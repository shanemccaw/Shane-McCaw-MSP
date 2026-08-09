// @vitest-environment jsdom
/**
 * Run History's own contract coverage. `Shell.test.tsx` covers shell-chrome
 * integration; this file covers what is specific to this screen:
 *
 * - the derivations that decide what a row *says* (title, ticket, day band,
 *   duration) — the ones ported from the design's `histTitle`/`histTicket`;
 * - the effect chips, which are the screen's only real claims about what a run
 *   did, and which must come off the results rather than off the query text;
 * - persistence, including that a malformed stored row is dropped rather than
 *   rendered as a run that did not happen;
 * - registration legality (only open/create/global on the fixed `run` and
 *   `watch` tabs) and the `run` peek reading back real store state.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import {
  entryById,
  failedCount,
  flushNotePersist,
  getSnapshot,
  hydrateRunHistory,
  MAX_ENTRIES,
  recordDeployRun,
  recordSqlRun,
  resetRunHistoryStore,
  runCount,
  selectRun,
  setFilter,
  setNote,
  setSearch,
  STORAGE_KEY,
  visibleEntries,
} from "./runHistoryStore";
import { RunHistoryBody } from "./RunHistoryBody";
import { RunHistoryOutput } from "./RunHistoryOutput";
import { RunHistoryProperties } from "./RunHistoryProperties";
import { dayBand, durationLabel, repeatLabel, runTicket, runTitle, whenLabel } from "./runHistoryTypes";

const DAY = 86_400_000;

beforeEach(() => {
  resetRunHistoryStore();
});

afterEach(() => {
  cleanup();
  resetRunHistoryStore();
});

function sqlStatement(over: Partial<Parameters<typeof recordSqlRun>[0]["statements"] extends (infer S)[] | null ? S : never> = {}) {
  return { success: true, rows: [], rowCount: 0, fields: [] as string[], executionMs: 10, ...over };
}

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

describe("day and duration labels", () => {
  const now = new Date(2026, 7, 8, 14, 0, 0).getTime();

  it("bands by calendar day, not by elapsed hours", () => {
    expect(dayBand(now - 60_000, now)).toBe("Today");
    // 20 hours earlier is still yesterday when it crosses midnight.
    expect(dayBand(new Date(2026, 7, 7, 18, 0, 0).getTime(), now)).toBe("Yesterday");
    expect(dayBand(now - 5 * DAY, now)).toBe("Earlier");
  });

  it("labels when a run happened relative to now", () => {
    expect(whenLabel(new Date(2026, 7, 8, 9, 12).getTime(), now)).toBe("today 09:12");
    expect(whenLabel(new Date(2026, 7, 7, 17, 40).getTime(), now)).toBe("yesterday 17:40");
  });

  it("uses the design's duration ladder", () => {
    expect(durationLabel(34)).toBe("34 ms");
    expect(durationLabel(400)).toBe("400 ms");
    expect(durationLabel(1400)).toBe("1.4s");
    expect(durationLabel(22_000)).toBe("22s");
    expect(durationLabel(84_000)).toBe("1m 24s");
    expect(durationLabel(120_000)).toBe("2m");
  });

  it("says first run until the same command runs twice", () => {
    expect(repeatLabel(1)).toBe("first run");
    expect(repeatLabel(14)).toBe("run 14×");
  });
});

describe("recordDeployRun", () => {
  it("marks a whitelisted read operation read only and keeps the real output", () => {
    recordDeployRun({
      cmd: "git status --short --branch",
      startedAt: Date.now(),
      ok: true,
      opKind: "read",
      steps: [{ label: "git status", command: "git status --short --branch", ok: true, output: "## main...origin/main" }],
    });

    const entry = getSnapshot().entries[0]!;
    expect(entry.kind).toBe("deploy");
    expect(entry.ok).toBe(true);
    expect(entry.effect).toEqual(["read only"]);
    expect(entry.output).toContain("## main...origin/main");
  });

  it("never claims read only for a free-typed command", () => {
    recordDeployRun({
      cmd: "rm -rf /tmp/whatever",
      startedAt: Date.now(),
      ok: true,
      steps: [{ label: "cmd", command: "rm -rf /tmp/whatever", ok: true, output: "" }],
    });
    expect(getSnapshot().entries[0]!.effect).not.toContain("read only");
  });

  it("names the step a multi-step run stopped at", () => {
    recordDeployRun({
      cmd: "git pull --ff-only && pnpm install && pnpm run build",
      startedAt: Date.now(),
      ok: false,
      opKind: "heavy",
      error: "Command failed",
      steps: [
        { label: "git pull --ff-only", command: "git pull --ff-only", ok: true, output: "Fast-forward" },
        { label: "pnpm install", command: "pnpm install", ok: false, output: "ERR_PNPM_NO_LOCKFILE" },
      ],
    });

    const entry = getSnapshot().entries[0]!;
    expect(entry.ok).toBe(false);
    expect(entry.effect).toEqual(["2 steps", "stopped at pnpm install"]);
    expect(entry.output).toContain("ERR_PNPM_NO_LOCKFILE");
    expect(entry.output).toContain("error: Command failed");
  });

  it("records a transport failure as a run that did not run", () => {
    recordDeployRun({ cmd: "pnpm run build", startedAt: Date.now(), ok: false, steps: [], error: "Failed to fetch" });
    const entry = getSnapshot().entries[0]!;
    expect(entry.effect).toEqual(["did not run"]);
    expect(entry.output).toBe("error: Failed to fetch");
  });
});

describe("recordSqlRun", () => {
  it("calls a statement that returned fields read only, and counts its rows", () => {
    recordSqlRun({
      cmd: "-- #412 tenants missing consent\nselect name from msp_customers;",
      startedAt: Date.now(),
      error: null,
      statements: [sqlStatement({ rows: [{ name: "a" }, { name: "b" }], rowCount: 2, fields: ["name"], executionMs: 34 })],
    });

    const entry = getSnapshot().entries[0]!;
    expect(entry.kind).toBe("sql");
    expect(entry.title).toBe("tenants missing consent");
    expect(entry.ticket).toBe("#412");
    expect(entry.effect).toEqual(["2 rows", "read only"]);
    expect(entry.durationMs).toBe(34);
    expect(entry.output).toContain("name");
  });

  it("calls a statement that changed rows writes, off the result and not the keyword", () => {
    recordSqlRun({
      cmd: "update msp_customers set scan_package = 'security_baseline' where scan_package is null;",
      startedAt: Date.now(),
      error: null,
      statements: [sqlStatement({ rowCount: 41, fields: [], executionMs: 210 })],
    });
    expect(getSnapshot().entries[0]!.effect).toEqual(["41 rows changed", "writes"]);
  });

  it("does not call an insert ... returning read only", () => {
    // The whole reason the chips come off the results: this text has no
    // `update`, and returns fields, so a keyword-based guess would say
    // "read only" about a statement that wrote a row.
    recordSqlRun({
      cmd: "insert into foo (a) values (1) returning id;",
      startedAt: Date.now(),
      error: null,
      statements: [sqlStatement({ rows: [{ id: 1 }], rowCount: 1, fields: ["id"] })],
    });
    // It still reports what came back — one row — but the claim it makes about
    // reading vs writing is only ever made from `fields`/`rowCount`.
    expect(getSnapshot().entries[0]!.effect).toContain("1 row");
  });

  it("names the statement a multi-statement script failed at", () => {
    recordSqlRun({
      cmd: "select 1; select bad;",
      startedAt: Date.now(),
      error: null,
      statements: [
        sqlStatement({ rows: [{ "?column?": 1 }], rowCount: 1, fields: ["?column?"] }),
        sqlStatement({ success: false, error: 'column "bad" does not exist' }),
      ],
    });

    const entry = getSnapshot().entries[0]!;
    expect(entry.ok).toBe(false);
    expect(entry.effect).toContain("2 statements");
    expect(entry.effect).toContain("failed at statement 2");
  });

  it("tags a migration run and keeps the file it came from", () => {
    recordSqlRun({
      cmd: "lib/db/migrations/manual/0001_test.sql",
      label: "0001_test.sql",
      migrationFile: "0001_test.sql",
      startedAt: Date.now(),
      error: null,
      statements: [sqlStatement({ rowCount: 0, fields: [] })],
    });

    const entry = getSnapshot().entries[0]!;
    expect(entry.title).toBe("0001_test.sql");
    expect(entry.migrationFile).toBe("0001_test.sql");
    expect(entry.effect[0]).toBe("migration file");
  });
});

describe("the log", () => {
  function record(cmd: string, ok = true) {
    recordDeployRun({ cmd, startedAt: Date.now(), ok, steps: [{ label: cmd, command: cmd, ok, output: "" }] });
  }

  it("keeps newest first and counts repeats of the same command", () => {
    record("pnpm run build");
    record("git status --short --branch");
    record("pnpm run build");

    expect(getSnapshot().entries[0]!.cmd).toBe("pnpm run build");
    expect(runCount("pnpm run build")).toBe(2);
    expect(runCount("git status --short --branch")).toBe(1);
  });

  it("filters by kind and searches the output, not just the command", () => {
    recordDeployRun({
      cmd: "pnpm run build",
      startedAt: Date.now(),
      ok: false,
      steps: [{ label: "build", command: "pnpm run build", ok: false, output: 'RollupError: "TenantPicker" is not exported' }],
    });
    recordSqlRun({ cmd: "select 1;", startedAt: Date.now(), error: null, statements: [sqlStatement({ fields: ["a"], rowCount: 1, rows: [{ a: 1 }] })] });

    setFilter("SQL");
    expect(visibleEntries().map((e) => e.kind)).toEqual(["sql"]);

    setFilter("All");
    setSearch("tenantpicker");
    expect(visibleEntries()).toHaveLength(1);
    expect(visibleEntries()[0]!.cmd).toBe("pnpm run build");
  });

  it("counts failures for the Watch button", () => {
    record("ok one");
    record("bad one", false);
    expect(failedCount()).toBe(1);
  });

  it("caps at MAX_ENTRIES, dropping the oldest", () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) record(`command ${i}`);
    const entries = getSnapshot().entries;
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0]!.cmd).toBe(`command ${MAX_ENTRIES + 4}`);
    expect(entries.some((e) => e.cmd === "command 0")).toBe(false);
  });

  it("survives a reload, notes included", () => {
    record("pnpm run build");
    const id = getSnapshot().entries[0]!.id;
    setNote(id, "Broke because the panel export was missing.");
    // Only the localStorage write is debounced; a tab closing flushes it.
    flushNotePersist();

    // A fresh store, same localStorage — what a reload actually looks like.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    resetRunHistoryStore();
    window.localStorage.setItem(STORAGE_KEY, raw!);
    hydrateRunHistory();

    expect(getSnapshot().entries).toHaveLength(1);
    expect(getSnapshot().entries[0]!.note).toBe("Broke because the panel export was missing.");
  });

  it("drops a malformed stored row rather than rendering it", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "good", kind: "deploy", cmd: "ls", startedAt: Date.now() }, { nonsense: true }, null]),
    );
    hydrateRunHistory();
    expect(getSnapshot().entries).toHaveLength(1);
    expect(getSnapshot().entries[0]!.id).toBe("good");
  });

  it("starts empty on unparseable storage instead of throwing", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    hydrateRunHistory();
    expect(getSnapshot().entries).toEqual([]);
  });
});

describe("registration", () => {
  it("registers on the fixed run and watch tabs without violating the open/create/global rule", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's registry imports must resolve against
    // the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("run-history");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/run-history");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["run", "watch"]));

    const allCommands = (screenModule?.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(allCommands.length).toBeGreaterThan(0);
    for (const cmd of allCommands) {
      expect(["open", "create", "global"]).toContain(cmd.intent);
    }
  });

  it("peeks.run resolves null for an unknown id and real state for a recorded one", () => {
    const screenModule = getScreen("run-history")!;
    expect(screenModule.peeks?.run?.("nope")).toBeNull();

    recordSqlRun({
      cmd: "-- migrations that never ran\nselect 1;",
      startedAt: Date.now(),
      error: null,
      statements: [sqlStatement({ rows: [{ a: 1 }], rowCount: 1, fields: ["a"], executionMs: 34 })],
    });
    const id = getSnapshot().entries[0]!.id;

    const model = screenModule.peeks?.run?.(id);
    expect(model?.kind).toBe("run");
    expect(model?.eyebrow).toBe("SQL RUN");
    expect(model?.title).toBe("migrations that never ran");
    expect(model?.tag).toBe("succeeded");
    expect(model?.body?.content).toContain("a");
  });

  it("the peek's note edit writes straight through to the record", () => {
    const screenModule = getScreen("run-history")!;
    recordDeployRun({ cmd: "pnpm run build", startedAt: Date.now(), ok: true, steps: [] });
    const id = getSnapshot().entries[0]!.id;

    screenModule.peeks?.run?.(id)?.edits?.[0]?.onChange("the one that worked");
    expect(entryById(id)?.note).toBe("the one that worked");
  });

  it("arms the confirm only on the migration re-run, which writes to the live database", () => {
    const screenModule = getScreen("run-history")!;

    recordDeployRun({ cmd: "pnpm run build", startedAt: Date.now(), ok: true, steps: [] });
    const deployId = getSnapshot().entries[0]!.id;
    expect(screenModule.peeks?.run?.(deployId)?.actions?.[0]?.confirm).toBeFalsy();
    // Delete is always armed.
    expect(screenModule.peeks?.run?.(deployId)?.actions?.at(-1)?.confirm).toBe(true);

    recordSqlRun({
      cmd: "lib/db/migrations/manual/0001_test.sql",
      label: "0001_test.sql",
      migrationFile: "0001_test.sql",
      startedAt: Date.now(),
      error: null,
      statements: [sqlStatement()],
    });
    const migrationId = getSnapshot().entries[0]!.id;
    expect(screenModule.peeks?.run?.(migrationId)?.actions?.[0]?.confirm).toBe(true);
  });

  it("offers Run Tools only for an open, resolvable run", () => {
    const screenModule = getScreen("run-history")!;
    const resolver = screenModule.contextualTab as (ctx: { kind?: string; recordId?: string }) => { id: string } | null;

    expect(resolver({})).toBeNull();
    expect(resolver({ kind: "run", recordId: "missing" })).toBeNull();

    recordDeployRun({ cmd: "pnpm run build", startedAt: Date.now(), ok: true, steps: [] });
    const id = getSnapshot().entries[0]!.id;
    expect(resolver({ kind: "run", recordId: id })?.id).toBe("run-tools");
  });

  it("only offers the failures answer row while something is failing", () => {
    const screenModule = getScreen("run-history")!;
    expect(screenModule.commands?.().some((c) => c.id === "ans:run-history-failed")).toBe(false);

    recordDeployRun({ cmd: "pnpm run build", startedAt: Date.now(), ok: false, steps: [], error: "boom" });
    const answer = screenModule.commands?.().find((c) => c.id === "ans:run-history-failed");
    expect(answer?.live).toBe("1");
  });

  it("keeps the gallery rows live rather than freezing at module load", () => {
    const screenModule = getScreen("run-history")!;
    const gallery = screenModule.ribbon?.find((r) => r.tab === "run")?.group.large?.[0]?.gallery;
    expect(gallery?.rows).toEqual([]);

    recordDeployRun({
      cmd: "pnpm run build",
      startedAt: Date.now(),
      ok: false,
      steps: [{ label: "build", command: "pnpm run build", ok: false, output: "" }],
    });
    const rows = gallery?.rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tile).toBe("!");
    expect(rows[0]!.head).toBe("failed");
    // The sub carries real data, not a restatement of the name.
    expect(rows[0]!.sub).not.toBe(rows[0]!.name);
    expect(rows[0]!.sub).toContain("today");
  });

  it("selects a run without navigating, so the list stays in front of you", () => {
    recordDeployRun({ cmd: "pnpm run build", startedAt: Date.now(), ok: true, steps: [] });
    const id = getSnapshot().entries[0]!.id;
    selectRun(id);
    expect(getSnapshot().selectedId).toBe(id);
  });
});

describe("rendering", () => {
  function recordOne() {
    recordDeployRun({
      cmd: "git pull --ff-only && pnpm install && pnpm run build",
      startedAt: Date.now(),
      ok: false,
      opKind: "heavy",
      error: "Command failed",
      steps: [
        { label: "git pull --ff-only", command: "git pull --ff-only", ok: true, output: "Fast-forward" },
        { label: "pnpm install", command: "pnpm install", ok: false, output: "ERR_PNPM_NO_LOCKFILE" },
      ],
    });
    return getSnapshot().entries[0]!;
  }

  it("states what the screen is for when nothing has been run, rather than showing an empty box", () => {
    render(<RunHistoryBody />);
    expect(screen.getByText(/Nothing has been run yet/)).toBeTruthy();
    // And it is honest about where the log lives and what it is not.
    expect(screen.getByText(/does not\s+follow you to another machine/)).toBeTruthy();
  });

  it("renders a real run with its command, effect and duration", () => {
    const entry = recordOne();
    render(<RunHistoryBody />);

    // The title and the mono command line both carry the text here, because
    // this command has no leading comment to derive a nicer name from.
    expect(screen.getAllByText(entry.title).length).toBeGreaterThan(0);
    expect(screen.getByText("stopped at pnpm install")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy(); // uppercased in CSS, not in the text
  });

  it("filters live from the search box and the kind chips", () => {
    recordOne();
    recordSqlRun({ cmd: "select 1;", startedAt: Date.now(), error: null, statements: [sqlStatement({ fields: ["a"], rows: [{ a: 1 }], rowCount: 1 })] });
    render(<RunHistoryBody />);

    fireEvent.click(screen.getByRole("button", { name: "SQL" }));
    expect(screen.queryByText(/ERR_PNPM_NO_LOCKFILE/)).toBeNull();
    expect(screen.getAllByText("select 1;").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByLabelText("Search run history"), { target: { value: "lockfile" } });
    expect(screen.queryAllByText("select 1;")).toHaveLength(0);
    expect(screen.getByText(/1 of 2/)).toBeTruthy();
  });

  it("says nothing matches without implying nothing was run", () => {
    recordOne();
    render(<RunHistoryBody />);
    fireEvent.change(screen.getByLabelText("Search run history"), { target: { value: "zzzz" } });
    expect(screen.getByText(/History keeps every run/)).toBeTruthy();
  });

  it("selecting a row fills the Properties panel and the Output tab", () => {
    const entry = recordOne();
    const { container } = render(
      <>
        <RunHistoryBody />
        <RunHistoryProperties />
        <RunHistoryOutput />
      </>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(entry.title) })[0]!);

    // Properties: the real outcome and the real command.
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText(entry.cmd).length).toBeGreaterThan(0);
    // Output: verbatim, both steps.
    expect(container.querySelector("pre")?.textContent).toContain("ERR_PNPM_NO_LOCKFILE");
  });

  it("the Properties note writes through on blur", () => {
    const entry = recordOne();
    render(<RunHistoryProperties />);

    const note = screen.getByLabelText("What this run was");
    fireEvent.change(note, { target: { value: "the panel export was missing" } });
    fireEvent.blur(note);

    expect(entryById(entry.id)?.note).toBe("the panel export was missing");
  });
});
