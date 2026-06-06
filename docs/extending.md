# Extending: adding a database

There are two very different kinds of change. Adding another **SQL** engine is
cheap and touches a handful of well-defined spots. Adding a **non-SQL** family
is a deliberate, larger change with its own port, guard, service, and tools.
Read [architecture.md](architecture.md) first — especially the port-family
model.

## Adding a SQL engine (e.g. SQL Server, MariaDB, DuckDB)

A relational engine fits the existing `SqlDatabasePort`, so the service, tools,
and read-only guard need **no changes**. Four steps:

1. **Config shape** — in [`src/core/types.ts`](../src/core/types.ts), add the
   new `type` to `DatabaseType` and a `*Config` variant with whatever connection
   fields it needs.
2. **Validation** — in [`src/config.ts`](../src/config.ts), add a matching
   member to the Zod `discriminatedUnion("type", [...])` so the new config
   validates.
3. **Adapter** — add `src/adapters/<engine>.ts` implementing `SqlDatabasePort`:
   - declare `readonly kind = "sql" as const` and `readonly type = "<engine>" as const`;
   - implement `listSchemas`, `listTables`, `describeTable`, `executeReadQuery`,
     `close`;
   - **enforce read-only at the connection level** (a read-only transaction, or
     a read-only connection mode) — do not rely on the text guard alone;
   - apply a statement timeout and a small connection pool, mirroring the
     existing adapters.
4. **Factory** — add a `case` to `createAdapter` in
   [`src/adapters/registry.ts`](../src/adapters/registry.ts) that constructs your
   adapter.

Then cover it: extend the read-only guard tests if the engine has quirks, and
add an integration test mirroring
[`test/sqliteAdapter.test.ts`](../test/sqliteAdapter.test.ts) (the SQLite test
needs no live server, so it is the easiest template).

> **Checklist:** `DatabaseType` + `*Config` → Zod union → adapter (with
> connection-level read-only) → `createAdapter` case → tests.

## Adding a non-SQL family (e.g. MongoDB)

NoSQL engines do **not** share a model, so do not invent a `NoSqlDatabasePort`
and do not force the engine through `run_query`. Give the family its own
everything, and design the port **from a real adapter** rather than
speculatively. Steps:

1. **New port** — add e.g. `MongoDbPort` in `src/core/` with its own vocabulary
   (`listCollections`, `inferSchema`, `find`, `aggregate`, …) extending
   `DatabasePort` with `kind: "mongodb"`. Add `"mongodb"` to `DatabaseKind` and
   add the port to the `AnyDatabasePort` union in
   [`src/core/databasePort.ts`](../src/core/databasePort.ts).
2. **Config + factory** — add the `mongodb` config variant (types + Zod) and a
   `createAdapter` case as above.
3. **Its own read-only guard** — the SQL guard does not apply. Write a separate
   validator that blocks write stages/commands (e.g. `$out`, `$merge`,
   `$function`, write commands) and pair it with a read-only database user.
4. **Its own service** — add e.g. `MongoDatabaseService` that owns the Mongo
   guard. The three SQL engines keep sharing one `DatabaseService`; do not split
   the service per engine, only per **family**.
5. **Kind-specific tools** — add tools like `mongo_find` / `mongo_aggregate`
   rather than overloading `run_query`. `list_databases` already reports each
   database's `type`, so the agent can tell which tools apply. The existing
   `getSqlAdapter` mismatch error already nudges the agent toward the right tool.

The `kind` discriminant makes the routing safe: narrowing `AnyDatabasePort`
forces every consumer to handle the new family, so the compiler points you at
each place that needs a branch.

## Verifying a change

```bash
npm run build     # strict TypeScript is the type/correctness gate
npm test          # builds, then runs the node:test suite
```

CI runs the same on every push and pull request. To refresh the demo GIF after a
user-visible change, see [`examples/demo.tape`](../examples/demo.tape).
