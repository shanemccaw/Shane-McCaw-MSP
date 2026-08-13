// @vitest-environment jsdom
/**
 * Run History's own contract coverage.
 *
 * The log is server-side, so the assertions that matter here are about the
 * client's half of that contract, not about how a row is derived — the
 * derivations moved to `api-server/src/lib/run-history.ts` and are tested
 * there, next to the results they are read off.
 *
 * What this file covers:
 *
 * - the label derivations that genuinely stayed client-side, because they are
 *   relative to *now* and so cannot be stored (day band, when, duration);
 * - the store's contract with the API: filter and search go to the server,
 *   typing is debounced, an out-of-order response never overwrites a newer
 *   one, and `output` is fetched per selection rather than shipped in the list;
 * - the states the screen has to tell apart honestly — nothing run yet, nothing
 *   matches, and the table not existing because the migration has not been run;
 * - registration legality (only open/create/global on the fixed `run` and
 *   `watch` tabs) and the `run` peek reading back real store state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import { RunHistoryBody } from "./RunHistoryBody";
import { RunHistoryOutput } from "./RunHistoryOutput";
import { RunHistoryProperties } from "./RunHistoryProperties";
import {
  configureRunHistoryFetch,
  entryById,
  failedCount,
  getSnapshot,
  loadRuns,
  resetRunHistoryStore,
  SEARCH_DEBOUNCE_MS,
  selectRun,
  setFilter,
  setNote,
  setSearch,
  warmRunHistory,
} from "./runHistoryStore";
import { dayBand, durationLabel, repeatLabel, whenLabel, type RunHistoryEntry } from "./runHistoryTypes";

const DAY = 86_400_000;

const fetchWithAuth = vi.fn();
const clipboardWrite = vi.fn((_text: string) => Promise.resolve());

/** One list row as the API actually returns it — no `output`, `runCount` from the server. */
function row(over: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    id: "1",
    kind: "deploy",
    cmd: "pnpm run build",
    title: "pnpm run build",
    ticket: "",
    startedAt: new Date().toISOString(),
    durationMs: 42_000,
    ok: true,
    effect: ["read only"],
    note: "",
    runCount: 1,
    hasOutput: true,
    ...over,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

/** Answers the list endpoint with `runs`, and `GET /:id` with the same row plus `output`. */
function serveRuns(runs: RunHistoryEntry[], extra: Record<string, unknown> = {}) {
  fetchWithAuth.mockImplementation((url: string) => {
    const match = /\/run-history\/(\d+)$/.exec(String(url));
    if (match) {
      const found = runs.find((r) => r.id === match[1]);
      return Promise.resolve(jsonResponse({ run: found ? { ...found, output: `output for ${found.id}` } : null }));
    }
    return Promise.resolve(
      jsonResponse({ runs, total: runs.length, failed: runs.filter((r) => !r.ok).length, ...extra }),
    );
  });
}

beforeEach(() => {
  vi.useRealTimers();
  fetchWithAuth.mockReset();
  clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
  resetRunHistoryStore();
  configureRunHistoryFetch(fetchWithAuth);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  resetRunHistoryStore();
});

describe("day and duration labels", () => {
  // These stayed client-side because they are relative to now: a run recorded
  // yesterday has to read "yesterday" today and "Mon" next week, which a value
  // frozen at record time cannot do.
  const now = new Date(2026, 7, 8, 14, 0, 0).getTime();

  it("bands by calendar day, not by elapsed hours", () => {
    expect(dayBand(new Date(now - 60_000).toISOString(), now)).toBe("Today");
    // 20 hours earlier is still yesterday, because it crossed midnight.
    expect(dayBand(new Date(2026, 7, 7, 18, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayBand(new Date(now - 5 * DAY).toISOString(), now)).toBe("Earlier");
  });

  it("labels when a run happened relative to now", () => {
    expect(whenLabel(new Date(2026, 7, 8, 9, 12).toISOString(), now)).toBe("today 09:12");
    expect(whenLabel(new Date(2026, 7, 7, 17, 40).toISOString(), now)).toBe("yesterday 17:40");
  });

  it("uses the design's duration ladder", () => {
    expect(durationLabel(34)).toBe("34 ms");
    expect(durationLabel(1400)).toBe("1.4s");
    expect(durationLabel(22_000)).toBe("22s");
    expect(durationLabel(84_000)).toBe("1m 24s");
    expect(durationLabel(120_000)).toBe("2m");
  });

  it("says first run until the same command has run twice", () => {
    expect(repeatLabel(1)).toBe("first run");
    expect(repeatLabel(14)).toBe("run 14×");
  });
});

describe("the store's contract with the API", () => {
  it("never writes a run — there is no create call on this client", async () => {
    // The routes that run things record their own rows. A client that could
    // POST a history row would make the log worth less than no log.
    const api = await import("./runHistoryApi");
    expect(Object.keys(api).some((name) => /create|record|post/i.test(name))).toBe(false);
  });

  it("sends the kind filter to the server rather than filtering locally", async () => {
    serveRuns([row()]);
    setFilter("SQL");
    await vi.waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    expect(String(fetchWithAuth.mock.calls.at(-1)?.[0])).toContain("kind=sql");
  });

  it("debounces search into one request, and searches server-side", async () => {
    vi.useFakeTimers();
    serveRuns([]);
    setSearch("l");
    setSearch("lo");
    setSearch("lockfile");
    expect(fetchWithAuth).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(String(fetchWithAuth.mock.calls[0]?.[0])).toContain("q=lockfile");
    vi.useRealTimers();
  });

  it("does not let a slow earlier response overwrite a newer one", async () => {
    // The classic search race: "sel" lands after "select" and the list snaps
    // back to the wrong answer.
    const stale = row({ id: "9", title: "stale" });
    const fresh = row({ id: "10", title: "current" });
    let resolveSlow: (value: unknown) => void = () => {};

    fetchWithAuth
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ runs: [fresh], total: 1, failed: 0 })));

    const first = loadRuns();
    const second = loadRuns();
    await second;
    expect(getSnapshot().entries[0]?.title).toBe("current");

    resolveSlow(jsonResponse({ runs: [stale], total: 1, failed: 0 }));
    await first;
    expect(getSnapshot().entries[0]?.title).toBe("current");
  });

  it("fetches a run's output only when it is selected", async () => {
    serveRuns([row({ id: "7" })]);
    await loadRuns();
    expect(getSnapshot().entries[0]?.output).toBeUndefined();

    selectRun("7");
    await vi.waitFor(() => expect(entryById("7")?.output).toBe("output for 7"));
  });

  it("reports the table's own failure count, not this page's", async () => {
    // The Watch badge must never quietly mean "failures on screen".
    fetchWithAuth.mockResolvedValue(jsonResponse({ runs: [row()], total: 480, failed: 12 }));
    await loadRuns();
    expect(failedCount()).toBe(12);
  });

  it("puts a note back if the save fails, rather than leaving it looking saved", async () => {
    serveRuns([row({ id: "3", note: "original" })]);
    await loadRuns();

    fetchWithAuth.mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) });
    await setNote("3", "typed but not saved");

    expect(entryById("3")?.note).toBe("original");
    expect(getSnapshot().error).toContain("did not save");
  });
});

