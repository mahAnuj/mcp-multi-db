const BLOCKED_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|REPLACE|MERGE|CALL|EXEC|EXECUTE|ATTACH|DETACH|COPY|VACUUM|REINDEX)\b/i;

const ALLOWED_START = /^(SELECT|WITH|EXPLAIN)\b/i;

/** Default rows per query when neither config nor the caller says otherwise. */
export const DEFAULT_QUERY_LIMIT = 100;
/** Default ceiling on rows per query; configurable up to HARD_MAX_ROWS. */
export const MAX_QUERY_LIMIT = 1000;
/**
 * The ceiling no configuration can raise. A row cap exists to keep one call
 * from flooding the model's context and the token bill (OWASP LLM10); a typo
 * in a config must not turn into a million-row response.
 */
export const HARD_MAX_ROWS = 10_000;

export interface RowLimits {
  defaultRows: number;
  maxRows: number;
}

export const DEFAULT_ROW_LIMITS: RowLimits = {
  defaultRows: DEFAULT_QUERY_LIMIT,
  maxRows: MAX_QUERY_LIMIT,
};

export function clampQueryLimit(limit?: number, bounds: RowLimits = DEFAULT_ROW_LIMITS): number {
  const max = Math.min(bounds.maxRows, HARD_MAX_ROWS);
  if (limit === undefined) {
    return Math.min(bounds.defaultRows, max);
  }
  return Math.min(Math.max(1, Math.floor(limit)), max);
}

export function validateReadOnlySql(sql: string, limit: number): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new Error("SQL query cannot be empty.");
  }

  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed.");
  }

  if (!ALLOWED_START.test(withoutTrailingSemicolon)) {
    throw new Error(
      "Only read-only queries are allowed (SELECT, WITH, EXPLAIN).",
    );
  }

  if (BLOCKED_KEYWORDS.test(withoutTrailingSemicolon)) {
    throw new Error("Query contains blocked keywords.");
  }

  if (/^EXPLAIN\b/i.test(withoutTrailingSemicolon)) {
    return withoutTrailingSemicolon;
  }

  // Every LIMIT must be a plain decimal integer. Without this, "LIMIT 0x1F4"
  // or "LIMIT 1e3" matched only their leading "0"/"1" and the engine read the
  // rest; "LIMIT 0, 5000" (offset, count) slipped the same way. Adapters also
  // cap fetched rows themselves, so this is a clear refusal, not the only guard.
  for (const m of withoutTrailingSemicolon.matchAll(/\bLIMIT\b\s*([^\s)]*)(\s*,)?/gi)) {
    if (!/^\d+$/.test(m[1]) || m[2]) {
      throw new Error(
        "LIMIT must be a plain integer (e.g. LIMIT 50, or LIMIT 50 OFFSET 100); " +
          "hex, exponent, expression and 'offset, count' forms are not accepted.",
      );
    }
  }

  if (/\bLIMIT\s+\d+/i.test(withoutTrailingSemicolon)) {
    return enforceExistingLimit(withoutTrailingSemicolon, limit);
  }

  return `${withoutTrailingSemicolon} LIMIT ${limit}`;
}

function enforceExistingLimit(sql: string, maxLimit: number): string {
  return sql.replace(/\bLIMIT\s+(\d+)/i, (_match, value: string) => {
    const parsed = Number.parseInt(value, 10);
    const clamped = Math.min(parsed, maxLimit);
    return `LIMIT ${clamped}`;
  });
}
