// @vitest-environment jsdom
/**
 * Tests: the two Pillar Matrix refinements — clickable rule trace + live
 * customer pillar-score header.
 *
 * Coverage:
 *   - Clicking a row's "Source of record" cell (checkKey resolved) opens the
 *     real trace surface (SimulatorEndpointCanvas, which embeds the real Phase
 *     2 SimulatorEngineTrace) scoped to that row's owning check — fetched via
 *     GET /api/admin/monitor-checks/:key and rendered with that exact check.
 *   - A row with no resolvable checkKey renders plain (non-interactive) text.
 *   - The live pillar-score header loads on mount for the selected testbed
 *     customer, then recomputes automatically after a successful inline
 *     rule-weight save — no manual reload.
 *
 * SimulatorEndpointCanvas itself is mocked out (it has its own real run/trace
 * network behavior, exercised by its own tests) — this file only asserts the
 * matrix wires the right check into it and opens/closes the modal correctly.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth }),
}));

vi.mock("@/contexts/TestbedContext", () => ({
  useTestbedContext: () => ({
    selectedCustomerId: 42,
    selectedCustomer: { id: 42, mspId: 1, name: "Acme Testbed", domain: null, isTestbed: true },
  }),
}));

vi.mock("./SimulatorEndpointCanvas", () => ({
  SimulatorEndpointCanvas: ({ check }: { check: { key: string } }) => (
    <div data-testid="mock-endpoint-canvas">trace:{check.key}</div>
  ),
}));

import { SimulatorPillarMatrixCanvas } from "./SimulatorPillarMatrixCanvas";

const MATRIX_ROW_FED = {
  ruleId: 1,
  signalKey: "signal.governance.mfa-gap",
  ruleType: "threshold",
  sourceKey: "identity:mfa-registration",
  groupId: null,
  description: "MFA gap",
  ruleImpact: 8,
  groupImpact: 0,
  effectiveSignalImpact: 8,
  isWinningSource: true,
  fed: true,
  signalEvaluable: true,
  checkKey: "identity:mfa-registration",
};

const MATRIX_ROW_INERT = {
  ruleId: 2,
  signalKey: "signal.governance.orphan",
  ruleType: "profile_key_gt",
  sourceKey: "noSuchKey",
  groupId: null,
  description: null,
  ruleImpact: 3,
  groupImpact: 0,
  effectiveSignalImpact: 3,
  isWinningSource: true,
  fed: false,
  signalEvaluable: false,
  checkKey: null,
};

function matrixResponse(rows = [MATRIX_ROW_FED, MATRIX_ROW_INERT]) {
  return {
    pillar: "governance",
    label: "Governance",
    field: "governanceImpact",
    theoreticalMax: 20,
    contributingSignalCount: 2,
    ruleCount: rows.length,
    fedRuleCount: rows.filter((r) => r.fed).length,
    rows,
  };
}

function scoresResponse(governanceScore: number) {
  return {
    customerId: 42,
    pillars: [
      { pillar: "governance", label: "Governance", score: governanceScore },
      { pillar: "security", label: "Security", score: 70 },
    ],
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/signal-rules/pillar-matrix")) {
      return jsonResponse(matrixResponse());
    }
    if (url.startsWith("/api/admin/signal-rules/customer-pillar-scores/42")) {
      return jsonResponse(scoresResponse(fetchWithAuth.mock.calls.filter((c) => String(c[0]).includes("customer-pillar-scores")).length === 1 ? 40 : 55));
    }
    if (url.startsWith("/api/admin/monitor-checks/")) {
      const key = decodeURIComponent(url.replace("/api/admin/monitor-checks/", ""));
      return jsonResponse({
        check: {
          key,
          label: key,
          description: null,
          endpoint: "https://graph.microsoft.com/v1.0/x",
          method: "GET",
          selectParams: null,
          requestBody: null,
          properties: [],
          mapping: [],
          requiresCustomerScript: false,
          status: "active",
        },
      });
    }
    if (url.startsWith("/api/admin/signal-rules/") && init?.method === "PATCH") {
      return jsonResponse({ ok: true });
    }
    throw new Error(`Unhandled fetch in test: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SimulatorPillarMatrixCanvas — clickable rule trace", () => {
  it("opens the real trace component (SimulatorEndpointCanvas) scoped to the row's resolved checkKey", async () => {
    render(React.createElement(SimulatorPillarMatrixCanvas, { initialPillar: "governance" }));

    const link = await screen.findByRole("button", { name: /this rule/i });
    fireEvent.click(link);

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/monitor-checks/identity%3Amfa-registration"),
      );
    });

    const canvas = await screen.findByTestId("mock-endpoint-canvas");
    expect(canvas.textContent).toBe("trace:identity:mfa-registration");
  });

  it("renders plain non-interactive text for a row with no resolvable checkKey", async () => {
    render(React.createElement(SimulatorPillarMatrixCanvas, { initialPillar: "governance" }));

    await screen.findByText("signal.governance.orphan");
    // The inert row's own "this rule" text must not be a button.
    const rows = screen.getAllByText(/this rule/i);
    expect(rows.some((el) => el.tagName === "SPAN")).toBe(true);
  });
});

describe("SimulatorPillarMatrixCanvas — live customer pillar-score header", () => {
  it("loads scores on mount and recomputes automatically after a successful rule-weight save", async () => {
    render(React.createElement(SimulatorPillarMatrixCanvas, { initialPillar: "governance" }));

    // Initial load shows the first score value.
    expect(await screen.findByText("40")).toBeTruthy();

    // Edit the fed row's impact value and save.
    const input = (await screen.findAllByRole("spinbutton"))[0];
    fireEvent.change(input, { target: { value: "9" } });

    const saveButton = screen.getByRole("button", { name: /save 1 change/i });
    fireEvent.click(saveButton);

    // Header recomputes without any manual reload action from the test.
    await waitFor(() => expect(screen.getByText("55")).toBeTruthy());

    const scoreCalls = fetchWithAuth.mock.calls.filter((c) =>
      String(c[0]).includes("customer-pillar-scores/42"),
    );
    expect(scoreCalls.length).toBeGreaterThanOrEqual(2);
  });
});
