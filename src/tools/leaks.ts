import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { debug } from "../utils/logger.js";

interface LeakEntry {
  title: string;
  retainedSize?: string;
  details?: string;
  elements?: string[];
  receivedAt: number;
}

const LEAK_BUFFER_SIZE = 50;
let leakBuffer: LeakEntry[] = [];

// LeakCanary v2 structured reports
flipperClient.on("plugin-message", ({ pluginId, method, data }) => {
  if (pluginId !== "LeakCanary") return;

  if (method === "reportLeak2") {
    const payload = data as { leaks?: Array<{ title: string; retainedSize?: string; details?: string; elements?: Array<{ className?: string; leakingStatus?: string; labels?: string[] }> }> };
    if (Array.isArray(payload?.leaks)) {
      for (const leak of payload.leaks) {
        leakBuffer.push({
          title: leak.title || "Unknown leak",
          retainedSize: leak.retainedSize,
          details: leak.details,
          elements: leak.elements?.map((el) =>
            `${el.className ?? "?"} (${el.leakingStatus ?? "?"})`,
          ),
          receivedAt: Date.now(),
        });
        if (leakBuffer.length > LEAK_BUFFER_SIZE) {
          leakBuffer.shift();
        }
      }
      debug(`[LeakCanary] Captured ${payload.leaks.length} leak(s)`);
    }
  }

  // LeakCanary v1 simple string reports
  if (method === "reportLeak") {
    const payload = data as { leaks?: string[] };
    if (Array.isArray(payload?.leaks)) {
      for (const leak of payload.leaks) {
        leakBuffer.push({
          title: leak.split("\n")[0] || "Unknown leak",
          details: leak,
          receivedAt: Date.now(),
        });
        if (leakBuffer.length > LEAK_BUFFER_SIZE) {
          leakBuffer.shift();
        }
      }
      debug(`[LeakCanary] Captured ${payload.leaks.length} leak(s) (v1)`);
    }
  }
});

export function registerLeakTools(server: McpServer): void {
  server.registerTool("flipper_get_leaks", {
    description:
      "Gets memory leak reports from LeakCanary captured by Flipper. " +
      "Shows leak traces with retained objects, reference chains, and retained sizes.",
    inputSchema: {
      count: z
        .number()
        .optional()
        .describe("Number of leaks to retrieve (default: 10)"),
      filter: z
        .string()
        .optional()
        .describe("Filter by text in the leak title or details"),
    },
  }, async (args) => {
    const count = args.count ?? 10;
    const filter = args.filter;

    let leaks = [...leakBuffer];

    if (filter) {
      const lower = filter.toLowerCase();
      leaks = leaks.filter(
        (l) =>
          l.title.toLowerCase().includes(lower) ||
          l.details?.toLowerCase().includes(lower),
      );
    }

    const recent = leaks.slice(-count);

    if (recent.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: "No memory leaks captured. Leaks are detected automatically by LeakCanary when they occur on a device connected to Flipper.",
        }],
      };
    }

    const formatted = recent
      .map((l, i) => {
        const date = new Date(l.receivedAt).toISOString();
        const lines = [`--- Leak #${i + 1} [${date}] ---`, `Title: ${l.title}`];
        if (l.retainedSize) {
          lines.push(`Retained size: ${l.retainedSize}`);
        }
        if (l.elements && l.elements.length > 0) {
          lines.push("Reference chain:");
          for (const el of l.elements) {
            lines.push(`  -> ${el}`);
          }
        }
        if (l.details) {
          lines.push(`Details:\n${l.details}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");

    return {
      content: [{
        type: "text" as const,
        text: `${recent.length} leak(s) found:\n\n${formatted}`,
      }],
    };
  });

  server.registerTool("flipper_clear_leaks", {
    description: "Clears the local buffer of captured memory leaks.",
  }, async () => {
    leakBuffer = [];
    return { content: [{ type: "text" as const, text: "Leak buffer cleared." }] };
  });
}
