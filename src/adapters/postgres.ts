import pg from "pg";
import type { SqlDatabasePort } from "../core/sqlDatabasePort.js";
import type {
  ColumnInfo,
  ColumnOrigin,
  ReadQueryOptions,
  ReadQueryOutcome,
  TableInfo,
} from "../core/types.js";
import { PolicyError } from "../governance/policy.js";

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

  async executeReadQuery(
    sql: string,
    limit: number,
    options: ReadQueryOptions = {},
  ): Promise<ReadQueryOutcome> {
    const timeoutMs = Math.min(options.timeoutMs ?? QUERY_TIMEOUT_MS, QUERY_TIMEOUT_MS);
    const client = await this.pool.connect();
    try {
      await client.query(`SET statement_timeout = ${Math.floor(timeoutMs)}`);
      // Run inside a read-only transaction so the database itself rejects any
      // write, even one the SQL-text guard cannot detect (e.g. a SELECT calling
      // a function with side effects). ROLLBACK discards any transaction state.
      await client.query("BEGIN READ ONLY");
      try {
        let relations: string[] | undefined;
        if (options.onPlan) {
          relations = await planRelations(client, sql);
          options.onPlan(relations); // may throw: the query below never runs
        }
        const result = await client.query(sql);
        const outcome: ReadQueryOutcome = toQueryResult(
          result.fields.map((f) => f.name),
          result.rows,
          limit,
        );
        if (relations) outcome.relations = relations;
        if (options.withOrigins) outcome.origins = await columnOrigins(client, result.fields);
        return outcome;
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

/**
 * The relations a query reads, from `EXPLAIN (FORMAT JSON, VERBOSE)` — VERBOSE
 * is what adds each scan's schema. Views are expanded in the plan, so the
 * names are base tables. A function scan can read anything, so it fails
 * closed under a table policy.
 */
async function planRelations(client: pg.PoolClient, sql: string): Promise<string[]> {
  const result = await client.query(`EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`);
  const raw = result.rows[0]?.["QUERY PLAN"];
  const plan = typeof raw === "string" ? JSON.parse(raw) : raw;
  const root = Array.isArray(plan) ? plan[0]?.Plan : undefined;
  if (!root) {
    throw new PolicyError("tables", "Could not read the query plan, so the query was refused.");
  }
  const relations = new Set<string>();
  const walk = (node: Record<string, unknown>): void => {
    if (node["Node Type"] === "Function Scan") {
      throw new PolicyError(
        "tables",
        "Query reads from a function, which a table policy cannot check.",
      );
    }
    const rel = node["Relation Name"];
    if (typeof rel === "string") {
      const schema = typeof node.Schema === "string" ? node.Schema : "public";
      relations.add(`${schema}.${rel}`);
    }
    const children = node.Plans;
    if (Array.isArray(children)) children.forEach((c) => walk(c as Record<string, unknown>));
  };
  walk(root as Record<string, unknown>);
  return [...relations];
}

/**
 * Each result column's origin, from the RowDescription's tableID/columnID
 * resolved through pg_attribute. A computed column has tableID 0 (null
 * origin); a view column names the view, not its base table.
 */
async function columnOrigins(
  client: pg.PoolClient,
  fields: Array<{ tableID: number; columnID: number }>,
): Promise<Array<ColumnOrigin | null>> {
  const ids = [...new Set(fields.map((f) => f.tableID).filter((id) => id > 0))];
  if (ids.length === 0) return fields.map(() => null);
  const result = await client.query<{ rel: number; num: number; nspname: string; relname: string; attname: string }>(
    `SELECT a.attrelid::int AS rel, a.attnum::int AS num, n.nspname, c.relname, a.attname
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0`,
    [ids],
  );
  const byKey = new Map(
    result.rows.map((r) => [`${r.rel}:${r.num}`, { table: `${r.nspname}.${r.relname}`, column: r.attname }]),
  );
  return fields.map((f) => (f.tableID > 0 ? byKey.get(`${f.tableID}:${f.columnID}`) ?? null : null));
}

function toQueryResult(
  columns: string[],
  rows: Record<string, unknown>[],
  limit: number,
): ReadQueryOutcome {
  const normalizedRows = rows.map((row) => ({ ...row }));
  return {
    columns,
    rows: normalizedRows,
    rowCount: normalizedRows.length,
    truncated: normalizedRows.length >= limit,
  };
}
