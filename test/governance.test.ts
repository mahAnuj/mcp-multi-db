import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { DatabaseRegistry } from "../build/adapters/registry.js";
import { loadConfig } from "../build/config.js";
import { AuditLog } from "../build/governance/audit.js";
import { RateLimiter, nameMatches } from "../build/governance/policy.js";
import { DatabaseService } from "../build/services/databaseService.js";

// Every test here drives the real service and the real SQLite adapter, so a
// control is proven at the layer that enforces it, not in a re-implementation.

let dir: string;
let dbPath: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-multi-db-gov-"));
  dbPath = join(dir, "app.db");
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT);
    CREATE TABLE deals (id INTEGER PRIMARY KEY, account_id INTEGER, amount INTEGER);
    CREATE TABLE secrets (id INTEGER PRIMARY KEY, token TEXT);
    CREATE INDEX deals_account ON deals(account_id);
    CREATE VIEW secret_view AS SELECT * FROM secrets;
    CREATE VIEW account_emails AS SELECT id, lower(email) AS e FROM accounts;
    INSERT INTO accounts (name, email, phone) VALUES ('Ada', 'ada@example.com', '555-0100');
    INSERT INTO accounts (name, email, phone) VALUES ('Linus', 'linus@example.com', '555-0101');
    INSERT INTO deals (account_id, amount) VALUES (1, 500), (2, 900), (1, 50);
    INSERT INTO secrets (token) VALUES ('s3cr3t-token');
  `);
  seed.close();
});

after(() => rmSync(dir, { recursive: true, force: true }));

function service(policy: Record<string, unknown> | undefined, audit?: AuditLog, now?: () => number) {
  const registry = new DatabaseRegistry([
    { id: "app", type: "sqlite", path: dbPath, ...(policy ? { policy } : {}) },
  ]);
  return new DatabaseService(registry, { ...(audit ? { audit } : {}), ...(now ? { now } : {}) });
}

const refusedBy = (rule: string) => (err: unknown) => {
  assert.equal((err as { name?: string }).name, "PolicyError", String(err));
  assert.equal((err as { rule?: string }).rule, rule);
  return true;
};

describe("no policy: behaviour unchanged", () => {
  it("reads every table and reports no policy in list_databases", async () => {
    const svc = service(undefined);
    const r = await svc.runQuery("app", "SELECT token FROM secrets");
    assert.equal(r.rows[0].token, "s3cr3t-token");
    assert.equal(svc.listDatabases()[0].policy, undefined);
    assert.equal(r.redacted, undefined);
    await svc.close();
  });
});

describe("tool scope", () => {
  it("makes a database schema-only when run_query is left out", async () => {
    const svc = service({ tools: ["list_tables", "describe_table"] });
    assert.ok((await svc.listTables("app")).length > 0);
    await assert.rejects(svc.runQuery("app", "SELECT 1"), refusedBy("tools"));
    assert.deepEqual(svc.listDatabases()[0].policy?.tools, ["list_tables", "describe_table"]);
    await svc.close();
  });
});

describe("table policy, enforced from the query plan", () => {
  const allow = { tables: { allow: ["accounts", "deals"] } };

  it("allows a join across allowed tables, including through an index", async () => {
    const svc = service(allow);
    const r = await svc.runQuery(
      "app",
      "SELECT a.name, d.amount FROM accounts a JOIN deals d ON d.account_id = a.id WHERE d.account_id = 1",
    );
    assert.equal(r.rowCount, 2);
    await svc.close();
  });

  for (const [label, sql] of [
    ["a direct read", "SELECT token FROM secrets"],
    ["an alias", "SELECT x.token FROM secrets AS x"],
    ["a CTE", "WITH s AS (SELECT * FROM secrets) SELECT * FROM s"],
    ["a subquery", "SELECT name, (SELECT token FROM secrets LIMIT 1) AS t FROM accounts"],
    ["a view", "SELECT * FROM secret_view"],
    ["the schema table", "SELECT sql FROM sqlite_master"],
    ["a table-valued function", "SELECT * FROM pragma_table_info('secrets')"],
  ] as const) {
    it(`refuses a table outside the allow-list via ${label}`, async () => {
      const svc = service(allow);
      await assert.rejects(svc.runQuery("app", sql), refusedBy("tables"));
      await svc.close();
    });
  }

  it("deny-list refuses only the named table", async () => {
    const svc = service({ tables: { deny: ["secrets"] } });
    assert.equal((await svc.runQuery("app", "SELECT count(*) AS n FROM deals")).rows[0].n, 3);
    await assert.rejects(svc.runQuery("app", "SELECT * FROM secret_view"), refusedBy("tables"));
    await svc.close();
  });

  it("refuses EXPLAIN on a governed database", async () => {
    const svc = service(allow);
    await assert.rejects(svc.runQuery("app", "EXPLAIN SELECT * FROM accounts"), refusedBy("explain"));
    await svc.close();
  });
});

describe("column redaction, keyed on result-column origin", () => {
  const redact = { columns: { redact: ["accounts.email", "accounts.phone"] } };

  it("redacts a selected column and says so", async () => {
    const svc = service(redact);
    const r = await svc.runQuery("app", "SELECT name, email FROM accounts");
    assert.equal(r.rows[0].name, "Ada");
    assert.equal(r.rows[0].email, "[redacted]");
    assert.deepEqual(r.redacted, ["accounts.email"]);
    await svc.close();
  });

  it("redacts through an alias and through SELECT *", async () => {
    const svc = service(redact);
    const aliased = await svc.runQuery("app", "SELECT email AS e, phone AS p FROM accounts");
    assert.equal(aliased.rows[0].e, "[redacted]");
    assert.equal(aliased.rows[0].p, "[redacted]");
    const star = await svc.runQuery("app", "SELECT * FROM accounts");
    assert.equal(star.rows[1].email, "[redacted]");
    assert.equal(star.rows[1].name, "Linus");
    await svc.close();
  });

  for (const [label, sql] of [
    ["a computed expression", "SELECT lower(email) AS e FROM accounts"],
    ["concatenation", "SELECT email || '' AS e FROM accounts"],
    ["a view that computes over it", "SELECT e FROM account_emails"],
    ["a CTE that renames it", "WITH t AS (SELECT email AS x FROM accounts) SELECT upper(x) FROM t"],
  ] as const) {
    it(`refuses ${label} over a redacted column`, async () => {
      const svc = service(redact);
      await assert.rejects(svc.runQuery("app", sql), refusedBy("columns"));
      await svc.close();
    });
  }

  it("allows computed columns over tables with nothing redacted", async () => {
    const svc = service(redact);
    const r = await svc.runQuery("app", "SELECT sum(amount) AS total FROM deals");
    assert.equal(r.rows[0].total, 1450);
    await svc.close();
  });
});

describe("budgets", () => {
  it("maxRows caps the row limit, and can only make it stricter", async () => {
    const svc = service({ maxRows: 2 });
    const r = await svc.runQuery("app", "SELECT * FROM deals", 500);
    assert.equal(r.rowCount, 2);
    assert.equal(r.truncated, true);
    await svc.close();
  });

  it("rate limit refuses the call over budget and recovers with time", async () => {
    let t = 0;
    const svc = service({ rateLimit: { queriesPerMinute: 2 } }, undefined, () => t);
    await svc.runQuery("app", "SELECT 1");
    await svc.runQuery("app", "SELECT 1");
    await assert.rejects(svc.runQuery("app", "SELECT 1"), refusedBy("rate_limit"));
    t += 30_000; // half a minute refills one token at 2/min
    await svc.runQuery("app", "SELECT 1");
    await svc.close();
  });

  it("RateLimiter says when to retry", () => {
    const rl = new RateLimiter(1, () => 0);
    rl.take();
    assert.throws(() => rl.take(), /Try again in 60s/);
  });
});

describe("audit log", () => {
  it("writes one line per call, with outcome and rule, and never a result value", async () => {
    const path = join(dir, "audit.jsonl");
    writeFileSync(path, "");
    const svc = service(
      { tables: { allow: ["accounts"] }, columns: { redact: ["accounts.email"] } },
      new AuditLog({ path }),
    );
    svc.listDatabases();
    await svc.runQuery("app", "SELECT name, email FROM accounts");
    await assert.rejects(svc.runQuery("app", "SELECT token FROM secrets"));
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

    assert.equal(lines.length, 3);
    assert.equal(lines[0].tool, "list_databases");
    assert.equal(lines[1].outcome, "ok");
    assert.deepEqual(lines[1].tables, ["accounts"]);
    assert.deepEqual(lines[1].redacted, ["accounts.email"]);
    assert.equal(lines[1].rowCount, 2);
    assert.equal(lines[2].outcome, "refused");
    assert.equal(lines[2].rule, "tables");
    assert.deepEqual(lines[2].tables, ["secrets"]);

    const raw = readFileSync(path, "utf8");
    for (const value of ["ada@example.com", "Ada", "s3cr3t-token"]) {
      assert.ok(!raw.includes(value), `audit log must not contain the value ${value}`);
    }
    await svc.close();
  });

  it("hash mode records a SHA-256 instead of the SQL", async () => {
    const path = join(dir, "audit-hash.jsonl");
    writeFileSync(path, "");
    const svc = service(undefined, new AuditLog({ path, sql: "hash" }));
    await svc.runQuery("app", "SELECT name FROM accounts");
    const line = JSON.parse(readFileSync(path, "utf8").trim());
    assert.equal(line.sql, undefined);
    assert.match(line.sql_sha256, /^[0-9a-f]{64}$/);
    await svc.close();
  });

  it("a failed write warns but does not fail the call, unless required", async () => {
    const bad = join(dir, "missing-dir", "audit.jsonl");
    const lenient = service(undefined, new AuditLog({ path: bad }));
    assert.equal((await lenient.runQuery("app", "SELECT 1 AS one")).rows[0].one, 1);
    await lenient.close();
    const strict = service(undefined, new AuditLog({ path: bad, required: true }));
    await assert.rejects(strict.runQuery("app", "SELECT 1"), /audit.required/);
    await strict.close();
  });
});

describe("config validation", () => {
  const load = (config: unknown) => {
    const prev = { c: process.env.MCP_DB_CONFIG, d: process.env.MCP_DATABASES };
    delete process.env.MCP_DB_CONFIG;
    process.env.MCP_DATABASES = JSON.stringify(config);
    try {
      return loadConfig();
    } finally {
      if (prev.c === undefined) delete process.env.MCP_DB_CONFIG;
      else process.env.MCP_DB_CONFIG = prev.c;
      if (prev.d === undefined) delete process.env.MCP_DATABASES;
      else process.env.MCP_DATABASES = prev.d;
    }
  };
  const sqlite = { id: "a", type: "sqlite", path: "x.db" };

  it("accepts a full policy and an audit block", () => {
    const cfg = load({
      audit: { path: "a.jsonl", sql: "hash" },
      databases: [{ ...sqlite, policy: { tools: ["run_query"], maxRows: 50, timeoutMs: 5000 } }],
    });
    assert.equal(cfg.audit?.sql, "hash");
    assert.equal(cfg.databases[0].policy?.maxRows, 50);
  });

  for (const [label, policy] of [
    ["a misspelt control", { tabels: { allow: ["x"] } }],
    ["an unknown tool", { tools: ["drop_table"] }],
    ["maxRows above the global max", { maxRows: 5000 }],
    ["a timeout above 30s", { timeoutMs: 60_000 }],
    ["a redact entry without a table", { columns: { redact: ["email"] } }],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.throws(() => load({ databases: [{ ...sqlite, policy }] }));
    });
  }

  it("rejects a table policy on MySQL, whose plan reports aliases", () => {
    assert.throws(
      () =>
        load({
          databases: [
            { id: "m", type: "mysql", connectionString: "mysql://x", policy: { tables: { allow: ["t"] } } },
          ],
        }),
      /not supported for MySQL/,
    );
  });
});

describe("name matching", () => {
  it("matches on trailing segments, case-insensitively", () => {
    assert.ok(nameMatches("accounts", "public.accounts"));
    assert.ok(nameMatches("PUBLIC.Accounts", "public.accounts"));
    assert.ok(!nameMatches("crm.accounts", "public.accounts"));
    assert.ok(!nameMatches("counts", "public.accounts"));
  });
});
