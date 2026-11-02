import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { AuditConfig } from "../core/types.js";

export interface AuditEntry {
  tool: string;
  database_id?: string;
  sql?: string;
  outcome: "ok" | "refused" | "error";
  rule?: string;
  reason?: string;
  rowCount?: number;
  truncated?: boolean;
  tables?: string[];
  redacted?: string[];
  ms: number;
}

/**
 * Append-only JSONL audit log: one line per tool call, written synchronously
 * before the response is returned, so a crash cannot drop a call that already
 * answered. Result VALUES are never written — only what was asked and what
 * the policy did.
 *
 * A failed write is reported on stderr and does not fail the call, because an
 * audit log that can take the server down is a denial-of-service lever.
 * `required: true` inverts that for operators who want fail-closed.
 */
export class AuditLog {
  constructor(private readonly config: AuditConfig) {}

  record(entry: AuditEntry): void {
    const { sql, ...rest } = entry;
    const line: Record<string, unknown> = { ts: new Date().toISOString(), ...rest };
    if (sql !== undefined) {
      if (this.config.sql === "hash") {
        line.sql_sha256 = createHash("sha256").update(sql).digest("hex");
      } else {
        line.sql = sql;
      }
    }
    try {
      appendFileSync(this.config.path, `${JSON.stringify(line)}\n`, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.config.required) {
        throw new Error(`Audit log write failed and audit.required is set: ${message}`);
      }
      console.error(`[mcp-multi-db] audit log write failed: ${message}`);
    }
  }
}
