// @vitest-environment jsdom
/**
 * Tests: SimulatorLeftTree.tsx's Section 11 (Assessments) Phase 7 (Issue
 * #30) delete/deprecate wiring.
 *
 * Coverage:
 *   - A deprecated assessment (visibility: "private") is reflected in the
 *     tree — dimmed row + "Private" badge — the moment
 *     simulator-assessments-updated fires (the same event the Phase 5/6
 *     create/edit wizard already dispatches), with no manual reload.
 *   - The per-row Delete/Deprecate hover actions open the correct modal
 *     type with the correct modalData, mirroring Phase 6's Edit wiring.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

const fetchWithAuth = vi.fn();
const openModal = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));
vi.mock("@/contexts/ModalContext", () => ({
  useModal: () => ({ openModal }),
}));
vi.mock("@/contexts/TestbedContext", () => ({
  useTestbedContext: () => ({ selectedCustomerId: null }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

import { SimulatorLeftTree, type AssessmentNode } from "./SimulatorLeftTree";

const ASSESSMENT_PUBLIC: AssessmentNode = {
  id: 5,
  name: "Solo Package Assessment",
  slug: "solo-package-assessment",
  isFreeOffering: false,
  sortOrder: 30,
  visibility: "public" as const,
  packageKey: "assess:solo-package",
  hasDedicatedPackage: true,
  checkKeys: ["identity:mfa-registration"],
  checkCount: 1,
};

const ASSESSMENT_PRIVATE = { ...ASSESSMENT_PUBLIC, visibility: "private" as const };

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

let assessmentsPayload: { assessments: AssessmentNode[] };

beforeEach(() => {
  fetchWithAuth.mockReset();
  openModal.mockReset();
  assessmentsPayload = { assessments: [ASSESSMENT_PUBLIC] };
  fetchWithAuth.mockImplementation(async (url: string) => {
    if (url === "/api/admin/simulator/assessments") {
      return jsonResponse(assessmentsPayload);
    }
    // Every other endpoint (manifest, scripts, migrations, suites, engines,
    // events, monitor-checks, write-actions, config-packs) — irrelevant to
    // these assessment-row assertions, so left unimplemented (falls back to
    // the component's own not-ok handling, e.g. the manifest's hardcoded
    // fallback scenario list).
    return jsonResponse({}, false);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function searchFor(text: string) {
  const input = screen.getByPlaceholderText(/Search endpoints, events, scripts, packs/i);
  fireEvent.change(input, { target: { value: text } });
}

describe("SimulatorLeftTree — Assessments row reflects deprecated state live", () => {
  it("shows no Private badge and full opacity for a public assessment", async () => {
    render(<SimulatorLeftTree />);
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/assessments"));

    await searchFor("Solo Package Assessment");
    const nameEl = await screen.findByText("Solo Package Assessment");
    expect(screen.queryByText("Private")).toBeNull();
    expect(nameEl.closest("div")?.className).not.toMatch(/opacity-50/);
  });

  it('dims the row and adds a "Private" badge as soon as simulator-assessments-updated fires, without a manual reload', async () => {
    render(<SimulatorLeftTree />);
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/assessments"));
    await searchFor("Solo Package Assessment");
    await screen.findByText("Solo Package Assessment");

    const callsBefore = fetchWithAuth.mock.calls.filter((c) => c[0] === "/api/admin/simulator/assessments").length;

    // The server now reports this assessment as deprecated (Deprecate PUT
    // already landed) — simulate the tree picking that up via the same
    // event the wizard dispatches on success, not a manual reload.
    assessmentsPayload = { assessments: [ASSESSMENT_PRIVATE] };
    await act(async () => {
      window.dispatchEvent(new CustomEvent("simulator-assessments-updated"));
    });

    await waitFor(() => {
      const callsAfter = fetchWithAuth.mock.calls.filter((c) => c[0] === "/api/admin/simulator/assessments").length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    const badge = await screen.findByText("Private");
    expect(badge).toBeTruthy();
    const nameEl = screen.getByText("Solo Package Assessment");
    expect(nameEl.closest("div")?.className).toMatch(/opacity-50/);
  });
});

describe("SimulatorLeftTree — per-row Delete/Deprecate actions", () => {
  it('the hover "Deprecate" icon opens the deprecate-assessment modal with this assessment', async () => {
    render(<SimulatorLeftTree />);
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/assessments"));
    await searchFor("Solo Package Assessment");
    await screen.findByText("Solo Package Assessment");

    fireEvent.click(screen.getByTitle("Deprecate assessment (unpublish, reversible)"));
    expect(openModal).toHaveBeenCalledWith("deprecate-assessment", { assessment: ASSESSMENT_PUBLIC });
  });

  it('the hover "Delete" icon opens the delete-assessment modal with this assessment and the full catalog', async () => {
    render(<SimulatorLeftTree />);
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/simulator/assessments"));
    await searchFor("Solo Package Assessment");
    await screen.findByText("Solo Package Assessment");

    fireEvent.click(screen.getByTitle("Delete assessment"));
    expect(openModal).toHaveBeenCalledWith("delete-assessment", {
      assessment: ASSESSMENT_PUBLIC,
      assessments: [ASSESSMENT_PUBLIC],
    });
  });
});
