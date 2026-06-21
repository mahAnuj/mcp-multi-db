import type { AnyDatabasePort } from "../core/databasePort.js";
import type { DatabaseConfig, DatabaseSummary } from "../core/types.js";
import { MysqlAdapter } from "./mysql.js";
import { PostgresAdapter } from "./postgres.js";
import { SqliteAdapter } from "./sqlite.js";

export class DatabaseRegistry {
  private readonly configs: DatabaseConfig[];
  private readonly adapters = new Map<string, AnyDatabasePort>();

  constructor(configs: DatabaseConfig[]) {
    this.configs = configs;
  }

  listDatabases(): DatabaseSummary[] {
    return this.configs.map((config) => ({
      id: config.id,
      type: config.type,
      label: config.label,
      description: config.description,
    }));
  }

  async getAdapter(databaseId: string): Promise<AnyDatabasePort> {
    const existing = this.adapters.get(databaseId);
    if (existing) {
      return existing;
    }

    const config = this.configs.find((entry) => entry.id === databaseId);
    if (!config) {
      if (this.configs.length === 0) {
        throw new Error(
          `No databases are configured. Set MCP_DB_CONFIG to the path of ` +
            `your databases.json (or MCP_DATABASES with inline JSON), then ` +
            `restart the MCP server. See https://github.com/mahAnuj/mcp-multi-db`,
        );
      }
      const available = this.configs.map((entry) => entry.id).join(", ");
      throw new Error(
        `Unknown database_id "${databaseId}". Call list_databases first. Available: ${available}`,
      );
    }

    const adapter = createAdapter(config);
    this.adapters.set(databaseId, adapter);
    return adapter;
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.adapters.values()].map((adapter) => adapter.close()),
    );
    this.adapters.clear();
  }
}

function createAdapter(config: DatabaseConfig): AnyDatabasePort {
  switch (config.type) {
    case "postgres":
      return new PostgresAdapter(config.id, config.connectionString);
    case "mysql":
      return new MysqlAdapter(config.id, config.connectionString);
    case "sqlite":
      return new SqliteAdapter(config.id, config.path);
  }
}
