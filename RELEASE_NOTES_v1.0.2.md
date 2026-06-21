# v1.0.2 — Boot tolerant of missing config file (Glama install-test fix)

A follow-up to v1.0.1's defensive-startup work.

## The problem

Directory smoke tests (Glama, Smithery) inject `MCP_DB_CONFIG=/app/config.json` but don't always populate a file at that path. v1.0.1 only handled the case where neither env var was set — the path-set-but-file-missing case still crashed:

```
Fatal error in main(): Error: ENOENT: no such file or directory, open '/app/config.json'
    at readFileSync (node:fs:441:20)
    at loadRawFromEnv (file:///app/build/config.js:47:26)
```

## The fix

- **`MCP_DB_CONFIG` points at a missing file** → log a clear stderr hint, boot with an empty registry. (Was: fatal crash.)
- **`MCP_DB_CONFIG` points at an empty file** → same.
- **`MCP_DB_CONFIG` is unreadable** (permissions, corrupted JSON read) → same, with the underlying error in the log line.
- **`{ "databases": [] }`** is now a valid config shape. Useful for the new image-baked default and for users iterating on a fresh setup. Both `databases.min(1)` constraints relaxed; everything else (per-DB Zod validation, duplicate-id check) unchanged.
- **Default `/app/config.json`** in the Docker image — a tiny `{"databases": []}` so directory harnesses that don't mount a config still find a valid file at the standard path.
- **Stricter logging**: when `MCP_DB_CONFIG` is set but unreadable, we log one specific message instead of two redundant ones.
- **+3 tests** covering the new paths: missing file, empty file, valid file at MCP_DB_CONFIG. Test count: 31 → 34, all passing.

## Behaviour after the fix

```bash
$ MCP_DB_CONFIG=/missing/path.json npx mcp-multi-db
[mcp-multi-db] MCP_DB_CONFIG="/missing/path.json" was set but no file exists
at that path. Starting with an empty registry.
mcp-multi-db server running on stdio
```

The server stays alive and responds to MCP introspection. Add your config and restart to query.

## Upgrade

```bash
npx mcp-multi-db@1.0.2
```

Or just `npx mcp-multi-db` — npm resolves to latest. No config-file changes required.

## Links

- **npm**: https://www.npmjs.com/package/mcp-multi-db
- **Diff**: https://github.com/mahAnuj/mcp-multi-db/compare/v1.0.1...v1.0.2
