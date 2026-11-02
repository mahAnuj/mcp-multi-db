import Database from "better-sqlite3";
import type { SqlDatabasePort } from "../core/sqlDatabasePort.js";
import type {
  ColumnInfo,
  ColumnOrigin,
  ReadQueryOptions,
  ReadQueryOutcome,
  TableInfo,
} from "../core/types.js";
import { PolicyError } from "../governance/policy.js";

export class SqliteAdapter implements SqlDatabasePort {
  readonly kind = "sql" as const;
  readonly type = "sqlite" as const;
  private readonly db: Database.Database;

  constructor(
    readonly id: string,
    path: string,
  ) {
    this.db = new Database(path, { readonly: true, fileMustExist: true });
  }

  async listSchemas(): Promise<string[]> {
    return ["main"];
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = this.db
      .prepare(
        `SELECT name, type
         FROM sqlite_master
         WHERE type IN ('table', 'view')
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string; type: string }>;

    return rows.map((row) => ({
      name: row.name,
      schema: "main",
      type: row.type,
    }));
  }

  async describeTable(table: string): Promise<ColumnInfo[]> {
    const safeName = table.replace(/"/g, '""');
    const rows = this.db.prepare(`PRAGMA table_info("${safeName}")`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    if (rows.length === 0) {
      throw new Error(`Table not found: ${table}`);
    }

    return rows.map((row) => ({
      name: row.name,
      type: row.type || "unknown",
      nullable: row.notnull === 0,
      isPrimaryKey: row.pk === 1,
    }));
  }

  // `timeoutMs` is not applied: better-sqlite3 runs synchronously and SQLite
  // offers no statement timeout to interrupt a running query.
  async executeReadQuery(
    sql: string,
    limit: number,
    options: ReadQueryOptions = {},
  ): Promise<ReadQueryOutcome> {
    let relations: string[] | undefined;
    if (options.onPlan) {
      relations = this.planRelations(sql);
      options.onPlan(relations);
    }

    const statement = this.db.prepare(sql);
    // Stop at `limit` rows whatever the SQL says: the row cap must not depend
    // on the LIMIT clause the text guard rewrote being the only one that counts.
    const rows: Record<string, unknown>[] = [];
    for (const row of statement.iterate() as IterableIterator<Record<string, unknown>>) {
      if (rows.length >= limit) break;
      rows.push(row);
    }
    const meta = statement.columns();
    const columns = rows.length > 0 ? Object.keys(rows[0]) : meta.map((column) => column.name);

    const outcome: ReadQueryOutcome = {
      columns,
      rows,
      rowCount: rows.length,
      truncated: rows.length >= limit,
    };
    if (relations) outcome.relations = relations;
    if (options.withOrigins) {
      // Rows are keyed by name, so with duplicate names the LAST column's value
      // survives; take that column's origin.
      outcome.origins = columns.map((name): ColumnOrigin | null => {
        const col = [...meta].reverse().find((m) => m.name === name);
        return col?.table && col.column ? { table: col.table, column: col.column } : null;
      });
    }
    return outcome;
  }

  /**
   * The tables a query reads, from SQLite's own bytecode: every OpenRead /
   * ReopenIdx names a root page, which sqlite_master maps to its table (an
   * index read counts as its table). Views are already expanded by then, so
   * aliases, CTEs and views cannot hide a table. Anything that cannot be
   * mapped — a virtual table, an attached or temp database, an unknown page —
   * fails closed.
   */
  private planRelations(sql: string): string[] {
    const ops = this.db.prepare(`EXPLAIN ${sql}`).all() as Array<{
      opcode: string;
      p2: number;
      p3: number;
    }>;
    const roots = new Map<number, string>(
      (
        this.db
          .prepare("SELECT tbl_name, rootpage FROM sqlite_master WHERE rootpage > 0")
          .all() as Array<{ tbl_name: string; rootpage: number }>
      ).map((row) => [row.rootpage, row.tbl_name]),
    );
    const relations = new Set<string>();
    for (const op of ops) {
      if (op.opcode === "VOpen") {
        throw new PolicyError(
          "tables",
          "Query reads a virtual table or table-valued function, which a table policy cannot check.",
        );
      }
      if (op.opcode !== "OpenRead" && op.opcode !== "ReopenIdx") continue;
      if (op.p3 !== 0) {
        throw new PolicyError("tables", "Query reads an attached or temporary database, which a table policy cannot check.");
      }
      const table = op.p2 === 1 ? "sqlite_master" : roots.get(op.p2);
      if (!table) {
        throw new PolicyError("tables", "Could not determine every table this query reads, so it was refused.");
      }
      relations.add(table);
    }
    return [...relations];
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
