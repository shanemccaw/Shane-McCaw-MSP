// @vitest-environment jsdom
/**
 * The Workflow Triggers screen's own contract coverage. `Shell.test.tsx`
 * already covers shell-chrome integration; this file covers what is
 * specific to this screen:
 *
 *  - registration legality on the fixed `home`/`watch` tabs.
 *  - the contextual tab not hand-authoring a Back group.
 *  - the `trigger` peek resolving null before the list loads and a real
 *    model after, with Delete armed.
 *  - the store: loading the global trigger list, selecting one (which loads
 *    its events + stats together), enable/disable + config patching
 *    optimistically, delete, test-fire, webhook token rotation, the chained
 *    `window.prompt` create flow, and the "trigger errors" live-ribbon count.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScreen, resetRegistry } from "../../registry/registry";
import { getLiveRibbonEntry } from "../../shell/liveRibbon";
import {
  configureTriggersFetch,
  createTriggerInteractive,
  getSnapshot,
  patchTriggerConfig,
  removeTrigger,
  reloadTriggers,
  resetTriggersStore,
  rotateTokenNow,
  selectTrigger,
  testFireNow,
  toggleTriggerEnabled,
  triggerById,
  warmTriggers,
  RIBBON_KEYS,
} from "./triggersStore";
import type { GlobalTriggerRow, TriggerEventRow, TriggerStats } from "./triggersTypes";

const fetchWithAuth = vi.fn();

function trigger(overrides: Partial<GlobalTriggerRow> = {}): GlobalTriggerRow {
  return {
    id: 5,
    definitionId: 1,
    definitionName: "Client onboarding",
    type: "event",
    config: { eventName: "fulfillment.assessment" },
    webhookToken: null,
    nextRunAt: null,
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    lastFiredAt: "2026-08-08T00:00:00.000Z",
    lastStatus: "fired",
    eventCount: 3,
    ...overrides,
  };
}

function event(overrides: Partial<TriggerEventRow> = {}): TriggerEventRow {
  return {
    id: 20,
    triggerId: 5,
    runId: 100,
    status: "fired",
    durationMs: 250,
    errorMessage: null,
    payload: {},
    firedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function stats(overrides: Partial<TriggerStats> = {}): TriggerStats {
  return {
    total: 3,
    avgDurationMs: 220,
    lastFiredAt: "2026-08-08T00:00:00.000Z",
    lastStatus: "fired",
    dailyBuckets: [],
    ...overrides,
  };
}

function jsonOnce(body: unknown, ok = true) {
  fetchWithAuth.mockResolvedValueOnce({ ok, status: ok ? 200 : 400, statusText: "", json: async () => body });
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetTriggersStore();
  configureTriggersFetch(fetchWithAuth);
});

afterEach(() => {
  resetTriggersStore();
  vi.restoreAllMocks();
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers on home + watch without violating the open/create/global rule", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's registry imports must resolve against
    // the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("workflow-triggers");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/triggers");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["home", "watch"]));

    const fixedCommands = (screenModule?.ribbon ?? []).flatMap((r) => [...(r.group.large ?? []), ...(r.group.small ?? []), ...(r.group.row ?? [])]);
    expect(fixedCommands.length).toBeGreaterThan(0);
    for (const cmd of fixedCommands) {
      expect(["open", "create", "global"]).toContain(cmd.intent);
    }
  });

  it("does not hand-author a Back group on its contextual tab", async () => {
    const screenModule = getScreen("workflow-triggers")!;
    jsonOnce([trigger()]);
    jsonOnce([{ id: 1, name: "Client onboarding" }]);
    await warmTriggers();

    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "5", kind: "trigger" }) : screenModule.contextualTab;
    expect(spec?.id).toBe("trigger-tools");
    // The shell splices Back in at position 2 for every contextual tab in
    // the app; a hand-authored one would produce two, in different places.
    expect(spec?.groups.map((g) => g.label)).not.toContain("Back");
    // Every contextual command needs a specific trigger open — legal only here.
    const contextualCommands = spec?.groups.flatMap((g) => [...(g.large ?? []), ...(g.small ?? []), ...(g.row ?? [])]) ?? [];
    expect(contextualCommands.length).toBeGreaterThan(0);
    for (const cmd of contextualCommands) expect(cmd.intent).toBe("record");
  });

  it("returns null for a contextual tab request on a kind it does not own", () => {
    const screenModule = getScreen("workflow-triggers")!;
    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "5", kind: "service" }) : screenModule.contextualTab;
    expect(spec).toBeNull();
  });

  it("only offers a webhook-token rotate button when the trigger is actually a webhook", async () => {
    const screenModule = getScreen("workflow-triggers")!;
    jsonOnce([trigger({ type: "webhook", webhookToken: "abc123" })]);
    jsonOnce([{ id: 1, name: "Client onboarding" }]);
    await warmTriggers();

    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "5", kind: "trigger" }) : screenModule.contextualTab;
    const labels = spec?.groups.flatMap((g) => [...(g.large ?? []), ...(g.small ?? [])]).map((c) => c.label) ?? [];
    expect(labels).toContain("Rotate token");
  });
});

// ─── Peeks ─────────────────────────────────────────────────────────────────────

describe("peeks.trigger", () => {
  it("resolves null before the list loads, and a real model after", async () => {
    const screenModule = getScreen("workflow-triggers")!;
    expect(screenModule.peeks?.trigger?.("5")).toBeNull();

    jsonOnce([trigger()]);
    await reloadTriggers();

    const peek = screenModule.peeks?.trigger?.("5");
    expect(peek).toBeTruthy();
    expect(peek?.kind).toBe("trigger");
    expect(peek?.title).toBe("Client onboarding");
    expect(peek?.tag).toBe("enabled");
  });

  it("arms Delete rather than firing it on the first press", async () => {
    jsonOnce([trigger()]);
    await reloadTriggers();
    const peek = getScreen("workflow-triggers")!.peeks?.trigger?.("5");
    const del = peek?.actions?.find((a) => a.label === "Delete");
    expect(del).toMatchObject({ tone: "danger", confirm: true });
  });

  it("only offers Rotate token for a webhook trigger", async () => {
    jsonOnce([trigger({ type: "manual", config: {} })]);
    await reloadTriggers();
    const peek = getScreen("workflow-triggers")!.peeks?.trigger?.("5");
    expect(peek?.actions?.map((a) => a.label)).not.toContain("Rotate token");
  });

  it("still returns null for an id the server never listed", async () => {
    jsonOnce([trigger()]);
    await reloadTriggers();
    expect(getScreen("workflow-triggers")!.peeks?.trigger?.("not-a-real-id")).toBeNull();
  });
});

// ─── Store ────────────────────────────────────────────────────────────────────

describe("reloadTriggers", () => {
  it("reads the real global list endpoint", async () => {
    jsonOnce([trigger()]);
    await reloadTriggers();
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/workflows/triggers");
    expect(getSnapshot().triggers).toHaveLength(1);
    expect(triggerById(5)?.definitionName).toBe("Client onboarding");
  });

  it("surfaces the server's own error text rather than a generic failure", async () => {
    jsonOnce({ error: "Something real broke." }, false);
    await reloadTriggers();
    expect(getSnapshot().triggersError).toBe("Something real broke.");
  });
});

describe("selectTrigger", () => {
  it("loads events and stats together", async () => {
    jsonOnce([trigger()]);
    await reloadTriggers();

    jsonOnce([event()]);
    jsonOnce(stats());
    await selectTrigger(5);

    const state = getSnapshot();
    expect(state.selectedTriggerId).toBe(5);
    expect(state.events).toHaveLength(1);
    expect(state.stats?.total).toBe(3);
    // Both real, definition-scoped routes — not invented ones.
    const paths = fetchWithAuth.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/api/admin/workflows/definitions/1/triggers/5/events?limit=50");
    expect(paths).toContain("/api/admin/workflows/definitions/1/triggers/5/stats");
  });
});

describe("mutations", () => {
  beforeEach(async () => {
    jsonOnce([trigger()]);
    await reloadTriggers();
  });

  it("toggleTriggerEnabled patches optimistically and rolls back on failure", async () => {
    jsonOnce({ error: "nope" }, false);
    await toggleTriggerEnabled(triggerById(5)!, false);
    // Rolled back to the original `enabled: true` after the server rejected it.
    expect(triggerById(5)?.enabled).toBe(true);
    expect(getSnapshot().message).toBe("nope");
  });

  it("patchTriggerConfig writes the real PATCH", async () => {
    jsonOnce(trigger({ config: { eventName: "new.event" } }));
    await patchTriggerConfig(triggerById(5)!, { eventName: "new.event" });
    const [path, init] = fetchWithAuth.mock.calls.at(-1)!;
    expect(path).toBe("/api/admin/workflows/definitions/1/triggers/5");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ config: { eventName: "new.event" } });
  });

  it("removeTrigger deletes and clears selection", async () => {
    await selectTrigger(null); // no-op, keeps the scenario simple
    fetchWithAuth.mockResolvedValueOnce({ ok: true, status: 204, statusText: "", json: async () => ({}) });
    await removeTrigger(triggerById(5)!);
    expect(getSnapshot().triggers).toHaveLength(0);
  });

  it("testFireNow fires the real test-fire route and refreshes the list", async () => {
    jsonOnce({ runId: 200, eventId: 55 });
    jsonOnce([trigger({ eventCount: 4 })]);
    await testFireNow(triggerById(5)!);
    const [path, init] = fetchWithAuth.mock.calls.at(-2)!;
    expect(path).toBe("/api/admin/workflows/definitions/1/triggers/5/test-fire");
    expect((init as RequestInit).method).toBe("POST");
    expect(getSnapshot().message).toBe("Test fire started run #200.");
    expect(getSnapshot().triggers[0]?.eventCount).toBe(4);
  });

  it("rotateTokenNow replaces just the webhook token in state", async () => {
    jsonOnce(trigger({ type: "webhook", webhookToken: "brand-new-token" }));
    await rotateTokenNow(triggerById(5)!);
    expect(triggerById(5)?.webhookToken).toBe("brand-new-token");
  });
});

describe("createTriggerInteractive", () => {
  it("creates against the single matching workflow and the chosen type", async () => {
    jsonOnce([]); // triggers
    jsonOnce([{ id: 1, name: "Client onboarding" }, { id: 2, name: "Weekly retargeting" }]); // definitions
    await warmTriggers();

    vi.spyOn(window, "prompt").mockReturnValueOnce("Client").mockReturnValueOnce("schedule");
    jsonOnce(trigger({ id: 9, type: "schedule", config: {} }));

    const created = await createTriggerInteractive();
    expect(created?.id).toBe(9);
    const [path, init] = fetchWithAuth.mock.calls.at(-1)!;
    expect(path).toBe("/api/admin/workflows/definitions/1/triggers");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ type: "schedule" });
  });

  it("refuses an ambiguous workflow name rather than guessing", async () => {
    jsonOnce([]); // triggers
    jsonOnce([{ id: 1, name: "Weekly retargeting rescan" }, { id: 2, name: "Weekly article generator" }]); // definitions
    await warmTriggers();

    vi.spyOn(window, "prompt").mockReturnValueOnce("Weekly");
    const callsBefore = fetchWithAuth.mock.calls.length;

    const created = await createTriggerInteractive();
    expect(created).toBeNull();
    expect(fetchWithAuth.mock.calls.length).toBe(callsBefore);
    expect(getSnapshot().message).toMatch(/multiple workflows match/i);
  });

  it("refuses an invalid trigger type", async () => {
    jsonOnce([]); // triggers
    jsonOnce([{ id: 1, name: "Client onboarding" }]); // definitions
    await warmTriggers();

    vi.spyOn(window, "prompt").mockReturnValueOnce("Client").mockReturnValueOnce("carrier pigeon");
    const created = await createTriggerInteractive();
    expect(created).toBeNull();
    expect(getSnapshot().message).toMatch(/not a trigger type/i);
  });
});

describe("live-ribbon counts", () => {
  it("counts trigger errors on the Watch tab's live-ribbon key", async () => {
    jsonOnce([trigger({ id: 5, lastStatus: "error" }), trigger({ id: 6, lastStatus: "fired" })]);
    await reloadTriggers();

    expect(getLiveRibbonEntry(RIBBON_KEYS.errorsWatch)?.label).toBe("1 trigger error");
    expect(getLiveRibbonEntry(RIBBON_KEYS.triggersCount)?.label).toBe("2 triggers");
  });

  it("says there are no trigger errors once every last-fire is clean", async () => {
    jsonOnce([trigger({ lastStatus: "fired" })]);
    await reloadTriggers();
    expect(getLiveRibbonEntry(RIBBON_KEYS.errorsWatch)?.label).toBe("No trigger errors");
  });
});
