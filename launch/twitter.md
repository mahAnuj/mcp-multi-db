# Twitter / X thread

**1/** Shipped my first MCP server: mcp-multi-db.

One MCP, three databases. PostgreSQL, MySQL, SQLite — same tools, same config, one install.

github.com/mahAnuj/mcp-multi-db
[attach demo gif from docs/demo.gif]

---

**2/** Why it exists: if you have a prod Postgres + analytics MySQL + a SQLite somewhere, you've been juggling 3 MCP installs. Different tool names, different configs.

That sucks. So I built the unified one.

---

**3/** Four tools, identical across backends:
- list_databases
- list_tables
- describe_table
- run_query

Claude / Cursor / any MCP client gets one consistent surface.

---

**4/** Built safety-first:
✅ Read-only by default
✅ Two-layer enforcement (SQL-text guard + DB-level read-only txn)
✅ Schema introspection so the agent picks the right DB

Don't trust "read-only role" alone — the SQL parser should refuse DROP/UPDATE/DELETE too.

---

**5/** Stack: TypeScript, official @modelcontextprotocol SDK, pg / mysql2 / better-sqlite3. Tests on every adapter. ISC license.

About 8 weeks of evening work.

---

**6/** What's next:
- ClickHouse adapter (if there's demand)
- MongoDB (post-NoSQL feedback)
- Want a different DB? Open an issue.

Install: `npx mcp-multi-db`

---

**7/** Built this because I wanted to deeply learn MCP. Strongly recommend the same path for any AI eng curious about the protocol — building an adapter teaches more than reading the spec.

Repo: github.com/mahAnuj/mcp-multi-db
npm: npmjs.com/package/mcp-multi-db
