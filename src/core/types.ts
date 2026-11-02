export type DatabaseType = "postgres" | "mysql" | "sqlite";

/** Tools a policy can scope per database. `list_databases` is always available. */
export type ScopedToolName = "list_tables" | "describe_table" | "run_query";

/**
 * Opt-in governance for one database. Every field is optional; a database with
 * no policy behaves exactly as before. See docs/governance.md.
 */
export interface DatabasePolicy {
  /** Tools exposed for this database. Omit `run_query` for schema-only access. */
  tools?: ScopedToolName[];
  /** Relations a query may read, checked against the engine's query plan. */
  tables?: { allow?: string[]; deny?: string[] };
  /** `[schema.]table.column` values replaced with "[redacted]" in results. */
  columns?: { redact?: string[] };
  /** Per-database row ceiling; can only be stricter than the server-wide ceiling. */
  maxRows?: number;
  /** Per-database default rows when the caller gives no `limit`; at most `maxRows`. */
  defaultRows?: number;
  /** Per-database statement timeout in ms; can only be stricter than 30s. */
  timeoutMs?: number;
  /** Token-bucket budget for run_query calls on this database. */
  rateLimit?: { queriesPerMinute: number };
}

export interface DatabaseConfigBase {
  id: string;
  label?: string;
  description?: string;
  policy?: DatabasePolicy;
}

export interface AuditConfig {
  /** Path of the JSONL audit log. One line is appended per tool call. */
  path: string;
  /** "full" records the SQL text; "hash" records its SHA-256 instead. */
  sql?: "full" | "hash";
  /** When true, a failed audit write fails the call instead of only warning. */
  required?: boolean;
}

/** Server-wide row limits. Omitted fields keep the v1.0 values (100 / 1000). */
export interface LimitsConfig {
  defaultRows?: number;
  /** At most 10,000 (HARD_MAX_ROWS). */
  maxRows?: number;
}

export interface AppConfig {
  databases: DatabaseConfig[];
  audit?: AuditConfig;
  limits?: LimitsConfig;
}

export interface PostgresConfig extends DatabaseConfigBase {
  type: "postgres";
  connectionString: string;
}

export interface MysqlConfig extends DatabaseConfigBase {
  type: "mysql";
  connectionString: string;
}

export interface SqliteConfig extends DatabaseConfigBase {
  type: "sqlite";
  path: string;
}

export type DatabaseConfig = PostgresConfig | MysqlConfig | SqliteConfig;

export interface DatabaseSummary {
  id: string;
  type: DatabaseType;
  label?: string;
  description?: string;
  /** Effective rows per query for this database: the default and the ceiling. */
  rowLimits: { default: number; max: number };
  /** Present only when a policy is set, so the agent knows its scope up front. */
  policy?: {
    tools: ScopedToolName[];
    tablesRestricted: boolean;
    redactedColumns: string[];
  };
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: "table" | "view" | string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  /** Result columns whose values were replaced by a redaction policy. */
  redacted?: string[];
}

/** Where a result column's values came from, as the engine reports it. */
export interface ColumnOrigin {
  /** Qualified as the engine names it: "schema.table" (postgres, mysql) or "table" (sqlite). */
  table: string;
  column: string;
}

export interface ReadQueryOptions {
  /** Statement timeout for this call (postgres, mysql). SQLite cannot interrupt a running query. */
  timeoutMs?: number;
  /**
   * Called with the relations the query plan reads, inside the read-only
   * transaction and BEFORE the query runs. Throwing aborts the query.
   * When set, the adapter must plan the query or throw (fail closed).
   */
  onPlan?: (relations: string[]) => void;
  /** Ask the adapter to report each result column's origin. */
  withOrigins?: boolean;
}

export interface ReadQueryOutcome extends QueryResult {
  /** Aligned with `columns`; null when the column is computed or unknown. */
  origins?: Array<ColumnOrigin | null>;
  /** The relations the plan read, when `onPlan` was requested. */
  relations?: string[];
}
