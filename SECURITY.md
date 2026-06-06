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
