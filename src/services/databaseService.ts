import type { DatabaseRegistry } from "../adapters/registry.js";
import type { SqlDatabasePort } from "../core/sqlDatabasePort.js";
import type {
  ColumnInfo,
  DatabaseSummary,
  QueryResult,
  ReadQueryOptions,
  ScopedToolName,
  TableInfo,
} from "../core/types.js";
import type { AuditEntry, AuditLog } from "../governance/audit.js";
import {
  PolicyError,
  RateLimiter,
  applyRedaction,
  checkRelations,
  hasTablePolicy,
  planRedaction,
  redactPatterns,
  toolAllowed,
} from "../governance/policy.js";
import {
  clampQueryLimit,
  validateReadOnlySql,
} from "../sql/validateReadOnly.js";

export interface DatabaseServiceOptions {
  audit?: AuditLog;
  /** Injectable clock, for rate-limit tests. */
  now?: () => number;
}

export class DatabaseService {
  private readonly limiters = new Map<string, RateLimiter>();

  constructor(
    private readonly registry: DatabaseRegistry,
    private readonly options: DatabaseServiceOptions = {},
  ) {}

  listDatabases(): DatabaseSummary[] {
    const started = Date.now();
    const databases = this.registry.listDatabases();
    this.audit({ tool: "list_databases", outcome: "ok", ms: Date.now() - started });
    return databases;
  }

  async listTables(databaseId: string, schema?: string): Promise<TableInfo[]> {
    return this.audited({ tool: "list_tables", database_id: databaseId }, async () => {
      this.requireTool(databaseId, "list_tables");
      const adapter = await this.getSqlAdapter(databaseId);
      return adapter.listTables(schema);
    });
  }

  async describeTable(
    databaseId: string,
    table: string,
    schema?: string,
  ): Promise<ColumnInfo[]> {
    return this.audited({ tool: "describe_table", database_id: databaseId }, async () => {
      this.requireTool(databaseId, "describe_table");
      const adapter = await this.getSqlAdapter(databaseId);
      return adapter.describeTable(table, schema);
    });
  }

  async runQuery(
    databaseId: string,
    sql: string,
    limit?: number,
  ): Promise<QueryResult> {
    return this.audited({ tool: "run_query", database_id: databaseId, sql }, async (entry) => {
      this.requireTool(databaseId, "run_query");
      const policy = this.registry.getPolicy(databaseId);
      const adapter = await this.getSqlAdapter(databaseId);

      const clamped = clampQueryLimit(limit);
      const effectiveLimit = policy?.maxRows ? Math.min(clamped, policy.maxRows) : clamped;
      const safeSql = validateReadOnlySql(sql, effectiveLimit);

      const tablesGoverned = hasTablePolicy(policy);
      const patterns = redactPatterns(policy);
      const isExplain = /^\s*EXPLAIN\b/i.test(safeSql);
      if (isExplain && (tablesGoverned || patterns.length > 0)) {
        throw new PolicyError(
          "explain",
          "EXPLAIN is not available on a database with a table or column policy.",
        );
      }

      if (policy?.rateLimit) this.limiter(databaseId, policy.rateLimit.queriesPerMinute).take();

      // Plan when a policy needs to know what the query reads. MySQL has no
      // reliable plan (aliases), so it never plans; config load already
      // refuses a MySQL table policy, and redaction there works by name.
      const needsPlan = adapter.type !== "mysql" && (tablesGoverned || patterns.length > 0);
      const readOptions: ReadQueryOptions = {
        ...(policy?.timeoutMs ? { timeoutMs: policy.timeoutMs } : {}),
        ...(needsPlan
          ? {
              onPlan: (relations: string[]) => {
                entry.tables = relations; // recorded even when the check refuses
                checkRelations(policy, relations);
              },
            }
          : {}),
        ...(patterns.length > 0 ? { withOrigins: true } : {}),
      };

      const outcome = await adapter.executeReadQuery(safeSql, effectiveLimit, readOptions);
      if (outcome.relations) entry.tables = outcome.relations;

      const { origins, relations, ...result } = outcome;
      if (patterns.length === 0) return result;

      const { redactKeys, redactedLabels } = planRedaction({
        type: adapter.type,
        patterns,
        columns: result.columns,
        origins: origins ?? result.columns.map(() => null),
        relations,
        sql: safeSql,
      });
      if (redactedLabels.length > 0) entry.redacted = redactedLabels;
      return {
        ...result,
        rows: applyRedaction(result.rows, redactKeys),
        ...(redactedLabels.length > 0 ? { redacted: redactedLabels } : {}),
      };
    });
  }

  async close(): Promise<void> {
    await this.registry.closeAll();
  }

  private requireTool(databaseId: string, tool: ScopedToolName): void {
    if (!toolAllowed(this.registry.getPolicy(databaseId), tool)) {
      throw new PolicyError(
        "tools",
        `The ${tool} tool is not enabled for database "${databaseId}" by its policy.`,
      );
    }
  }

  private limiter(databaseId: string, perMinute: number): RateLimiter {
    let limiter = this.limiters.get(databaseId);
    if (!limiter) {
      limiter = new RateLimiter(perMinute, this.options.now);
      this.limiters.set(databaseId, limiter);
    }
    return limiter;
  }

  /** Run a tool body and write exactly one audit line, whatever happens. */
  private async audited<T>(
    base: Omit<AuditEntry, "outcome" | "ms">,
    body: (entry: Partial<AuditEntry>) => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    const extra: Partial<AuditEntry> = {};
    try {
      const result = await body(extra);
      const r = result as unknown as Partial<QueryResult>;
      const counts =
        r && typeof r === "object" && typeof r.rowCount === "number"
          ? { rowCount: r.rowCount, truncated: r.truncated }
          : {};
      this.audit({ ...base, ...extra, ...counts, outcome: "ok", ms: Date.now() - started });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit({
        ...base,
        ...extra,
        outcome: err instanceof PolicyError ? "refused" : "error",
        ...(err instanceof PolicyError ? { rule: err.rule } : {}),
        reason: message,
        ms: Date.now() - started,
      });
      throw err;
    }
  }

  private audit(entry: AuditEntry): void {
    this.options.audit?.record(entry);
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
