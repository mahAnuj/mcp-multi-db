// Reproduces docs/images/demo-session.png: an MCP client calls run_query the
// way an agent would, against a throwaway SQLite database with a policy that
// denies one table and redacts one column. Run from the repo root after
// `npm run build`:  node examples/demo/run-demo.mjs
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dbPath = join(mkdtempSync(join(tmpdir(), "mcp-demo-")), "shop.db");
const seed = new Database(dbPath);
seed.exec(`
  CREATE TABLE customers (id INTEGER, name TEXT, email TEXT, plan TEXT);
  INSERT INTO customers VALUES (1,'Asha Rao','asha@example.com','pro'),
    (2,'Ben Ortiz','ben@example.com','free'), (3,'Chen Li','chen@example.com','pro');
  CREATE TABLE api_keys (customer_id INTEGER, key TEXT);
  INSERT INTO api_keys VALUES (1,'sk_live_51H...'), (2,'sk_live_93K...');
`);
seed.close();

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/index.js"],
  stderr: "ignore",
  env: {
    ...process.env,
    MCP_DATABASES: JSON.stringify([{
      id: "shop", type: "sqlite", path: dbPath, label: "Shop (read-only)",
      policy: { tables: { deny: ["api_keys"] }, columns: { redact: ["customers.email"] } },
    }]),
  },
});
const client = new Client({ name: "demo", version: "1.0.0" });
await client.connect(transport);

async function query(sql) {
  const r = await client.callTool({ name: "run_query", arguments: { database_id: "shop", sql } });
  const text = r.content[0].text;
  let out = text;
  if (!r.isError) {
    const j = JSON.parse(text);
    out = j.rows.map((row) => JSON.stringify(row)).join("\n")
      + (j.redacted?.length ? `\n(redacted: ${j.redacted.join(", ")})` : "");
  }
  console.log(`$ run_query  ${sql}`);
  console.log((r.isError ? "✗ refused: " : "✓ ") + out.replace(/\n/g, "\n  "));
  console.log();
}

await query("SELECT id, name, plan, email FROM customers");
await query("SELECT * FROM api_keys");
await query("WITH k AS (SELECT key FROM api_keys) SELECT * FROM k");
await query("SELECT name, email AS contact FROM customers WHERE plan = 'pro'");
await query("DELETE FROM customers WHERE id = 2");
await client.close();

const left = new Database(dbPath, { readonly: true }).prepare("SELECT count(*) AS n FROM customers").get().n;
console.log(`customers rows after the demo: ${left}`);
