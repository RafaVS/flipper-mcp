import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { resolveClientId } from "../flipper/device.js";
import { debug } from "../utils/logger.js";

const DATABASE_PLUGIN = "DatabasesManager";

interface DatabaseInfo {
  id: number;
  name: string;
  tables: { name: string; columns: string[] }[];
}

interface TableDataResponse {
  columns: string[];
  values: unknown[][];
  start: number;
  count: number;
  total: number;
}

interface TableStructureResponse {
  structureColumns: string[];
  structureValues: unknown[][];
  indexesColumns: string[];
  indexesValues: unknown[][];
  definition: string;
}

interface ExecuteResponse {
  type: "select" | "insert" | "update_delete";
  columns?: string[];
  values?: unknown[][];
  insertedId?: number;
  affectedCount?: number;
}

async function dbExec(method: string, params: Record<string, unknown>): Promise<unknown> {
  const clientId = await resolveClientId();
  return flipperClient.execPluginMethod(clientId, DATABASE_PLUGIN, method, params);
}

function formatTable(columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return `Columns: ${columns.join(", ")}\n(no rows)`;

  const widths = columns.map((col, i) => {
    const maxVal = rows.reduce((max, row) => {
      const val = String(row[i] ?? "NULL");
      return val.length > max ? val.length : max;
    }, 0);
    return Math.max(col.length, Math.min(maxVal, 40));
  });

  const header = columns.map((col, i) => col.padEnd(widths[i])).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-+-");
  const body = rows.map((row) =>
    row.map((val, i) => {
      const s = String(val ?? "NULL");
      return (s.length > 40 ? s.substring(0, 37) + "..." : s).padEnd(widths[i]);
    }).join(" | "),
  ).join("\n");

  return `${header}\n${separator}\n${body}`;
}

export function registerDatabaseTools(server: McpServer): void {
  server.registerTool("flipper_database_list", {
    description:
      "Lists all SQLite/Room databases and their tables in the connected Android app.",
  }, async () => {
    try {
      const result = (await dbExec("databaseList", {})) as DatabaseInfo[];

      if (!Array.isArray(result) || result.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No databases found. Make sure the app uses the Flipper Databases plugin.",
          }],
        };
      }

      const formatted = result.map((db) => {
        const tables = db.tables.map((t) => `    ${t.name}`).join("\n");
        return `Database: ${db.name} (id: ${db.id})\n  Tables:\n${tables}`;
      }).join("\n\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error listing databases: ${msg}` }],
        isError: true,
      };
    }
  });

  server.registerTool("flipper_database_query", {
    description:
      "Executes a SQL query against a database in the connected Android app. " +
      "Supports SELECT, INSERT, UPDATE, DELETE. Use flipper_database_list first to find database IDs.",
    inputSchema: {
      databaseId: z
        .number()
        .describe("Database ID (from flipper_database_list)"),
      query: z
        .string()
        .describe("SQL query to execute (e.g. 'SELECT * FROM users LIMIT 20')"),
    },
  }, async (args) => {
    try {
      debug(`[Database] Executing SQL on db=${args.databaseId}: ${args.query}`);
      const result = (await dbExec("execute", {
        databaseId: args.databaseId,
        value: args.query,
      })) as ExecuteResponse;

      if (result.type === "select" && result.columns && result.values) {
        const table = formatTable(result.columns, result.values);
        return {
          content: [{
            type: "text" as const,
            text: `${result.values.length} row(s):\n\n${table}`,
          }],
        };
      }

      if (result.type === "insert") {
        return {
          content: [{
            type: "text" as const,
            text: `Inserted row with ID: ${result.insertedId}`,
          }],
        };
      }

      if (result.type === "update_delete") {
        return {
          content: [{
            type: "text" as const,
            text: `Affected rows: ${result.affectedCount}`,
          }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error executing query: ${msg}` }],
        isError: true,
      };
    }
  });

  server.registerTool("flipper_database_get_table", {
    description:
      "Gets paginated data from a specific table. Useful for browsing table contents without writing SQL.",
    inputSchema: {
      databaseId: z
        .number()
        .describe("Database ID (from flipper_database_list)"),
      table: z.string().describe("Table name"),
      start: z
        .number()
        .optional()
        .describe("Row offset to start from (default: 0)"),
      count: z
        .number()
        .optional()
        .describe("Number of rows to fetch (default: 20)"),
      order: z
        .string()
        .optional()
        .describe("Column to order by"),
      reverse: z
        .boolean()
        .optional()
        .describe("Reverse sort order (default: false)"),
    },
  }, async (args) => {
    try {
      const result = (await dbExec("getTableData", {
        databaseId: args.databaseId,
        table: args.table,
        start: args.start ?? 0,
        count: args.count ?? 20,
        order: args.order,
        reverse: args.reverse ?? false,
      })) as TableDataResponse;

      const table = formatTable(result.columns, result.values);
      return {
        content: [{
          type: "text" as const,
          text: `Rows ${result.start + 1}-${result.start + result.count} of ${result.total}:\n\n${table}`,
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error getting table data: ${msg}` }],
        isError: true,
      };
    }
  });

  server.registerTool("flipper_database_get_structure", {
    description:
      "Gets the schema (columns, types, indexes) for a specific table.",
    inputSchema: {
      databaseId: z
        .number()
        .describe("Database ID (from flipper_database_list)"),
      table: z.string().describe("Table name"),
    },
  }, async (args) => {
    try {
      const result = (await dbExec("getTableStructure", {
        databaseId: args.databaseId,
        table: args.table,
      })) as TableStructureResponse;

      const lines: string[] = [];

      if (result.definition) {
        lines.push(`Definition:\n${result.definition}\n`);
      }

      if (result.structureColumns.length > 0) {
        lines.push("Columns:");
        lines.push(formatTable(result.structureColumns, result.structureValues));
      }

      if (result.indexesColumns.length > 0 && result.indexesValues.length > 0) {
        lines.push("\nIndexes:");
        lines.push(formatTable(result.indexesColumns, result.indexesValues));
      }

      return {
        content: [{
          type: "text" as const,
          text: lines.join("\n") || "No structure information available.",
        }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: `Error getting table structure: ${msg}` }],
        isError: true,
      };
    }
  });
}
