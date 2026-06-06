# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install           # install dependencies
npm run build         # tsc -> build/, then chmod 755 build/index.js
npm test              # runs build, then node:test suite in test/
node --test "test/**/*.test.ts"          # run tests without rebuilding
node --test test/validateReadOnly.test.ts # run a single test file
```

Tests use Node's built-in runner (`node:test`, no extra deps) and require Node ≥ 22.18 / 24 (native TypeScript execution). They import the **compiled** `build/*.js` — not `src` — because the source uses constructor parameter properties that Node's type-stripping can't run, so `npm test` builds first. There is no linter; TypeScript `strict` mode is the type/correctness gate. Always `npm run build` after changes — `build/index.js` is what the MCP client executes.

To run the server manually for debugging (it speaks MCP over stdio, so it waits for JSON-RPC on stdin):

```bash
MCP_DB_CONFIG=./databases.json node build/index.js
```

## Architecture

A **read-only** MCP server (stdio transport) that exposes SQL queries over PostgreSQL, MySQL, and SQLite to MCP clients (e.g. Cursor). Layers, from entry point outward:

- **`src/index.ts`** — wires everything: load config → build `DatabaseRegistry` → wrap in `DatabaseService` → `registerTools` → connect `StdioServerTransport`.
- **`src/config.ts`** — loads/validates config via Zod. Reads `MCP_DB_CONFIG` (path to JSON file) first, else `MCP_DATABASES` (inline JSON). Accepts either `{ databases: [...] }` or a bare array. Enforces unique `id`s.
- **`src/tools/registerTools.ts`** — the 4 MCP tools (`list_databases`, `list_tables`, `describe_table`, `run_query`). Each is a thin wrapper that calls `DatabaseService` and returns the result JSON-stringified into a text content block. Tool input schemas are defined here with Zod.
- **`src/services/databaseService.ts`** — orchestration layer. The **only place** the read-only SQL guard runs: `runQuery` calls `clampQueryLimit` + `validateReadOnlySql` *before* dispatching to an adapter. Resolves adapters via `getSqlAdapter`, which narrows on `kind` and rejects a non-SQL `database_id` with a clear error (the routing seam for future non-SQL families).
- **`src/adapters/registry.ts`** — maps `database_id` → adapter instance (typed `AnyDatabasePort`), lazily constructing and **caching** adapters (and their connection pools) on first use.
- **`src/adapters/{postgres,mysql,sqlite}.ts`** — per-engine implementations of `SqlDatabasePort`.
- **`src/core/databasePort.ts`** — the thin `DatabasePort` base (`id`, `type`, `kind`, `close`) shared by *every* family, the `DatabaseKind` discriminant (currently just `"sql"`), and `AnyDatabasePort` (the union of all port families). **Port-family model:** relational engines share one `SqlDatabasePort` (`kind: "sql"`) because they share a model; non-relational engines are intentionally *not* grouped under a "nosql" port — each would get its own port/family (e.g. a future `MongoDbPort` with `kind: "mongodb"`), its own read-only guard, and its own service, since they share no common vocabulary.
- **`src/core/sqlDatabasePort.ts` + `src/core/types.ts`** — the `SqlDatabasePort` interface (extends `DatabasePort`) every SQL adapter implements, plus shared types. This is the seam: code above the adapters is engine-agnostic.

### Key invariants

- **Read-only enforcement is two-layered.** (1) SQL-text guard in `src/sql/validateReadOnly.ts` (called from `DatabaseService.runQuery`): allows only statements starting with `SELECT`/`WITH`/`EXPLAIN`, blocks a keyword denylist, rejects multiple statements (stray `;`), and **injects/clamps a `LIMIT`** (default 100, max 1000) onto non-`EXPLAIN` queries. (2) Database-level enforcement in each adapter's `executeReadQuery`: Postgres/MySQL run the query inside a **read-only transaction** (`BEGIN READ ONLY` / `START TRANSACTION READ ONLY`, always `ROLLBACK`); SQLite opens its connection with `{ readonly: true }`. Layer 2 catches writes the text guard can't see (e.g. a `SELECT` calling a side-effecting function). New adapters **must** enforce read-only at the connection/transaction level too — don't rely on the text guard alone.
- **Adding a *SQL* engine** means: add a `*Config` variant + the `type` to the Zod discriminated union in `config.ts`, implement `SqlDatabasePort` (with `kind: "sql"`) in a new adapter, and add a `case` in `createAdapter` (`registry.ts`). The service/tool layers need no changes.
- **Adding a *non-SQL* family** (e.g. mongodb) is a bigger, deliberate change: a new port (`MongoDbPort` with its own `kind`) added to `AnyDatabasePort`, its own read-only guard, its own service, and its own kind-specific MCP tools (e.g. `mongo_find`/`mongo_aggregate`) rather than reusing `run_query`. Don't force it through `SqlDatabasePort`/`run_query`, and design the port *from* the first real adapter rather than speculatively.
- **`QueryResult.truncated`** is set when `rows.length >= limit` — adapters compute this in their `toQueryResult` helper; the LIMIT was already applied to the SQL by the service.
- Adapters use small connection pools (e.g. Postgres `max: 3`) and a 30s statement timeout. Schema/table introspection uses `information_schema` (Postgres/MySQL) or `PRAGMA`/`sqlite_master` (SQLite); the `schema` tool arg is ignored for SQLite.

## Configuration & secrets

- `databases.json` holds real connection strings/credentials and is **gitignored** — never commit it. `databases.example.json` and `mcp.example.json` are the templates.
- Note `mcp.example.json` references the `MCP_DB_CONFIG` env var (file path), which is the primary config path; `MCP_DATABASES` (inline JSON) is the fallback.
- Built artifacts (`build/`), `node_modules/`, and `data/*.db` are gitignored.
