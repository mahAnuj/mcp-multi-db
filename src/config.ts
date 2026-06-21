import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DatabaseConfig } from "./core/types.js";

const baseFields = {
  id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
};

const databaseSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseFields,
    type: z.literal("postgres"),
    connectionString: z.string().min(1),
  }),
  z.object({
    ...baseFields,
    type: z.literal("mysql"),
    connectionString: z.string().min(1),
  }),
  z.object({
    ...baseFields,
    type: z.literal("sqlite"),
    path: z.string().min(1),
  }),
]);

const configFileSchema = z.object({
  databases: z.array(databaseSchema).min(1),
});

const databasesArraySchema = z.array(databaseSchema).min(1);

function parseRawConfig(raw: unknown): DatabaseConfig[] {
  const asFile = configFileSchema.safeParse(raw);
  if (asFile.success) {
    return asFile.data.databases;
  }

  const asArray = databasesArraySchema.safeParse(raw);
  if (asArray.success) {
    return asArray.data;
  }

  throw new Error("Config must be { databases: [...] } or a databases array.");
}

// Returns `undefined` when neither env var is set, so the server can still
// boot and respond to MCP introspection (list_tools etc.). Useful for
// directory smoke tests and for users discovering the server before they
// have a config ready.
function loadRawFromEnv(): unknown | undefined {
  const configPath = process.env.MCP_DB_CONFIG;
  if (configPath) {
    const contents = readFileSync(configPath, "utf8");
    return JSON.parse(contents) as unknown;
  }

  const inline = process.env.MCP_DATABASES;
  if (inline) {
    return JSON.parse(inline) as unknown;
  }

  return undefined;
}

export function loadDatabaseConfig(): DatabaseConfig[] {
  const raw = loadRawFromEnv();
  if (raw === undefined) {
    console.error(
      "[mcp-multi-db] No database configuration found. " +
        "Set MCP_DB_CONFIG to the path of your databases.json " +
        "(or MCP_DATABASES with inline JSON). Server is starting with " +
        "an empty registry — list_databases will return [] until you " +
        "configure at least one database.",
    );
    return [];
  }

  const databases = parseRawConfig(raw);

  const ids = new Set<string>();
  for (const db of databases) {
    if (ids.has(db.id)) {
      throw new Error(`Duplicate database id: ${db.id}`);
    }
    ids.add(db.id);
  }

  return databases;
}
