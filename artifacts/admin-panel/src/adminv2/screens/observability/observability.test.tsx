// @vitest-environment jsdom
/**
 * The Observability screen's contract + interaction coverage: registration
 * legality, the store's four real reads and its writes, the health rollup the
 * Watch tab depends on, the peek resolvers, and the honest gaps (a dead-letter
 * job nothing can re-run must not offer a Retry; suppressing must not fire
 * without a reason). `Shell.test.tsx` already covers shell-chrome integration
 * against a demo screen.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getScreen, resetRegistry } from "../../registry/registry";
import type { ScreenModule } from "../../registry/types";
import { ObservabilityBody } from "./ObservabilityBody";
import { codeFrameLines, whenLabel } from "./observabilityFormat";
import {
  configureObservabilityFetch,
  getSnapshot,
  health,
  loadDlq,
  loadExceptions,
  loadIncidents,
  loadRules,
  openView,
  resetObservabilityStore,
  retryAllDlq,
  suppressExceptionGroup,
} from "./observabilityStore";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

/** The store's fetch layer reads `res.text()`, not `res.json()` — see observabilityApi.ts. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => JSON.stringify(body),
  } as Response;
}

const RULE = {
  id: 1,
  ruleKey: "dlq_backlog",
  label: "Dead-letter backlog",
  description: "Failed background jobs piling up unresolved.",
  conditionType: "dlq_backlog",
  threshold: 10,
  windowMinutes: 15,
  severity: "critical",
  enabled: true,
  deliveryEmail: true,
  deliveryPush: true,
  cooldownMinutes: 60,
  deepLinkPath: "/system/dlq",
  updatedAt: "2026-08-08T08:00:00.000Z",
};

const EVENT = {
  id: 41,
  alertEventId: "ae-41",
  ruleId: 1,
  ruleKey: "dlq_backlog",
  ruleLabel: "Dead-letter backlog",
  conditionType: "dlq_backlog",
  severity: "critical",
  conditionValue: 14,
  summary: "Dead-letter backlog crossed 10 (14 unresolved)",
  deepLinkPath: "/system/dlq",
  mspId: null,
  deliveredEmail: true,
  deliveredPush: true,
  resolvedAt: null,
  resolvedBy: null,
  firedAt: "2026-08-08T08:52:00.000Z",
};

const GROUP = {
  fingerprint: "fp-1",
  errorName: "TypeError",
  errorMessage: "Cannot read properties of undefined (reading 'tenantId')",
  file: "server/engines/drift.ts",
  line: 214,
  functionName: "computeDrift",
  codeFrame: "213   const tenant = scope.tenant;\n214 > return tenant.tenantId;",
  stackSample: "at computeDrift (server/engines/drift.ts:214:18)",
  channel: "engine",
  source: "caught",
  status: "open",
  occurrenceCount: 47,
  firstSeenAt: "2026-08-03T09:00:00.000Z",
  lastSeenAt: "2026-08-08T09:04:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  suppressedAt: null,
  suppressedBy: null,
  suppressionReason: null,
};

const INCIDENT = {
  id: 7,
  title: "Delayed tenant scans",
  description: "Scans queued behind a backlog of failed jobs.",
  severity: "major",
  status: "monitoring",
  startedAt: "2026-08-08T09:10:00.000Z",
  resolvedAt: null,
  createdAt: "2026-08-08T09:10:00.000Z",
  updatedAt: "2026-08-08T09:40:00.000Z",
};

const REPLAYABLE = {
  id: 1,
  dlqId: "d-1",
  sourceEventId: null,
  eventType: "portal_wf.run.failed:onboarding",
  payload: { workflowKey: "onboarding" },
  errorMessage: "Step 3 threw",
  errorStack: null,
  attemptCount: 3,
  lastAttemptAt: "2026-08-08T09:04:00.000Z",
  resolvedAt: null,
  resolution: null,
  mspId: null,
  customerId: 4,
  createdAt: "2026-08-08T09:04:00.000Z",
  customerName: "Northwind Traders",
  replayable: true,
};

const NOT_REPLAYABLE = {
  ...REPLAYABLE,
  id: 2,
  dlqId: "d-2",
  eventType: "graph.sync.users",
  payload: { scope: "users" },
  errorMessage: "GraphError 429 throttled",
  attemptCount: 5,
  customerName: "Adventure Works",
  replayable: false,
};

/** Answers every one of the four warm reads with the fixtures above. */
function stubAllRoutes(overrides: { dlq?: unknown[]; dlqTotal?: number } = {}) {
  fetchWithAuth.mockImplementation((path: string) => {
    if (path.startsWith("/api/admin/observability/alert-rules"))
      return Promise.resolve(jsonResponse({ rules: [RULE] }));
    if (path.startsWith("/api/admin/observability/alert-events"))
      return Promise.resolve(jsonResponse({ events: [EVENT] }));
    if (path.startsWith("/api/admin/exceptions/"))
      return Promise.resolve(jsonResponse({ group: GROUP, occurrences: [] }));
    if (path.startsWith("/api/admin/exceptions"))
      return Promise.resolve(jsonResponse({ groups: [GROUP] }));
    if (path.startsWith("/api/admin/incidents"))
      return Promise.resolve(jsonResponse([INCIDENT]));
    if (path.startsWith("/api/admin/dlq"))
      return Promise.resolve(
        jsonResponse({
          items: overrides.dlq ?? [REPLAYABLE, NOT_REPLAYABLE],
          unresolvedTotal: overrides.dlqTotal ?? 2,
          limit: 100,
        }),
      );
    return Promise.resolve(jsonResponse({}, false, 404));
  });
}

