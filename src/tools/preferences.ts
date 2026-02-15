import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { resolveClientId } from "../flipper/device.js";
import { PreferenceChange } from "../flipper/types.js";
import { debug } from "../utils/logger.js";

const PREFERENCES_PLUGIN_ID = "Preferences";
const CHANGE_EVENT = "sharedPreferencesChange";
const CHANGE_BUFFER_SIZE = 50;

let preferencesSnapshot: Record<string, Record<string, unknown>> = {};
let changesBuffer: PreferenceChange[] = [];

flipperClient.on("plugin-message", ({ pluginId, method, data }) => {
  if (pluginId === PREFERENCES_PLUGIN_ID && method === CHANGE_EVENT) {
    const change = data as PreferenceChange;
    if (change.preferences && change.name) {
      changesBuffer.push(change);
      if (changesBuffer.length > CHANGE_BUFFER_SIZE) {
        changesBuffer.shift();
      }
      if (preferencesSnapshot[change.preferences]) {
        if (change.deleted) {
          delete preferencesSnapshot[change.preferences][change.name];
        } else {
          preferencesSnapshot[change.preferences][change.name] = change.value;
        }
      }
    }
  }
});

flipperClient.on("exec-response", (success: Record<string, unknown>) => {
  mergeSnapshot(success);
});

function mergeSnapshot(data: Record<string, unknown>) {
  let merged = 0;
  for (const [storeName, storeData] of Object.entries(data)) {
    if (
      storeData !== null &&
      typeof storeData === "object" &&
      !Array.isArray(storeData)
    ) {
      preferencesSnapshot[storeName] = storeData as Record<string, unknown>;
      merged++;
    }
  }
  if (merged > 0) {
    debug(
      `[Preferences] Merged ${merged} stores (total: ${Object.keys(preferencesSnapshot).length})`,
    );
  }
  return merged;
}

