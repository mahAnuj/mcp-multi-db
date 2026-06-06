import mysql from "mysql2/promise";
import type { SqlDatabasePort } from "../core/sqlDatabasePort.js";
import type { ColumnInfo, QueryResult, TableInfo } from "../core/types.js";

const QUERY_TIMEOUT_MS = 30_000;

export class MysqlAdapter implements SqlDatabasePort {
  readonly kind = "sql" as const;
  readonly type = "mysql" as const;
  private readonly pool: mysql.Pool;

  constructor(
    readonly id: string,
    connectionString: string,
  ) {
    this.pool = mysql.createPool({
      uri: connectionString,
      connectionLimit: 3,
      waitForConnections: true,
    });
  }

  async listSchemas(): Promise<string[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT SCHEMA_NAME AS schema_name
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
       ORDER BY SCHEMA_NAME`,
    );
    return rows.map((row) => String(row.schema_name));
  }

  async listTables(schema?: string): Promise<TableInfo[]> {
    const resolvedSchema = schema ?? (await this.currentSchema());
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS table_name, TABLE_SCHEMA AS table_schema, TABLE_TYPE AS table_type
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
       ORDER BY TABLE_NAME`,
      [resolvedSchema],
    );

    return rows.map((row) => ({
      name: String(row.table_name),
      schema: String(row.table_schema),
      type: String(row.table_type) === "VIEW" ? "view" : "table",
    }));
  }

  async describeTable(table: string, schema?: string): Promise<ColumnInfo[]> {
    const resolvedSchema = schema ?? (await this.currentSchema());
    const [columns] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [resolvedSchema, table],
    );

    const [keys] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND CONSTRAINT_NAME = 'PRIMARY'`,
      [resolvedSchema, table],
    );

    const primaryKeys = new Set(keys.map((row) => String(row.column_name)));

    return columns.map((row) => ({
      name: String(row.column_name),
      type: String(row.data_type),
      nullable: String(row.is_nullable) === "YES",
      isPrimaryKey: primaryKeys.has(String(row.column_name)),
    }));
  }

  async executeReadQuery(sql: string, limit: number): Promise<QueryResult> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query(`SET SESSION MAX_EXECUTION_TIME = ${QUERY_TIMEOUT_MS}`);
      // Run inside a read-only transaction so the database itself rejects any
      // write, even one the SQL-text guard cannot detect (e.g. a SELECT calling
      // a stored function with side effects). ROLLBACK discards any state.
      await connection.query("START TRANSACTION READ ONLY");
      try {
        const [rows, fields] = await connection.query(sql);
        const resultRows = Array.isArray(rows) ? (rows as mysql.RowDataPacket[]) : [];
        const columns = Array.isArray(fields)
          ? fields.map((field) => field.name)
          : Object.keys(resultRows[0] ?? {});
        return toQueryResult(columns, resultRows, limit);
      } finally {
        await connection.query("ROLLBACK");
      }
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async currentSchema(): Promise<string> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT DATABASE() AS db",
    );
    const db = rows[0]?.db;
    if (!db) {
      throw new Error("MySQL connection has no default database selected.");
    }
    return String(db);
  }
}

function toQueryResult(
  columns: string[],
  rows: mysql.RowDataPacket[],
  limit: number,
): QueryResult {
  const normalizedRows = rows.map((row) => ({ ...row }));
  return {
    columns,
    rows: normalizedRows,
    rowCount: normalizedRows.length,
    truncated: normalizedRows.length >= limit,
  };
}
