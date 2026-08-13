// @vitest-environment jsdom
/**
 * Tests: Simulator Assessments Phase 4 (Issue #26) run history + diff in
 * SimulatorAssessmentRunHistory.tsx.
 *
 * Coverage:
 *   - History list correctly filters GET .../diagnostics/runs (which returns
 *     ALL of the customer's runs, unfiltered) down to only the ones whose
 *     stored packageKey matches the selected assessment's resolved
 *     packageKey — both for a dedicated-package assessment and for a
 *     fallback assessment resolving to core:security-baseline.
 *   - computeAssessmentFindingsDiff correctly categorizes a synthetic
 *     before/after findings pair into new/resolved/severity-changed/
 *     unchanged.
 *   - The packageKey-differed caveat renders in the DiffView when the two
 *     diffed runs' stored packageKey differ, and does not render when they
 *     match.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

import { computeAssessmentFindingsDiff } from "./SimulatorAssessmentRunHistory";
import type { DiagnosticFinding } from "./SimulatorAssessmentCanvas";

let runsResponse: unknown[] = [];
let runDetailByRunId: Record<string, { run: unknown; findings: unknown[] }> = {};

const fetchWithAuth = vi.fn(async (url: string) => {
  if (url.includes("/diagnostics/runs?")) {
    return jsonResponse(runsResponse);
  }
  const match = /\/diagnostics\/runs\/([^/]+)$/.exec(url);
  if (match) {
    const runId = match[1]!;
    return jsonResponse(runDetailByRunId[runId] ?? { run: { runId }, findings: [] });
  }
  return jsonResponse([]);
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

import { SimulatorAssessmentRunHistory } from "./SimulatorAssessmentRunHistory";
import type { AssessmentNode } from "./SimulatorLeftTree";

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

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function finding(overrides: Partial<DiagnosticFinding>): DiagnosticFinding {
  return {
    findingId: "f-1",
    checkKey: "identity:mfa",
    checkLabel: "MFA",
    severity: "warning",
    title: "t",
    ...overrides,
  };
}

beforeEach(() => {
  fetchWithAuth.mockClear();
  runsResponse = [];
  runDetailByRunId = {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SimulatorAssessmentRunHistory — packageKey filtering", () => {
  it("filters the unfiltered run list down to only this dedicated assessment's packageKey", async () => {
    runsResponse = [
      { runId: "r-1", status: "completed", packageKey: "copilot:readiness", checksTotal: 2, checksOk: 2, checksError: 0, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-20T00:00:00Z", completedAt: null },
      { runId: "r-2", status: "completed", packageKey: "core:security-baseline", checksTotal: 5, checksOk: 5, checksError: 0, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-21T00:00:00Z", completedAt: null },
      { runId: "r-3", status: "completed", packageKey: "identity:mfa-baseline", checksTotal: 3, checksOk: 3, checksError: 0, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-22T00:00:00Z", completedAt: null },
    ];

    render(React.createElement(SimulatorAssessmentRunHistory, { assessment: DEDICATED_ASSESSMENT, customerId: 42 }));
    fireEvent.click(screen.getByText("History"));

    await waitFor(() => expect(screen.getByText("(1)")).toBeTruthy());
    expect(screen.getByText(/ok: 2 · error: 0 · license-gap: 0 \/ 2 total/)).toBeTruthy();
  });

  it("filters down to core:security-baseline runs for a fallback assessment", async () => {
    runsResponse = [
      { runId: "r-1", status: "completed", packageKey: "copilot:readiness", checksTotal: 2, checksOk: 2, checksError: 0, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-20T00:00:00Z", completedAt: null },
      { runId: "r-2", status: "completed", packageKey: "core:security-baseline", checksTotal: 5, checksOk: 4, checksError: 1, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-21T00:00:00Z", completedAt: null },
    ];

    render(React.createElement(SimulatorAssessmentRunHistory, { assessment: FALLBACK_ASSESSMENT, customerId: 42 }));
    fireEvent.click(screen.getByText("History"));

    await waitFor(() => expect(screen.getByText("(1)")).toBeTruthy());
    expect(screen.getByText(/ok: 4 · error: 1 · license-gap: 0 \/ 5 total/)).toBeTruthy();
  });
});

describe("computeAssessmentFindingsDiff", () => {
  it("categorizes new, resolved, severity-changed, and unchanged findings", () => {
    const before: DiagnosticFinding[] = [
      finding({ findingId: "b-1", checkKey: "identity:mfa", severity: "critical", title: "MFA off" }),
      finding({ findingId: "b-2", checkKey: "identity:guest", severity: "warning", title: "Guest review" }),
      finding({ findingId: "b-3", checkKey: "licensing:copilot-skus", severity: "ok", title: "SKUs fine" }),
    ];
    const after: DiagnosticFinding[] = [
      // identity:mfa resolved (severity improved to ok but same checkKey present) — treated as severity change, not resolved.
      finding({ findingId: "a-1", checkKey: "identity:mfa", severity: "ok", title: "MFA off" }),
      // identity:guest is gone entirely — resolved.
      // licensing:copilot-skus unchanged.
      finding({ findingId: "a-3", checkKey: "licensing:copilot-skus", severity: "ok", title: "SKUs fine" }),
      // a brand-new finding.
      finding({ findingId: "a-4", checkKey: "identity:pim", severity: "warning", title: "PIM standing access" }),
    ];

    const diff = computeAssessmentFindingsDiff(before, after);

    expect(diff.newFindings.map((f) => f.checkKey)).toEqual(["identity:pim"]);
    expect(diff.resolvedFindings.map((f) => f.checkKey)).toEqual(["identity:guest"]);
    expect(diff.severityChanges).toEqual([
      { checkKey: "identity:mfa", checkLabel: "MFA", before: "critical", after: "ok" },
    ]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("returns an all-unchanged diff when nothing differs", () => {
    const findings: DiagnosticFinding[] = [finding({ checkKey: "identity:mfa", severity: "ok" })];
    const diff = computeAssessmentFindingsDiff(findings, findings);
    expect(diff.newFindings).toEqual([]);
    expect(diff.resolvedFindings).toEqual([]);
    expect(diff.severityChanges).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });
});

describe("SimulatorAssessmentRunHistory — diff selection + packageKey-differed caveat", () => {
  it("enables Diff only once two runs are selected and renders the diff categories", async () => {
    runsResponse = [
      { runId: "r-old", status: "completed", packageKey: "copilot:readiness", checksTotal: 2, checksOk: 1, checksError: 1, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-20T00:00:00Z", completedAt: null },
      { runId: "r-new", status: "completed", packageKey: "copilot:readiness", checksTotal: 2, checksOk: 2, checksError: 0, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-25T00:00:00Z", completedAt: null },
    ];
    runDetailByRunId = {
      "r-old": {
        run: { runId: "r-old", packageKey: "copilot:readiness" },
        findings: [finding({ findingId: "f-old", checkKey: "identity:mfa", severity: "critical", title: "MFA off" })],
      },
      "r-new": {
        run: { runId: "r-new", packageKey: "copilot:readiness" },
        findings: [finding({ findingId: "f-new", checkKey: "licensing:copilot-skus", severity: "warning", title: "SKU gap" })],
      },
    };

    render(React.createElement(SimulatorAssessmentRunHistory, { assessment: DEDICATED_ASSESSMENT, customerId: 42 }));
    fireEvent.click(screen.getByText("History"));
    await screen.findByText(/ok: 1 · error: 1/);

    const diffButton = screen.getByRole("button", { name: /diff \(0\/2\)/i }) as HTMLButtonElement;
    expect(diffButton.disabled).toBe(true);

    const rows = screen.getAllByText(/completed/).map((el) => el.closest("div[class*='cursor-pointer']")!);
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);

    const enabledDiffButton = screen.getByRole("button", { name: /diff \(2\/2\)/i }) as HTMLButtonElement;
    expect(enabledDiffButton.disabled).toBe(false);
    fireEvent.click(enabledDiffButton);

    await screen.findByText("SKU gap");
    expect(screen.getByText("MFA off")).toBeTruthy();
    expect(screen.queryByText(/used different packageKeys/)).toBeNull();
  });

  it("shows the packageKey-differed caveat when the two diffed runs used different packageKeys", async () => {
    runsResponse = [
      { runId: "r-old", status: "completed", packageKey: "copilot:readiness", checksTotal: 2, checksOk: 2, checksError: 0, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-20T00:00:00Z", completedAt: null },
      { runId: "r-new", status: "completed", packageKey: "copilot:readiness", checksTotal: 3, checksOk: 3, checksError: 0, checksRequiresScript: 0, checksLicenseGap: 0, createdAt: "2026-07-25T00:00:00Z", completedAt: null },
    ];
    // The run rows in the filtered list both report the CURRENT resolved
    // packageKey, but the run-detail fetch (the actual diff input) can still
    // reveal the two runs disagree — e.g. a stale/edited record — so the
    // caveat is driven off the fetched run detail, not the list filter.
    runDetailByRunId = {
      "r-old": { run: { runId: "r-old", packageKey: "copilot:readiness-v1" }, findings: [] },
      "r-new": { run: { runId: "r-new", packageKey: "copilot:readiness-v2" }, findings: [] },
    };

    render(React.createElement(SimulatorAssessmentRunHistory, { assessment: DEDICATED_ASSESSMENT, customerId: 42 }));
    fireEvent.click(screen.getByText("History"));
    await screen.findByText(/ok: 2 · error: 0/);

    const rows = screen.getAllByText(/completed/).map((el) => el.closest("div[class*='cursor-pointer']")!);
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    fireEvent.click(screen.getByRole("button", { name: /diff \(2\/2\)/i }));

    await screen.findByText(/used different packageKeys/);
    expect(screen.getByText(/copilot:readiness-v1/)).toBeTruthy();
    expect(screen.getByText(/copilot:readiness-v2/)).toBeTruthy();
  });
});
