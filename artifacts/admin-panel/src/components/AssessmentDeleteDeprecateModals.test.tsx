// @vitest-environment jsdom
/**
 * Tests: Simulator Assessments Phase 7 (Issue #30) delete/deprecate modals.
 *
 * Coverage:
 *   - Delete surfaces the real DELETE /admin/services/:id 409 blocker
 *     message verbatim and stops (no auto-retry-as-deprecate, no package
 *     archive offer).
 *   - The package-archive offer (DELETE /admin/monitoring-packages/:key)
 *     appears ONLY when the deleted assessment was the sole one referencing
 *     a dedicated, non-fallback packageKey (count === 0) — absent entirely
 *     for a package still shared with another assessment (the
 *     assess:copilot-readiness-style case), for core:security-baseline, and
 *     for a null packageKey. It is never called automatically — only when
 *     the operator explicitly clicks "Archive Package".
 *   - Deprecate round-trips the full GET row into the PUT body, changing
 *     only `visibility` — the same round-trip rule
 *     AssessmentCreationWizard.tsx's editPutBody established for this route.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { AssessmentNode } from "./SimulatorLeftTree";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

import { DeleteAssessmentModal, DeprecateAssessmentModal } from "./AssessmentDeleteDeprecateModals";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

function noContentResponse() {
  // Matches the real DELETE /admin/services/:id success path: 204, no body.
  return { ok: true, status: 204, json: async () => { throw new Error("no body on 204"); } };
}

function renderModal(node: React.ReactNode) {
  return render(
    <Dialog open>
      <DialogContent>{node}</DialogContent>
    </Dialog>,
  );
}

const SOLO_ASSESSMENT: AssessmentNode = {
  id: 5,
  name: "Solo Package Assessment",
  slug: "solo-package-assessment",
  isFreeOffering: false,
  sortOrder: 30,
  visibility: "public",
  packageKey: "assess:solo-package",
  hasDedicatedPackage: true,
  checkKeys: ["identity:mfa-registration"],
  checkCount: 1,
};

const SHARED_ASSESSMENT_A: AssessmentNode = {
  id: 1,
  name: "Copilot Readiness Assessment",
  slug: "copilot-readiness-assessment",
  isFreeOffering: false,
  sortOrder: 25,
  visibility: "public",
  packageKey: "assess:copilot-readiness",
  hasDedicatedPackage: true,
  checkKeys: ["copilot:usage-activity"],
  checkCount: 1,
};

const SHARED_ASSESSMENT_B: AssessmentNode = {
  id: 2,
  name: "Copilot Readiness Snapshot",
  slug: "copilot-readiness-snapshot",
  isFreeOffering: true,
  sortOrder: 14,
  visibility: "public",
  packageKey: "assess:copilot-readiness",
  hasDedicatedPackage: true,
  checkKeys: ["copilot:usage-activity"],
  checkCount: 1,
};

const CORE_BASELINE_ASSESSMENT: AssessmentNode = {
  id: 3,
  name: "Security Posture Assessment",
  slug: "security-posture-assessment",
  isFreeOffering: false,
  sortOrder: 17,
  visibility: "public",
  packageKey: "core:security-baseline",
  hasDedicatedPackage: false,
  checkKeys: null,
  checkCount: null,
};

const NULL_PACKAGE_ASSESSMENT: AssessmentNode = {
  id: 4,
  name: "M365 Tenant Health Audit",
  slug: "m365-tenant-health-audit",
  isFreeOffering: false,
  sortOrder: 16,
  visibility: "public",
  packageKey: null,
  hasDedicatedPackage: false,
  checkKeys: null,
  checkCount: null,
};

beforeEach(() => {
  fetchWithAuth.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DeleteAssessmentModal — 409 blocker", () => {
  it("surfaces the real blocker message verbatim and does not offer a package archive", async () => {
    const blockerMessage =
      "This service cannot be deleted because it is referenced by: contracts. Remove those links first.";
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url === "/api/admin/services/5") {
        return jsonResponse({ error: blockerMessage }, false, 409);
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(
      <DeleteAssessmentModal assessment={SOLO_ASSESSMENT} existingAssessments={[SOLO_ASSESSMENT]} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText(blockerMessage)).toBeTruthy();
    // No auto-retry-as-deprecate and no surprise package-archive offer.
    expect(screen.queryByRole("button", { name: /Archive Package/i })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/monitoring-packages/"),
      expect.anything(),
    );
  });

  it("Close button on the blocked state closes the dialog without further calls", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url === "/api/admin/services/5") {
        return jsonResponse({ error: "blocked" }, false, 409);
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(
      <DeleteAssessmentModal assessment={SOLO_ASSESSMENT} existingAssessments={[SOLO_ASSESSMENT]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("blocked");
    // Two "Close"-named buttons exist once blocked: this modal's own Close
    // button (rendered first, in DOM order) and DialogContent's built-in
    // sr-only "Close" [X] button (rendered last) — the first is ours.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[0]!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("DeleteAssessmentModal — package-archive offer gating", () => {
  it("offers to archive the package when this was the ONLY assessment referencing it", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url === "/api/admin/services/5") {
        return noContentResponse();
      }
      if (init?.method === "DELETE" && url === "/api/admin/monitoring-packages/assess%3Asolo-package") {
        return jsonResponse({ archived: true, package: { key: "assess:solo-package", status: "archived" } });
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    // existingAssessments contains only this assessment on the package — zero OTHER referencers.
    renderModal(
      <DeleteAssessmentModal assessment={SOLO_ASSESSMENT} existingAssessments={[SOLO_ASSESSMENT]} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText(/only assessment using monitoring package/i)).toBeTruthy();
    expect(screen.getByText("assess:solo-package")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Archive Package/i }));

    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/admin/monitoring-packages/assess%3Asolo-package",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('never calls the archive route automatically — "Skip" closes without archiving', async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url === "/api/admin/services/5") {
        return noContentResponse();
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(
      <DeleteAssessmentModal assessment={SOLO_ASSESSMENT} existingAssessments={[SOLO_ASSESSMENT]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));

    expect(onClose).toHaveBeenCalled();
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/monitoring-packages/"),
      expect.anything(),
    );
  });

  it("does NOT offer a package archive for a package still shared with another assessment (assess:copilot-readiness style)", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url === "/api/admin/services/1") {
        return noContentResponse();
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(
      <DeleteAssessmentModal
        assessment={SHARED_ASSESSMENT_A}
        existingAssessments={[SHARED_ASSESSMENT_A, SHARED_ASSESSMENT_B]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/only assessment using monitoring package/i)).toBeNull();
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/monitoring-packages/"),
      expect.anything(),
    );
  });

  it("does NOT offer a package archive for core:security-baseline", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url === "/api/admin/services/3") {
        return noContentResponse();
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(
      <DeleteAssessmentModal
        assessment={CORE_BASELINE_ASSESSMENT}
        existingAssessments={[CORE_BASELINE_ASSESSMENT]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/only assessment using monitoring package/i)).toBeNull();
  });

  it("does NOT offer a package archive for a null packageKey (fallback) assessment", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url === "/api/admin/services/4") {
        return noContentResponse();
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(
      <DeleteAssessmentModal
        assessment={NULL_PACKAGE_ASSESSMENT}
        existingAssessments={[NULL_PACKAGE_ASSESSMENT]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/only assessment using monitoring package/i)).toBeNull();
  });
});

describe("DeleteAssessmentModal — cancel", () => {
  it("Cancel closes without calling DELETE", () => {
    const onClose = vi.fn();
    renderModal(
      <DeleteAssessmentModal assessment={SOLO_ASSESSMENT} existingAssessments={[SOLO_ASSESSMENT]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});

// ─── Deprecate ──────────────────────────────────────────────────────────────

const FULL_ROW: Record<string, unknown> = {
  id: 5,
  name: "Solo Package Assessment",
  slug: "solo-package-assessment",
  description: "Evaluates the solo package.",
  tagline: "Know before you buy",
  bestFor: "Mid-market IT teams",
  isFreeOffering: false,
  allowFreeCheckout: false,
  basePrice: "500",
  maxPrice: "750",
  sortOrder: 30,
  category: "assessment",
  visibility: "public",
  isPublic: true,
  // Fields the modal never manages — must survive the PUT untouched.
  iconName: "Sparkles",
  tags: ["ai", "copilot"],
  requiredAppPermissions: [{ scope: "User.Read", reason: "profile lookup" }],
  typeAttributes: { packageKey: "assess:solo-package" },
  priceCents: 50000,
  internalCostCents: 35000,
};

describe("DeprecateAssessmentModal — round-trips the full row", () => {
  it("PUT body changes only visibility; every unmanaged field is carried through unchanged", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/admin/services/5") {
        return jsonResponse(FULL_ROW);
      }
      if (method === "PUT" && url === "/api/admin/services/5") {
        const body = JSON.parse(init!.body as string);
        return jsonResponse({ ...body, id: 5 });
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(<DeprecateAssessmentModal assessment={SOLO_ASSESSMENT} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Deprecate" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const putCall = fetchWithAuth.mock.calls.find((c) => c[0] === "/api/admin/services/5" && c[1]?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1].body as string);

    expect(body.visibility).toBe("private");
    // Everything else round-tripped verbatim from the GET.
    expect(body.iconName).toBe("Sparkles");
    expect(body.tags).toEqual(["ai", "copilot"]);
    expect(body.requiredAppPermissions).toEqual([{ scope: "User.Read", reason: "profile lookup" }]);
    expect(body.priceCents).toBe(50000);
    expect(body.internalCostCents).toBe(35000);
    expect(body.name).toBe("Solo Package Assessment");
    expect(body.typeAttributes).toEqual({ packageKey: "assess:solo-package" });
  });

  it("dispatches simulator-assessments-updated on success so the tree refreshes without a manual reload", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/admin/services/5") return jsonResponse(FULL_ROW);
      if (method === "PUT" && url === "/api/admin/services/5") {
        const body = JSON.parse(init!.body as string);
        return jsonResponse({ ...body, id: 5 });
      }
      return jsonResponse({});
    });

    const handler = vi.fn();
    window.addEventListener("simulator-assessments-updated", handler);

    renderModal(<DeprecateAssessmentModal assessment={SOLO_ASSESSMENT} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Deprecate" }));

    await waitFor(() => expect(handler).toHaveBeenCalled());
    window.removeEventListener("simulator-assessments-updated", handler);
  });

  it("shows an error and does not PUT when the GET fails", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/admin/services/5") return jsonResponse({ error: "not found" }, false, 404);
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderModal(<DeprecateAssessmentModal assessment={SOLO_ASSESSMENT} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Deprecate" }));

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/services/5"));
    expect(fetchWithAuth).not.toHaveBeenCalledWith("/api/admin/services/5", expect.objectContaining({ method: "PUT" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
