# Security

`mcp-multi-db` exposes SQL query tools to an LLM agent. Treat it as a tool that
will run arbitrary read SQL the model generates against whatever databases you
configure. The defaults are conservative, but the deployment choices are yours.

## How read-only is enforced

Enforcement is two-layered:

1. **SQL-text guard** ([`src/sql/validateReadOnly.ts`](src/sql/validateReadOnly.ts)) —
   only `SELECT` / `WITH` / `EXPLAIN` are allowed, a denylist of mutating
   keywords is rejected, multiple statements are blocked, and a `LIMIT`
   (default 100, max 1000) is injected/clamped.
2. **Database-level read-only** — each adapter prevents writes at the connection
   itself, so a write the text guard can't detect (e.g. a `SELECT` calling a
   side-effecting function) is still refused:
   - **PostgreSQL** — query runs inside a `BEGIN READ ONLY` transaction, always
     rolled back.
   - **MySQL** — query runs inside a `START TRANSACTION READ ONLY`, always
     rolled back.
   - **SQLite** — the connection is opened with `readonly: true`.

A string-based filter alone is not a security boundary. Layer 2 is what makes
the read-only guarantee real.

## Optional governance controls

Since v1.1.0 a database can carry a `policy`, and the config an `audit` block
(see the README's Governance section and [docs/governance.md](docs/governance.md)).
They add controls a database grant cannot express, each enforced in code
below the prompt:

- **Tool scope** — e.g. schema-only access for a database.
- **Table allow/deny-list** — checked against the engine's query plan before
  the query runs (Postgres `EXPLAIN (FORMAT JSON, VERBOSE)`, SQLite bytecode).
  Anything the plan cannot account for — a function scan, a virtual table, an
  attached database — is refused. Not supported on MySQL, whose plan reports
  aliases; use grants there.
- **Column redaction** — keyed on each result column's origin from the
  driver, so aliasing does not bypass it; a computed or view column over a
  table with redacted columns is refused.
- **Budgets** — server-wide `limits` (default 100 / ceiling 1000 rows, hard cap
  10,000) narrowed per database, statement timeout and query rate. The row cap
  is enforced twice: a `LIMIT` in the SQL must be a plain integer and is
  clamped, and adapters stop fetching at the cap whatever the SQL says.
- **Schema tools follow the table policy** — `list_tables` / `describe_table`
  hide and refuse tables outside it, and the system catalogs are refused unless
  explicitly allowed.
- **Engine errors are withheld under redaction** — an error raised while a
  query runs can echo row values (`bad JSON path: '<value>'`), so on a database
  with redacted columns it is replaced with a generic message, for the caller
  and the audit log.
- **Audit log** — one JSONL line per call; result values are never logged.

**Known limits.** Redaction hides values in results but does not stop a query
from filtering, grouping or sorting by a redacted column, so repeated queries
can infer a value (`WHERE email LIKE 'a%'`). Where that matters, remove the
column from what the database user can see, and set a rate limit. A function
that reads other tables inside its body is not
visible in a query plan, so a table policy cannot see what it reads; the
`SELECT`-only user below is what bounds that case. SQLite cannot time out a
running query. Redaction protects result values, not the fact that a row
exists.

## Recommendations for operators

- **Use a dedicated read-only database user** with `GRANT SELECT` only. This is
  the strongest control and protects you even if a bug slips past the layers
  above.
- **Point at a read replica** rather than a primary where possible.
- **Keep `databases.json` out of version control** — it holds connection
  strings with credentials. It is already listed in `.gitignore`. Prefer
  least-privilege credentials and rotate them like any other secret.
- **Scope what you connect.** The agent can read every table the configured
  user can see. Don't wire it to databases holding data the agent shouldn't read.

## Reporting a vulnerability

Please open a GitHub issue, or for sensitive reports email the maintainer
listed in `package.json`. Avoid including real credentials or live connection
strings in any report.
