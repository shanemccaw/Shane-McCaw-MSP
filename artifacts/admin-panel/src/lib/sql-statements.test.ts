import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "./sql-statements";

const texts = (source: string) => splitSqlStatements(source).map((s) => s.text);

describe("splitSqlStatements", () => {
  it("splits stacked single-line statements", () => {
    const source = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    expect(texts(source)).toEqual(["SELECT 1;", "SELECT 2;", "SELECT 3;"]);
  });

  it("keeps a trailing statement without a semicolon", () => {
    expect(texts("SELECT 1;\nSELECT 2")).toEqual(["SELECT 1;", "SELECT 2"]);
  });

  it("ignores semicolons inside string literals, including escaped quotes", () => {
    const source = "SELECT * FROM users WHERE name = 'O''Brien; test';\nSELECT 2;";
    expect(texts(source)).toEqual(["SELECT * FROM users WHERE name = 'O''Brien; test';", "SELECT 2;"]);
  });

  it("ignores semicolons inside -- line comments", () => {
    const source = "SELECT 1 -- note; not a boundary\n;\nSELECT 2;";
    expect(texts(source)).toEqual(["SELECT 1 -- note; not a boundary\n;", "SELECT 2;"]);
  });

  it("ignores semicolons inside block comments, including nested ones", () => {
    const source = "SELECT 1 /* a; /* nested; */ b; */;\nSELECT 2;";
    expect(texts(source)).toEqual(["SELECT 1 /* a; /* nested; */ b; */;", "SELECT 2;"]);
  });

  it("ignores semicolons inside quoted identifiers", () => {
    const source = 'SELECT "weird;col" FROM t;\nSELECT 2;';
    expect(texts(source)).toEqual(['SELECT "weird;col" FROM t;', "SELECT 2;"]);
  });

  it("ignores semicolons inside dollar-quoted strings", () => {
    const source = "SELECT $$one; two$$;\nSELECT $tag$three; four$tag$;";
    expect(texts(source)).toEqual(["SELECT $$one; two$$;", "SELECT $tag$three; four$tag$;"]);
  });

  it("does not treat positional params as dollar-quote openers", () => {
    expect(texts("SELECT $1;\nSELECT $2;")).toEqual(["SELECT $1;", "SELECT $2;"]);
  });

  it("honors backslash-escaped quotes only in E'' strings", () => {
    const escapeString = "SELECT E'a\\'; b';\nSELECT 2;";
    expect(texts(escapeString)).toEqual(["SELECT E'a\\'; b';", "SELECT 2;"]);
    // In a standard string a backslash is literal, so the quote ends it.
    const standardString = "SELECT 'a\\';\nSELECT 2;";
    expect(texts(standardString)).toEqual(["SELECT 'a\\';", "SELECT 2;"]);
  });

  it("skips empty statements and whitespace/comment-only segments", () => {
    expect(texts(";;  ;\n-- just a comment\n/* block */")).toEqual([]);
    expect(texts("SELECT 1;;\nSELECT 2;")).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  it("excludes leading comments so the range starts at executable code", () => {
    const source = "-- header comment\nSELECT 1;";
    const [stmt] = splitSqlStatements(source);
    expect(stmt.text).toBe("SELECT 1;");
    expect(source.slice(stmt.from, stmt.to)).toBe("SELECT 1;");
  });

  it("reports offsets that match the source text", () => {
    const source = "SELECT 'a;b';\n\n  UPDATE t SET x = 1 WHERE id = 2;";
    const stmts = splitSqlStatements(source);
    expect(stmts).toHaveLength(2);
    for (const s of stmts) {
      expect(source.slice(s.from, s.to)).toBe(s.text);
    }
    expect(stmts[1].text).toBe("UPDATE t SET x = 1 WHERE id = 2;");
  });

  it("handles multi-line statements as a single block", () => {
    const source = "SELECT *\nFROM users\nWHERE id = 1;\nSELECT 2;";
    expect(texts(source)).toEqual(["SELECT *\nFROM users\nWHERE id = 1;", "SELECT 2;"]);
  });

  it("tolerates an unterminated string without crashing", () => {
    expect(texts("SELECT 'oops")).toEqual(["SELECT 'oops"]);
    expect(texts("SELECT $$oops")).toEqual(["SELECT $$oops"]);
  });
});
