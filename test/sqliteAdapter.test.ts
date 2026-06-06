import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../build/adapters/sqlite.js";

describe("SqliteAdapter (integration)", () => {
  let dir: string;
  let dbPath: string;
  let adapter: SqliteAdapter;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-multi-db-test-"));
    dbPath = join(dir, "app.db");

    // Seed a database with a writable connection, then close it. The adapter
    // opens the same file read-only.
    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
      INSERT INTO users (name, email) VALUES ('Ada', 'ada@example.com');
      INSERT INTO users (name, email) VALUES ('Linus', NULL);
      CREATE VIEW active_users AS SELECT * FROM users;
    `);
    seed.close();

    adapter = new SqliteAdapter("test-sqlite", dbPath);
  });

  after(async () => {
    await adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists tables and views, excluding internal sqlite_ objects", async () => {
    const tables = await adapter.listTables();
    const byName = new Map(tables.map((t) => [t.name, t]));

    assert.equal(byName.get("users")?.type, "table");
    assert.equal(byName.get("active_users")?.type, "view");
    assert.ok(!tables.some((t) => t.name.startsWith("sqlite_")));
  });

  it("describes columns with nullability and primary keys", async () => {
    const columns = await adapter.describeTable("users");
    const byName = new Map(columns.map((c) => [c.name, c]));

    assert.equal(byName.get("id")?.isPrimaryKey, true);
    assert.equal(byName.get("name")?.nullable, false);
    assert.equal(byName.get("email")?.nullable, true);
    assert.equal(byName.get("name")?.isPrimaryKey, false);
  });

  it("throws a clear error for an unknown table", async () => {
    await assert.rejects(() => adapter.describeTable("does_not_exist"), /not found/i);
  });

  it("runs a read query and reports column order", async () => {
    const result = await adapter.executeReadQuery(
      "SELECT id, name FROM users ORDER BY id LIMIT 100",
      100,
    );
    assert.deepEqual(result.columns, ["id", "name"]);
    assert.equal(result.rowCount, 2);
    assert.equal(result.truncated, false);
  });

  it("marks results truncated when row count reaches the limit", async () => {
    const result = await adapter.executeReadQuery(
      "SELECT id FROM users ORDER BY id LIMIT 1",
      1,
    );
    assert.equal(result.rowCount, 1);
    assert.equal(result.truncated, true);
  });

  it("rejects writes at the database layer (read-only connection)", async () => {
    // Even though the service-level guard would normally block this, the
    // connection itself must refuse writes as defense in depth. RETURNING makes
    // the statement row-returning so the write is actually attempted (and the
    // read-only connection rejects it) rather than failing as "no data".
    await assert.rejects(
      () =>
        adapter.executeReadQuery(
          "INSERT INTO users (name) VALUES ('x') RETURNING id",
          100,
        ),
      /readonly database/i,
    );
  });
});