describe("rendering", () => {
  it("names the migration when the table does not exist yet", async () => {
    serveRuns([], { tableMissing: true, migration: "2026-08-09-simulator-run-history.sql" });
    render(<RunHistoryBody />);

    await screen.findByText(/does not exist yet/);
    expect(screen.getByText(/2026-08-09-simulator-run-history\.sql/)).toBeTruthy();
  });

  it("distinguishes nothing-run-yet from nothing-matches", async () => {
    serveRuns([]);
    render(<RunHistoryBody />);

    await screen.findByText(/Nothing has been run yet/);
    // And it says where the recording happens, since that is what makes the
    // log trustworthy across tabs and admins.
    expect(screen.getByText(/Recorded by the server as it runs/)).toBeTruthy();

    setFilter("SQL");
    await screen.findByText(/Nothing matches/);
  });

  it("renders a real run with its command, effect and repeat count", async () => {
    serveRuns([
      row({
        id: "5",
        cmd: "git pull --ff-only && pnpm install",
        title: "Ship the consent fix",
        ticket: "#412",
        ok: false,
        effect: ["2 steps", "stopped at pnpm install"],
        runCount: 14,
      }),
    ]);
    render(<RunHistoryBody />);

    await screen.findByText("Ship the consent fix");
    expect(screen.getByText("#412")).toBeTruthy();
    expect(screen.getByText("stopped at pnpm install")).toBeTruthy();
    expect(screen.getByText("run 14×")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy(); // uppercased in CSS, not in the text
  });

  it("selecting a row fills the Properties panel and loads the Output tab", async () => {
    serveRuns([row({ id: "8", title: "Rebuild", ok: false })]);
    const { container } = render(
      <>
        <RunHistoryBody />
        <RunHistoryProperties />
        <RunHistoryOutput />
      </>,
    );

    await screen.findAllByText("Rebuild");
    fireEvent.click(screen.getAllByRole("button", { name: /Rebuild/ })[0]!);

    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe("output for 8"));
  });

  it("says the output is still coming rather than that there was none", async () => {
    // "It printed nothing" and "not fetched yet" are different answers, and the
    // screen must never give the first when it means the second.
    fetchWithAuth.mockImplementation((url: string) =>
      /\/run-history\/\d+$/.test(String(url))
        ? new Promise(() => {}) // never resolves — the output is still in flight
        : Promise.resolve(jsonResponse({ runs: [row({ id: "2", hasOutput: true })], total: 1, failed: 0 })),
    );

    warmRunHistory();
    await vi.waitFor(() => expect(getSnapshot().entries).toHaveLength(1));
    render(<RunHistoryOutput />);
    selectRun("2");

    await screen.findByText(/Reading what it printed/);
  });

  it("writes the Properties note through on blur", async () => {
    serveRuns([row({ id: "4" })]);
    await loadRuns();
    render(<RunHistoryProperties />);

    const note = screen.getByLabelText("What this run was");
    fireEvent.change(note, { target: { value: "the panel export was missing" } });
    fireEvent.blur(note);

    await vi.waitFor(() => expect(entryById("4")?.note).toBe("the panel export was missing"));
    const patch = fetchWithAuth.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patch).toBeTruthy();
  });
});

