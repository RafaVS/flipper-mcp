import WebSocket from "ws";
import { EventEmitter } from "events";
import { DeviceLogEntry, CrashLog } from "./types.js";
import { debug } from "../utils/logger.js";

const FLIPPER_HOST = process.env.FLIPPER_HOST ?? "localhost";
const FLIPPER_PORT = process.env.FLIPPER_PORT ?? "52342";

/* eslint-disable @typescript-eslint/no-explicit-any --
   Flipper WebSocket messages are dynamic JSON; a recursive index type
   is the pragmatic choice here. */
interface FlipperWsMessage {
  event?: string;
  method?: string;
  payload?: Record<string, unknown>;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export class FlipperClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private nextRequestId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();

  public get connected(): boolean {
    return this.isConnected;
  }

  constructor() {
    super();
  }

  /**
   * Send an exec command to Flipper server API and wait for the response.
   * Uses the same protocol as Flipper Desktop browser UI.
   */
  public exec(
    command: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = this.nextRequestId++;
      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({
        event: "exec",
        payload: { id, command, args },
      });

      debug(`[FlipperClient] EXEC id=${id} command=${command}`);
      this.ws.send(message);

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${id} (${command}) timed out`));
        }
      }, 10000);
    });
  }

  /**
   * Send a plugin method request to a device client and wait for the response.
   * Uses the init + execute (without id) pattern so the device response
   * arrives as a client-message instead of being silently dropped by the server.
   */
  public async execPluginMethod(
    clientId: string,
    api: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    // 1. Init the plugin (activate receivers on device)
    await this.exec("client-request", [
      clientId,
      { method: "init", params: { plugin: api } },
    ]);

    // Small delay to let the device register plugin receivers
    await new Promise((r) => setTimeout(r, 500));

    // 2. Set up one-shot listener for the response via client-message
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener("client-message", handler);
        reject(new Error(`Plugin method ${api}.${method} timed out`));
      }, 10000);

      const handler = (data: unknown) => {
        // Device responses have 'success' or 'error' key, NOT 'method' (which plugin push events have)
        if (data && typeof data === "object" && !("method" in data)) {
          const rec = data as Record<string, unknown>;
          if ("success" in rec) {
            clearTimeout(timeout);
            this.removeListener("client-message", handler);
            resolve(rec.success);
          } else if ("error" in rec) {
            clearTimeout(timeout);
            this.removeListener("client-message", handler);
            reject(new Error(JSON.stringify(rec.error)));
          }
        }
      };

      this.on("client-message", handler);

      // 3. Send execute WITHOUT id in the inner payload
      //    so the response isn't dropped by the server's matchPendingRequest
      this.exec("client-request", [
        clientId,
        {
          method: "execute",
          params: { api, method, params },
        },
      ]).catch(() => {
        // exec resolves with server ack (client-request is fire-and-forget)
        // Actual response comes via client-message
      });
    });
  }

  /**
   * Send a fire-and-forget plugin message to a device client.
   * Use this for methods like `mockResponses` that do not return a response.
   */
  public async sendPluginMessage(
    clientId: string,
    api: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    // Init the plugin so the device registers receivers
    await this.exec("client-request", [
      clientId,
      { method: "init", params: { plugin: api } },
    ]);

    await new Promise((r) => setTimeout(r, 300));

    // Send the message without waiting for a response
    await this.exec("client-request", [
      clientId,
      {
        method: "execute",
        params: { api, method, params },
      },
    ]);

    debug(`[FlipperClient] sendPluginMessage ${api}.${method} sent (fire-and-forget)`);
  }

  public connect() {
    const token = process.env.FLIPPER_TOKEN;
    if (!token) {
      throw new Error(
        "FLIPPER_TOKEN environment variable is not set. " +
        "Please restart with: FLIPPER_TOKEN=<your-token> npm start",
      );
    }

    // Evitar leaks cerrando conexión anterior
    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
    }

    const wsUrl = `ws://${FLIPPER_HOST}:${FLIPPER_PORT}/?token=${token}`;
    this.ws = new WebSocket(wsUrl, {
      headers: {
        Origin: `http://${FLIPPER_HOST}:${FLIPPER_PORT}`,
      },
    });

    this.ws.on("open", () => {
      console.error("✅ Conectado a Flipper WebSocket");
      this.isConnected = true;
      this.stopReconnect();
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      try {
        const message = data.toString();
        const json = JSON.parse(message);
        this.handleMessage(json);
      } catch (e) {
        debug(
          "Error parsing Flipper message:",
          data.toString().slice(0, 100),
        );
      }
    });

    this.ws.on("error", (err) => {
      console.error("❌ Error en WebSocket Flipper:", err.message);
    });

    this.ws.on("close", () => {
      console.error("⚠️ Conexión cerrada. Reintentando...");
      this.isConnected = false;
      this.startReconnect();
    });
  }

