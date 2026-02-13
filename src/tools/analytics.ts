import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { MeliaEvent } from "../flipper/types.js";

const ANALYTICS_PLUGIN_ID = "melia-analytics";
const ANALYTICS_METHOD = "analyticsEvent";
const BUFFER_SIZE = 100;

let analyticsBuffer: MeliaEvent[] = [];

function parseEventSource(event: string): string {
  if (event.startsWith("GA:")) return "GA";
  if (event.startsWith("AppsFlyer:")) return "AppsFlyer";
  return "Unknown";
}

flipperClient.on("plugin-message", ({ pluginId, method, data }) => {
  if (pluginId === ANALYTICS_PLUGIN_ID && method === ANALYTICS_METHOD) {
    const event = data as MeliaEvent;
    if (event.event && event.id !== undefined) {
      analyticsBuffer.push(event);
      if (analyticsBuffer.length > BUFFER_SIZE) {
        analyticsBuffer.shift();
      }
    }
  }
});

export function registerAnalyticsTools(server: McpServer): void {
  server.registerTool("flipper_get_analytics_events", {
    description:
      "Obtiene los últimos eventos de analytics (GA, AppsFlyer) capturados por Flipper.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Número de eventos a recuperar (default: 50)"),
      eventName: z
        .string()
        .optional()
        .describe(
          "Filtrar por nombre/tipo de evento (e.g. 'screen_view', 'purchase')",
        ),
      source: z
        .enum(["GA", "AppsFlyer"])
        .optional()
        .describe("Filtrar por fuente de analytics"),
      since: z
        .string()
        .optional()
        .describe("Filtrar eventos posteriores a esta fecha (ISO string)"),
    },
  }, async (args) => {
    const limit = args.limit ?? 50;
    const eventName = args.eventName;
    const source = args.source;
    const since = args.since;

    let events = [...analyticsBuffer];

    if (eventName) {
      events = events.filter(
        (e) =>
          e.origin.toLowerCase().includes(eventName.toLowerCase()) ||
          e.event.toLowerCase().includes(eventName.toLowerCase()),
      );
    }

    if (source) {
      events = events.filter((e) => parseEventSource(e.event) === source);
    }

    if (since) {
      const sinceDate = new Date(since).getTime();
      events = events.filter((e) => new Date(e.date).getTime() > sinceDate);
    }

    const recentEvents = events.slice(-limit);

    const formatted = recentEvents
      .map((e) => {
        const src = parseEventSource(e.event);
        return `[${e.date}] ${e.origin} (${src}): ${e.event}`;
      })
      .join("\n");

    return {
      content: [
        { type: "text" as const, text: formatted || "No analytics events found." },
      ],
    };
  });
}