describe("row context menu", () => {
  // The row's double-click and the peek/contextual tab already do all of
  // this — right-click is just a second entry point onto the same functions,
  // never a new capability.

  function rowFor(title: string): HTMLElement {
    return screen.getByText(title).closest('[role="button"]') as HTMLElement;
  }

  it("offers Open, Run again, Copy output and Copy command, real actions the row already supports", async () => {
    serveRuns([row({ id: "20", cmd: "pnpm run build", title: "Rebuild the api-server" })]);
    render(<RunHistoryBody />);

    await screen.findByText("Rebuild the api-server");
    fireEvent.contextMenu(rowFor("Rebuild the api-server"));

    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Run again" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy command" }));
    expect(clipboardWrite).toHaveBeenCalledWith("pnpm run build");

    // Selecting the row (its own plain click) loads the output the same way
    // it always has; the menu's Copy output reads whatever that loaded.
    fireEvent.click(rowFor("Rebuild the api-server"));
    await vi.waitFor(() => expect(entryById("20")?.output).toBeDefined());
    fireEvent.contextMenu(rowFor("Rebuild the api-server"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy output" }));
    expect(clipboardWrite).toHaveBeenCalledWith("output for 20");
  });

  it("labels the rerun item per kind: Run again for deploy, Open in SQL Runner for sql, Run this migration again for a migration", async () => {
    serveRuns([
      row({ id: "21", kind: "sql", cmd: "select 1;", title: "Ad-hoc query" }),
      row({ id: "22", kind: "sql", cmd: "0002_test.sql", title: "Run 0002_test.sql", migrationFile: "0002_test.sql" }),
    ]);
    render(<RunHistoryBody />);

    await screen.findByText("Ad-hoc query");
    fireEvent.contextMenu(rowFor("Ad-hoc query"));
    expect(screen.getByRole("menuitem", { name: "Open in SQL Runner" })).toBeTruthy();

    fireEvent.contextMenu(rowFor("Run 0002_test.sql"));
    expect(screen.getByRole("menuitem", { name: "Run this migration again" })).toBeTruthy();
  });

  it("arms the same confirm a migration re-run always requires, even from the right-click menu", async () => {
    serveRuns([row({ id: "23", kind: "sql", cmd: "0003_test.sql", title: "Run 0003_test.sql", migrationFile: "0003_test.sql" })]);
    render(<RunHistoryBody />);

    await screen.findByText("Run 0003_test.sql");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.contextMenu(rowFor("Run 0003_test.sql"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run this migration again" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Run "0003_test.sql" against the real database again? This cannot be undone from here.',
    );
    confirmSpy.mockRestore();
  });

  it("disables Copy output when the run printed nothing, and gates Forget behind the contextual tab's own confirm copy", async () => {
    serveRuns([row({ id: "24", title: "No output run", hasOutput: false })]);
    render(<RunHistoryBody />);

    await screen.findByText("No output run");
    fireEvent.contextMenu(rowFor("No output run"));
    expect(screen.getByRole("menuitem", { name: "Copy output" }).getAttribute("aria-disabled")).toBe("true");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Forget this run" }));
    expect(confirmSpy).toHaveBeenCalledWith('Forget "No output run"? Its output goes with it.');

    await vi.waitFor(() =>
      expect(fetchWithAuth.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
        true,
      ),
    );
    confirmSpy.mockRestore();
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

  it("peeks.run resolves null for an unknown id and real state for a loaded one", async () => {
    const screenModule = getScreen("run-history")!;
    expect(screenModule.peeks?.run?.("nope")).toBeNull();

    serveRuns([row({ id: "6", kind: "sql", title: "Migrations that never ran", cmd: "select 1;" })]);
    await loadRuns();

    const model = screenModule.peeks?.run?.("6");
    expect(model?.kind).toBe("run");
    expect(model?.eyebrow).toBe("SQL RUN");
    expect(model?.title).toBe("Migrations that never ran");
    expect(model?.tag).toBe("succeeded");
    // Not yet fetched — and it says so instead of claiming it printed nothing.
    expect(model?.body?.content).toMatch(/Reading what it printed/);
  });

  it("arms the confirm only on the migration re-run, which writes to the live database", async () => {
    const screenModule = getScreen("run-history")!;
    serveRuns([
      row({ id: "11" }),
      row({ id: "12", kind: "sql", migrationFile: "0001_test.sql", title: "0001_test.sql" }),
    ]);
    await loadRuns();

    expect(screenModule.peeks?.run?.("11")?.actions?.[0]?.confirm).toBeFalsy();
    // Forget is always armed.
    expect(screenModule.peeks?.run?.("11")?.actions?.at(-1)?.confirm).toBe(true);
    expect(screenModule.peeks?.run?.("12")?.actions?.[0]?.confirm).toBe(true);
  });

  it("offers Run Tools only for an open, resolvable run", async () => {
    const screenModule = getScreen("run-history")!;
    const resolver = screenModule.contextualTab as (ctx: { kind?: string; recordId?: string }) => { id: string } | null;

    expect(resolver({})).toBeNull();
    expect(resolver({ kind: "run", recordId: "missing" })).toBeNull();

    serveRuns([row({ id: "13" })]);
    await loadRuns();
    expect(resolver({ kind: "run", recordId: "13" })?.id).toBe("run-tools");
  });

  it("only offers the failures answer row while something is failing", async () => {
    const screenModule = getScreen("run-history")!;
    serveRuns([row({ id: "14" })]);
    await loadRuns();
    expect(screenModule.commands?.().some((c) => c.id === "ans:run-history-failed")).toBe(false);

    fetchWithAuth.mockResolvedValue(jsonResponse({ runs: [row({ id: "15", ok: false })], total: 1, failed: 1 }));
    await loadRuns();
    expect(screenModule.commands?.().find((c) => c.id === "ans:run-history-failed")?.live).toBe("1");
  });

  it("keeps the gallery rows live rather than freezing at module load", async () => {
    const screenModule = getScreen("run-history")!;
    const gallery = screenModule.ribbon?.find((r) => r.tab === "run")?.group.large?.[0]?.gallery;
    expect(gallery?.rows).toEqual([]);

    serveRuns([row({ id: "16", title: "Rebuild after the vite bump", ok: false, effect: ["build failed"] })]);
    await loadRuns();

    const rows = gallery?.rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tile).toBe("!");
    expect(rows[0]!.head).toBe("failed");
    // The sub carries real data, not a restatement of the name.
    expect(rows[0]!.sub).not.toBe(rows[0]!.name);
    expect(rows[0]!.sub).toContain("build failed");
  });
});
