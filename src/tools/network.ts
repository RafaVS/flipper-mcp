import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { NetworkRequest, NetworkResponse } from "../flipper/types.js";
import { debug } from "../utils/logger.js";

const NETWORK_PLUGIN_IDS = ["Network GraphQL", "Network"];
const BUFFER_SIZE = 100;

interface NetworkEntry {
  request: NetworkRequest;
  response: NetworkResponse | null;
  pluginSource: string;
}

let networkBuffer: NetworkEntry[] = [];
const seenRequestIds = new Set<string>();

function decodeBase64(data: string): string {
  try {
    return Buffer.from(data, "base64").toString("utf-8");
  } catch {
    return data;
  }
}

function formatBody(data: string | null, maxLen = 500): string {
  if (data === null || data === undefined) return "(no body)";
  if (data === "") return "(empty body)";
  const decoded = decodeBase64(data);
  if (decoded.length > maxLen) return decoded.substring(0, maxLen) + "...";
  return decoded;
}

flipperClient.on("plugin-message", ({ pluginId, method, data }) => {
  if (!NETWORK_PLUGIN_IDS.includes(pluginId)) return;

  if (method === "newRequest") {
    const request = data as NetworkRequest;
    debug(`[Network] newRequest id=${request.id} url=${request.url} data_type=${typeof request.data} data_len=${request.data?.length ?? 'null'}`);
    if (request.id && !seenRequestIds.has(request.id)) {
      seenRequestIds.add(request.id);
      networkBuffer.push({ request, response: null, pluginSource: pluginId });

      if (networkBuffer.length > BUFFER_SIZE) {
        const removed = networkBuffer.shift();
        if (removed) {
          seenRequestIds.delete(removed.request.id);
        }
      }
    }
  }

  if (method === "newResponse") {
    const response = data as NetworkResponse;
    debug(`[Network] newResponse id=${response.id} status=${response.status} data_type=${typeof response.data} data_len=${response.data?.length ?? 'null'}`);
    if (response.id) {
      const entry = networkBuffer.find((e) => e.request.id === response.id);
      if (entry) {
        entry.response = response;
      }
    }
  }
});

export function registerNetworkTools(server: McpServer): void {
  server.registerTool("flipper_get_network_requests", {
    description:
      "Obtiene las últimas peticiones de red (GraphQL/REST) capturadas, incluyendo request y response.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Número de peticiones a recuperar (default: 20)"),
      method: z
        .string()
        .optional()
        .describe("Filtrar por método HTTP (GET, POST)"),
      urlContains: z
        .string()
        .optional()
        .describe("Filtrar por URL parcial"),
      source: z
        .enum(["graphql", "rest"])
        .optional()
        .describe(
          "Filtrar por tipo de red: 'graphql' para Network GraphQL, 'rest' para Network",
        ),
      status: z
        .number()
        .optional()
        .describe(
          "Filtrar por código de estado HTTP de la respuesta (e.g. 200, 401, 500)",
        ),
    },
  }, async (args) => {
    const limit = args.limit ?? 20;
    const methodFilter = args.method;
    const urlContains = args.urlContains;
    const source = args.source;
    const statusFilter = args.status;

    let entries = [...networkBuffer];

    if (methodFilter) {
      entries = entries.filter((e) => e.request.method === methodFilter);
    }

    if (urlContains) {
      entries = entries.filter((e) => e.request.url.includes(urlContains));
    }

    if (source) {
      const pluginId =
        source === "graphql" ? "Network GraphQL" : "Network";
      entries = entries.filter((e) => e.pluginSource === pluginId);
    }

    if (statusFilter !== undefined) {
      entries = entries.filter((e) => e.response?.status === statusFilter);
    }

    const recentEntries = entries.slice(-limit);

    const formatted = recentEntries
      .map((e) => {
        const r = e.request;
        const res = e.response;
        const tag = e.pluginSource === "Network GraphQL" ? "[GraphQL]" : "[REST]";

        const reqPreview = formatBody(r.data);

        let responseLine = "    Response: (pending)";
        if (res) {
          const duration = res.timestamp - r.timestamp;
          const resPreview = formatBody(res.data);
          responseLine = `    Response: ${res.status} (${duration}ms)\n    Response Body: ${resPreview}`;
        }

        return `${tag} [${new Date(r.timestamp).toISOString()}] ${r.method} ${r.url}\n    Request Body: ${reqPreview}\n${responseLine}`;
      })
      .join("\n\n");

    return {
      content: [
        { type: "text" as const, text: formatted || "No network requests found." },
      ],
    };
  });
}