async function fetchPreferencesFromDevice(): Promise<boolean> {
  try {
    const clients = await flipperClient.exec("client-list", []);
    debug(
      `[Preferences] client-list response: ${JSON.stringify(clients).slice(0, 300)}`,
    );

    if (!Array.isArray(clients) || clients.length === 0) {
      debug("[Preferences] No clients connected");
      return false;
    }

    for (const client of clients) {
      const clientId = (client as Record<string, unknown>).id as string;
      debug(`[Preferences] Trying client: ${clientId}`);

      try {
        const result = await flipperClient.execPluginMethod(
          clientId,
          PREFERENCES_PLUGIN_ID,
          "getAllSharedPreferences",
          {},
        );

        debug(
          `[Preferences] Got response: ${JSON.stringify(result).slice(0, 300)}`,
        );

        if (result && typeof result === "object") {
          mergeSnapshot(result as Record<string, unknown>);
          return true;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        debug(`[Preferences] Failed for ${clientId}: ${msg}`);
      }
    }

    return false;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    debug(`[Preferences] fetchPreferencesFromDevice error: ${msg}`);
    return false;
  }
}

export function registerPreferencesTools(server: McpServer): void {
  server.registerTool("flipper_get_preferences", {
    description: "Obtiene los cambios en SharedPreferences y DataStore.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Límite de registros (default: 20)"),
      store: z
        .string()
        .optional()
        .describe("Filtrar por nombre del archivo de preferencias"),
      key: z.string().optional().describe("Filtrar por clave"),
    },
  }, async (args) => {
    const storeFilter = args.store;
    const keyFilter = args.key;
    const limit = args.limit ?? 20;

    if (Object.keys(preferencesSnapshot).length === 0) {
      debug("[Preferences] No snapshot cached, fetching from device...");
      await fetchPreferencesFromDevice();
    }

    const storeNames = Object.keys(preferencesSnapshot);

    if (storeNames.length === 0 && changesBuffer.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No preferences data available. Make sure a device with the Preferences plugin is connected to Flipper.",
          },
        ],
      };
    }

    if (storeNames.length > 0) {
      const stores = storeFilter
        ? storeNames.filter((s) =>
            s.toLowerCase().includes(storeFilter.toLowerCase()),
          )
        : storeNames;

      const lines: string[] = [];

      for (const storeName of stores) {
        const storeData = preferencesSnapshot[storeName];
        if (!storeData || typeof storeData !== "object") continue;

        let entries = Object.entries(storeData);

        if (keyFilter) {
          entries = entries.filter(([k]) =>
            k.toLowerCase().includes(keyFilter.toLowerCase()),
          );
        }

        if (entries.length === 0) continue;

        lines.push(`\n[${storeName}]`);
        for (const [key, value] of entries.slice(0, limit)) {
          const val =
            typeof value === "object" ? JSON.stringify(value) : String(value);
          const preview =
            val.length > 200 ? val.substring(0, 200) + "..." : val;
          lines.push(`  ${key} = ${preview}`);
        }
        if (entries.length > limit) {
          lines.push(`  ... and ${entries.length - limit} more keys`);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: lines.length > 0
              ? lines.join("\n")
              : "No preferences matched the filter.",
          },
        ],
      };
    }

    let changes = [...changesBuffer];
    if (storeFilter) {
      changes = changes.filter((c) => c.preferences === storeFilter);
    }
    if (keyFilter) {
      changes = changes.filter((c) => c.name === keyFilter);
    }

    const recentChanges = changes.slice(-limit);
    const formatted = recentChanges
      .map((c) => {
        const val =
          typeof c.value === "object" ? JSON.stringify(c.value) : c.value;
        return `[${new Date(c.time).toISOString()}] [${c.preferences}] ${c.name} = ${val} ${c.deleted ? "(DELETED)" : ""}`;
      })
      .join("\n");

    return {
      content: [
        { type: "text" as const, text: formatted || "No preference changes found." },
      ],
    };
  });

  server.registerTool("flipper_set_preference", {
    description:
      "Sets a SharedPreference value on the connected Android app. " +
      "Useful for toggling feature flags, resetting onboarding, or forcing app states without recompiling.",
    inputSchema: {
      store: z
        .string()
        .describe("SharedPreferences file name (from flipper_get_preferences)"),
      key: z.string().describe("Preference key to set"),
      value: z
        .string()
        .describe("Value to set (will be stored as-is)"),
    },
  }, async (args) => {
    try {
      const clientId = await resolveClientId();
      debug(`[Preferences] Setting ${args.store}.${args.key} = ${args.value}`);

      await flipperClient.execPluginMethod(
        clientId,
        PREFERENCES_PLUGIN_ID,
        "setSharedPreference",
        {
          sharedPreferencesName: args.store,
          preferenceName: args.key,
          preferenceValue: args.value,
        },
      );

      // Update local snapshot
      if (!preferencesSnapshot[args.store]) {
        preferencesSnapshot[args.store] = {};
      }
      preferencesSnapshot[args.store][args.key] = args.value;

      return {
        content: [{
          type: "text" as const,
          text: `Set [${args.store}] ${args.key} = ${args.value}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error setting preference: ${msg}` }],
        isError: true,
      };
    }
  });

  server.registerTool("flipper_delete_preference", {
    description:
      "Deletes a SharedPreference key from the connected Android app.",
    inputSchema: {
      store: z
        .string()
        .describe("SharedPreferences file name"),
      key: z.string().describe("Preference key to delete"),
    },
  }, async (args) => {
    try {
      const clientId = await resolveClientId();
      debug(`[Preferences] Deleting ${args.store}.${args.key}`);

      await flipperClient.execPluginMethod(
        clientId,
        PREFERENCES_PLUGIN_ID,
        "deleteSharedPreference",
        {
          sharedPreferencesName: args.store,
          preferenceName: args.key,
        },
      );

      // Update local snapshot
      if (preferencesSnapshot[args.store]) {
        delete preferencesSnapshot[args.store][args.key];
      }

      return {
        content: [{
          type: "text" as const,
          text: `Deleted [${args.store}] ${args.key}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error deleting preference: ${msg}` }],
        isError: true,
      };
    }
  });
}
