import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { resolveSerial } from "../flipper/device.js";
import { debug } from "../utils/logger.js";

export function registerScreenshotTools(server: McpServer): void {
  server.registerTool("flipper_take_screenshot", {
    description:
      "Takes a screenshot of the connected Android device screen. " +
      "Returns the image as base64 PNG for visual analysis.",
    inputSchema: {
      serial: z
        .string()
        .optional()
        .describe("Device serial. If omitted, uses the first connected device"),
    },
  }, async (args) => {
    try {
      const serial = await resolveSerial(args.serial);
      debug(`[Screenshot] Taking screenshot on ${serial}`);

      const result = await flipperClient.exec("device-take-screenshot", [serial]);

      if (typeof result !== "string" || result.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "Failed to capture screenshot: empty response from device",
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "image" as const,
          data: result,
          mimeType: "image/png",
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error taking screenshot: ${msg}` }],
        isError: true,
      };
    }
  });
}
