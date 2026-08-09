// @vitest-environment jsdom
/**
 * The Engines screen's own contract coverage. `Shell.test.tsx` already covers
 * shell-chrome integration; this file covers what is specific to this screen:
 *
 *  - the breakdown flattener, against every shape the twelve engines actually
 *    return (flat contributions, pillar-nested contributions, and CRM's five
 *    dimensions with no single contribution at all). This is the one piece of
 *    real logic on the screen, and getting it wrong would mean silently
 *    mis-attributing what moved a tenant's score.
 *  - score extraction refusing to invent a single number where the engine
 *    does not return one.
 *  - registration legality on the fixed `run` tab.
 *  - the `engine` peek resolving null before the registry loads and real
 *    after, so the tab strip can never show a raw key.
 *  - the store dropping per-customer caches when the customer changes — a
 *    score from the previous tenant left on screen is the worst failure this
 *    screen could have.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import { EnginesExplorer } from "./EnginesExplorer";
import { EnginesBody } from "./EnginesBody";
import {
  configureEnginesFetch,
  getSnapshot,
  loadEngines,
  loadTestbeds,
  resetEnginesStore,
  runEngine,
  select,
  setTab,
  setTestbed,
} from "./enginesStore";
import { historyUnderreportsScore, scoreOfOutput, traceRowsOf, traceTotal } from "./engineTypes";

const fetchWithAuth = vi.fn();
const clipboardWrite = vi.fn((_text: string) => Promise.resolve());

const ENGINES = [
  {
    key: "health",
    label: "Architecture Health Engine",
    description: "Sums the pillar impacts.",
    categoryPrefix: "governance",
    tenantScoped: true,
    dependsOn: ["security"],
    configMode: "signal-rules",
    backingTable: null,
  },
  {
    key: "sla",
    label: "SLA Engine",
    description: "Tracks SLA timers.",
    categoryPrefix: "sla",
    tenantScoped: true,
    dependsOn: [],
    configMode: "backing-table",
    backingTable: "sla_policies",
  },
  {
    key: "msp",
    label: "MSP Portfolio Engine",
    description: "Aggregates the others.",
    categoryPrefix: "msp",
    tenantScoped: false,
    dependsOn: ["health", "drift", "priority"],
    configMode: "aggregator",
    backingTable: null,
  },
];

const TESTBEDS = [
  { id: 7, mspId: 1, name: "Contoso Ltd", domain: "contoso.example", isTestbed: true },
  { id: 9, mspId: 1, name: "Northwind Traders", domain: "northwind.example", isTestbed: true },
];

function jsonOnce(body: unknown, ok = true) {
  fetchWithAuth.mockResolvedValueOnce({ ok, status: ok ? 200 : 400, statusText: "", json: async () => body });
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  clipboardWrite.mockReset().mockImplementation(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
  // The selected customer deliberately survives a reload, which means it also
  // survives `resetEnginesStore()` — that reads it back from storage. Clear it
  // so one test's scope cannot become the next one's starting state.
  localStorage.clear();
  resetEnginesStore();
  configureEnginesFetch(fetchWithAuth);
});

afterEach(() => {
  cleanup();
  resetEnginesStore();
});

// ─── Breakdown flattening ─────────────────────────────────────────────────────

describe("traceRowsOf", () => {
  it("reads a flat priority-style breakdown", () => {
    const rows = traceRowsOf([
      { signalKey: "legacy_auth", contribution: 10 },
      { signalKey: "guest_sprawl", contribution: 4 },
    ]);
    expect(rows.map((r) => [r.name, r.impact])).toEqual([
      ["legacy_auth", 10],
      ["guest_sprawl", 4],
    ]);
    expect(traceTotal(rows)).toBe(14);
  });

  it("expands health's pillar-nested contributions and bands them by pillar", () => {
    const rows = traceRowsOf([
      { pillar: "governance", score: 12, contributions: [{ signalKey: "no_owner", value: 7 }, { signalKey: "stale_group", value: 5 }] },
      { pillar: "security", score: 3, contributions: [{ signalKey: "legacy_auth", value: 3 }] },
    ]);
    expect(rows.map((r) => [r.band, r.name, r.impact])).toEqual([
      ["governance", "no_owner", 7],
      ["governance", "stale_group", 5],
      ["security", "legacy_auth", 3],
    ]);
  });

  it("accepts security's single non-array breakdown object", () => {
    const rows = traceRowsOf({ pillar: "security", score: 9, contributions: [{ signalKey: "mfa_gap", value: 9 }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ band: "security", name: "mfa_gap", impact: 9 });
  });

  it("leaves impact null when a row carries no single contribution, and shows the figures it does carry", () => {
    // CRM: five independent dimensions. Picking one and calling it "the"
    // contribution would be inventing the engine's answer.
    const rows = traceRowsOf([{ signalKey: "budget_signal", fit: 3, pain: 5, maturity: 0, intent: 2, urgency: 0 }]);
    expect(rows[0]!.impact).toBeNull();
    expect(rows[0]!.detail).toEqual([
      ["fit", "3"],
      ["pain", "5"],
      ["intent", "2"],
    ]);
    expect(traceTotal(rows)).toBeNull();
  });

  it("keeps drift's trend fields as detail beside its contribution", () => {
    const rows = traceRowsOf([
      { signalKey: "policy_changed", category: "drift:policy", trendValue: 4, governanceImpact: 2, contribution: 6, source: "rule", sourceId: 12 },
    ]);
    expect(rows[0]!.impact).toBe(6);
    expect(rows[0]!.band).toBe("drift:policy");
    // sourceId identifies the row rather than measuring it, so it is not detail.
    expect(rows[0]!.detail).toEqual([
      ["trend value", "4"],
      ["governance impact", "2"],
    ]);
  });

  it("returns nothing for an absent or empty breakdown rather than a placeholder row", () => {
    expect(traceRowsOf(undefined)).toEqual([]);
    expect(traceRowsOf([])).toEqual([]);
  });
});

// ─── Score extraction ─────────────────────────────────────────────────────────

describe("scoreOfOutput", () => {
  it("takes a plain numeric score", () => {
    expect(scoreOfOutput({ score: 52 })).toEqual({ value: 52, label: "score" });
  });

  it("takes pricing's total impact, and says that is what it is", () => {
    expect(scoreOfOutput({ score: { totalPricingImpact: 1200, totalPricingValueContribution: 400 } })).toEqual({
      value: 1200,
      label: "pricing impact",
    });
  });

  it("takes CRM's combined total", () => {
    expect(scoreOfOutput({ score: { fit: 1, pain: 2, maturity: 3, intent: 4, urgency: 5, total: 15 } })).toEqual({
      value: 15,
      label: "combined score",
    });
  });

  it("refuses to synthesise one where the engine returns none", () => {
    const result = scoreOfOutput({ score: { somethingElse: 3 } });
    expect(result.value).toBeNull();
    expect(result.note).toBeTruthy();
  });
});

describe("historyUnderreportsScore", () => {
  it("is true exactly when the output score is not a plain number", () => {
    // writeEngineSnapshot stores 0 for these, so the Score tab has to say so.
    expect(historyUnderreportsScore({ score: { totalPricingImpact: 900 } })).toBe(true);
    expect(historyUnderreportsScore({ score: 41 })).toBe(false);
    expect(historyUnderreportsScore(undefined)).toBe(false);
  });
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers on the fixed run tab without violating the open/create/global rule", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's registry imports must resolve against
    // the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("engines");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/engines");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["run"]));

    const fixedCommands = (screenModule?.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(fixedCommands.length).toBeGreaterThan(0);
    for (const cmd of fixedCommands) {
      expect(["open", "create", "global"]).toContain(cmd.intent);
    }
  });

  it("does not hand-author a Back group on its contextual tab", async () => {
    const screenModule = getScreen("engines")!;
    jsonOnce({ engines: ENGINES });
    await loadEngines();

    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "health", kind: "engine" }) : screenModule.contextualTab;
    expect(spec?.id).toBe("engine-tools");
    // The shell splices Back in at position 2 for every contextual tab in the
    // app; a hand-authored one would produce two, in different places.
    expect(spec?.groups.map((g) => g.label)).not.toContain("Back");
  });

  it("gives the Rules group the label that matches how the engine is configured", async () => {
    const screenModule = getScreen("engines")!;
    jsonOnce({ engines: ENGINES });
    await loadEngines();

    const forRules = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "health", kind: "engine" }) : null;
    const forTable = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "sla", kind: "engine" }) : null;
    expect(forRules?.groups.find((g) => g.label === "Change it")?.large?.[0]?.label).toBe("Its rules");
    expect(forTable?.groups.find((g) => g.label === "Change it")?.large?.[0]?.label).toBe("Where it is configured");
  });
});

// ─── Peek ─────────────────────────────────────────────────────────────────────

describe("peeks.engine", () => {
  it("resolves null before the registry loads, and a real model after", async () => {
    const screenModule = getScreen("engines")!;
    expect(screenModule.peeks?.engine?.("health")).toBeNull();

    jsonOnce({ engines: ENGINES });
    await loadEngines();

    const peek = screenModule.peeks?.engine?.("health");
    expect(peek).toBeTruthy();
    expect(peek?.title).toBe("Architecture Health Engine");
    expect(peek?.kind).toBe("engine");
    // Never scored here yet, so it says so rather than showing a 0.
    expect(peek?.facts?.find((f) => f.label === "Score")?.value).toBe("never here");
  });

  it("still returns null for a key the server never registered", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    expect(getScreen("engines")!.peeks?.engine?.("not_an_engine")).toBeNull();
  });

  it("arms the run action rather than firing it on the first press", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    const peek = getScreen("engines")!.peeks?.engine?.("health");
    expect(peek?.actions?.[0]).toMatchObject({ label: "Run it for real", confirm: true });
  });
});

// ─── Store ────────────────────────────────────────────────────────────────────

describe("testbed scope", () => {
  it("drops a stored selection the server no longer lists as a testbed", async () => {
    setTestbed(9999);
    jsonOnce({ testbeds: TESTBEDS });
    await loadTestbeds();
    // 9999 is gone, so it falls back to a real one instead of leaving a scope
    // that every run would 400 against.
    expect(getSnapshot().testbedId).toBe(7);
  });

  it("clears per-customer caches when the customer changes", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    jsonOnce({ testbeds: TESTBEDS });
    await loadTestbeds();

    jsonOnce({
      engineKey: "health",
      customerId: 7,
      series: [{ date: "2026-08-01T00:00:00.000Z", score: 52, previousScore: 63, delta: -11, trendDirection: null, source: "snapshot" }],
      baselineEvents: [],
      signalDeltas: [],
      latest: { id: 1, engineKey: "health", score: 52, previousScore: 63, delta: -11, trendDirection: null, breakdown: [], rawSignals: [], capturedAt: "2026-08-01T00:00:00.000Z" },
    });
    select("health");
    await vi.waitFor(() => expect(getSnapshot().history.health).toBeTruthy());

    // Switching customer refetches; the old customer's history must not be
    // sitting under the new one's name while that is in flight.
    jsonOnce({ engineKey: "health", customerId: 9, series: [], baselineEvents: [], signalDeltas: [], latest: null });
    setTestbed(9);
    expect(getSnapshot().history.health).toBeUndefined();
    expect(getSnapshot().runs).toEqual({});
  });
});

describe("runEngine", () => {
  it("refuses, in words, when no customer is in scope", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    fetchWithAuth.mockClear();

    await runEngine("health");
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(getSnapshot().message).toMatch(/testbed customer/i);
  });

  it("posts the real customerId and keeps the output", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    jsonOnce({ testbeds: TESTBEDS });
    await loadTestbeds();
    fetchWithAuth.mockClear();

    jsonOnce({ mode: "tenant", customerId: 7, output: { engine: "health", score: 52, rawSignals: ["legacy_auth"] } });
    // The refetch runEngine kicks off afterwards.
    jsonOnce({ engineKey: "health", customerId: 7, series: [], baselineEvents: [], signalDeltas: [], latest: null });

    await runEngine("health");

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/engines/health/test");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ customerId: 7 });
    expect(getSnapshot().runs.health).toMatchObject({ score: 52 });
    // The copy has to state the consequence — there is no dry run here.
    expect(getSnapshot().message).toMatch(/history row was written/i);
  });

  it("surfaces the server's own error text rather than a generic failure", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    jsonOnce({ testbeds: TESTBEDS });
    await loadTestbeds();

    jsonOnce({ error: "A real customerId is required." }, false);
    await runEngine("health");
    expect(getSnapshot().runError).toBe("A real customerId is required.");
  });
});

// ─── Context menus ────────────────────────────────────────────────────────────

function engineCard(label: string): HTMLElement {
  // The header repeats the selected engine's label as plain text, so this
  // targets the card's own title button specifically rather than any text
  // match.
  const heading = screen.getByRole("button", { name: label });
  return heading.parentElement!.parentElement!.parentElement as HTMLElement;
}

describe("EnginesExplorer right-click", () => {
  it("offers Open the engine / Run it for real / Copy engine key / Copy last score", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    render(<EnginesExplorer />);

    const row = screen.getByText("Architecture Health Engine").closest("button")!;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menuitem", { name: "Open the engine" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Run it for real" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy engine key" })).toBeTruthy();
    // Never scored here yet — "Copy last score" has nothing real to copy.
    expect(screen.getByRole("menuitem", { name: "Copy last score" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("copies the real engine key, not a label or a guess", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    render(<EnginesExplorer />);

    const row = screen.getByText("SLA Engine").closest("button")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy engine key" }));
    expect(clipboardWrite).toHaveBeenCalledWith("sla");
  });

  it("Run it for real reuses the same runEngine path the screen's own buttons use — no dry run, no fabricated behaviour", async () => {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    jsonOnce({ testbeds: TESTBEDS });
    await loadTestbeds();
    fetchWithAuth.mockClear();
    jsonOnce({ mode: "tenant", customerId: 7, output: { engine: "health", score: 61, rawSignals: [] } });
    jsonOnce({ engineKey: "health", customerId: 7, series: [], baselineEvents: [], signalDeltas: [], latest: null });

    render(<EnginesExplorer />);
    const row = screen.getByText("Architecture Health Engine").closest("button")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Run it for real" }));

    await vi.waitFor(() => expect(getSnapshot().runs.health).toMatchObject({ score: 61 }));
    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/engines/health/test");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ customerId: 7 });
    // Real snapshot write, same as every other run path on this screen.
    expect(getSnapshot().message).toMatch(/history row was written/i);
  });
});

describe("EngineCard right-click (Run every engine tab)", () => {
  async function renderGrid() {
    jsonOnce({ engines: ENGINES });
    await loadEngines();
    jsonOnce({ testbeds: TESTBEDS });
    await loadTestbeds();
    jsonOnce({ engineKey: "health", customerId: 7, series: [], baselineEvents: [], signalDeltas: [], latest: null });
    select("health");
    setTab("all");
    render(<EnginesBody />);
  }

  it("offers Open this engine / Run it for real / Copy last output / Copy engine key", async () => {
    await renderGrid();
    const card = engineCard("Architecture Health Engine");
    fireEvent.contextMenu(card);

    expect(screen.getByRole("menuitem", { name: "Open this engine" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Run it for real" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy engine key" })).toBeTruthy();
    // Nothing has run yet in this session, so there is no output to copy.
    expect(screen.getByRole("menuitem", { name: "Copy last output" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("Copy last output copies the real run — enabled only once one exists", async () => {
    await renderGrid();
    fetchWithAuth.mockClear();
    jsonOnce({ mode: "tenant", customerId: 7, output: { engine: "health", score: 61, rawSignals: [] } });
    jsonOnce({ engineKey: "health", customerId: 7, series: [], baselineEvents: [], signalDeltas: [], latest: null });

    await runEngine("health");

    const card = engineCard("Architecture Health Engine");
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy last output" }));
    expect(clipboardWrite).toHaveBeenCalledWith(JSON.stringify(getSnapshot().runs.health, null, 2));
  });

  it("Copy engine key copies the real key", async () => {
    await renderGrid();
    const card = engineCard("SLA Engine");
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy engine key" }));
    expect(clipboardWrite).toHaveBeenCalledWith("sla");
  });
});