  private handleMessage(json: FlipperWsMessage) {
    const payload = json.payload;
    const payloadEvent = payload?.event as string | undefined;
    const payloadData = payload?.data as Record<string, unknown> | undefined;

    if (
      !(json.event === "server-event" && payloadEvent === "device-log")
    ) {
      debug(
        `[FlipperClient] MSG event=${json.event} method=${json.method} payload_event=${payloadEvent} has_success=${!!(payloadData?.success)}`,
      );
    }

    // 1. Device Logs
    if (json.event === "server-event" && payloadEvent === "device-log") {
      const entry = (payloadData?.entry) as DeviceLogEntry;
      this.emit("log", entry);
      return;
    }

    // 1.1 Device Crashes
    if (json.event === "server-event" && payloadEvent === "device-crash") {
      const crash = payloadData?.crash as CrashLog | undefined;
      const serial = payloadData?.serial as string | undefined;
      if (crash) {
        this.emit("crash", { ...crash, serial });
      }
      return;
    }

    // 1.5 Handle 'client-message' wrapper (device responses & plugin push events)
    if (json.event === "server-event" && payloadEvent === "client-message") {
      const rawInner = payloadData?.message;
      if (typeof rawInner === "string") {
        try {
          const innerJson = JSON.parse(rawInner) as FlipperWsMessage;
          this.emit("client-message", innerJson);
          this.handleMessage(innerJson);
          return;
        } catch (e) {
          debug("Error parsing inner client-message:", e);
        }
      }
    }

    // 2. Exec Responses (success or error) — resolve pending requests
    if (
      json.event === "exec-response" ||
      json.event === "exec-response-error"
    ) {
      const requestId = payload?.id as number | undefined;
      const pending = requestId !== undefined
        ? this.pendingRequests.get(requestId)
        : undefined;

      if (json.event === "exec-response-error") {
        debug(
          `[FlipperClient] EXEC ERROR id=${requestId}: ${JSON.stringify(payloadData ?? payload).slice(0, 500)}`,
        );
      }

      if (pending && requestId !== undefined) {
        this.pendingRequests.delete(requestId);
        if (json.event === "exec-response-error") {
          pending.reject(
            new Error(
              JSON.stringify(payloadData ?? payload?.message ?? "Unknown error"),
            ),
          );
        } else {
          debug(
            `[FlipperClient] EXEC RESPONSE id=${requestId} raw payload: ${JSON.stringify(payload).slice(0, 500)}`,
          );
          const success = payloadData?.success;
          pending.resolve(success ?? payloadData);
        }
      }
      // Also emit for passive listeners
      if (json.event === "exec-response" && payloadData?.success) {
        this.emit("exec-response", payloadData.success);
      }
      return;
    }

    // 3. Plugin Messages (Generic)
    if (json.method === "execute" || json.method === "fireAndForget") {
      const params = json.params;
      const api = params?.api as string | undefined;
      const method = params?.method as string | undefined;
      const data = params?.params;

      if (api && method) {
        this.emit("plugin-message", { pluginId: api, method, data });
      }
    }
  }

  private startReconnect() {
    if (!this.reconnectInterval) {
      this.reconnectInterval = setInterval(() => {
        if (!this.isConnected) {
          this.connect();
        }
      }, 5000);
    }
  }

  private stopReconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  public disconnect(): void {
    this.stopReconnect();

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error("Client disconnected"));
      this.pendingRequests.delete(id);
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.isConnected = false;
  }
}

export const flipperClient = new FlipperClient();
