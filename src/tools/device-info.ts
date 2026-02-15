import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import type { DeviceDescription, ClientDescription } from "../flipper/device.js";

export function registerDeviceInfoTools(server: McpServer): void {
  server.registerTool("flipper_list_devices", {
    description:
      "Lists all devices connected to Flipper with their details. " +
      "Shows serial number, device name, OS, type (physical/emulator), and connection status.",
  }, async () => {
    try {
      const devices = (await flipperClient.exec("device-list", [])) as DeviceDescription[];

      if (!Array.isArray(devices) || devices.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No devices connected to Flipper.",
          }],
        };
      }

      const formatted = devices.map((d) => {
        const status = d.connected ? "connected" : "disconnected";
        return `${d.title}\n  Serial: ${d.serial}\n  OS: ${d.os}\n  Type: ${d.deviceType}\n  Status: ${status}`;
      }).join("\n\n");

      return {
        content: [{
          type: "text" as const,
          text: `${devices.length} device(s):\n\n${formatted}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error listing devices: ${msg}` }],
        isError: true,
      };
    }
  });

  server.registerTool("flipper_list_apps", {
    description:
      "Lists all app clients connected to Flipper. " +
      "Shows the client ID, app name, device, OS, and SDK version for each connected app.",
  }, async () => {
    try {
      const clients = (await flipperClient.exec("client-list", [])) as ClientDescription[];

      if (!Array.isArray(clients) || clients.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No app clients connected to Flipper.",
          }],
        };
      }

      const formatted = clients.map((c) => {
        const lines = [
          c.query.app,
          `  Client ID: ${c.id}`,
          `  Device: ${c.query.device_id}`,
          `  OS: ${c.query.os}`,
        ];
        if (c.query.sdk_version != null) {
          lines.push(`  SDK version: ${c.query.sdk_version}`);
        }
        return lines.join("\n");
      }).join("\n\n");

      return {
        content: [{
          type: "text" as const,
          text: `${clients.length} app(s) connected:\n\n${formatted}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error listing apps: ${msg}` }],
        isError: true,
      };
    }
  });
}
