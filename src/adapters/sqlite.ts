import Database from "better-sqlite3";
import type { SqlDatabasePort } from "../core/sqlDatabasePort.js";
import type { ColumnInfo, QueryResult, TableInfo } from "../core/types.js";

export class SqliteAdapter implements SqlDatabasePort {
  readonly kind = "sql" as const;
  readonly type = "sqlite" as const;
  private readonly db: Database.Database;

  constructor(
    readonly id: string,
    path: string,
  ) {
    this.db = new Database(path, { readonly: true, fileMustExist: true });
  }

  async listSchemas(): Promise<string[]> {
    return ["main"];
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = this.db
      .prepare(
        `SELECT name, type
         FROM sqlite_master
         WHERE type IN ('table', 'view')
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string; type: string }>;

    return rows.map((row) => ({
      name: row.name,
      schema: "main",
      type: row.type,
    }));
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const safeName = table.replace(/"/g, '""');
    const rows = this.db.prepare(`PRAGMA table_info("${safeName}")`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    if (rows.length === 0) {
      throw new Error(`Table not found: ${table}`);
    }

    return rows.map((row) => ({
      name: row.name,
      type: row.type || "unknown",
      nullable: row.notnull === 0,
      isPrimaryKey: row.pk === 1,
    }));
  }

  async executeReadQuery(sql: string, limit: number): Promise<QueryResult> {
    const statement = this.db.prepare(sql);
    const rows = statement.all() as Record<string, unknown>[];
    const columns =
      rows.length > 0
        ? Object.keys(rows[0])
        : statement.columns().map((column) => column.name);

    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: rows.length >= limit,
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
