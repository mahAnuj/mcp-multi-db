import type { DatabasePort } from "./databasePort.js";
import type { ColumnInfo, ReadQueryOptions, ReadQueryOutcome, TableInfo } from "./types.js";

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
  /**
   * Run already-validated read SQL inside a read-only transaction/connection.
   * Governance hooks (`options`) are optional; without them behaviour is the
   * plain v1.0 read path.
   */
  executeReadQuery(sql: string, limit: number, options?: ReadQueryOptions): Promise<ReadQueryOutcome>;
}
