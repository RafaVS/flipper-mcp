import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { resolveSerial } from "../flipper/device.js";
import { debug } from "../utils/logger.js";

export function registerShellTools(server: McpServer): void {
  server.registerTool("flipper_shell_exec", {
    description:
      "Executes an ADB shell command on the connected Android device via Flipper. " +
      "Useful for: dumpsys (activity, meminfo, battery, package), getprop, pm list packages, " +
      "logcat -d, settings, am start/broadcast, input tap/text, and reading proc files.",
    inputSchema: {
      command: z
        .string()
        .describe("The shell command to execute (e.g. 'dumpsys activity top', 'logcat -d -t 50')"),
      serial: z
        .string()
        .optional()
        .describe("Device serial. If omitted, uses the first connected device"),
    },
  }, async (args) => {
    try {
      const serial = await resolveSerial(args.serial);
      debug(`[Shell] Executing on ${serial}: ${args.command}`);

      const result = await flipperClient.exec("device-shell-exec", [serial, args.command]);
      const output = typeof result === "string" ? result : JSON.stringify(result);

      return {
        content: [{ type: "text" as const, text: output || "(empty output)" }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error executing shell command: ${msg}` }],
        isError: true,
      };
    }
  });
}
