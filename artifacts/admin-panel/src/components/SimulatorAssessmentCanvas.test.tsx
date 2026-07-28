// @vitest-environment jsdom
/**
 * Tests: Simulator Assessments Phase 2 (Issue #24) run wiring in
 * SimulatorAssessmentCanvas.tsx.
 *
 * Coverage:
 *   - Run correctly omits `packageKey` in the POST body for a fallback
 *     assessment (no dedicated package) and sends the real one for a
 *     dedicated-package assessment.
 *   - SSE event handling updates progress state correctly for a
 *     progress -> progress -> complete sequence, and separately for a
 *     progress -> error sequence.
 *
 * EventSource isn't implemented in jsdom, so this file installs a small
 * controllable mock on globalThis.EventSource that the component's real
 * `new EventSource(url)` call picks up, and the test drives its `onmessage`/
 * `onerror` handlers directly to simulate server-pushed events.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const fetchWithAuth = vi.fn();

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
  fetchWithAuth.mockReset();
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SimulatorAssessmentCanvas — Run packageKey selection", () => {
  it("omits packageKey in the POST body for an assessment on the fallback", async () => {
    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ runId: "run-1", status: "pending" }));

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: FALLBACK_ASSESSMENT }));

    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    const [url, init] = fetchWithAuth.mock.calls[0];
    expect(url).toBe("/api/msp/customers/42/diagnostics/run");
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("sends the real packageKey in the POST body for a dedicated-package assessment", async () => {
    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ runId: "run-2", status: "pending" }));

    render(React.createElement(SimulatorAssessmentCanvas, { assessment: DEDICATED_ASSESSMENT }));

    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    const [, init] = fetchWithAuth.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ packageKey: "copilot:readiness" });
  });
});

describe("SimulatorAssessmentCanvas — SSE progress handling", () => {
  it("updates progress state across a progress -> progress -> complete sequence", async () => {
    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ runId: "run-3", status: "pending" }));

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
    fetchWithAuth.mockResolvedValueOnce(jsonResponse({ runId: "run-4", status: "pending" }));

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
