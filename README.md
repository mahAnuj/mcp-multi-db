# mcp-multi-db

[![npm version](https://img.shields.io/npm/v/mcp-multi-db.svg)](https://www.npmjs.com/package/mcp-multi-db)
[![npm downloads](https://img.shields.io/npm/dm/mcp-multi-db.svg)](https://www.npmjs.com/package/mcp-multi-db)
[![license](https://img.shields.io/npm/l/mcp-multi-db.svg)](LICENSE)
[![mcp-multi-db MCP server](https://glama.ai/mcp/servers/mahAnuj/mcp-multi-db/badges/score.svg)](https://glama.ai/mcp/servers/mahAnuj/mcp-multi-db)

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
- **Row limits.** Results are capped (default 100, max 1000).
- **Query timeouts.** Statements are bounded (30s) to avoid runaway queries.
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

## License

ISC — see [LICENSE](LICENSE).
