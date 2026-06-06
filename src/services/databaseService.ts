import type { DatabaseRegistry } from "../adapters/registry.js";
import type { SqlDatabasePort } from "../core/sqlDatabasePort.js";
import type { ColumnInfo, DatabaseSummary, QueryResult, TableInfo } from "../core/types.js";
import {
  clampQueryLimit,
  validateReadOnlySql,
} from "../sql/validateReadOnly.js";

export class DatabaseService {
  constructor(private readonly registry: DatabaseRegistry) {}

  listDatabases(): DatabaseSummary[] {
    return this.registry.listDatabases();
  }

  async listTables(databaseId: string, schema?: string): Promise<TableInfo[]> {
    const adapter = await this.getSqlAdapter(databaseId);
    return adapter.listTables(schema);
  }

  async describeTable(
    databaseId: string,
    table: string,
    schema?: string,
  ): Promise<ColumnInfo[]> {
    const adapter = await this.getSqlAdapter(databaseId);
    return adapter.describeTable(table, schema);
  }

  async runQuery(
    databaseId: string,
    sql: string,
    limit?: number,
  ): Promise<QueryResult> {
    const adapter = await this.getSqlAdapter(databaseId);
    const effectiveLimit = clampQueryLimit(limit);
    const safeSql = validateReadOnlySql(sql, effectiveLimit);
    return adapter.executeReadQuery(safeSql, effectiveLimit);
  }

  async close(): Promise<void> {
    await this.registry.closeAll();
  }

  /**
   * Resolve an adapter and narrow it to the SQL family. Once non-SQL families
   * exist (e.g. mongodb), this is the routing point that rejects a mismatched
   * database_id with a clear, agent-friendly error instead of a low-level
   * "method is not a function" failure.
   */
  private async getSqlAdapter(databaseId: string): Promise<SqlDatabasePort> {
    const adapter = await this.registry.getAdapter(databaseId);
    if (adapter.kind !== "sql") {
      throw new Error(
        `Database "${databaseId}" is ${adapter.type}, which is not a SQL ` +
          "database. Use the tools for its database type instead.",
      );
    }
    return adapter;
  }
}
