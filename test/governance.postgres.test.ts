import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { DatabaseRegistry } from "../build/adapters/registry.js";
import { DatabaseService } from "../build/services/databaseService.js";

// Runs only when MCP_TEST_POSTGRES_URL points at a disposable database the
// test may create a schema in; skipped otherwise, so `npm test` needs no
// server. Exercises the Postgres-specific paths: EXPLAIN (FORMAT JSON,
// VERBOSE) for relations, and RowDescription tableID/columnID for origins.
const url = process.env.MCP_TEST_POSTGRES_URL;

describe("governance on PostgreSQL (integration)", { skip: !url && "set MCP_TEST_POSTGRES_URL" }, () => {
  const schema = `gov_${process.pid}`;
  let admin: pg.Client;

  before(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.accounts (id serial PRIMARY KEY, name text, email text);
      CREATE TABLE ${schema}.secrets (id serial PRIMARY KEY, token text);
      CREATE VIEW ${schema}.secret_view AS SELECT * FROM ${schema}.secrets;
      CREATE VIEW ${schema}.account_view AS SELECT id, email FROM ${schema}.accounts;
      INSERT INTO ${schema}.accounts (name, email) VALUES ('Ada', 'ada@example.com');
      INSERT INTO ${schema}.secrets (token) VALUES ('s3cr3t');
    `);
  });

  after(async () => {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const svc = (policy: Record<string, unknown>) =>
    new DatabaseService(
      new DatabaseRegistry([{ id: "pg", type: "postgres", connectionString: url!, policy }]),
    );
  const rule = (r: string) => (e: unknown) => (e as { rule?: string }).rule === r;

  it("table allow-list: schema-qualified, through alias, CTE and view", async () => {
    const s = svc({ tables: { allow: [`${schema}.accounts`] } });
    assert.equal((await s.runQuery("pg", `SELECT name FROM ${schema}.accounts`)).rows[0].name, "Ada");
    for (const sql of [
      `SELECT x.token FROM ${schema}.secrets x`,
      `WITH s AS (SELECT * FROM ${schema}.secrets) SELECT * FROM s`,
      `SELECT * FROM ${schema}.secret_view`,
      `SELECT name, (SELECT token FROM ${schema}.secrets LIMIT 1) FROM ${schema}.accounts`,
    ]) {
      await assert.rejects(s.runQuery("pg", sql), rule("tables"), sql);
    }
    await s.close();
  });

  it("refuses a function scan under a table policy", async () => {
    const s = svc({ tables: { deny: [`${schema}.secrets`] } });
    await assert.rejects(s.runQuery("pg", "SELECT * FROM generate_series(1, 3)"), rule("tables"));
    await s.close();
  });

  it("redacts by origin through an alias; refuses computed and view columns", async () => {
    const s = svc({ columns: { redact: [`${schema}.accounts.email`] } });
    const r = await s.runQuery("pg", `SELECT name, email AS e FROM ${schema}.accounts`);
    assert.equal(r.rows[0].e, "[redacted]");
    assert.deepEqual(r.redacted, [`${schema}.accounts.email`]);
    await assert.rejects(s.runQuery("pg", `SELECT lower(email) FROM ${schema}.accounts`), rule("columns"));
    // A view column names the view, not its base table, so it cannot be traced.
    await assert.rejects(s.runQuery("pg", `SELECT email FROM ${schema}.account_view`), rule("columns"));
    await s.close();
  });

  it("applies the per-database timeout", async () => {
    const s = svc({ timeoutMs: 200 });
    await assert.rejects(s.runQuery("pg", "SELECT pg_sleep(2)"), /statement timeout/);
    await s.close();
  });
});