let obsScreen: ScreenModule;

beforeAll(async () => {
  resetRegistry();
  // One import for the whole file: ESM caches the module, so a second
  // resetRegistry() + re-import would wipe the map without re-running
  // registerScreen(). Same reasoning as crm.test.tsx.
  await import("./index");
  obsScreen = getScreen("observability")!;
});

beforeEach(() => {
  fetchWithAuth.mockReset();
  resetObservabilityStore();
  configureObservabilityFetch(fetchWithAuth);
});

afterEach(cleanup);

// ── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers against the fixed watch tab only, and never puts a record command there", () => {
    expect(obsScreen).toBeTruthy();
    expect(obsScreen.route).toBe("/observability");
    expect(new Set(obsScreen.ribbon?.map((r) => r.tab))).toEqual(new Set(["watch"]));

    const commands = (obsScreen.ribbon ?? []).flatMap((r) => [
      ...(r.group.large ?? []),
      ...(r.group.small ?? []),
      ...(r.group.row ?? []),
    ]);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((c) => c.intent === "open" || c.intent === "create" || c.intent === "global")).toBe(true);
  });

  it("owns the four record kinds it introduced", () => {
    expect(Object.keys(obsScreen.peeks ?? {}).sort()).toEqual(["alert", "dlq", "exception", "incident"]);
  });

  it("hides Observe Tools until one of its own records is open, and only puts record intents on it", () => {
    const spec = typeof obsScreen.contextualTab === "function" ? obsScreen.contextualTab : null;
    expect(spec).toBeTruthy();
    expect(spec!({})).toBeNull();
    // A record of a kind this screen does not own must not summon its tab.
    expect(spec!({ recordId: "l1", kind: "lead" })).toBeNull();

    const tab = spec!({ recordId: "1", kind: "alert" });
    expect(tab?.label).toBe("Observe Tools");
    const commands = (tab?.groups ?? []).flatMap((g) => [...(g.large ?? []), ...(g.small ?? [])]);
    expect(commands.every((c) => c.intent === "record")).toBe(true);
  });

  it("does not hand-author a Back group — the shell splices one in", () => {
    const spec = typeof obsScreen.contextualTab === "function" ? obsScreen.contextualTab : null;
    const tab = spec!({ recordId: "1", kind: "alert" });
    expect((tab?.groups ?? []).some((g) => g.label.toLowerCase().includes("back"))).toBe(false);
  });
});

// ── Store reads ──────────────────────────────────────────────────────────────

describe("store reads", () => {
  it("loads all four surfaces from their real admin routes", async () => {
    stubAllRoutes();
    await Promise.all([loadRules(), loadExceptions(), loadIncidents(), loadDlq()]);

    const s = getSnapshot();
    expect(s.rules).toHaveLength(1);
    expect(s.events).toHaveLength(1);
    expect(s.exceptions).toHaveLength(1);
    expect(s.incidents).toHaveLength(1);
    expect(s.dlq).toHaveLength(2);
    // Selection defaults to the first row of each, so no view opens empty.
    expect(s.selectedRuleId).toBe(1);
    expect(s.selectedFingerprint).toBe("fp-1");
    expect(s.selectedIncidentId).toBe(7);
    expect(s.selectedDlqId).toBe("d-1");
  });

  it("asks for every exception status, so a suppressed group stays reachable", async () => {
    stubAllRoutes();
    await loadExceptions();
    const call = fetchWithAuth.mock.calls.find((c: unknown[]) => String(c[0]).startsWith("/api/admin/exceptions?"));
    expect(String(call?.[0])).toContain("status=all");
  });

  it("surfaces a failed read instead of showing an empty, healthy-looking list", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ error: "Failed to list exception groups" }, false, 500));
    await loadExceptions();
    expect(getSnapshot().exceptionsError).toBe("Failed to list exception groups");
  });
});

