// @vitest-environment jsdom
/**
 * The Workflow Builder screen's own contract coverage. `Shell.test.tsx`
 * already covers shell-chrome integration; this file covers what is
 * specific to this screen:
 *
 *  - registration legality on the fixed `home`/`watch` tabs (open/create/
 *    global only — running, publishing and duplicating a specific
 *    definition are contextual-only).
 *  - the contextual tab not hand-authoring a Back group.
 *  - the `workflow` and `workflowRun` peeks resolving null before their
 *    lists load and a real model after, with Delete armed on `workflow`.
 *  - the store: loading definitions, selecting one (which loads its
 *    versions/triggers/runs and picks the published-or-latest version's
 *    graph), editing the canvas client-side, saving (including the
 *    auto-draft-from-published case the server can return), publishing,
 *    running, trigger CRUD, and the "pending approvals" live-ribbon count.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScreen, resetRegistry } from "../../registry/registry";
import { getLiveRibbonEntry } from "../../shell/liveRibbon";
import {
  addTrigger,
  cancelRunNow,
  clearRunDetail,
  configureWorkflowFetch,
  definitionById,
  deleteNode,
  duplicateNode,
  getSnapshot,
  publishCurrentVersion,
  reloadDefinitions,
  removeTrigger,
  rerunNow,
  resetWorkflowStore,
  runNow,
  saveGraph,
  selectDefinition,
  selectRunDetail,
  setGraph,
  toggleTrigger,
  warmWorkflows,
  RIBBON_KEYS,
} from "./workflowStore";
import type { DefinitionRow, RunDetail, RunRow, TriggerRow, VersionRow } from "./workflowTypes";

const fetchWithAuth = vi.fn();

function definition(overrides: Partial<DefinitionRow> = {}): DefinitionRow {
  return {
    id: 1,
    name: "Client onboarding",
    description: "Runs after a SOW is signed.",
    concurrencyLimit: 5,
    maxRunDepth: 5,
    metadata: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    publishedVersionLabel: "v3",
    publishedVersionNumber: 3,
    triggerCount: 1,
    triggerTypes: ["event"],
    triggerEventNames: ["fulfillment.assessment"],
    lastRunStatus: "completed",
    lastRunAt: "2026-08-08T00:00:00.000Z",
    askForInputFields: null,
    ...overrides,
  };
}

function version(overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    id: 10,
    definitionId: 1,
    versionNumber: 3,
    label: "v3",
    status: "published",
    graph: { nodes: [{ id: "node-1", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "Start" } }], edges: [] },
    isDefault: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    runCount: 4,
    ...overrides,
  };
}

function trigger(overrides: Partial<TriggerRow> = {}): TriggerRow {
  return {
    id: 5,
    definitionId: 1,
    type: "event",
    config: { eventName: "fulfillment.assessment" },
    webhookToken: null,
    nextRunAt: null,
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 100,
    definitionId: 1,
    definitionName: "Client onboarding",
    versionId: 10,
    versionLabel: "v3",
    triggerType: "manual",
    triggerRef: "admin:manual",
    status: "completed",
    payload: {},
    branchPath: null,
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:00:05.000Z",
    errorMessage: null,
    durationMs: 5000,
    isSystem: false,
    createdAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function runDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    ...run(),
    graph: { nodes: [{ id: "node-1", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "Start" } }], edges: [] },
    logs: [],
    nodeOutputs: [],
    nodeResultMap: {},
    activeNodeId: null,
    ...overrides,
  };
}

function jsonOnce(body: unknown, ok = true) {
  fetchWithAuth.mockResolvedValueOnce({ ok, status: ok ? 200 : 400, statusText: "", json: async () => body });
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetWorkflowStore();
  configureWorkflowFetch(fetchWithAuth);
});

afterEach(() => {
  resetWorkflowStore();
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers on home + watch without violating the open/create/global rule", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's registry imports must resolve against
    // the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("workflows");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/workflows");
    expect(new Set(screenModule?.ribbon?.map((r) => r.tab))).toEqual(new Set(["home", "watch"]));

    const fixedCommands = (screenModule?.ribbon ?? []).flatMap((r) => [...(r.group.large ?? []), ...(r.group.small ?? []), ...(r.group.row ?? [])]);
    expect(fixedCommands.length).toBeGreaterThan(0);
    for (const cmd of fixedCommands) {
      expect(["open", "create", "global"]).toContain(cmd.intent);
    }
  });

  it("does not hand-author a Back group on its contextual tab", async () => {
    const screenModule = getScreen("workflows")!;
    jsonOnce([definition()]);
    await reloadDefinitions();

    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "1", kind: "workflow" }) : screenModule.contextualTab;
    expect(spec?.id).toBe("workflow-tools");
    // The shell splices Back in at position 2 for every contextual tab in
    // the app; a hand-authored one would produce two, in different places.
    expect(spec?.groups.map((g) => g.label)).not.toContain("Back");
    // Every contextual command needs a specific definition open — legal only here.
    const contextualCommands = spec?.groups.flatMap((g) => [...(g.large ?? []), ...(g.small ?? []), ...(g.row ?? [])]) ?? [];
    expect(contextualCommands.length).toBeGreaterThan(0);
    for (const cmd of contextualCommands) expect(cmd.intent).toBe("record");
  });

  it("returns null for a contextual tab request on a kind it does not own", () => {
    const screenModule = getScreen("workflows")!;
    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "1", kind: "service" }) : screenModule.contextualTab;
    expect(spec).toBeNull();
  });
});

// ─── Peeks ─────────────────────────────────────────────────────────────────────

describe("peeks.workflow", () => {
  it("resolves null before the list loads, and a real model after", async () => {
    const screenModule = getScreen("workflows")!;
    expect(screenModule.peeks?.workflow?.("1")).toBeNull();

    jsonOnce([definition()]);
    await reloadDefinitions();

    const peek = screenModule.peeks?.workflow?.("1");
    expect(peek).toBeTruthy();
    expect(peek?.kind).toBe("workflow");
    expect(peek?.title).toBe("Client onboarding");
    expect(peek?.tag).toBe("v3");
    expect(peek?.facts?.find((f) => f.label === "Triggers")?.value).toBe("1");
  });

  it("arms Delete rather than firing it on the first press", async () => {
    jsonOnce([definition()]);
    await reloadDefinitions();
    const peek = getScreen("workflows")!.peeks?.workflow?.("1");
    const del = peek?.actions?.find((a) => a.label === "Delete");
    expect(del).toMatchObject({ tone: "danger", confirm: true });
  });

  it("still returns null for an id the server never listed", async () => {
    jsonOnce([definition()]);
    await reloadDefinitions();
    expect(getScreen("workflows")!.peeks?.workflow?.("not-a-real-id")).toBeNull();
  });
});

describe("peeks.workflowRun", () => {
  it("resolves null before any run has loaded, and a real model once warmed", async () => {
    const screenModule = getScreen("workflows")!;
    expect(screenModule.peeks?.workflowRun?.("100")).toBeNull();

    jsonOnce([]); // definitions
    jsonOnce([]); // pending approvals
    jsonOnce({ runs: [run()], total: 1 }); // recent runs
    await warmWorkflows();

    const peek = screenModule.peeks?.workflowRun?.("100");
    expect(peek).toBeTruthy();
    expect(peek?.kind).toBe("workflowRun");
    expect(peek?.title).toBe("Client onboarding");
    expect(peek?.tag).toBe("Completed");
  });

  it("offers Approve/Reject only when the run is actually paused at an approval gate", async () => {
    jsonOnce([]);
    jsonOnce([{ id: 9, runId: 100, nodeId: "node-3", approverRole: "admin", mspId: null, status: "pending", context: {}, definitionName: "Client onboarding", createdAt: "2026-08-08T00:00:00.000Z" }]);
    jsonOnce({ runs: [run({ status: "awaiting_approval" })], total: 1 });
    await warmWorkflows();

    const peek = getScreen("workflows")!.peeks?.workflowRun?.("100");
    expect(peek?.actions?.map((a) => a.label)).toEqual(["Approve", "Reject"]);
  });

  it("opens the run's own detail doc, not the definition's canvas", async () => {
    jsonOnce([]);
    jsonOnce([]);
    jsonOnce({ runs: [run()], total: 1 });
    await warmWorkflows();

    const peek = getScreen("workflows")!.peeks?.workflowRun?.("100");
    expect(peek?.openLabel).toBe("Open the run");
  });
});

// ─── Store ────────────────────────────────────────────────────────────────────

describe("reloadDefinitions", () => {
  it("reads the real list endpoint", async () => {
    jsonOnce([definition()]);
    await reloadDefinitions();
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/workflows/definitions");
    expect(getSnapshot().definitions).toHaveLength(1);
    expect(definitionById(1)?.name).toBe("Client onboarding");
  });

  it("surfaces the server's own error text rather than a generic failure", async () => {
    jsonOnce({ error: "Something real broke." }, false);
    await reloadDefinitions();
    expect(getSnapshot().definitionsError).toBe("Something real broke.");
  });
});

describe("selectDefinition", () => {
  it("loads versions/triggers/runs and opens the published-or-latest version's graph", async () => {
    jsonOnce([version({ status: "draft", id: 11, versionNumber: 4, label: "v4 — Draft" }), version()]); // versions
    jsonOnce([trigger()]); // triggers
    jsonOnce({ runs: [run()], total: 1 }); // definition runs

    await selectDefinition(1);

    const state = getSnapshot();
    expect(state.selectedDefinitionId).toBe(1);
    expect(state.versions).toHaveLength(2);
    // The published version (id 10), not the newer draft (id 11), is the one opened.
    expect(state.selectedVersionId).toBe(10);
    expect(state.graph?.nodes[0]?.id).toBe("node-1");
    expect(state.triggers).toHaveLength(1);
    expect(state.definitionRuns).toHaveLength(1);
  });
});

describe("canvas editing", () => {
  beforeEach(async () => {
    jsonOnce([version()]);
    jsonOnce([]);
    jsonOnce({ runs: [], total: 0 });
    await selectDefinition(1);
  });

  it("setGraph marks the store dirty without touching the server", () => {
    const callsBeforeEdit = fetchWithAuth.mock.calls.length;
    setGraph([{ id: "node-1", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "Start" } }, { id: "node-101", type: "action", position: { x: 0, y: 100 }, data: { nodeType: "action", label: "New step" } }], []);
    expect(getSnapshot().dirty).toBe(true);
    expect(getSnapshot().graph?.nodes).toHaveLength(2);
    expect(fetchWithAuth.mock.calls.length).toBe(callsBeforeEdit);
  });

  it("duplicateNode clones with a fresh id and an offset position", () => {
    duplicateNode("node-1");
    const nodes = getSnapshot().graph?.nodes ?? [];
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.id).not.toBe("node-1");
    expect(nodes[1]?.position).toEqual({ x: 40, y: 40 });
  });

  it("deleteNode refuses to remove the Start node", () => {
    deleteNode("node-1");
    expect(getSnapshot().graph?.nodes).toHaveLength(1);
  });

  it("saveGraph writes the real PUT and clears dirty", async () => {
    setGraph([{ id: "node-1", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "Start" } }], []);
    jsonOnce(version({ label: "v3" }));
    jsonOnce([version()]); // versions re-read after save

    await saveGraph();

    const [path, init] = fetchWithAuth.mock.calls.at(-2)!;
    expect(path).toBe("/api/admin/workflows/definitions/1/versions/10");
    expect((init as RequestInit).method).toBe("PUT");
    expect(getSnapshot().dirty).toBe(false);
  });

  it("saveGraph over a published version follows the server's auto-draft response", async () => {
    setGraph([{ id: "node-1", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "Start" } }], []);
    jsonOnce({ ...version({ id: 12, versionNumber: 4, status: "draft", label: "v4 — Draft (from v3)" }), autoDraftedFrom: 10 });
    jsonOnce([version({ id: 12, versionNumber: 4, status: "draft" }), version()]);

    await saveGraph();

    expect(getSnapshot().selectedVersionId).toBe(12);
    expect(getSnapshot().message).toMatch(/new draft/i);
  });
});

describe("publishCurrentVersion", () => {
  it("publishes the open version and re-reads definitions", async () => {
    jsonOnce([version({ status: "draft" })]);
    jsonOnce([]);
    jsonOnce({ runs: [], total: 0 });
    await selectDefinition(1);

    jsonOnce(version({ status: "published" }));
    jsonOnce([version({ status: "published" })]);
    jsonOnce([definition()]);

    await publishCurrentVersion();

    // The publish POST fires before the two post-publish reloads
    // (`reloadVersionsQuiet` + `reloadDefinitions`), which run in parallel.
    const [path] = fetchWithAuth.mock.calls.at(-3)!;
    expect(path).toBe("/api/admin/workflows/definitions/1/versions/10/publish");
    expect(getSnapshot().message).toMatch(/published/i);
  });
});

describe("runNow", () => {
  it("fires the real run endpoint and refreshes runs", async () => {
    jsonOnce({ runId: 200 });
    jsonOnce({ runs: [], total: 0 });

    await runNow(1);

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/workflows/definitions/1/run");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({});
    expect(getSnapshot().message).toBe("Run started — #200.");
  });
});

describe("triggers", () => {
  it("addTrigger posts the real create call and appends the row", async () => {
    jsonOnce(trigger({ id: 6, type: "schedule", config: {} }));
    jsonOnce([definition()]);

    await addTrigger(1, "schedule");

    const [path, init] = fetchWithAuth.mock.calls[0]!;
    expect(path).toBe("/api/admin/workflows/definitions/1/triggers");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ type: "schedule" });
    expect(getSnapshot().triggers.map((t) => t.id)).toContain(6);
  });

  it("toggleTrigger patches optimistically", async () => {
    getSnapshot(); // baseline
    jsonOnce([version()]);
    jsonOnce([trigger()]);
    jsonOnce({ runs: [], total: 0 });
    await selectDefinition(1);

    jsonOnce(trigger({ enabled: false }));
    await toggleTrigger(1, 5, false);

    expect(getSnapshot().triggers.find((t) => t.id === 5)?.enabled).toBe(false);
  });

  it("removeTrigger deletes and re-reads definitions", async () => {
    jsonOnce([version()]);
    jsonOnce([trigger()]);
    jsonOnce({ runs: [], total: 0 });
    await selectDefinition(1);

    fetchWithAuth.mockResolvedValueOnce({ ok: true, status: 204, statusText: "", json: async () => ({}) });
    jsonOnce([definition({ triggerCount: 0 })]);

    await removeTrigger(1, 5);
    expect(getSnapshot().triggers).toHaveLength(0);
  });
});

describe("pending approvals", () => {
  it("counts pending approvals on the Watch tab's live-ribbon key", async () => {
    jsonOnce([definition()]);
    jsonOnce([{ id: 1, runId: 100, nodeId: "n", approverRole: null, mspId: null, status: "pending", context: {}, definitionName: "Client onboarding", createdAt: "2026-08-08T00:00:00.000Z" }]);
    jsonOnce({ runs: [], total: 0 });

    await warmWorkflows();

    expect(getLiveRibbonEntry(RIBBON_KEYS.pendingApprovalsWatch)?.label).toBe("1 waiting on you");
  });

  it("says nothing is waiting once every approval is decided", async () => {
    jsonOnce([definition()]);
    jsonOnce([]);
    jsonOnce({ runs: [], total: 0 });
    await warmWorkflows();
    expect(getLiveRibbonEntry(RIBBON_KEYS.pendingApprovalsWatch)?.label).toBe("Nothing waiting");
  });
});

// ─── Run detail ─────────────────────────────────────────────────────────────

describe("selectRunDetail", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the full execution trace", async () => {
    jsonOnce(runDetail());
    await selectRunDetail(100);

    expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/workflows/runs/100");
    const state = getSnapshot();
    expect(state.selectedRunId).toBe(100);
    expect(state.runDetail?.graph?.nodes).toHaveLength(1);
    expect(state.loadingRunDetail).toBe(false);
  });

  it("is a no-op when the same run is already open", async () => {
    jsonOnce(runDetail());
    await selectRunDetail(100);
    await selectRunDetail(100);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("polls every 3s while the run is still running, and stops once it settles", async () => {
    vi.useFakeTimers();
    jsonOnce(runDetail({ status: "running" }));
    await selectRunDetail(200);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(getSnapshot().runDetail?.status).toBe("running");

    // `runOnlyPendingTimersAsync` fires exactly the one timer pending right
    // now — safe against the reschedule-a-new-timer loop this store does,
    // unlike `runAllTimersAsync` which would spin forever on it.
    jsonOnce(runDetail({ status: "running" }));
    await vi.runOnlyPendingTimersAsync();
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);

    jsonOnce(runDetail({ status: "completed" }));
    await vi.runOnlyPendingTimersAsync();
    expect(fetchWithAuth).toHaveBeenCalledTimes(3);
    expect(getSnapshot().runDetail?.status).toBe("completed");

    // Settled — no further timer was scheduled, so nothing left to run.
    await vi.runOnlyPendingTimersAsync();
    expect(fetchWithAuth).toHaveBeenCalledTimes(3);
  });

  it("clearRunDetail stops an in-flight poll", async () => {
    vi.useFakeTimers();
    jsonOnce(runDetail({ status: "pending" }));
    await selectRunDetail(300);

    clearRunDetail();
    expect(getSnapshot().runDetail).toBeNull();
    expect(getSnapshot().selectedRunId).toBeNull();

    // The pending poll was cleared — running whatever timers remain is a no-op.
    await vi.runOnlyPendingTimersAsync();
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });
});

describe("cancelRunNow / rerunNow", () => {
  it("cancelRunNow refreshes the open run's own detail", async () => {
    jsonOnce(runDetail({ status: "running" }));
    await selectRunDetail(100);

    // `Promise.all` starts `reloadRecentRuns()` before `fetchRunDetail()` —
    // the mocks must queue in the order each call actually reaches `fetch`.
    jsonOnce({ ok: true }); // POST cancel
    jsonOnce({ runs: [], total: 0 }); // reloadRecentRuns
    jsonOnce(runDetail({ status: "cancelled" })); // fetchRunDetail's refresh

    await cancelRunNow(100);

    expect(getSnapshot().runDetail?.status).toBe("cancelled");
  });

  it("rerunNow starts a new run without touching a different open run's detail", async () => {
    jsonOnce(runDetail({ id: 100, status: "failed" }));
    await selectRunDetail(100);

    jsonOnce({ runId: 999 }); // POST rerun
    jsonOnce({ runs: [], total: 0 }); // reloadRecentRuns

    await rerunNow(999);

    // 999 isn't the open run (100 is) — no third fetch for its detail.
    expect(fetchWithAuth).toHaveBeenCalledTimes(3);
    expect(getSnapshot().runDetail?.id).toBe(100);
  });
});

describe("workflowRun contextual tab", () => {
  it("offers Cancel while the run is in flight, Re-run once it has settled", async () => {
    const screenModule = getScreen("workflows")!;
    jsonOnce([]);
    jsonOnce([]);
    jsonOnce({ runs: [run({ status: "running" })], total: 1 });
    await warmWorkflows();

    const spec = typeof screenModule.contextualTab === "function" ? screenModule.contextualTab({ recordId: "100", kind: "workflowRun" }) : null;
    expect(spec?.id).toBe("workflow-run-tools");
    expect(spec?.groups.map((g) => g.label)).not.toContain("Back");
    expect(spec?.groups[0]?.large?.[0]?.label).toBe("Cancel");
  });
});
