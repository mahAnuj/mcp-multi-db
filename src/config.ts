import { existsSync, readFileSync, statSync } from "node:fs";
import { z } from "zod";
import type { AppConfig, DatabaseConfig } from "./core/types.js";
import { MAX_QUERY_LIMIT } from "./sql/validateReadOnly.js";

const MAX_TIMEOUT_MS = 30_000;

// `.strict()` so a misspelt control ("tabels") is an error rather than a
// policy that silently enforces nothing.
const policySchema = z
  .object({
    tools: z.array(z.enum(["list_tables", "describe_table", "run_query"])).optional(),
    tables: z
      .object({
        allow: z.array(z.string().min(1)).optional(),
        deny: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    columns: z
      .object({
        redact: z
          .array(
            z
              .string()
              .regex(/^[^.]+(\.[^.]+){1,2}$/, "use table.column or schema.table.column"),
          )
          .optional(),
      })
      .strict()
      .optional(),
    maxRows: z.number().int().positive().max(MAX_QUERY_LIMIT).optional(),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
    rateLimit: z.object({ queriesPerMinute: z.number().int().positive() }).strict().optional(),
  })
  .strict();

const baseFields = {
  id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  policy: policySchema.optional(),
};

const auditSchema = z
  .object({
    path: z.string().min(1),
    sql: z.enum(["full", "hash"]).optional(),
    required: z.boolean().optional(),
  })
  .strict();

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

// Allow an explicitly-empty databases array — useful for the default config
// shipped in the Docker image and for users iterating on a fresh setup.
const configFileSchema = z.object({
  databases: z.array(databaseSchema),
  audit: auditSchema.optional(),
});

const databasesArraySchema = z.array(databaseSchema);

function parseRawConfig(raw: unknown): AppConfig {
  const asFile = configFileSchema.safeParse(raw);
  if (asFile.success) {
    return asFile.data;
  }

  const asArray = databasesArraySchema.safeParse(raw);
  if (asArray.success) {
    return { databases: asArray.data };
  }

  // Surface the most useful validation message: the object form's, when the
  // input is an object (that is where policy/audit errors live).
  const issues = (raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? asFile.error
    : asArray.error
  ).issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`Config must be { databases: [...] } or a databases array. ${issues}`);
}

function checkPolicies(databases: DatabaseConfig[]): void {
  for (const db of databases) {
    // MySQL's EXPLAIN reports table ALIASES, not table names, so a table
    // policy could be bypassed by aliasing one table as another. Refuse the
    // config rather than enforce something unreliable.
    if (db.type === "mysql" && db.policy?.tables) {
      throw new Error(
        `Database "${db.id}": policy.tables is not supported for MySQL, whose query plan ` +
          "reports aliases rather than table names. Restrict tables with MySQL grants instead.",
      );
    }
  }
}

// Returns `undefined` when no usable config is present (env vars unset, or
// MCP_DB_CONFIG points at a missing / unreadable / empty file), so the server
// can still boot and respond to MCP introspection (list_tools etc.). Useful
// for directory smoke tests (Glama, Smithery) which inject a path but may not
// populate the file, and for users discovering the server before they have a
// config ready.
function loadRawFromEnv(): unknown | undefined {
  const configPath = process.env.MCP_DB_CONFIG;
  if (configPath) {
    if (!existsSync(configPath)) {
      console.error(
        `[mcp-multi-db] MCP_DB_CONFIG="${configPath}" was set but no file ` +
          `exists at that path. Starting with an empty registry.`,
      );
      return undefined;
    }
    try {
      if (statSync(configPath).size === 0) {
        console.error(
          `[mcp-multi-db] MCP_DB_CONFIG="${configPath}" is an empty file. ` +
            `Starting with an empty registry.`,
        );
        return undefined;
      }
      const contents = readFileSync(configPath, "utf8");
      return JSON.parse(contents) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[mcp-multi-db] Failed to read MCP_DB_CONFIG="${configPath}": ${message}. ` +
          `Starting with an empty registry.`,
      );
      return undefined;
    }
  }

  const inline = process.env.MCP_DATABASES;
  if (inline) {
    return JSON.parse(inline) as unknown;
  }

  return undefined;
}

export function loadDatabaseConfig(): DatabaseConfig[] {
  return loadConfig().databases;
}

export function loadConfig(): AppConfig {
  const raw = loadRawFromEnv();
  if (raw === undefined) {
    // Only log the generic "no config" hint when nothing pointed us at one
    // in the first place. If MCP_DB_CONFIG was set but unreadable / empty,
    // loadRawFromEnv() already logged a more specific message.
    if (!process.env.MCP_DB_CONFIG && !process.env.MCP_DATABASES) {
      console.error(
        "[mcp-multi-db] No database configuration found. " +
          "Set MCP_DB_CONFIG to the path of your databases.json " +
          "(or MCP_DATABASES with inline JSON). Server is starting with " +
          "an empty registry — list_databases will return [] until you " +
          "configure at least one database.",
      );
    }
    return { databases: [] };
  }

  const config = parseRawConfig(raw);
  const databases = config.databases;

  const ids = new Set<string>();
  for (const db of databases) {
    if (ids.has(db.id)) {
      throw new Error(`Duplicate database id: ${db.id}`);
    }
    ids.add(db.id);
  }
  checkPolicies(databases);

  return config;
}
