// @vitest-environment jsdom
/**
 * Tests: #379 PART 1 — Simulator Studio deep link.
 *
 * `/system/simulator?checkKey=<key>` must land on that exact check already
 * loaded into the endpoint canvas, with no manual search — the same end state
 * as if the operator had found it in the Explorer tree and clicked it.
 *
 * The route path itself is confirmed in admin-panel's own router (App.tsx's
 * `<Route path="/system/:section">` → SystemWorkspace `case "simulator"`), so
 * what's under test here is the page's handling of the param, not the routing.
 *
 * The real SimulatorCenterCanvas is kept — it owns the selection state and the
 * `simulator-select-endpoint` listener, so stubbing it would test nothing. Only
 * the leaf panels are stubbed, and SimulatorEndpointCanvas is replaced with a
 * probe that renders the check it was actually handed, which is the real
 * assertion: the FULL monitor_checks row arrived, not just a key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import React from "react";

const PIM_CHECK = {
  key: "identity:pim-eligible-roles",
  label: "PIM Eligible Roles",
  description: "Privileged roles held as eligible rather than active",
  endpoint: "/roleManagement/directory/roleEligibilitySchedules?$expand=principal",
  method: "GET",
  selectParams: null,
  filterParams: null,
  requestBody: null,
  properties: ["eligibleRoleCount"],
  mapping: [],
  requiresCustomerScript: false,
  status: "active",
};

const checkFetches: string[] = [];
let checkResponse: { ok: boolean; body: unknown } = { ok: true, body: { check: PIM_CHECK } };

const fetchWithAuth = vi.fn(async (url: string) => {
  if (url.includes("/admin/monitor-checks/")) {
    checkFetches.push(url);
    return { ok: checkResponse.ok, json: async () => checkResponse.body };
  }
  return { ok: true, json: async () => ({}) };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Leaf panels — none of them participate in selection.
vi.mock("@/components/SimulatorLeftTree", () => ({ SimulatorLeftTree: () => <div /> }));
vi.mock("@/components/SimulatorPortalSnapshot", () => ({ SimulatorPortalSnapshot: () => <div /> }));
vi.mock("@/components/SimulatorLogStream", () => ({ SimulatorLogStream: () => <div /> }));
vi.mock("@/components/SqlQueryOutput", () => ({ SqlQueryOutput: () => <div /> }));
vi.mock("@/components/LiveDbSchemaTree", () => ({ LiveDbSchemaTree: () => <div /> }));
vi.mock("@/components/ApiTesterDialog", () => ({
  ApiTesterDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/SqlQueryCanvas", () => ({
  SqlQueryCanvas: () => <div />,
  EMPTY_SQL_OUTPUT: { rows: [], columns: [], isExecuting: false },
}));
vi.mock("@/components/SimulatorOverridesPanel", () => ({ SimulatorOverridesPanel: () => <div /> }));
vi.mock("@/components/SimulatorEnginesPanel", () => ({ SimulatorEnginesPanel: () => <div /> }));
vi.mock("@/components/SimulatorDeployConsolePanel", () => ({ SimulatorDeployConsolePanel: () => <div /> }));
vi.mock("@/components/SimulatorBatchCanvas", () => ({ SimulatorBatchCanvas: () => <div /> }));
vi.mock("@/components/SimulatorWriteActionCanvas", () => ({ SimulatorWriteActionCanvas: () => <div /> }));
vi.mock("@/components/SimulatorConfigPackCanvas", () => ({ SimulatorConfigPackCanvas: () => <div /> }));
vi.mock("@/components/SimulatorPillarMatrixCanvas", () => ({ SimulatorPillarMatrixCanvas: () => <div /> }));
vi.mock("@/components/SimulatorAssessmentCanvas", () => ({ SimulatorAssessmentCanvas: () => <div /> }));
vi.mock("@/components/SimulatorDocumentCanvas", () => ({ SimulatorDocumentCanvas: () => <div /> }));

// The probe: renders what the canvas was really given, so the test can prove
// the whole row arrived rather than just asserting a tab switched.
vi.mock("@/components/SimulatorEndpointCanvas", () => ({
  SimulatorEndpointCanvas: ({ check }: { check: Record<string, unknown> }) => (
    <div>
      <span data-testid="loaded-check-key">{String(check.key)}</span>
      <span data-testid="loaded-check-endpoint">{String(check.endpoint)}</span>
      <span data-testid="loaded-check-label">{String(check.label)}</span>
    </div>
  ),
}));

import { toast } from "sonner";
import { simulatorStudioCheckPath } from "@/components/simulatorDeepLink";
import { SimulatorStudioPage } from "./SimulatorStudioPage";

const toastError = vi.mocked(toast.error);

function visit(search: string) {
  window.history.replaceState({}, "", `/system/simulator${search}`);
}

beforeEach(() => {
  localStorage.clear();
  checkFetches.length = 0;
  checkResponse = { ok: true, body: { check: PIM_CHECK } };
  fetchWithAuth.mockClear();
  toastError.mockClear();
});

afterEach(() => {
  cleanup();
  visit("");
});

describe("#379 Simulator Studio ?checkKey deep link", () => {
  it("auto-loads the named check into the endpoint canvas on page load", async () => {
    visit("?checkKey=identity%3Apim-eligible-roles");
    render(<SimulatorStudioPage />);

    await waitFor(() => expect(screen.getByTestId("loaded-check-key")).toBeTruthy());
    expect(screen.getByTestId("loaded-check-key").textContent).toBe("identity:pim-eligible-roles");
    // The FULL row, not just the key — this is what SimulatorEndpointCanvas
    // actually requires, and what a manual tree click would have supplied.
    expect(screen.getByTestId("loaded-check-endpoint").textContent).toBe(PIM_CHECK.endpoint);
    expect(screen.getByTestId("loaded-check-label").textContent).toBe("PIM Eligible Roles");
  });

  it("resolves the key against the real monitor-checks route, URL-encoded", async () => {
    visit("?checkKey=identity%3Apim-eligible-roles");
    render(<SimulatorStudioPage />);

    await waitFor(() => expect(checkFetches.length).toBe(1));
    expect(checkFetches[0]).toBe("/api/admin/monitor-checks/identity%3Apim-eligible-roles");
  });

  it("opens (and persists) the check's document tab, exactly as a tree click does", async () => {
    visit("?checkKey=identity%3Apim-eligible-roles");
    render(<SimulatorStudioPage />);

    await waitFor(() => expect(screen.getByTestId("loaded-check-key")).toBeTruthy());
    const persisted = JSON.parse(localStorage.getItem("simulator-open-documents-v1") || "[]");
    expect(persisted.map((d: { id: string }) => d.id)).toContain("endpoint:identity:pim-eligible-roles");
  });

  it("does nothing at all without the param — the studio opens on its normal default", async () => {
    visit("");
    render(<SimulatorStudioPage />);

    await waitFor(() => expect(screen.getByText("Simulator Studio")).toBeTruthy());
    expect(checkFetches.length).toBe(0);
    expect(screen.queryByTestId("loaded-check-key")).toBeNull();
  });

  it("consumes the exact link Active Directory's finding rows produce", async () => {
    // Closes the seam between the two halves of #379: this navigates using the
    // SAME builder the "Test in Simulator Studio →" link uses, so a change to
    // the URL shape on either side fails here rather than shipping a dead link.
    const href = simulatorStudioCheckPath("identity:pim-eligible-roles");
    expect(href).toBe("/system/simulator?checkKey=identity%3Apim-eligible-roles");

    window.history.replaceState({}, "", href);
    render(<SimulatorStudioPage />);

    await waitFor(() => expect(screen.getByTestId("loaded-check-key")).toBeTruthy());
    expect(screen.getByTestId("loaded-check-key").textContent).toBe("identity:pim-eligible-roles");
  });

  it("surfaces a real error for an unknown check rather than failing silently", async () => {
    checkResponse = { ok: false, body: { error: "Monitor check not found" } };
    visit("?checkKey=nope%3Ano-such-check");
    render(<SimulatorStudioPage />);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Monitor check not found"));
    expect(screen.queryByTestId("loaded-check-key")).toBeNull();
  });
});
