# LinkedIn post

🚀 Shipped my first MCP (Model Context Protocol) server: **mcp-multi-db** — one MCP, three databases.

The pain it solves: if you use Claude Desktop / Cursor / any MCP client with multiple databases, you've been installing a separate MCP per backend. Different tool names. Different config files. Different docs.

**mcp-multi-db** gives you one server, one config, one set of tools (`list_databases`, `list_tables`, `describe_table`, `run_query`) — across PostgreSQL, MySQL, and SQLite.

Built with safety first: read-only by default, two-layer enforcement (SQL-text guard + database-level read-only transactions), schema introspection so Claude can pick the right DB on its own.

Stack: TypeScript, official @modelcontextprotocol/sdk, native drivers (pg, mysql2, better-sqlite3), tests on every adapter.

Install: `npx mcp-multi-db`
GitHub: github.com/mahAnuj/mcp-multi-db
npm: npmjs.com/package/mcp-multi-db

Open to ideas / issues / PRs. ClickHouse and MongoDB adapters are next on the list if there's demand.

#AI #MCP #ModelContextProtocol #Claude #OpenSource #TypeScript
