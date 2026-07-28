// @vitest-environment jsdom
/**
 * Tests: Simulator Assessments Phase 2 (Issue #24) run wiring + Phase 3
 * (Issue #25) results/findings display in SimulatorAssessmentCanvas.tsx.
 *
 * Coverage:
 *   - Run correctly omits `packageKey` in the POST body for a fallback
 *     assessment (no dedicated package) and sends the real one for a
 *     dedicated-package assessment.
 *   - SSE event handling updates progress state correctly for a
 *     progress -> progress -> complete sequence, and separately for a
 *     progress -> error sequence.
 *   - Findings load automatically on diagnostics_complete and render
 *     re-sorted by real severity priority (critical > warning > info > ok),
 *     regardless of the API's alphabetical ordering.
 *   - Severity badges render the correct label for all 4 severity values.
 *   - Expanding a finding row shows its extractedProperties as formatted
 *     JSON via the shared JsonResponseViewer.
 *   - A past run can be picked from the dropdown (outside the live-run
 *     flow) and its findings load the same way.
 *
 * EventSource isn't implemented in jsdom, so this file installs a small
 * controllable mock on globalThis.EventSource that the component's real
 * `new EventSource(url)` call picks up, and the test drives its `onmessage`/
 * `onerror` handlers directly to simulate server-pushed events.
 *
 * fetchWithAuth is mocked as a route dispatcher (by URL/method) rather than
 * a fixed call-index queue — the component now fires an extra GET on mount
 * (the past-runs picker), so tests can't rely on call order the way the
 * original Phase 2 tests did.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

let pastRunsResponse: unknown[] = [];
let findingsResponse: { run?: unknown; findings: unknown[] } = { findings: [] };
let runStartResponse: unknown = { runId: "run-1", status: "pending" };

const fetchWithAuth = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith("/diagnostics/run") && init?.method === "POST") {
    return jsonResponse(runStartResponse);
  }
  if (url.includes("/diagnostics/runs?")) {
    return jsonResponse(pastRunsResponse);
  }
  if (/\/diagnostics\/runs\/[^/]+$/.test(url)) {
    return jsonResponse(findingsResponse);
  }
  return jsonResponse([]);
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

vi.mock("@/contexts/TestbedContext", () => ({
  useTestbedContext: () => ({ selectedCustomerId: 42 }),
}));

import { SimulatorAssessmentCanvas } from "./SimulatorAssessmentCanvas";
import type { AssessmentNode } from "./SimulatorLeftTree";

const FALLBACK_ASSESSMENT: AssessmentNode = {
  id: 1,
  name: "Free Security Snapshot",
  slug: "free-security-snapshot",
  isFreeOffering: true,
  sortOrder: 1,
  visibility: "public",
  packageKey: null,
  hasDedicatedPackage: false,
  checkKeys: null,
  checkCount: null,
};

const DEDICATED_ASSESSMENT: AssessmentNode = {
  id: 2,
  name: "Copilot Readiness Assessment",
  slug: "copilot-readiness",
  isFreeOffering: false,
  sortOrder: 2,
  visibility: "public",
  packageKey: "copilot:readiness",
  hasDedicatedPackage: true,
  checkKeys: ["identity:mfa-registration", "licensing:copilot-skus"],
  checkCount: 2,
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  fetchWithAuth.mockClear();
  pastRunsResponse = [];
  findingsResponse = { findings: [] };
  runStartResponse = { runId: "run-1", status: "pending" };
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SimulatorAssessmentCanvas — Run packageKey selection", () => {
  it("omits packageKey in the POST body for an assessment on the fallback", async () => {
    runStartResponse = { runId: "run-1", status: "pending" };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: FALLBACK_ASSESSMENT }));

    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() =>
      expect(fetchWithAuth.mock.calls.some(([url]) => url === "/api/msp/customers/42/diagnostics/run")).toBe(true),
    );
    const call = fetchWithAuth.mock.calls.find(([url]) => url === "/api/msp/customers/42/diagnostics/run")!;
    const [, init] = call;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
  });

  it("sends the real packageKey in the POST body for a dedicated-package assessment", async () => {
    runStartResponse = { runId: "run-2", status: "pending" };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));

    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() =>
      expect(fetchWithAuth.mock.calls.some(([url]) => url === "/api/msp/customers/42/diagnostics/run")).toBe(true),
    );
    const call = fetchWithAuth.mock.calls.find(([url]) => url === "/api/msp/customers/42/diagnostics/run")!;
    const [, init] = call;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ packageKey: "copilot:readiness" });
  });
});

describe("SimulatorAssessmentCanvas — SSE progress handling", () => {
  it("updates progress state across a progress -> progress -> complete sequence", async () => {
    runStartResponse = { runId: "run-3", status: "pending" };
    findingsResponse = { findings: [] };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];
    expect(es.url).toContain("/api/msp/customers/42/diagnostics/runs/run-3/sse");
    expect(es.url).toContain("jwt=test-token");

    es.emit({ type: "diagnostics_progress", checkKey: "identity:mfa-registration", checkLabel: "MFA registration", status: "ok", index: 1, total: 2 });
    await screen.findByText("1/2 checks");

    es.emit({ type: "diagnostics_progress", checkKey: "licensing:copilot-skus", checkLabel: "Copilot SKUs", status: "ok", index: 2, total: 2 });
    await screen.findByText("2/2 checks");
    expect(screen.getAllByText(/MFA registration|Copilot SKUs/).length).toBe(2);

    es.emit({ type: "diagnostics_complete", status: "completed", checksTotal: 2, checksOk: 2, checksError: 0, requiresScript: 0, findings: 3 });

    await screen.findByText(/Run complete — completed/i);
    expect(screen.getByText("checks: 2")).toBeTruthy();
    expect(screen.getByText("findings: 3")).toBeTruthy();
    expect(es.closed).toBe(true);
  });

  it("shows the error message and stops on a progress -> error sequence", async () => {
    runStartResponse = { runId: "run-4", status: "pending" };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    es.emit({ type: "diagnostics_progress", checkKey: "identity:mfa-registration", checkLabel: "MFA registration", status: "ok", index: 1, total: 2 });
    await screen.findByText("1/2 checks");

    es.emit({ type: "diagnostics_error", message: "Tenant connection lost" });

    await screen.findByText("Tenant connection lost");
    expect(screen.queryByText(/Run complete/i)).toBeNull();
    expect(es.closed).toBe(true);
  });
});

describe("SimulatorAssessmentCanvas — findings display (Phase 3)", () => {
  it("re-sorts findings by real severity priority, ignoring the API's alphabetical order", async () => {
    runStartResponse = { runId: "run-5", status: "pending" };
    // Deliberately alphabetical by severity text, matching the real (unfixed)
    // backend ordering: critical, info, ok, warning.
    findingsResponse = {
      findings: [
        { findingId: "f-crit", checkKey: "identity:mfa", checkLabel: "MFA", severity: "critical", title: "MFA disabled" },
        { findingId: "f-info", checkKey: "licensing:skus", checkLabel: "SKUs", severity: "info", title: "SKU info" },
        { findingId: "f-ok", checkKey: "identity:pim", checkLabel: "PIM", severity: "ok", title: "PIM fine" },
        { findingId: "f-warn", checkKey: "identity:guest", checkLabel: "Guests", severity: "warning", title: "Guest review" },
      ],
    };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];
    es.emit({ type: "diagnostics_complete", status: "completed", checksTotal: 4, checksOk: 3, checksError: 0, requiresScript: 0, findings: 4 });

    await screen.findByText("MFA disabled");

    const rows = screen.getAllByText(/disabled|SKU info|PIM fine|Guest review/);
    const order = rows.map((el) => el.textContent);
    expect(order).toEqual(["MFA disabled", "Guest review", "SKU info", "PIM fine"]);
  });

  it("renders the correct severity badge label for all 4 severity values", async () => {
    runStartResponse = { runId: "run-6", status: "pending" };
    findingsResponse = {
      findings: [
        { findingId: "f-1", checkKey: "a", checkLabel: "A", severity: "critical", title: "t1" },
        { findingId: "f-2", checkKey: "b", checkLabel: "B", severity: "warning", title: "t2" },
        { findingId: "f-3", checkKey: "c", checkLabel: "C", severity: "info", title: "t3" },
        { findingId: "f-4", checkKey: "d", checkLabel: "D", severity: "ok", title: "t4" },
      ],
    };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];
    es.emit({ type: "diagnostics_complete", status: "completed", checksTotal: 4, checksOk: 4, checksError: 0, requiresScript: 0, findings: 4 });

    await screen.findByText("t1");
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText("Info")).toBeTruthy();
    expect(screen.getByText("OK")).toBeTruthy();
  });

  it("shows extractedProperties as formatted JSON when a finding row is expanded", async () => {
    runStartResponse = { runId: "run-7", status: "pending" };
    findingsResponse = {
      findings: [
        {
          findingId: "f-1",
          checkKey: "identity:mfa",
          checkLabel: "MFA registration",
          severity: "critical",
          title: "MFA disabled for 3 users",
          description: "3 users have no MFA method registered.",
          extractedProperties: { affectedUsers: ["a@x.com", "b@x.com", "c@x.com"], checkedAt: "2026-07-27T00:00:00Z" },
        },
      ],
    };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];
    es.emit({ type: "diagnostics_complete", status: "completed", checksTotal: 1, checksOk: 0, checksError: 0, requiresScript: 0, findings: 1 });

    const findingTitle = await screen.findByText("MFA disabled for 3 users");
    expect(screen.queryByText(/affectedUsers/)).toBeNull();

    fireEvent.click(findingTitle.closest("tr")!);

    await screen.findByText("3 users have no MFA method registered.");
    expect(screen.getByText(/"affectedUsers"/)).toBeTruthy();
    expect(screen.getByText(/a@x\.com/)).toBeTruthy();
  });
});

describe("SimulatorAssessmentCanvas — past-run picker (Phase 3)", () => {
  it("loads and displays findings for a run picked from the past-runs dropdown", async () => {
    pastRunsResponse = [
      { runId: "past-1", status: "completed", packageKey: "copilot:readiness", checksTotal: 2, createdAt: "2026-07-20T00:00:00Z" },
    ];
    findingsResponse = {
      findings: [{ findingId: "f-1", checkKey: "identity:mfa", checkLabel: "MFA", severity: "warning", title: "Past finding" }],
    };

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));

    const select = await screen.findByDisplayValue(/Select a past run/i);
    fireEvent.change(select, { target: { value: "past-1" } });

    await screen.findByText("Past finding");
    expect(
      fetchWithAuth.mock.calls.some(([url]) => url === "/api/msp/customers/42/diagnostics/runs/past-1"),
    ).toBe(true);
  });
});
