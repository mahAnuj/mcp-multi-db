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
- **Configurable row limits** — top-level `limits.defaultRows` / `limits.maxRows`
  (defaults 100 / 1000, hard cap 10,000), narrowed per database with
  `policy.defaultRows` / `policy.maxRows`. `list_databases` reports each
  database's effective `rowLimits`.
- **`policy.timeoutMs`, `rateLimit.queriesPerMinute`** — per-database budgets,
  which can only be stricter than the defaults.
- **`audit`** — one JSONL line per tool call (tool, database, SQL or its
  SHA-256, outcome, refusing rule, tables read, columns redacted, timing).
  Never result values.

## Hardening (independent adversarial review, 70 attempts)

- Engine errors raised mid-query are withheld on databases with redacted
  columns: they could echo row values to the caller and the audit log.
- A `LIMIT` must be a plain integer (hex, exponent, `offset, count` and
  expression forms are refused), and adapters cap fetched rows themselves, so
  no SQL form can exceed the row cap.
- Under a table policy, system catalogs are refused unless allow-listed, and
  `list_tables` / `describe_table` hide and refuse tables outside the policy.
- **Stated limit:** redaction does not stop filtering or sorting by a redacted
  column, so repeated queries can infer a value. See SECURITY.md.

## Compatibility

A config with no `policy`, `audit` or `limits` behaves as v1.0.2, with three
deliberate exceptions that apply to everyone: `list_databases` now includes
each database's `rowLimits`; a `LIMIT` in the SQL must be a plain integer
(previously `LIMIT 0x1F4` was silently mis-clamped); and adapters cap fetched
rows even when the SQL's only `LIMIT` is in a subquery. The existing test
suite passes unchanged. Config validation is strict for
the new blocks, so a misspelt control is an error rather than a silent no-op.

## Engine notes

- **MySQL**: a `tables` policy is rejected at startup, because MySQL's plan
  reports aliases rather than table names. Redaction matches the column name
  in any table.
- **SQLite**: `timeoutMs` cannot be applied (no statement timeout).
- Under a table or column policy, `EXPLAIN` statements, Postgres function scans
  and SQLite virtual tables are refused.

## Tests

56 new tests against SQLite (always run), including the bypasses each control
exists to stop, and a Postgres integration suite that runs when
`MCP_TEST_POSTGRES_URL` is set — CI now provides a Postgres 16 service.

## Links

- **Design**: [docs/governance.md](docs/governance.md)
- **Diff**: https://github.com/mahAnuj/mcp-multi-db/compare/v1.0.2...v1.1.0
