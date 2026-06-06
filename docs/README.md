# Documentation

| Doc | Read it when you want to… |
|-----|----------------------------|
| [Project README](../README.md) | Install, configure, and connect the server to an MCP client. |
| [Architecture](architecture.md) | Understand the components, how a request flows through them, and the port-family design. |
| [Extending](extending.md) | Add a new database — a SQL engine (cheap) or a non-SQL family (deliberate). |
| [Security](../SECURITY.md) | Understand the two-layer read-only model and how to deploy safely. |
| [CLAUDE.md](../CLAUDE.md) | Guidance for Claude Code / AI agents working in this repo. |

New to the codebase? Read **[Architecture](architecture.md)** first — it has the
component map, a `run_query` lifecycle diagram, and the type hierarchy — then
**[Extending](extending.md)** when you're ready to add an engine.
