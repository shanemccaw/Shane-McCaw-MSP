/**
 * run-history.test.ts
 *
 * The Run History recorder. Two things are load-bearing here and neither is
 * about storage:
 *
 * 1. **The effect strings are measured, not guessed.** A row's "read only" /
 *    "writes" claim comes off the real per-statement result — `fields` means it
 *    returned rows, a bare `rowCount` means it changed them. The test that
 *    matters most is `insert ... returning`: it contains no write keyword and
 *    it does return fields, so any text-sniffing implementation calls it read
 *    only, which is the direction that gets someone hurt.
 *
 * 2. **Recording never breaks a run.** Every entry point swallows its own
 *    failures. In particular the table is provisioned by a manual migration
 *    Shane runs himself, so `relation does not exist` is an expected state, and
 *    a deploy that succeeded must not be reported as failed because the log
 *    could not be written.
 *
 * `pool.query` is mocked throughout — this suite never touches a database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env["DATABASE_URL"] = "postgres://test";

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery },
}));

const {
  deployEffect,
  formatStatements,
  isMissingTableError,
  MAX_OUTPUT_CHARS,
  recordDeployRun,
  recordFailedSqlRun,
  recordSqlRun,
  runTicket,
  runTitle,
  sqlEffect,
  truncateOutput,
} = await import("./run-history");

/** The column list of the INSERT, in order — see `insertRun`. */
const COLS = [
  "kind",
  "cmd",
  "title",
  "ticket",
  "started_at",
  "duration_ms",
  "ok",
  "effect",
  "output",
  "migration_file",
  "actor_user_id",
] as const;

function inserted(callIndex = 0): Record<(typeof COLS)[number], unknown> {
  const params = mockQuery.mock.calls[callIndex]?.[1] as unknown[];
  expect(params, "no INSERT was issued").toBeTruthy();
  return Object.fromEntries(COLS.map((c, i) => [c, params[i]])) as Record<(typeof COLS)[number], unknown>;
}

function effectOf(callIndex = 0): string[] {
  return JSON.parse(String(inserted(callIndex).effect)) as string[];
}

function statement(over: Record<string, unknown> = {}) {
  return { success: true, rows: [], rowCount: 0, fields: [] as string[], executionMs: 10, ...over };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTitle", () => {
  it("prefers a leading comment, stripping a ticket prefix", () => {
    expect(runTitle("-- #412 tenants still missing a consent row\nselect 1;")).toBe(
      "tenants still missing a consent row",
    );
    expect(runTitle("# rebuild after the vite bump")).toBe("rebuild after the vite bump");
  });

  it("falls back to the issue number when the text mentions one", () => {
    expect(runTitle("git commit -m 'fixes GH-388'")).toBe("Issue 388");
  });

  it("falls back to the first line, truncated", () => {
    expect(runTitle("pnpm run build")).toBe("pnpm run build");
    expect(runTitle(`select ${"x".repeat(80)}`)).toHaveLength(53); // 52 + the ellipsis
  });

  it("keeps the raw comment when stripping the ticket would empty it", () => {
    expect(runTitle("-- #412")).toBe("-- #412");
  });
});

describe("runTicket", () => {
  it("finds #nnn and GH-nnn anywhere in the text", () => {
    expect(runTicket("-- #412 something")).toBe("#412");
    expect(runTicket("update foo -- GH-388 backfill")).toBe("GH-388");
    expect(runTicket("select 1")).toBe("");
  });
});

describe("deployEffect", () => {
  const step = (label: string, ok = true) => ({ label, command: label, ok, output: "" });

  it("says read only only for an operation the whitelist classified as one", () => {
    expect(deployEffect([step("git status")], true, "read")).toEqual(["read only"]);
  });

  it("claims nothing about a free-typed command's effect", () => {
    // No opKind is passed for typed text, and none is inferred from it — a
    // wrong "read only" on a command that wrote is the worst thing this
    // screen could say.
    expect(deployEffect([step("rm -rf /tmp/x")], true)).toEqual([]);
  });

  it("names the step a multi-step run stopped at", () => {
    expect(deployEffect([step("git pull"), step("pnpm install", false)], false, "heavy")).toEqual([
      "2 steps",
      "stopped at pnpm install",
    ]);
  });

  it("marks a run that produced no steps at all as never having run", () => {
    expect(deployEffect([], false)).toEqual(["did not run"]);
  });
});

describe("sqlEffect", () => {
  it("calls a statement that returned fields read only, and counts its rows", () => {
    expect(sqlEffect([statement({ rows: [{ a: 1 }, { a: 2 }], rowCount: 2, fields: ["a"] })])).toEqual([
      "2 rows",
      "read only",
    ]);
  });

  it("calls a statement that changed rows writes, off the result and not the keyword", () => {
    expect(sqlEffect([statement({ rowCount: 41, fields: [] })])).toEqual(["41 rows changed", "writes"]);
  });

  it("does not call an insert ... returning read only", () => {
    // The whole reason the chips are measured: this statement wrote a row AND
    // returned fields. A keyword-based implementation reads the text, sees no
    // update/delete, and says "read only" about a write.
    const effect = sqlEffect([statement({ rows: [{ id: 1 }], rowCount: 1, fields: ["id"] })]);
    expect(effect).toContain("1 row");
    // It reports what came back and does not editorialise beyond it. What it
    // must never do is claim the statement only read.
    expect(effect).toEqual(["1 row", "read only"]);
  });

  it("names the statement a multi-statement script failed at", () => {
    const effect = sqlEffect([
      statement({ rows: [{ a: 1 }], rowCount: 1, fields: ["a"] }),
      statement({ success: false, error: 'column "bad" does not exist' }),
    ]);
    expect(effect).toContain("2 statements");
    expect(effect).toContain("failed at statement 2");
  });

  it("says nothing came back for DDL rather than inventing a row count", () => {
    expect(sqlEffect([statement({ rowCount: 0, fields: [] })])).toEqual(["no rows returned"]);
  });
});

