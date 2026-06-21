# PR to punkpeye/awesome-mcp-servers

## Repo to fork

https://github.com/punkpeye/awesome-mcp-servers

## File to edit

`README.md`

## Section to add to

`🗄️ Databases`

## Line to add (alphabetical by `owner/repo-name`)

```markdown
- [mahAnuj/mcp-multi-db](https://github.com/mahAnuj/mcp-multi-db) 📇 🏠 - Unified read-only MCP for PostgreSQL, MySQL, and SQLite — one server, one config, one set of tools
```

Place it alphabetically (between entries starting with `m` and the next letter — usually after the `modelcontextprotocol/*` entries).

## PR title

```
Add mcp-multi-db to Databases section
```

## PR body

```
Adds mcp-multi-db — a unified read-only MCP server supporting PostgreSQL, MySQL, and SQLite from a single configuration.

Why it's distinct from existing single-DB entries:
- One install instead of N
- Identical tool surface across backends (list_databases, list_tables, describe_table, run_query)
- Read-only-by-default with two-layer enforcement (SQL-text guard + DB-level read-only transactions)
- Extensible adapter pattern (ClickHouse / MongoDB planned)

Repo: https://github.com/mahAnuj/mcp-multi-db
npm: https://www.npmjs.com/package/mcp-multi-db
License: ISC
Tests + CI: yes
```

## Emoji legend (per their convention)

- 📇 = TypeScript codebase
- 🏠 = Local service
- (No 🎖️ — not an official MCP team server)
- (No 🐍 — not Python)
