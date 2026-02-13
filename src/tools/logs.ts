import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { DeviceLogEntry } from "../flipper/types.js";

const LOG_BUFFER_SIZE = 200;
let logBuffer: DeviceLogEntry[] = [];

flipperClient.on("log", (entry: DeviceLogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
});

export function registerLogTools(server: McpServer): void {
  server.registerTool("get_android_logs", {
    description:
      "Obtiene los últimos logs de la aplicación Android desde Flipper.",
    inputSchema: {
      count: z
        .number()
        .optional()
        .describe("Número de líneas de log a recuperar (default: 50)"),
      filter_tag: z
        .string()
        .optional()
        .describe("Filtrar por TAG específico"),
      level: z
        .enum(["verbose", "debug", "info", "warn", "error"])
        .optional()
        .describe("Nivel mínimo de log"),
    },
  }, async (args) => {
    const count = args.count ?? 50;
    const filterTag = args.filter_tag;
    const levelFilter = args.level;

    let logs = [...logBuffer];

    if (filterTag) {
      logs = logs.filter((l) =>
        l.tag.toLowerCase().includes(filterTag.toLowerCase()),
      );
    }

    if (levelFilter) {
      const levels = ["verbose", "debug", "info", "warn", "error"];
      const minLevelIndex = levels.indexOf(levelFilter);
      logs = logs.filter((l) => levels.indexOf(l.type) >= minLevelIndex);
    }

    const recentLogs = logs.slice(-count);
    const formattedLogs = recentLogs
      .map(
        (l) =>
          `[${l.date.split("T")[1]?.slice(0, 12) || l.date}] [${l.type.toUpperCase()}] [${l.tag}]: ${l.message.trim()}`,
      )
      .join("\n");

    return {
      content: [{ type: "text" as const, text: formattedLogs || "No logs found." }],
    };
  });

  server.registerTool("clear_logs", {
    description: "Limpia el buffer local de logs.",
  }, async () => {
    logBuffer = [];
    return { content: [{ type: "text" as const, text: "Logs cleared." }] };
  });
}
