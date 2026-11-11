# mcp-multi-db

[![npm version](https://img.shields.io/npm/v/mcp-multi-db.svg)](https://www.npmjs.com/package/mcp-multi-db)
[![npm downloads](https://img.shields.io/npm/dm/mcp-multi-db.svg)](https://www.npmjs.com/package/mcp-multi-db)
[![license](https://img.shields.io/npm/l/mcp-multi-db.svg)](LICENSE)
[![mcp-multi-db MCP server](https://glama.ai/mcp/servers/mahAnuj/mcp-multi-db/badges/score.svg)](https://glama.ai/mcp/servers/mahAnuj/mcp-multi-db)
[![M8ven Verified](https://m8ven.ai/badge/mcp/mahanuj-mcp-multi-db-1dz3qj?variant=verified&v=3abe07628301cdb645fd676a67e656fa)](https://m8ven.ai/mcp/mahanuj-mcp-multi-db-1dz3qj?s=readme)

**One MCP server for all your SQL databases — read-only and safe by default.**

[![mcp-multi-db MCP server card](https://glama.ai/mcp/servers/mahAnuj/mcp-multi-db/badges/card.svg)](https://glama.ai/mcp/servers/mahAnuj/mcp-multi-db)

Connect an AI agent to PostgreSQL, MySQL, and SQLite at the same time through a
single [Model Context Protocol](https://modelcontextprotocol.io) server. List
your databases in one config file and the agent picks which one to query by
`database_id`. Every query is enforced read-only at the database level, so it's
safe to point at real data.

- **Multi-engine, one server** — Postgres, MySQL, and SQLite side by side; no
  separate server per database.
- **Read-only & safe by default** — two-layer enforcement (SQL-text guard +
  database-level read-only transactions) plus row limits and query timeouts.
  See [SECURITY.md](SECURITY.md).
- **Governed when you need it (opt-in)** — per-database tool scope, a table
  allow/deny-list checked against the engine's own query plan, column redaction
  that survives aliasing, row/time/rate budgets, and a JSONL audit log. See
  [Governance](#governance-opt-in).
- **Schema-aware** — the agent can discover databases, tables/views, and column
  metadata before it writes a query.
- **Zero query language to learn** — just ask in natural language.

![Demo: the MCP server listing databases, inspecting schema, running a read-only query, and refusing a write](docs/demo.gif)

> The clip drives the real server over stdio (via the MCP SDK) against a seeded
> SQLite database. Regenerate it with `npm run build && vhs examples/demo.tape`.

## Tools

| Tool | Description |
|------|-------------|
| `list_databases` | List configured database connections |
| `list_tables` | List tables/views in a database |
| `describe_table` | Show column metadata for a table |
| `run_query` | Run read-only SQL (`SELECT`, `WITH`, `EXPLAIN`) |

## Quick start

No install needed — `npx` fetches the package on first use.

### 1. Create `databases.json`

Copy the example and edit with your connection details:

```bash
cp databases.example.json databases.json
```

```json
{
  "databases": [
    {
      "id": "local-sqlite",
      "type": "sqlite",
      "path": "/absolute/path/to/app.db",
      "label": "Local dev SQLite"
    },
    {
      "id": "analytics-pg",
      "type": "postgres",
      "connectionString": "postgresql://user:pass@localhost:5432/analytics",
      "label": "Analytics Warehouse"
    },
    {
      "id": "reporting-mysql",
      "type": "mysql",
      "connectionString": "mysql://user:pass@localhost:3306/reporting",
      "label": "Reporting MySQL"
    }
  ]
}
```

> **Never commit `databases.json`** — it contains credentials. It's already
> gitignored if you cloned the repo. Prefer read-only database users (see
> [Security](#security)).

### 2. Register the server with your MCP client

The server speaks MCP over **stdio**, so it works with any MCP-capable client.
Use `npx mcp-multi-db` as the command and pass `MCP_DB_CONFIG` (the path to
your `databases.json`). See [mcp.example.json](mcp.example.json) and
[databases.example.json](databases.example.json) for templates.

<details open>
<summary><b>Claude Desktop</b></summary>

Edit `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mcp-multi-db": {
      "command": "npx",
      "args": ["-y", "mcp-multi-db"],
      "env": {
        "MCP_DB_CONFIG": "/absolute/path/to/databases.json"
      }
    }
  }
}
```

Restart Claude Desktop afterward.
</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add mcp-multi-db \
  --env MCP_DB_CONFIG=/absolute/path/to/databases.json \
  -- npx -y mcp-multi-db
```
</details>

<details>
<summary><b>Cursor</b></summary>

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project), then open
**Cursor Settings → Tools & MCP**, restart the server, and use **Agent** mode:

```json
{
  "mcpServers": {
    "mcp-multi-db": {
      "command": "npx",
      "args": ["-y", "mcp-multi-db"],
      "env": {
        "MCP_DB_CONFIG": "/absolute/path/to/databases.json"
      }
    }
  }
}
```
</details>

<details>
<summary><b>Cline / Windsurf / other MCP clients</b></summary>

Any client that supports stdio MCP servers uses the same shape: command `npx`,
args `["-y", "mcp-multi-db"]`, and env `MCP_DB_CONFIG` pointing at your
`databases.json`. Consult your client's docs for where its MCP config lives.

> **Prefer a pinned global install?** `npm install -g mcp-multi-db`, then use
> command `mcp-multi-db` with no args.
</details>

## Configuration reference

Config is loaded from one of two environment variables, in order:

1. **`MCP_DB_CONFIG`** — path to a JSON file (recommended).
2. **`MCP_DATABASES`** — inline JSON (useful when a file path is awkward).

The JSON may be either `{ "databases": [ ... ] }` or a bare array. Each entry:

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Unique; the agent references this as `database_id` |
| `type` | yes | `postgres` \| `mysql` \| `sqlite` |
| `connectionString` | postgres/mysql | Standard connection URI |
| `path` | sqlite | Absolute path to the `.db` file |
| `label` | no | Human-friendly name shown to the agent |
| `description` | no | Extra context shown to the agent |
| `policy` | no | Opt-in governance for this database — see [Governance](#governance-opt-in) |

The object form also accepts top-level `audit` (see Governance) and `limits`:

| Field | Default | Notes |
|-------|---------|-------|
| `limits.defaultRows` | 100 | Rows returned when a query passes no `limit` |
| `limits.maxRows` | 1000 | Ceiling on rows per query; at most **10,000**, a hard cap no config can raise |

Each database can narrow these with `policy.defaultRows` / `policy.maxRows`
(never widen them), and `list_databases` reports every database's effective
`rowLimits` so the agent knows them before it asks. A `LIMIT` in the SQL must be
a plain integer, and adapters stop fetching at the cap whatever the SQL says.

## Governance (opt-in)

Read-only answers *can the agent change data?* A policy answers the next
questions: what may it read, may it see personal data, and what did it run.
A database with no `policy`, and a config with no `audit`, behave exactly as
before.

```json
{
  "audit": { "path": "/var/log/mcp-multi-db/audit.jsonl", "sql": "full" },
  "databases": [
    {
      "id": "crm",
      "type": "postgres",
      "connectionString": "postgresql://readonly@replica:5432/crm",
      "policy": {
        "tools": ["list_tables", "describe_table", "run_query"],
        "tables": { "allow": ["public.accounts", "public.deals"] },
        "columns": { "redact": ["public.accounts.email", "public.accounts.phone"] },
        "maxRows": 200,
        "timeoutMs": 10000,
        "rateLimit": { "queriesPerMinute": 30 }
      }
    }
  ]
}
```

| Control | What it does | How it is enforced |
|---------|--------------|--------------------|
| `tools` | Tools exposed for this database. Leave out `run_query` for schema-only access. | Checked before any database call. |
| `tables.allow` / `tables.deny` | Relations a query may read. Names match case-insensitively on trailing segments (`accounts` matches `public.accounts`). | From the engine's **query plan**, inside the read-only transaction, before the query runs — so aliases, CTEs, subqueries and views cannot hide a table. Postgres and SQLite only; see below. |
| `columns.redact` | `[schema.]table.column` values become `"[redacted]"`. | From each result column's **origin** as the driver reports it, so `SELECT email AS e` is still redacted. A computed or view column over a table with redacted columns is refused. |
| `maxRows` / `defaultRows` | Row ceiling and default for this database. | Can only narrow the server-wide `limits`; enforced in the SQL and again when rows are fetched. |
| `timeoutMs` | Statement timeout (≤ 30000). | Postgres `statement_timeout`, MySQL `MAX_EXECUTION_TIME`. Not available for SQLite. |
| `rateLimit.queriesPerMinute` | `run_query` budget. | Token bucket per database; the refusal says when to retry. |
| `audit` (top level) | One JSON line per tool call: tool, database, SQL (or `"sql": "hash"` for its SHA-256), outcome, the rule that refused, tables read, columns redacted, timing. **Never result values.** | Written before the response. A failed write warns on stderr; `"required": true` makes it fail the call instead. |

**What else a policy changes.** Under a table policy, `list_tables` and
`describe_table` only show tables the policy allows, and the system catalogs
(`sqlite_master`, `pg_catalog`, `information_schema`) are refused unless the
allow-list names them, because they describe every table. On a database with
redacted columns, an engine error raised *while a query runs* is replaced with
a generic message, because errors such as `bad JSON path: '<value>'` can echo
row values; parse and plan errors still come through.

**What redaction does not stop.** It hides values in results. It does not stop
a query from filtering, grouping or sorting by a redacted column, so
`SELECT name FROM accounts WHERE email LIKE 'a%'` returns no email but answers
a question about one, and enough such queries can reconstruct a value. If that
matters, do not expose the column at all (a view without it, or column grants)
and set a `rateLimit`.

**Engine notes.** MySQL's query plan reports table *aliases*, so a `tables`
policy on MySQL is rejected at startup — restrict tables with MySQL grants.
Redaction on MySQL matches the column *name* in any table, which can
over-redact but never under-redacts. Under a table or column policy, `EXPLAIN`
and (on Postgres) function scans are refused, because neither can be checked.
A function that reads another table inside its body does not appear in a plan;
the read-only database user is what bounds that. Full design and limits:
[docs/governance.md](docs/governance.md).

## Example prompts

- "List my configured databases"
- "What tables are in `local-sqlite`?"
- "Describe the `users` table in `analytics-pg`"
- "Run `SELECT COUNT(*) FROM orders` on `reporting-mysql`"

## Security

- **Read-only only.** `INSERT`, `UPDATE`, `DELETE`, DDL, etc. are blocked — both
  by a SQL-text guard and by running each query inside a database-level
  read-only transaction (SQLite opens read-only). A `SELECT` that calls a
  side-effecting function is still refused.
- **Row limits.** Results are capped (default 100, max 1000; configurable up
  to a hard cap of 10,000).
- **Query timeouts.** Statements are bounded (30s) to avoid runaway queries.
- **Optional governance.** Per-database tool scope, plan-checked table
  policy, alias-proof column redaction, budgets and an audit log — see
  [Governance](#governance-opt-in).
- **Use least privilege anyway.** Prefer dedicated read-only DB users and read
  replicas. Full details and reporting in [SECURITY.md](SECURITY.md).

## Docker

A multi-stage [`Dockerfile`](Dockerfile) is included. Build and run with your
`databases.json` mounted in:

```bash
docker build -t mcp-multi-db .

docker run --rm -i \
  -v /absolute/path/to/databases.json:/config/databases.json:ro \
  mcp-multi-db
```

The image runs as a non-root user, ships only the built JS and runtime
`node_modules` (no toolchain), and speaks MCP over stdio just like the npx
install — so it slots into any MCP client by replacing the `command` and
`args` with the appropriate `docker run -i` invocation.

## Development

```bash
npm install
npm run build     # tsc -> build/, the artifact MCP clients run
npm test          # builds, then runs the node:test suite
```

Tests use Node's built-in test runner (no extra dependencies) and cover the
read-only SQL guard and the SQLite adapter end to end. CI runs build + tests on
every push and pull request.

Adding another database engine is a contained change: add the config variant in
[`src/config.ts`](src/config.ts), implement the `SqlDatabasePort` interface in a
new adapter under [`src/adapters/`](src/adapters/), and register it in the
adapter factory. New adapters must enforce read-only at the connection level —
not rely on the text guard alone. See [docs/extending.md](docs/extending.md) for
the full checklist.

## Documentation

- **[Architecture](docs/architecture.md)** — components, request lifecycle, and
  the port-family design (with diagrams).
- **[Extending](docs/extending.md)** — add a SQL engine or a non-SQL family.
- **[Security](SECURITY.md)** — the two-layer read-only model and safe
  deployment.

The full index is in [docs/](docs/README.md).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for setup, the read-only invariants, and how to add a database engine.

## License

ISC — see [LICENSE](LICENSE).
