import type { DatabasePolicy, LimitsConfig } from "../core/types.js";
import {
  DEFAULT_QUERY_LIMIT,
  HARD_MAX_ROWS,
  MAX_QUERY_LIMIT,
  type RowLimits,
} from "./validateReadOnly.js";

export { HARD_MAX_ROWS };

/**
 * The rows-per-query bounds for one database: server-wide `limits` (default
 * 100 / 1000) narrowed by the database's policy, never past HARD_MAX_ROWS.
 * A policy can only tighten the ceiling; config load rejects one that widens.
 * Pure, so the registry (list_databases) and the service (run_query) cannot
 * disagree about what a database allows.
 */
export function effectiveRowLimits(
  global: LimitsConfig | undefined,
  policy?: DatabasePolicy,
): RowLimits {
  const globalMax = Math.min(global?.maxRows ?? MAX_QUERY_LIMIT, HARD_MAX_ROWS);
  const maxRows = Math.min(policy?.maxRows ?? globalMax, globalMax);
  const defaultRows = Math.min(
    policy?.defaultRows ?? global?.defaultRows ?? DEFAULT_QUERY_LIMIT,
    maxRows,
  );
  return { defaultRows, maxRows };
}
