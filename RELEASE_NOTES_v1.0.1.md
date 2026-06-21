# v1.0.1 — Boot tolerant of missing config

A small but important fix for first-time users and directory smoke tests (Glama, etc.).

## The problem

In v1.0.0, the server fatal-crashed on startup if neither `MCP_DB_CONFIG` nor `MCP_DATABASES` was set. That meant:

- Running `npx mcp-multi-db` to "try it out" failed with an error before any MCP handshake completed.
- Directory listings (Glama and others) probed the server, got an immediate process exit, and marked the install as broken.
- The friendly install story ("`npx -y mcp-multi-db` then point your MCP client at it") was undermined for users who hadn't created `databases.json` yet.

## The fix

- The server now boots cleanly with **no env config**. It logs a clear hint to stderr explaining what to do next.
- `list_databases` returns an empty array (correct: there are no databases registered).
- If you try to run a query against the empty registry, you get a friendly "no databases configured, here's how" error with a link to the README — instead of the previous `Available: ` (empty list).
- 5 new tests cover the config paths: empty, inline `MCP_DATABASES`, bare-array shape, duplicate IDs, and malformed JSON. Test count: 26 → 31, all passing.

## Behaviour after the fix

```bash
$ npx mcp-multi-db
[mcp-multi-db] No database configuration found. Set MCP_DB_CONFIG to the path
of your databases.json (or MCP_DATABASES with inline JSON). Server is starting
with an empty registry — list_databases will return [] until you configure at
least one database.
mcp-multi-db server running on stdio
```

The server stays alive and responds to MCP introspection. Add your config and restart to query.

## Upgrade

```bash
npx mcp-multi-db@1.0.1
```

Or just `npx mcp-multi-db` — npm resolves to latest. No config-file changes required.

## Links

- **npm**: https://www.npmjs.com/package/mcp-multi-db
- **Diff**: https://github.com/mahAnuj/mcp-multi-db/compare/v1.0.0...v1.0.1
