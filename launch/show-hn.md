# Show HN (optional)

**Best window**: Sunday 8-10am Pacific.

## Submit at

https://news.ycombinator.com/submit

## Title

```
Show HN: mcp-multi-db – one MCP server for Postgres, MySQL, and SQLite
```

## URL field

```
https://github.com/mahAnuj/mcp-multi-db
```

## Text field (leave empty; instead post the comment below 2 min after submitting)

## Seed comment to post yourself

```
Author here. Built this because I had a separate MCP install per database type
and the friction was killing the workflow. One config, one set of tools,
three backends.

Safety was the main design constraint — Claude with database access scares people
for good reason. Read-only by default, two-layer enforcement: SQL-text parser
refuses anything that's not a SELECT, AND every query runs inside a database-level
read-only transaction (SQLite opened read-only). Don't trust read-only roles alone.

Schema introspection lets the agent pick the right DB without trial-and-error.

Install: npx mcp-multi-db

Currently TypeScript-only; happy to take feedback on whether a Python port would
be valuable. ClickHouse and MongoDB adapters are next if there's demand.

Things I'd love feedback on:
1. Are the four tool names (list_databases, list_tables, describe_table, run_query)
   the right surface, or am I missing something obvious?
2. Anyone running multiple DBs in production through MCP today — what hurts?
3. Should the safety policy be more granular (per-DB, per-table allow-lists)?
```
