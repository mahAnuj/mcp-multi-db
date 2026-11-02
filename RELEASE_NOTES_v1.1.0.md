# v1.1.0 — Opt-in governance: policy per database, alias-proof redaction, audit log

Read-only answers *can the agent change data?* This release adds the controls
for the next questions — what may it read, may it see personal data, and what
did it run — without changing anything for existing configs.

## New (all opt-in)

- **`policy.tools`** — expose only some tools per database, e.g. schema-only
  access by leaving out `run_query`. `list_databases` reports each database's
  scope so the agent knows it up front.
- **`policy.tables.allow` / `deny`** — checked against the engine's own query
  plan (Postgres `EXPLAIN (FORMAT JSON, VERBOSE)`, SQLite bytecode) inside the
  read-only transaction, before the query runs. Aliases, CTEs, subqueries and
  views cannot hide a table; anything the plan cannot account for fails closed.
- **`policy.columns.redact`** — values become `"[redacted]"`, keyed on each
  result column's origin as the driver reports it, so `SELECT email AS e` is
  still redacted. Computed or view columns over a table with redacted columns
  are refused.
- **`policy.maxRows`, `timeoutMs`, `rateLimit.queriesPerMinute`** — per-database
  budgets, which can only be stricter than the global defaults.
- **`audit`** — one JSONL line per tool call (tool, database, SQL or its
  SHA-256, outcome, refusing rule, tables read, columns redacted, timing).
  Never result values.

## Compatibility

A config with no `policy` and no `audit` behaves exactly as v1.0.2; the
existing test suite is unchanged and passes. Config validation is strict for
the new blocks, so a misspelt control is an error rather than a silent no-op.

## Engine notes

- **MySQL**: a `tables` policy is rejected at startup, because MySQL's plan
  reports aliases rather than table names. Redaction matches the column name
  in any table.
- **SQLite**: `timeoutMs` cannot be applied (no statement timeout).
- Under a table or column policy, `EXPLAIN` statements, Postgres function scans
  and SQLite virtual tables are refused.

## Tests

33 new tests against SQLite (always run), including the bypasses each control
exists to stop, and a Postgres integration suite that runs when
`MCP_TEST_POSTGRES_URL` is set — CI now provides a Postgres 16 service.

## Links

- **Design**: [docs/governance.md](docs/governance.md)
- **Diff**: https://github.com/mahAnuj/mcp-multi-db/compare/v1.0.2...v1.1.0
