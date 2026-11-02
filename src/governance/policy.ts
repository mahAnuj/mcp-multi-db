import type {
  ColumnOrigin,
  DatabasePolicy,
  DatabaseType,
  ScopedToolName,
} from "../core/types.js";

export const ALL_SCOPED_TOOLS: ScopedToolName[] = ["list_tables", "describe_table", "run_query"];
export const REDACTED = "[redacted]";

/**
 * A refusal by policy. `rule` names which control refused, so the audit log
 * and the agent both learn *why*, not just that it failed.
 */
export class PolicyError extends Error {
  constructor(
    readonly rule: "tools" | "tables" | "columns" | "rate_limit" | "explain",
    message: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

// ---------- names ----------
//
// Identifiers are compared case-insensitively. A pattern matches a qualified
// name on its trailing segments: "accounts" matches "public.accounts", and
// "public.accounts" matches only that. Quoting is not interpreted.

const norm = (s: string): string[] => s.toLowerCase().split(".").filter(Boolean);

export function nameMatches(pattern: string, qualified: string): boolean {
  const p = norm(pattern);
  const q = norm(qualified);
  if (p.length === 0 || p.length > q.length) return false;
  const tail = q.slice(q.length - p.length);
  return p.every((seg, i) => seg === tail[i]);
}

/** Split "[schema.]table.column" into its table pattern and column. */
export function splitColumnPattern(pattern: string): { table: string; column: string } {
  const parts = pattern.split(".");
  const column = parts.pop() ?? "";
  return { table: parts.join("."), column };
}

export function toolAllowed(policy: DatabasePolicy | undefined, tool: ScopedToolName): boolean {
  return !policy?.tools || policy.tools.includes(tool);
}

export function hasTablePolicy(policy: DatabasePolicy | undefined): boolean {
  return Boolean(policy?.tables && (policy.tables.allow || policy.tables.deny));
}

export function redactPatterns(policy: DatabasePolicy | undefined): string[] {
  return policy?.columns?.redact ?? [];
}

/**
 * The system catalogs describe every table, including ones a policy denies,
 * so under any table policy they are readable only if the allow-list names
 * them explicitly. Use list_tables / describe_table, which apply the policy.
 */
export function isCatalog(rel: string): boolean {
  const r = rel.toLowerCase();
  return (
    r === "sqlite_master" ||
    r === "sqlite_schema" ||
    r === "sqlite_temp_master" ||
    r.startsWith("pg_catalog.") ||
    r.startsWith("information_schema.") ||
    r.startsWith("mysql.") ||
    r.startsWith("performance_schema.")
  );
}

/** Why a relation is outside the table policy, or null when it may be read. */
function relationRefusal(policy: DatabasePolicy | undefined, rel: string): string | null {
  const tables = policy?.tables;
  if (!tables) return null;
  const allowed = tables.allow?.some((p) => nameMatches(p, rel)) ?? false;
  if (isCatalog(rel) && !allowed) {
    return `Query reads the system catalog "${rel}", which a table policy withholds. Use list_tables or describe_table.`;
  }
  if (tables.allow && !allowed) {
    return `Query reads "${rel}", which is not in this database's table allow-list.`;
  }
  if (tables.deny && tables.deny.some((p) => nameMatches(p, rel))) {
    return `Query reads "${rel}", which this database's policy denies.`;
  }
  return null;
}

export function relationAllowed(policy: DatabasePolicy | undefined, rel: string): boolean {
  return relationRefusal(policy, rel) === null;
}

/** Throw if any relation the plan reads falls outside the table policy. */
export function checkRelations(policy: DatabasePolicy | undefined, relations: string[]): void {
  for (const rel of relations) {
    const reason = relationRefusal(policy, rel);
    if (reason) throw new PolicyError("tables", reason);
  }
}

// ---------- redaction ----------

function originMatches(pattern: string, origin: ColumnOrigin, nameOnly: boolean): boolean {
  const { table, column } = splitColumnPattern(pattern);
  if (column.toLowerCase() !== origin.column.toLowerCase()) return false;
  if (nameOnly) return true;
  return table === "" || nameMatches(table, origin.table);
}

/**
 * Decide which result columns to redact, and refuse queries whose columns
 * cannot be traced.
 *
 * - A column whose ORIGIN is a redacted column is redacted, however it was
 *   aliased. Origins come from the driver, not from the SQL text.
 * - An UNVERIFIABLE column (computed, or from a view rather than a base table
 *   the plan read) could carry a redacted value in another shape, e.g.
 *   lower(email). If the plan reads any table holding a redacted column, the
 *   query is refused. This over-refuses some harmless queries (count(*) on that
 *   table), which is the safe side.
 * - MySQL has no reliable plan, and may report a view's own name as a column's
 *   table, so there redaction matches on column NAME in any table, and an
 *   untraceable column is refused if the SQL mentions a redacted column name.
 */
export function planRedaction(args: {
  type: DatabaseType;
  patterns: string[];
  columns: string[];
  origins: Array<ColumnOrigin | null>;
  relations?: string[];
  sql: string;
}): { redactKeys: Set<string>; redactedLabels: string[] } {
  const { type, patterns, columns, origins, relations, sql } = args;
  const redactKeys = new Set<string>();
  const redactedLabels: string[] = [];
  if (patterns.length === 0) return { redactKeys, redactedLabels };

  const nameOnly = type === "mysql";
  const unverifiable: string[] = [];

  columns.forEach((name, i) => {
    const origin = origins[i] ?? null;
    if (origin && patterns.some((p) => originMatches(p, origin, nameOnly))) {
      redactKeys.add(name);
      redactedLabels.push(`${origin.table}.${origin.column}`);
      return;
    }
    const fromPlannedTable =
      origin !== null &&
      (relations === undefined || relations.some((r) => r.toLowerCase() === origin.table.toLowerCase()));
    if (origin === null || !fromPlannedTable) unverifiable.push(name);
  });

  if (unverifiable.length > 0) {
    let sensitive: boolean;
    if (relations !== undefined) {
      sensitive = relations.some((rel) =>
        patterns.some((p) => {
          const t = splitColumnPattern(p).table;
          return t === "" || nameMatches(t, rel);
        }),
      );
    } else {
      sensitive = patterns.some((p) =>
        new RegExp(`\\b${escapeRegex(splitColumnPattern(p).column)}\\b`, "i").test(sql),
      );
    }
    if (sensitive) {
      throw new PolicyError(
        "columns",
        `Result column(s) ${unverifiable.map((c) => `"${c}"`).join(", ")} are computed or come ` +
          "from a view, and the query reads a table with redacted columns, so their values cannot " +
          "be checked. Select columns directly from the table, or compute over non-redacted columns.",
      );
    }
  }
  return { redactKeys, redactedLabels: [...new Set(redactedLabels)] };
}

export function applyRedaction(
  rows: Record<string, unknown>[],
  keys: Set<string>,
): Record<string, unknown>[] {
  if (keys.size === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const k of keys) if (k in copy) copy[k] = REDACTED;
    return copy;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- rate limit ----------

/** A token bucket per database: `perMinute` tokens, refilled continuously. */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = perMinute;
    this.last = now();
  }

  take(): void {
    const t = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
    if (this.tokens < 1) {
      const waitS = Math.ceil(((1 - this.tokens) / this.perMinute) * 60);
      throw new PolicyError(
        "rate_limit",
        `Rate limit of ${this.perMinute} queries per minute reached for this database. Try again in ${waitS}s.`,
      );
    }
    this.tokens -= 1;
  }
}
