# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

## Getting set up

**Node 22.18+ or 24 is required to run the tests.** They are TypeScript files
executed directly by `node --test`, which needs native type stripping. The
package's own `engines` field says `>=20` because *consumers* run the compiled
JavaScript in `build/` and Node 20 is fine for that — the higher floor applies
to contributors only. CI runs 22.x and 24.x.

```bash
git clone https://github.com/mahAnuj/mcp-multi-db.git
cd mcp-multi-db
npm install
npm test        # builds first, then runs 34 tests
```

To try the server against your own databases, copy the example config and point
the server at it:

```bash
cp databases.example.json databases.json   # add your connection details
MCP_DB_CONFIG=./databases.json node build/index.js
```

That will look like it hangs. It has not — the server speaks MCP over stdio and
is waiting for JSON-RPC on stdin. `mcp.example.json` shows how to wire it into
an MCP client.

There is no `.env` file: configuration is `MCP_DB_CONFIG` (path to a JSON file)
or `MCP_DATABASES` (inline JSON), validated by Zod in `src/config.ts`.

## Before you open a pull request

```bash
npm run build   # tsc, then chmod 755 build/index.js
npm test        # 34 tests, must stay green
```

**Always rebuild after changing source.** `build/index.js` is what an MCP client
actually executes, and the tests import the compiled `build/*.js` rather than
`src/` — the source uses constructor parameter properties that Node's type
stripping cannot run. `npm test` builds first for exactly this reason.

There is no linter. TypeScript `strict` mode is the correctness gate, so a clean
`npm run build` is the bar.

To run one file while iterating:

```bash
node --test test/validateReadOnly.test.ts
```

## The rule that matters most: this server is read-only

Read-only is enforced in **two independent layers**, and both must hold:

1. **SQL text guard** — `src/sql/validateReadOnly.ts`, called from
   `DatabaseService.runQuery`. Allows only `SELECT`/`WITH`/`EXPLAIN`, blocks a
   keyword denylist, rejects multiple statements, and clamps a `LIMIT`.
2. **Database-level enforcement** — in each adapter's `executeReadQuery`.
   Postgres and MySQL run inside a read-only transaction and always `ROLLBACK`;
   SQLite opens its connection `{ readonly: true }`.

Layer 2 exists because layer 1 cannot see everything — a `SELECT` calling a
side-effecting function, for instance. **A new adapter must enforce read-only at
the connection or transaction level too.** Do not rely on the text guard alone,
and please do not weaken either layer for convenience.

If you find a way around them, that is a security issue — see
[SECURITY.md](SECURITY.md) rather than opening a public issue.

## Adding a SQL engine

Contained, and the service and tool layers need no changes:

1. Add a `*Config` variant and its `type` to the Zod discriminated union in
   `src/config.ts`.
2. Implement `SqlDatabasePort` (with `kind: "sql"`) in `src/adapters/`.
3. Add a `case` to `createAdapter` in `src/adapters/registry.ts`.
4. Enforce read-only at the connection level, and add tests.

[docs/extending.md](docs/extending.md) walks through it.

## Adding a non-SQL engine

Deliberately *not* a small change. Mongo and friends do not belong under
`SqlDatabasePort` or `run_query` — they share no vocabulary with SQL. A new
family means its own port and `kind`, its own read-only guard, its own service,
and its own kind-specific tools. Please open an issue first, and design the port
from one real adapter rather than speculatively.

## What makes a change easy to merge

- **One concern per pull request.**
- **A test that fails before and passes after.** The suite uses Node's built-in
  runner with no extra dependencies; please keep it that way.
- **Keep the docs in sync.** [docs/architecture.md](docs/architecture.md) and
  [AGENTS.md](AGENTS.md) describe the component map and invariants — if you
  change the architecture, change them in the same pull request.

## Reporting bugs

Include the engine and version, the tool you called, the arguments, and the full
error. **Redact connection strings and credentials.** A failing query that
reproduces it is ideal.
