import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DatabaseRegistry } from "./adapters/registry.js";
import { loadDatabaseConfig } from "./config.js";
import { DatabaseService } from "./services/databaseService.js";
import { registerTools } from "./tools/registerTools.js";

async function main(): Promise<void> {
  const configs = loadDatabaseConfig();
  const registry = new DatabaseRegistry(configs);
  const service = new DatabaseService(registry);

  const server = new McpServer({
    name: "mcp-multi-db",
    version: "1.0.0",
  });

  registerTools(server, service);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-multi-db server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
