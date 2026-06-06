import type { DatabasePort } from "./databasePort.js";
import type { ColumnInfo, QueryResult, TableInfo } from "./types.js";

/**
 * Shared by every relational engine (postgres, mysql, sqlite). They differ in
 * dialect, not model — same tables/columns/SELECT contract — so one port serves
 * all three. Per-engine differences live in the adapter implementations.
 */
export interface SqlDatabasePort extends DatabasePort {
  readonly kind: "sql";
  listSchemas(): Promise<string[]>;
  listTables(schema?: string): Promise<TableInfo[]>;
  describeTable(table: string, schema?: string): Promise<ColumnInfo[]>;
  executeReadQuery(sql: string, limit: number): Promise<QueryResult>;
}
