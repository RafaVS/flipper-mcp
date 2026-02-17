import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { resolveClientId } from "../flipper/device.js";
import { MockRoute } from "../flipper/types.js";
import { debug } from "../utils/logger.js";

const NETWORK_GRAPHQL_PLUGIN_ID = "Network GraphQL";
const NETWORK_REST_PLUGIN_ID = "Network";

// In-memory store of active mocks.
// Key = `${method}:${requestUrl}:${operation}` for uniqueness.
const activeMocks = new Map<string, MockRoute>();

function mockKey(route: Pick<MockRoute, "method" | "requestUrl" | "operation">): string {
  return `${route.method.toUpperCase()}:${route.requestUrl}:${route.operation}`;
}

async function pushMocksToDevice(): Promise<void> {
  const clientId = await resolveClientId();
  const allRoutes = Array.from(activeMocks.values());

  // GraphQL mocks go to "Network GraphQL" plugin (have an operation name)
  const graphqlRoutes = allRoutes.filter((r) => r.operation !== "");
  // REST mocks go to the native "Network" plugin (no operation name)
  const restRoutes = allRoutes.filter((r) => r.operation === "");

  const sends: Promise<void>[] = [];

  if (graphqlRoutes.length > 0 || restRoutes.length > 0) {
    // Always push to both plugins so each one has its current set of mocks.
    // An empty array clears mocks on the device side.
    debug(`[Mock] Pushing ${graphqlRoutes.length} GraphQL + ${restRoutes.length} REST mock(s) to device`);

    sends.push(
      flipperClient.sendPluginMessage(
        clientId,
        NETWORK_GRAPHQL_PLUGIN_ID,
        "mockResponses",
        { routes: graphqlRoutes },
      ),
    );
    sends.push(
      flipperClient.sendPluginMessage(
        clientId,
        NETWORK_REST_PLUGIN_ID,
        "mockResponses",
        { routes: restRoutes },
      ),
    );
  } else {
    // No mocks left — clear both plugins
    debug("[Mock] No mocks left, clearing both plugins");
    sends.push(
      flipperClient.sendPluginMessage(clientId, NETWORK_GRAPHQL_PLUGIN_ID, "mockResponses", { routes: [] }),
    );
    sends.push(
      flipperClient.sendPluginMessage(clientId, NETWORK_REST_PLUGIN_ID, "mockResponses", { routes: [] }),
    );
  }

  await Promise.all(sends);
}

