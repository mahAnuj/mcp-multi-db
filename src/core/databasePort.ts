import type { SqlDatabasePort } from "./sqlDatabasePort.js";
import type { DatabaseType } from "./types.js";

/**
 * Port-family discriminant. Each family that shares a query model gets one
 * value. Relational engines (postgres/mysql/sqlite) all share "sql"; engines
 * with their own vocabulary (e.g. mongodb) get their own family rather than a
 * shared "nosql" grouping. Grows as engines are added: | "mongodb" | ...
 */
export type DatabaseKind = "sql";

/**
 * The thin contract every database adapter shares, regardless of family. Only
 * what is genuinely common lives here — discovery and read methods belong on
 * the family-specific port (e.g. {@link SqlDatabasePort}). Narrow on `kind` to
 * reach the family-specific surface.
 */
export interface DatabasePort {
  readonly id: string;
  readonly type: DatabaseType;
  readonly kind: DatabaseKind;
  close(): Promise<void>;
}

/** Union of every concrete port family. Add new families here as they land. */
export type AnyDatabasePort = SqlDatabasePort;
