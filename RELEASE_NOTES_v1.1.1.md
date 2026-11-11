# v1.1.1 — Dependency security update

No behaviour change. Updates dependencies that had known vulnerabilities, so
`npm audit` reports none, for runtime or development dependencies.

## Updated

- **`@modelcontextprotocol/sdk` 1.29.0 → 1.32.2.** Fixes four high-severity
  advisories in the SDK (GHSA-22jm-h49p-29qw, GHSA-46jr-4wx8-v453,
  GHSA-6qxp-vccf-f47h, GHSA-f897-62hf-6gxq) and pulls in fixed versions of its
  HTTP-server dependencies (hono, @hono/node-server, body-parser, proxy-addr,
  qs, fast-uri, ip-address).
- **`zod` 3.25.76 → 4.6.7.** Fixes GHSA-mrhx-c7xc-m3w5. The SDK supports zod 4
  from 1.32; the schemas this server uses are unchanged.
- **`mysql2`** and the remaining transitive packages: patch updates via
  `npm audit fix`.

## Exposure, honestly stated

mcp-multi-db runs over stdio, so most of the fixed advisories (HTTP request
size limits, OAuth, the HTTP transports) were in code paths this server does
not use. They were still shipped in the installed dependency tree and flagged
by scanners, which is reason enough to update.

## Verified

- `npm audit`: 0 vulnerabilities (runtime and dev).
- 94/94 tests pass, including the PostgreSQL governance integration tests
  (`MCP_TEST_POSTGRES_URL`) and the adversarial bypass regressions.
- A real MCP session over stdio: all four tools list with their full input
  schemas (types, descriptions, required fields), a query on a redacted
  column returns `[redacted]`, and a `DELETE` is refused with the table
  unchanged.

**Diff**: https://github.com/mahAnuj/mcp-multi-db/compare/v1.1.0...v1.1.1
