import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { resolveSerial } from "../flipper/device.js";
import { debug } from "../utils/logger.js";

export function registerNavigateTools(server: McpServer): void {
  server.registerTool("flipper_navigate", {
    description:
      "Navigates to a deep link URI on the connected Android device. " +
      "Executes 'am start' with the given URI. Useful for opening specific screens, " +
      "testing deep links, and reproducing navigation flows.",
    inputSchema: {
      uri: z
        .string()
        .describe("Deep link URI to navigate to (e.g. 'myapp://profile/123', 'https://example.com/path')"),
      serial: z
        .string()
        .optional()
        .describe("Device serial. If omitted, uses the first connected device"),
    },
  }, async (args) => {
    try {
      const serial = await resolveSerial(args.serial);
      debug(`[Navigate] Navigating to ${args.uri} on ${serial}`);

      await flipperClient.exec("device-navigate", [serial, args.uri]);

      return {
        content: [{
          type: "text" as const,
          text: `Navigated to: ${args.uri}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error navigating: ${msg}` }],
        isError: true,
      };
    }
  });
}
