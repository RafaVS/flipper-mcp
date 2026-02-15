#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { flipperClient } from "./flipper/client.js";

import { registerLogTools } from "./tools/logs.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerViewModelTools } from "./tools/viewmodel.js";
import { registerPreferencesTools } from "./tools/preferences.js";
import { registerFcmTools } from "./tools/fcm.js";
import { registerCrashReporterTools } from "./tools/crashreporter.js";
import { registerScreenshotTools } from "./tools/screenshot.js";
import { registerDatabaseTools } from "./tools/database.js";
import { registerShellTools } from "./tools/shell.js";
import { registerUIInspectorTools } from "./tools/ui-inspector.js";
import { registerNavigateTools } from "./tools/navigate.js";

const server = new McpServer({
  name: "flipper-logs-bridge",
  version: "1.0.0",
});

// Register all tools
registerLogTools(server);
registerAnalyticsTools(server);
registerNetworkTools(server);
registerViewModelTools(server);
registerPreferencesTools(server);
registerFcmTools(server);
registerCrashReporterTools(server);
registerScreenshotTools(server);
registerDatabaseTools(server);
registerShellTools(server);
registerUIInspectorTools(server);
registerNavigateTools(server);

// Start Flipper connection
flipperClient.connect();

// Start MCP server
const transport = new StdioServerTransport();
async function main() {
  await server.connect(transport);
  console.error("Flipper MCP Server running on stdio");
}

main().catch((err) => console.error("Fatal error:", err));

// Graceful shutdown
async function shutdown() {
  console.error("Shutting down...");
  flipperClient.disconnect();
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
