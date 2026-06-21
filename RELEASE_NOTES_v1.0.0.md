# v1.0.0 — Initial release

**One MCP server for Postgres, MySQL, and SQLite.** Read-only and safe by default.

## What it does

Lets any MCP-capable client (Claude Desktop, Claude Code, Cursor, Cline, Windsurf, etc.) talk to PostgreSQL, MySQL, and SQLite databases — all from a single server config. List databases, list tables, describe columns, and run read-only queries through one unified tool surface.

## Install

```bash
npx mcp-multi-db
```

Or register in your MCP client (see [README](README.md) for client-specific configs):

```json
{
  "mcpServers": {
    "mcp-multi-db": {
      "command": "npx",
      "args": ["-y", "mcp-multi-db"],
      "env": { "MCP_DB_CONFIG": "/path/to/databases.json" }
    }
  }
}
```

## Features

- **Three SQL engines side by side** — Postgres, MySQL, SQLite — through one server, one config
- **Read-only by default, two-layer enforcement** — SQL-text guard + database-level read-only transactions (and SQLite opened read-only). `INSERT`, `UPDATE`, `DELETE`, DDL all refused.
- **Schema-aware** — `list_databases`, `list_tables`, `describe_table`, `run_query`
- **Row limits + query timeouts** — caps results at 100 (max 1000), bounds runtime at 30s
- **Pluggable adapter pattern** — adding a new SQL engine is a contained change documented in [docs/extending.md](docs/extending.md)

## Why this exists

If you use MCP with multiple databases, you've been installing a separate MCP per backend. Different tool names. Different config files. Different docs. This collapses that to one server, one config, one set of tools.

## What's next

- ClickHouse adapter (if there's interest)
- MongoDB adapter (post-NoSQL feedback)
- Issues + PRs welcome — see [docs/extending.md](docs/extending.md) for the contributor checklist

## Links

- **npm**: <https://www.npmjs.com/package/mcp-multi-db>
- **Docs**: [Architecture](docs/architecture.md) · [Extending](docs/extending.md) · [Security](SECURITY.md)
- **License**: ISC