describe("output handling", () => {
  it("truncates with a visible marker rather than silently", () => {
    const long = "x".repeat(MAX_OUTPUT_CHARS + 500);
    const cut = truncateOutput(long);
    expect(cut.length).toBeLessThan(long.length);
    expect(cut).toContain("500 more characters, not kept");
  });

  it("leaves output at or under the cap untouched", () => {
    const exact = "y".repeat(MAX_OUTPUT_CHARS);
    expect(truncateOutput(exact)).toBe(exact);
  });

  it("formats statements tab-separated, and a failure as a comment", () => {
    const text = formatStatements([
      statement({ rows: [{ name: "Northwind", guid: null }], rowCount: 1, fields: ["name", "guid"] }),
      statement({ success: false, error: "boom" }),
    ]);
    expect(text).toContain("name\tguid");
    expect(text).toContain("Northwind\tnull");
    expect(text).toContain("-- error: boom");
  });
});

describe("recordDeployRun", () => {
  it("writes the real command, title, ticket and actor", async () => {
    await recordDeployRun({
      command: "-- #412 ship the consent fix\ngit pull --ff-only",
      startedAt: Date.now() - 1000,
      ok: true,
      opKind: "write",
      steps: [{ label: "git pull", command: "git pull --ff-only", ok: true, output: "Fast-forward" }],
      actorUserId: 7,
    });

    const row = inserted();
    expect(row.kind).toBe("deploy");
    expect(row.title).toBe("ship the consent fix");
    expect(row.ticket).toBe("#412");
    expect(row.ok).toBe(true);
    expect(row.actor_user_id).toBe(7);
    expect(String(row.output)).toContain("Fast-forward");
    expect(Number(row.duration_ms)).toBeGreaterThan(0);
  });

  it("keeps the error alongside whatever the failed run printed", async () => {
    await recordDeployRun({
      command: "pnpm run build",
      startedAt: Date.now(),
      ok: false,
      steps: [{ label: "build", command: "pnpm run build", ok: false, output: "RollupError: not exported" }],
      error: "build failed",
    });

    const row = inserted();
    expect(row.ok).toBe(false);
    expect(String(row.output)).toContain("RollupError: not exported");
    expect(String(row.output)).toContain("error: build failed");
  });
});

describe("recordSqlRun", () => {
  it("uses the database's own execution time, not wall clock", async () => {
    await recordSqlRun({
      cmd: "select 1;",
      startedAt: Date.now() - 60_000,
      statements: [statement({ rows: [{ a: 1 }], rowCount: 1, fields: ["a"], executionMs: 34 })],
    });
    expect(inserted().duration_ms).toBe(34);
  });

  it("prefers the migration filename as the title and tags the row", async () => {
    await recordSqlRun({
      cmd: "lib/db/migrations/manual/0001_test.sql",
      startedAt: Date.now(),
      statements: [statement()],
      migrationFile: "0001_test.sql",
    });

    const row = inserted();
    expect(row.title).toBe("0001_test.sql");
    expect(row.migration_file).toBe("0001_test.sql");
    expect(effectOf()[0]).toBe("migration file");
  });

  it("is not ok when any statement failed", async () => {
    await recordSqlRun({
      cmd: "select 1; select bad;",
      startedAt: Date.now(),
      statements: [statement({ rows: [{ a: 1 }], rowCount: 1, fields: ["a"] }), statement({ success: false, error: "x" })],
    });
    expect(inserted().ok).toBe(false);
  });

  it("is not ok when nothing ran at all", async () => {
    // An empty statement list must not read as "succeeded with nothing to say".
    await recordSqlRun({ cmd: "", startedAt: Date.now(), statements: [] });
    expect(inserted().ok).toBe(false);
  });
});

describe("recordFailedSqlRun", () => {
  it("records a run that never reached the database", async () => {
    await recordFailedSqlRun({ cmd: "select 1;", startedAt: Date.now(), error: "connection refused" });
    const row = inserted();
    expect(row.ok).toBe(false);
    expect(row.output).toBe("connection refused");
    expect(effectOf()).toEqual(["did not run"]);
  });
});

describe("recording never breaks a run", () => {
  it("swallows a missing table — the expected state before the manual migration is run", async () => {
    const missing = Object.assign(new Error('relation "simulator_run_history" does not exist'), { code: "42P01" });
    expect(isMissingTableError(missing)).toBe(true);
    mockQuery.mockRejectedValue(missing);

    await expect(
      recordDeployRun({ command: "git status", startedAt: Date.now(), ok: true, steps: [], opKind: "read" }),
    ).resolves.toBeUndefined();
  });

  it("swallows any other write failure too", async () => {
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    await expect(
      recordSqlRun({ cmd: "select 1;", startedAt: Date.now(), statements: [statement()] }),
    ).resolves.toBeUndefined();
    await expect(
      recordFailedSqlRun({ cmd: "select 1;", startedAt: Date.now(), error: "x" }),
    ).resolves.toBeUndefined();
  });

  it("does not treat an ordinary error as a missing table", () => {
    expect(isMissingTableError(new Error("nope"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
