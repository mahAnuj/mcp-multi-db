import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadDatabaseConfig } from "../build/config.js";

const ENV_VARS = ["MCP_DB_CONFIG", "MCP_DATABASES"] as const;

function clearEnv(): void {
  for (const key of ENV_VARS) {
    delete process.env[key];
  }
}

describe("loadDatabaseConfig", () => {
  afterEach(clearEnv);

  it("returns an empty array when no env vars are set", () => {
    clearEnv();
    const configs = loadDatabaseConfig();
    assert.deepEqual(configs, []);
  });

  it("loads from inline MCP_DATABASES", () => {
    clearEnv();
    process.env.MCP_DATABASES = JSON.stringify({
      databases: [
        { id: "local", type: "sqlite", path: "/tmp/example.db" },
      ],
    });
    const configs = loadDatabaseConfig();
    assert.equal(configs.length, 1);
    assert.equal(configs[0].id, "local");
    assert.equal(configs[0].type, "sqlite");
  });

  it("accepts a bare-array shape from MCP_DATABASES", () => {
    clearEnv();
    process.env.MCP_DATABASES = JSON.stringify([
      { id: "local", type: "sqlite", path: "/tmp/example.db" },
    ]);
    const configs = loadDatabaseConfig();
    assert.equal(configs.length, 1);
  });

  it("rejects duplicate database ids", () => {
    clearEnv();
    process.env.MCP_DATABASES = JSON.stringify({
      databases: [
        { id: "same", type: "sqlite", path: "/tmp/a.db" },
        { id: "same", type: "sqlite", path: "/tmp/b.db" },
      ],
    });
    assert.throws(() => loadDatabaseConfig(), /Duplicate database id: same/);
  });

  it("rejects malformed config JSON shape", () => {
    clearEnv();
    process.env.MCP_DATABASES = JSON.stringify({ wrong: true });
    assert.throws(
      () => loadDatabaseConfig(),
      /Config must be \{ databases: \[\.\.\.\] \} or a databases array\./,
    );
  });
});
