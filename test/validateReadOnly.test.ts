import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampQueryLimit,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  validateReadOnlySql,
} from "../build/sql/validateReadOnly.js";

describe("clampQueryLimit", () => {
  it("defaults when no limit is given", () => {
    assert.equal(clampQueryLimit(undefined), DEFAULT_QUERY_LIMIT);
  });

  it("passes through an in-range limit", () => {
    assert.equal(clampQueryLimit(50), 50);
  });

  it("raises a too-small limit to 1", () => {
    assert.equal(clampQueryLimit(0), 1);
    assert.equal(clampQueryLimit(-10), 1);
  });

  it("caps a too-large limit at MAX_QUERY_LIMIT", () => {
    assert.equal(clampQueryLimit(99_999), MAX_QUERY_LIMIT);
  });

  it("floors fractional limits", () => {
    assert.equal(clampQueryLimit(12.9), 12);
  });
});

describe("validateReadOnlySql — allowed queries", () => {
  it("appends a LIMIT to a bare SELECT", () => {
    assert.equal(validateReadOnlySql("SELECT 1", 100), "SELECT 1 LIMIT 100");
  });

  it("is case-insensitive on the leading keyword", () => {
    assert.equal(
      validateReadOnlySql("select id from users", 25),
      "select id from users LIMIT 25",
    );
  });

  it("allows WITH (CTE) queries", () => {
    assert.equal(
      validateReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x", 10),
      "WITH x AS (SELECT 1) SELECT * FROM x LIMIT 10",
    );
  });

  it("strips a trailing semicolon before appending LIMIT", () => {
    assert.equal(validateReadOnlySql("SELECT 1;", 100), "SELECT 1 LIMIT 100");
  });

  it("returns EXPLAIN untouched (no LIMIT injected)", () => {
    assert.equal(
      validateReadOnlySql("EXPLAIN SELECT * FROM users", 100),
      "EXPLAIN SELECT * FROM users",
    );
  });
});

describe("validateReadOnlySql — LIMIT clamping", () => {
  it("keeps an existing LIMIT below the cap", () => {
    assert.equal(
      validateReadOnlySql("SELECT * FROM t LIMIT 5", 100),
      "SELECT * FROM t LIMIT 5",
    );
  });

  it("clamps an existing LIMIT above the effective max", () => {
    assert.equal(
      validateReadOnlySql("SELECT * FROM t LIMIT 99999", 1000),
      "SELECT * FROM t LIMIT 1000",
    );
  });
});

describe("validateReadOnlySql — rejected queries", () => {
  const cases: Array<[string, string]> = [
    ["empty string", "   "],
    ["INSERT", "INSERT INTO users VALUES (1)"],
    ["UPDATE", "UPDATE users SET name = 'x'"],
    ["DELETE", "DELETE FROM users"],
    ["DROP", "DROP TABLE users"],
    ["multiple statements", "SELECT 1; SELECT 2"],
    ["blocked keyword inside a single SELECT", "SELECT * FROM t WHERE id IN (DELETE FROM x)"],
    ["non-read leading keyword", "TRUNCATE users"],
  ];

  for (const [name, sql] of cases) {
    it(`rejects ${name}`, () => {
      assert.throws(() => validateReadOnlySql(sql, 100));
    });
  }
});