// ── The health rollup ────────────────────────────────────────────────────────

describe("health", () => {
  it("counts what actually needs you", async () => {
    stubAllRoutes();
    await Promise.all([loadRules(), loadExceptions(), loadIncidents(), loadDlq()]);

    const h = health(getSnapshot());
    expect(h.firing).toHaveLength(1);
    expect(h.openExceptions).toHaveLength(1);
    expect(h.stuck).toHaveLength(2);
    expect(h.liveIncidents).toHaveLength(1);
    expect(h.bad).toBe(true);
    expect(h.headline).toBe("Something needs you");
  });

  it("reports the real queue length, not the page it happens to have loaded", async () => {
    stubAllRoutes({ dlq: [REPLAYABLE], dlqTotal: 214 });
    await loadDlq();
    // One row loaded, 214 stuck. The Watch count must say 214.
    expect(health(getSnapshot()).total).toBe(214);
  });

  it("says all quiet only when every surface really is", () => {
    const h = health(getSnapshot());
    expect(h.bad).toBe(false);
    expect(h.warn).toBe(false);
    expect(h.headline).toBe("All quiet");
    expect(h.total).toBe(0);
  });
});

// ── Writes ───────────────────────────────────────────────────────────────────

describe("writes", () => {
  it("sends a suppression reason, which the route refuses to accept as blank", async () => {
    stubAllRoutes();
    await suppressExceptionGroup("fp-1", "Known third-party throttle");

    const call = fetchWithAuth.mock.calls.find((c: unknown[]) => String(c[0]).includes("/suppress"));
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ reason: "Known third-party throttle" });
  });

  it("retries only the jobs something knows how to re-run", async () => {
    stubAllRoutes();
    await loadDlq();
    fetchWithAuth.mockClear();
    stubAllRoutes();

    await retryAllDlq();

    const replays = fetchWithAuth.mock.calls.filter((c: unknown[]) => String(c[0]).includes("/replay"));
    expect(replays).toHaveLength(1);
    expect(String(replays[0]![0])).toContain("d-1");
  });

  it("says so rather than silently doing nothing when no job can be re-run", async () => {
    stubAllRoutes({ dlq: [NOT_REPLAYABLE], dlqTotal: 1 });
    await loadDlq();
    fetchWithAuth.mockClear();

    await retryAllDlq();

    expect(fetchWithAuth.mock.calls.filter((c: unknown[]) => String(c[0]).includes("/replay"))).toHaveLength(0);
    expect(getSnapshot().said).toMatch(/nothing here can be re-run/i);
  });
});

// ── Peeks ────────────────────────────────────────────────────────────────────

describe("peeks", () => {
  beforeEach(async () => {
    stubAllRoutes();
    await Promise.all([loadRules(), loadExceptions(), loadIncidents(), loadDlq()]);
  });

  it("returns null for an id it does not hold, so another screen can answer", () => {
    expect(obsScreen.peeks!.alert!("999")).toBeNull();
    expect(obsScreen.peeks!.exception!("nope")).toBeNull();
  });

  it("resolves an alert rule with its editable firing settings", () => {
    const peek = obsScreen.peeks!.alert!("1")!;
    expect(peek.title).toBe("Dead-letter backlog");
    expect(peek.edits?.map((e) => e.key)).toContain("threshold");
    expect(peek.list?.rows).toHaveLength(1);
  });

  it("offers no Retry on a dead-letter job nothing can re-run", () => {
    const cannot = obsScreen.peeks!.dlq!("d-2")!;
    expect(cannot.actions?.map((a) => a.label)).not.toContain("Retry");

    const can = obsScreen.peeks!.dlq!("d-1")!;
    expect(can.actions?.map((a) => a.label)).toContain("Retry");
  });

  it("arms Discard rather than firing it, because there is no undo", () => {
    const peek = obsScreen.peeks!.dlq!("d-1")!;
    expect(peek.actions?.find((a) => a.label === "Discard")?.confirm).toBe(true);
  });

  it("routes an exception's suppression to the screen, which is the only place a reason can be typed", () => {
    const peek = obsScreen.peeks!.exception!("fp-1")!;
    expect(peek.actions?.map((a) => a.label)).not.toContain("Suppress");
    expect(peek.openLabel).toMatch(/suppress/i);
  });
});

