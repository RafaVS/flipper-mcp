import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { resolveClientId } from "../flipper/device.js";
import { debug } from "../utils/logger.js";

const INSPECTOR_PLUGIN = "Inspector";

interface InspectorNode {
  id: string;
  name: string;
  decoration?: string;
  children?: string[];
  attributes?: Array<{ name: string; value: string }>;
  data?: Record<string, Record<string, unknown>>;
  extraInfo?: Record<string, string>;
}

interface SearchResult {
  results: { id: string }[] | null;
  query: string;
}

async function inspectorExec(method: string, params: Record<string, unknown>): Promise<unknown> {
  const clientId = await resolveClientId();
  return flipperClient.execPluginMethod(clientId, INSPECTOR_PLUGIN, method, params);
}

function formatNode(node: InspectorNode, indent: number = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  const decoration = node.decoration ? ` (${node.decoration})` : "";
  lines.push(`${pad}${node.name}${decoration} [id: ${node.id}]`);

  if (node.attributes && node.attributes.length > 0) {
    for (const attr of node.attributes) {
      lines.push(`${pad}  @${attr.name} = ${attr.value}`);
    }
  }

  if (node.data) {
    for (const [section, values] of Object.entries(node.data)) {
      const entries = Object.entries(values);
      if (entries.length === 0) continue;
      lines.push(`${pad}  [${section}]`);
      for (const [key, value] of entries) {
        const val = typeof value === "object" ? JSON.stringify(value) : String(value);
        const preview = val.length > 120 ? val.substring(0, 117) + "..." : val;
        lines.push(`${pad}    ${key}: ${preview}`);
      }
    }
  }

  return lines.join("\n");
}

export function registerUIInspectorTools(server: McpServer): void {
  server.registerTool("flipper_get_view_tree", {
    description:
      "Gets the root view hierarchy of the connected Android app. " +
      "Returns the tree of UI elements with their IDs, names, and attributes. " +
      "Use the node IDs with flipper_get_node_details for more information.",
    inputSchema: {
      depth: z
        .number()
        .optional()
        .describe("Max depth of the tree to return (default: 3)"),
    },
  }, async (args) => {
    const maxDepth = args.depth ?? 3;

    try {
      const root = (await inspectorExec("getRoot", {})) as InspectorNode;

      if (!root) {
        return {
          content: [{
            type: "text" as const,
            text: "No view root found. Make sure an app with the Inspector plugin is connected to Flipper.",
          }],
        };
      }

      debug(`[Inspector] Got root: ${root.name} (${root.id}), children: ${root.children?.length ?? 0}`);

      // Recursively fetch children up to maxDepth
      const lines: string[] = [formatNode(root, 0)];
      if (root.children && root.children.length > 0 && maxDepth > 0) {
        await expandChildren(root.children, 1, maxDepth, lines);
      }

      return {
        content: [{
          type: "text" as const,
          text: lines.join("\n"),
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error getting view tree: ${msg}` }],
        isError: true,
      };
    }
  });

  server.registerTool("flipper_get_node_details", {
    description:
      "Gets detailed information about specific UI nodes by their IDs. " +
      "Returns attributes, layout data, and properties for each node. " +
      "Get node IDs from flipper_get_view_tree or flipper_search_view.",
    inputSchema: {
      ids: z
        .array(z.string())
        .describe("Array of node IDs to inspect"),
    },
  }, async (args) => {
    try {
      const result = (await inspectorExec("getNodes", {
        ids: args.ids,
      })) as { elements: InspectorNode[] };

      const nodes = result?.elements ?? [];

      if (nodes.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No nodes found for IDs: ${args.ids.join(", ")}`,
          }],
        };
      }

      const formatted = nodes.map((node) => formatNode(node, 0)).join("\n\n---\n\n");

      return {
        content: [{
          type: "text" as const,
          text: `${nodes.length} node(s):\n\n${formatted}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error getting node details: ${msg}` }],
        isError: true,
      };
    }
  });

  server.registerTool("flipper_search_view", {
    description:
      "Searches the UI view hierarchy for elements matching a query string. " +
      "Useful for finding specific views, text, or components by name or content.",
    inputSchema: {
      query: z.string().describe("Search query to find in the view tree"),
    },
  }, async (args) => {
    try {
      const result = (await inspectorExec("getSearchResults", {
        query: args.query,
      })) as SearchResult;

      const matches = result?.results ?? [];

      if (matches.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No views matching "${args.query}" found.`,
          }],
        };
      }

      // Fetch full details for matching nodes
      const ids = matches.map((m) => m.id);
      const details = (await inspectorExec("getNodes", {
        ids,
      })) as { elements: InspectorNode[] };

      const nodes = details?.elements ?? [];
      const formatted = nodes.length > 0
        ? nodes.map((node) => formatNode(node, 0)).join("\n\n---\n\n")
        : ids.map((id) => `Node ID: ${id}`).join("\n");

      return {
        content: [{
          type: "text" as const,
          text: `${matches.length} match(es) for "${args.query}":\n\n${formatted}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error searching views: ${msg}` }],
        isError: true,
      };
    }
  });
}

async function expandChildren(
  childIds: string[],
  currentDepth: number,
  maxDepth: number,
  lines: string[],
): Promise<void> {
  try {
    const result = (await inspectorExec("getNodes", {
      ids: childIds,
    })) as { elements: InspectorNode[] };

    const nodes = result?.elements ?? [];

    for (const node of nodes) {
      lines.push(formatNode(node, currentDepth));

      if (node.children && node.children.length > 0 && currentDepth < maxDepth) {
        await expandChildren(node.children, currentDepth + 1, maxDepth, lines);
      } else if (node.children && node.children.length > 0) {
        lines.push(`${"  ".repeat(currentDepth + 1)}... ${node.children.length} children (max depth reached)`);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    debug(`[Inspector] Error expanding children at depth ${currentDepth}: ${msg}`);
    lines.push(`${"  ".repeat(currentDepth)}(error fetching children: ${msg})`);
  }
}
