// Self-contained demo: seeds a SQLite database, then drives the *real* built
// MCP server (build/index.js) over stdio via the MCP SDK client — exactly how
// an MCP host (Claude Desktop, Cursor, ...) talks to it. Run `npm run build`
// first, then `node examples/demo.mjs`. Used to record docs/demo.gif with VHS.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dbPath = join(here, ".demo.db");
const configPath = join(here, ".demo.databases.json");

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seed() {
  rmSync(dbPath, { force: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, plan TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL);
    INSERT INTO users (name, plan) VALUES ('Ada', 'pro'), ('Linus', 'free'), ('Grace', 'pro');
    INSERT INTO orders (user_id, total) VALUES (1, 42.00), (1, 8.50), (3, 99.99);
  `);
  db.close();
  return JSON.stringify({
    databases: [
      { id: "demo-sqlite", type: "sqlite", path: dbPath, label: "Demo SQLite", description: "Seeded demo data" },
    ],
  });
}

async function call(client, name, args = {}) {
  console.log(c.cyan(`\n  ▸ ${name}`) + (Object.keys(args).length ? c.dim(`  ${JSON.stringify(args)}`) : ""));
  await sleep(500);
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  const isError = res.isError;
  for (const line of text.split("\n")) {
    console.log("    " + (isError ? c.red(line) : c.green(line)));
  }
  await sleep(900);
}

async function main() {
  const config = seed();
  process.env.MCP_DB_CONFIG = configPath;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(configPath, config);

  console.log(c.bold("\n  mcp-multi-db") + c.dim("  —  one read-only MCP server for all your SQL databases\n"));
  await sleep(700);

  const transport = new StdioClientTransport({
    command: "node",
    args: [join(root, "build", "index.js")],
    env: { ...process.env, MCP_DB_CONFIG: configPath },
    stderr: "ignore",
  });
  const client = new Client({ name: "demo", version: "1.0.0" });
  await client.connect(transport);

  await call(client, "list_databases");
  await call(client, "list_tables", { database_id: "demo-sqlite" });
  await call(client, "describe_table", { database_id: "demo-sqlite", table: "users" });
  await call(client, "run_query", {
    database_id: "demo-sqlite",
    sql: "SELECT u.name, COUNT(o.id) AS orders, SUM(o.total) AS spent FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id ORDER BY spent DESC",
  });

  console.log(c.yellow("\n  ✦ writes are refused — safe to point at real data:"));
  await call(client, "run_query", {
    database_id: "demo-sqlite",
    sql: "DELETE FROM users WHERE id = 1",
  });

  await client.close();
  rmSync(dbPath, { force: true });
  rmSync(configPath, { force: true });
  console.log(c.dim("\n  github.com/mahAnuj/mcp-multi-db\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
