import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { CrashLog } from "../flipper/types.js";
import { debug } from "../utils/logger.js";

interface CrashEntry extends CrashLog {
  serial?: string;
  receivedAt: number;
}

const CRASH_BUFFER_SIZE = 50;
let crashBuffer: CrashEntry[] = [];

flipperClient.on("crash", (data: CrashLog & { serial?: string }) => {
  crashBuffer.push({
    ...data,
    date: data.date || Date.now(),
    receivedAt: Date.now(),
  });
  if (crashBuffer.length > CRASH_BUFFER_SIZE) {
    crashBuffer.shift();
  }
  debug(`[CrashReporter] Crash captured: ${data.name} - ${data.reason}`);
});

export function registerCrashReporterTools(server: McpServer): void {
  server.registerTool("flipper_get_crashes", {
    description:
      "Obtiene los crash reports capturados del dispositivo Android conectado a Flipper.",
    inputSchema: {
      count: z
        .number()
        .optional()
        .describe("Número de crashes a recuperar (default: 10)"),
      filter: z
        .string()
        .optional()
        .describe(
          "Filtrar por texto en el nombre, razón o callstack del crash",
        ),
    },
  }, async (args) => {
    const count = args.count ?? 10;
    const filter = args.filter;

    let crashes = [...crashBuffer];

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      crashes = crashes.filter(
        (c) =>
          c.name?.toLowerCase().includes(lowerFilter) ||
          c.reason?.toLowerCase().includes(lowerFilter) ||
          c.callstack?.toLowerCase().includes(lowerFilter),
      );
    }

    const recent = crashes.slice(-count);

    if (recent.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No crashes captured yet. Crashes are detected automatically when the app crashes on a device connected to Flipper.",
          },
        ],
      };
    }

    const formatted = recent
      .map((c, i) => {
        const date = new Date(c.date || c.receivedAt).toISOString();
        const lines = [
          `--- Crash #${i + 1} [${date}] ---`,
          `Name: ${c.name}`,
          `Reason: ${c.reason}`,
        ];
        if (c.serial) {
          lines.push(`Device: ${c.serial}`);
        }
        if (c.callstack) {
          lines.push(`Callstack:\n${c.callstack}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${recent.length} crash(es) found:\n\n${formatted}`,
        },
      ],
    };
  });

  server.registerTool("flipper_clear_crashes", {
    description: "Limpia el buffer local de crash reports.",
  }, async () => {
    crashBuffer = [];
    return { content: [{ type: "text" as const, text: "Crash buffer cleared." }] };
  });
}
