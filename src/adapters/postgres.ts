import pg from "pg";
import type { SqlDatabasePort } from "../core/sqlDatabasePort.js";
import type { ColumnInfo, QueryResult, TableInfo } from "../core/types.js";

const QUERY_TIMEOUT_MS = 30_000;

export class PostgresAdapter implements SqlDatabasePort {
  readonly kind = "sql" as const;
  readonly type = "postgres" as const;
  private readonly pool: pg.Pool;

  constructor(
    readonly id: string,
    connectionString: string,
  ) {
    this.pool = new pg.Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    });
  }

  async listSchemas(): Promise<string[]> {
    const result = await this.pool.query<{ schema_name: string }>(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
         AND schema_name NOT LIKE 'pg_toast%'
       ORDER BY schema_name`,
    );
    return result.rows.map((row) => row.schema_name);
  }

  async listTables(schema = "public"): Promise<TableInfo[]> {
    const result = await this.pool.query<{
      table_name: string;
      table_schema: string;
      table_type: string;
    }>(
      `SELECT table_name, table_schema, table_type
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_type IN ('BASE TABLE', 'VIEW')
       ORDER BY table_name`,
      [schema],
    );

    return result.rows.map((row) => ({
      name: row.table_name,
      schema: row.table_schema,
      type: row.table_type === "VIEW" ? "view" : "table",
    }));
  }

  async describeTable(table: string, schema = "public"): Promise<ColumnInfo[]> {
    const columns = await this.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table],
    );

    const keys = await this.pool.query<{ column_name: string }>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = $1
         AND tc.table_name = $2`,
      [schema, table],
    );

    const primaryKeys = new Set(keys.rows.map((row) => row.column_name));

    return columns.rows.map((row) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
      isPrimaryKey: primaryKeys.has(row.column_name),
    }));
  }

  async executeReadQuery(sql: string, limit: number): Promise<QueryResult> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`);
      // Run inside a read-only transaction so the database itself rejects any
      // write, even one the SQL-text guard cannot detect (e.g. a SELECT calling
      // a function with side effects). ROLLBACK discards any transaction state.
      await client.query("BEGIN READ ONLY");
      try {
        const result = await client.query(sql);
        return toQueryResult(result.fields.map((f) => f.name), result.rows, limit);
      } finally {
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function toQueryResult(
  columns: string[],
  rows: Record<string, unknown>[],
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
