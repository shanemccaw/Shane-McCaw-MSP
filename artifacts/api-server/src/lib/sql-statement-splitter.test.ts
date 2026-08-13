import { describe, it, expect } from "vitest";
import { splitSqlStatements } from "./sql-statement-splitter";

describe("splitSqlStatements", () => {
  it("splits simple statements on top-level semicolons", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2;")).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  it("returns a trailing statement that has no final semicolon", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2")).toEqual(["SELECT 1;", "SELECT 2"]);
  });

  it("returns a single unterminated statement", () => {
    expect(splitSqlStatements("SELECT 42")).toEqual(["SELECT 42"]);
  });

  it("ignores semicolons inside single-quoted string literals", () => {
    expect(splitSqlStatements("SELECT 'a;b;c';")).toEqual(["SELECT 'a;b;c';"]);
  });

  it("handles escaped quotes ('') inside single-quoted literals", () => {
    const sql = "INSERT INTO t (note) VALUES ('it''s a test; really'); SELECT 1;";
    expect(splitSqlStatements(sql)).toEqual([
      "INSERT INTO t (note) VALUES ('it''s a test; really');",
      "SELECT 1;",
    ]);
  });

  it("ignores semicolons inside double-quoted identifiers", () => {
    const sql = 'SELECT "weird;col" FROM "my;table"; SELECT 2;';
    expect(splitSqlStatements(sql)).toEqual(['SELECT "weird;col" FROM "my;table";', "SELECT 2;"]);
  });

  it("ignores semicolons inside anonymous dollar-quoted blocks ($$...$$)", () => {
    const sql = "SELECT $$a; b; c$$; SELECT 2;";
    expect(splitSqlStatements(sql)).toEqual(["SELECT $$a; b; c$$;", "SELECT 2;"]);
  });

  it("ignores semicolons inside tagged dollar-quoted blocks ($tag$...$tag$)", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS trigger AS $body$",
      "BEGIN",
      "  RAISE NOTICE 'hi; there';",
      "  RETURN NEW;",
      "END;",
      "$body$ LANGUAGE plpgsql;",
      "SELECT 1;",
    ].join("\n");
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("$body$");
    expect(out[0].endsWith("LANGUAGE plpgsql;")).toBe(true);
    expect(out[1]).toBe("SELECT 1;");
  });

  it("does not treat a $1 parameter placeholder as a dollar quote", () => {
    const sql = "SELECT * FROM t WHERE id = $1; SELECT 2;";
    expect(splitSqlStatements(sql)).toEqual(["SELECT * FROM t WHERE id = $1;", "SELECT 2;"]);
  });

  it("ignores semicolons inside -- line comments", () => {
    const sql = "SELECT 1; -- this; is; a comment\nSELECT 2;";
    expect(splitSqlStatements(sql)).toEqual(["SELECT 1;", "-- this; is; a comment\nSELECT 2;"]);
  });

  it("ignores semicolons inside /* block comments */", () => {
    const sql = "SELECT 1 /* a; b; c */; SELECT 2;";
    expect(splitSqlStatements(sql)).toEqual(["SELECT 1 /* a; b; c */;", "SELECT 2;"]);
  });

  it("handles nested block comments", () => {
    const sql = "SELECT 1 /* outer /* inner; */ still;in */; SELECT 2;";
    expect(splitSqlStatements(sql)).toEqual(["SELECT 1 /* outer /* inner; */ still;in */;", "SELECT 2;"]);
  });

  it("drops segments that are only whitespace or comments (double semicolons, trailing comment)", () => {
    const sql = "SELECT 1;; \n -- trailing only\n";
    expect(splitSqlStatements(sql)).toEqual(["SELECT 1;"]);
  });

  it("returns an empty array for blank / comment-only input", () => {
    expect(splitSqlStatements("")).toEqual([]);
    expect(splitSqlStatements("   \n\t ")).toEqual([]);
    expect(splitSqlStatements("-- just a comment")).toEqual([]);
    expect(splitSqlStatements("/* only block */")).toEqual([]);
  });

  it("keeps BEGIN and COMMIT as their own statements in a wrapped script", () => {
    const sql = [
      "BEGIN;",
      "ALTER TABLE client_services ADD COLUMN IF NOT EXISTS foo text;",
      "UPDATE client_services SET foo = 'x' WHERE id = 1;",
      "COMMIT;",
    ].join("\n");
    expect(splitSqlStatements(sql)).toEqual([
      "BEGIN;",
      "ALTER TABLE client_services ADD COLUMN IF NOT EXISTS foo text;",
      "UPDATE client_services SET foo = 'x' WHERE id = 1;",
      "COMMIT;",
    ]);
  });

  it("handles a realistic mixed migration (comment + DDL + dollar-quoted trigger + trailing statement)", () => {
    const sql = [
      "-- 2026-07-20-example.sql",
      "ALTER TABLE msps ADD COLUMN IF NOT EXISTS motto text; -- inline; note",
      "CREATE OR REPLACE FUNCTION touch_updated() RETURNS trigger AS $fn$",
      "BEGIN",
      "  NEW.updated_at := now(); -- semicolon; inside body",
      "  RETURN NEW;",
      "END;",
      "$fn$ LANGUAGE plpgsql;",
      "INSERT INTO audit (msg) VALUES ('done; ok')",
    ].join("\n");
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("ALTER TABLE msps ADD COLUMN IF NOT EXISTS motto text;");
    expect(out[1]).toContain("$fn$ LANGUAGE plpgsql;");
    expect(out[1]).toContain("semicolon; inside body");
    expect(out[2]).toBe("INSERT INTO audit (msg) VALUES ('done; ok')");
  });
});