export function registerMockTools(server: McpServer): void {
  // ─────────────────────────────────────────────
  // flipper_add_mock
  // ─────────────────────────────────────────────
  server.registerTool("flipper_add_mock", {
    description:
      "Añade o actualiza un mock de red en la app Android conectada a Flipper. " +
      "Funciona tanto para peticiones REST (plugin 'Network') como GraphQL (plugin 'Network GraphQL'). " +
      "Si se indica 'operation', el mock se envía al plugin GraphQL; si se deja vacío, al plugin REST. " +
      "Usa flipper_list_mocks para ver los mocks activos.",
    inputSchema: {
      requestUrl: z
        .string()
        .describe("URL completa a interceptar (ej: https://api.melia.com/graphql)"),
      method: z
        .string()
        .default("POST")
        .describe("Método HTTP: GET, POST, PUT, DELETE, PATCH (default: POST)"),
      operation: z
        .string()
        .default("")
        .describe("GraphQL operation name (ej: GetHotel). Dejar vacío para peticiones REST."),
      status: z
        .number()
        .default(200)
        .describe("HTTP status code de la respuesta mock (default: 200)"),
      data: z
        .string()
        .describe("Body de la respuesta mock como JSON string (ej: '{\"data\":{\"hotel\":null}}')"),
      headers: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .optional()
        .describe("Headers de la respuesta mock (default: Content-Type: application/json)"),
      enabled: z
        .boolean()
        .default(true)
        .describe("Si el mock está activo (default: true)"),
    },
  }, async (args) => {
    try {
      const route: MockRoute = {
        requestUrl: args.requestUrl,
        method: args.method.toUpperCase(),
        operation: args.operation,
        status: String(args.status),
        data: args.data,
        headers: args.headers ?? [
          { key: "Content-Type", value: "application/json" },
        ],
        enabled: args.enabled,
      };

      const key = mockKey(route);
      const isUpdate = activeMocks.has(key);
      activeMocks.set(key, route);

      debug(`[Mock] ${isUpdate ? "Updated" : "Added"} mock: ${key}`);

      await pushMocksToDevice();

      const label = route.operation
        ? `${route.method} ${route.operation} → ${route.requestUrl}`
        : `${route.method} ${route.requestUrl}`;

      return {
        content: [{
          type: "text" as const,
          text: `Mock ${isUpdate ? "actualizado" : "añadido"}: ${label}\nStatus: ${route.status}\nBody: ${route.data}\nTotal mocks activos: ${activeMocks.size}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error añadiendo mock: ${msg}` }],
        isError: true,
      };
    }
  });

  // ─────────────────────────────────────────────
  // flipper_remove_mock
  // ─────────────────────────────────────────────
  server.registerTool("flipper_remove_mock", {
    description:
      "Elimina un mock activo de la app Android (REST o GraphQL). " +
      "Usa flipper_list_mocks para ver los mocks activos y sus parámetros exactos.",
    inputSchema: {
      requestUrl: z
        .string()
        .describe("URL del mock a eliminar (debe coincidir exactamente con el añadido)"),
      method: z
        .string()
        .default("POST")
        .describe("Método HTTP del mock (default: POST)"),
      operation: z
        .string()
        .default("")
        .describe("GraphQL operation name del mock (vacío para REST)"),
    },
  }, async (args) => {
    try {
      const key = mockKey({
        method: args.method.toUpperCase(),
        requestUrl: args.requestUrl,
        operation: args.operation,
      });

      if (!activeMocks.has(key)) {
        return {
          content: [{
            type: "text" as const,
            text: `No se encontró ningún mock para: ${key}\nUsa flipper_list_mocks para ver los mocks activos.`,
          }],
          isError: true,
        };
      }

      activeMocks.delete(key);
      debug(`[Mock] Removed mock: ${key}`);

      await pushMocksToDevice();

      return {
        content: [{
          type: "text" as const,
          text: `Mock eliminado: ${key}\nTotal mocks activos: ${activeMocks.size}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error eliminando mock: ${msg}` }],
        isError: true,
      };
    }
  });

  // ─────────────────────────────────────────────
  // flipper_list_mocks
  // ─────────────────────────────────────────────
  server.registerTool("flipper_list_mocks", {
    description:
      "Lista todos los mocks de red activos actualmente en la app Android (REST y GraphQL).",
    inputSchema: {},
  }, async () => {
    if (activeMocks.size === 0) {
      return {
        content: [{
          type: "text" as const,
          text: "No hay mocks activos. Usa flipper_add_mock para añadir uno.",
        }],
      };
    }

    const lines = Array.from(activeMocks.values()).map((route, i) => {
      const label = route.operation
        ? `${route.method} ${route.operation} → ${route.requestUrl}`
        : `${route.method} ${route.requestUrl}`;
      const bodyPreview = route.data.length > 200
        ? route.data.substring(0, 200) + "..."
        : route.data;
      const status = route.enabled ? "✓ activo" : "✗ desactivado";
      return `[${i + 1}] ${label}\n    Status: ${route.status} | ${status}\n    Body: ${bodyPreview}`;
    });

    return {
      content: [{
        type: "text" as const,
        text: `Mocks activos (${activeMocks.size}):\n\n${lines.join("\n\n")}`,
      }],
    };
  });

  // ─────────────────────────────────────────────
  // flipper_clear_mocks
  // ─────────────────────────────────────────────
  server.registerTool("flipper_clear_mocks", {
    description:
      "Elimina todos los mocks activos (REST y GraphQL) y restaura el comportamiento de red real en la app Android.",
    inputSchema: {},
  }, async () => {
    try {
      const count = activeMocks.size;

      if (count === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No había mocks activos.",
          }],
        };
      }

      activeMocks.clear();
      debug("[Mock] Cleared all mocks");

      await pushMocksToDevice();

      return {
        content: [{
          type: "text" as const,
          text: `${count} mock(s) eliminados. La app vuelve a usar las respuestas reales del servidor.`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error limpiando mocks: ${msg}` }],
        isError: true,
      };
    }
  });
}
