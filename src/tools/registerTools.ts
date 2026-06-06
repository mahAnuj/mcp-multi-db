import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DatabaseService } from "../services/databaseService.js";

export function registerTools(server: McpServer, service: DatabaseService): void {
  server.registerTool(
    "list_databases",
    {
      description:
        "List all configured database connections (id, type, label, description). Call this first to discover which database_id to use.",
      inputSchema: {},
    },
    async () => {
      const databases = service.listDatabases();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(databases, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_tables",
    {
      description: "List tables and views in a configured database.",
      inputSchema: {
        database_id: z.string().describe("Database id from list_databases"),
        schema: z
          .string()
          .optional()
          .describe("Schema name (Postgres/MySQL). Ignored for SQLite."),
      },
    },
    async ({ database_id, schema }) => {
      const tables = await service.listTables(database_id, schema);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tables, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "describe_table",
    {
      description: "Describe columns for a table in a configured database.",
      inputSchema: {
        database_id: z.string().describe("Database id from list_databases"),
        table: z.string().describe("Table name"),
        schema: z
          .string()
          .optional()
          .describe("Schema name (Postgres/MySQL). Ignored for SQLite."),
      },
    },
    async ({ database_id, table, schema }) => {
      const columns = await service.describeTable(database_id, table, schema);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(columns, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_query",
    {
      description:
        "Execute a read-only SQL query (SELECT, WITH, EXPLAIN) on a configured database. Writes are blocked.",
      inputSchema: {
        database_id: z.string().describe("Database id from list_databases"),
        sql: z.string().describe("Read-only SQL query"),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Max rows to return (default 100, max 1000)"),
      },
    },
    async ({ database_id, sql, limit }) => {
      const result = await service.runQuery(database_id, sql, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