// ── Palette ──────────────────────────────────────────────────────────────────

describe("palette", () => {
  it("answers with live numbers and lists every record as its own kind", async () => {
    stubAllRoutes();
    await Promise.all([loadRules(), loadExceptions(), loadIncidents(), loadDlq()]);

    const items = obsScreen.commands!();
    const stuck = items.find((i) => i.id === "ans:obs-stuck-jobs");
    expect(stuck?.type).toBe("answer");
    expect(stuck?.live).toBe("2");

    const kinds = new Set(items.filter((i) => i.type === "record").map((i) => i.kind));
    expect(kinds).toEqual(new Set(["alert", "exception", "incident", "dlq"]));
  });
});

// ── Body ─────────────────────────────────────────────────────────────────────

describe("body", () => {
  it("renders each view against real rows", async () => {
    stubAllRoutes();
    render(<ObservabilityBody />);

    await waitFor(() => expect(screen.getAllByText("Dead-letter backlog").length).toBeGreaterThan(0));
    expect(screen.getByText(/above 10 in 15 min/)).toBeTruthy();

    fireEvent.click(screen.getByText("Exceptions"));
    await waitFor(() => expect(screen.getAllByText("TypeError").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText("Incidents"));
    await waitFor(() => expect(screen.getByText("Delayed tenant scans")).toBeTruthy());

    fireEvent.click(screen.getByText("Dead letters"));
    await waitFor(() => expect(screen.getAllByText("portal_wf.run.failed:onboarding").length).toBeGreaterThan(0));
  });

  it("states what cannot be re-run instead of offering a Retry that would fail", async () => {
    stubAllRoutes({ dlq: [NOT_REPLAYABLE], dlqTotal: 1 });
    render(<ObservabilityBody />);
    openView("dlq");

    await waitFor(() => expect(screen.getAllByText("graph.sync.users").length).toBeGreaterThan(0));
    expect(screen.getByText(/only workflow runs can be replayed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("will not suppress an exception until a reason has been typed", async () => {
    stubAllRoutes();
    render(<ObservabilityBody />);
    openView("exceptions");

    await waitFor(() => expect(screen.getAllByText("TypeError").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Suppress" }));

    const confirm = screen.getByRole("button", { name: "Suppress it" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/known third-party throttle/i), {
      target: { value: "Known throttle" },
    });
    expect((screen.getByRole("button", { name: "Suppress it" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says how much of the queue it is showing rather than passing a page off as the whole thing", async () => {
    stubAllRoutes({ dlq: [REPLAYABLE], dlqTotal: 214 });
    render(<ObservabilityBody />);
    openView("dlq");

    await waitFor(() => expect(screen.getByText("Showing 1 of 214 stuck jobs.")).toBeTruthy());
  });

  it("empty states say what the emptiness means", async () => {
    stubAllRoutes({ dlq: [], dlqTotal: 0 });
    render(<ObservabilityBody />);
    openView("dlq");

    await waitFor(() =>
      expect(screen.getByText(/Every job that failed has been dealt with/i)).toBeTruthy(),
    );
  });
});

// ── Formatting ───────────────────────────────────────────────────────────────

describe("format", () => {
  const now = new Date("2026-08-08T12:00:00");

  it("uses the design's own time vocabulary", () => {
    expect(whenLabel("2026-08-08T08:52:00", now)).toBe("today 08:52");
    expect(whenLabel("2026-08-07T16:30:00", now)).toBe("yesterday 16:30");
    expect(whenLabel("2026-08-05T11:20:00", now)).toBe("Aug 5 11:20");
    expect(whenLabel(null, now)).toBe("never");
  });

  it("marks the throwing line of a code frame and nothing else", () => {
    const lines = codeFrameLines(GROUP.codeFrame);
    expect(lines.map((l) => l.hit)).toEqual([false, true]);
    // A frame is null whenever code frames are off or the file was unreadable.
    expect(codeFrameLines(null)).toEqual([]);
  });
});
