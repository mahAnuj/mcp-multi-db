const BLOCKED_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|REPLACE|MERGE|CALL|EXEC|EXECUTE|ATTACH|DETACH|COPY|VACUUM|REINDEX)\b/i;

const ALLOWED_START = /^(SELECT|WITH|EXPLAIN)\b/i;

export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 1000;

export function clampQueryLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_QUERY_LIMIT;
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_QUERY_LIMIT);
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
