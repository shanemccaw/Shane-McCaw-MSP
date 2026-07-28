// @vitest-environment jsdom
/**
 * Tests: Simulator Assessments Phase 5 (Issue #28) creation wizard.
 *
 * Coverage:
 *   - "Create new package" submit sequence: POST monitoring-packages, then
 *     PUT .../checks with the selected check keys, then POST services with
 *     typeAttributes.packageKey set to the created package's key — in that
 *     order, and only after that order succeeds.
 *   - "Attach to existing package" submit sequence: no package POST/PUT at
 *     all, just POST services with typeAttributes.packageKey set to the
 *     chosen existing key.
 *   - Partial failure: package created successfully but the service POST
 *     fails — the created package's key is surfaced in the error banner
 *     (not silently discarded), and the modal is NOT closed.
 *   - Slug uniqueness is validated against the existingAssessments prop
 *     (Phase 1's already-fetched catalog) before Step 1 can advance.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { AssessmentNode } from "./SimulatorLeftTree";

const fetchWithAuth = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

import { AssessmentCreationWizard } from "./AssessmentCreationWizard";

const EXISTING: AssessmentNode[] = [
  {
    id: 1,
    name: "Copilot Readiness Assessment",
    slug: "copilot-readiness-assessment",
    isFreeOffering: false,
    sortOrder: 25,
    packageKey: "assess:copilot-readiness",
    hasDedicatedPackage: true,
    checkKeys: ["copilot:usage-activity"],
    checkCount: 1,
  },
  {
    id: 2,
    name: "Copilot Readiness Snapshot",
    slug: "copilot-readiness-snapshot",
    isFreeOffering: true,
    sortOrder: 14,
    packageKey: "assess:copilot-readiness",
    hasDedicatedPackage: true,
    checkKeys: ["copilot:usage-activity"],
    checkCount: 1,
  },
];

const PACKAGES = [
  { key: "assess:copilot-readiness", label: "Copilot Readiness", description: null, status: "active" },
  { key: "core:security-baseline", label: "Core Security Baseline", description: null, status: "active" },
];

const CHECKS = [
  { key: "identity:mfa-registration", label: "MFA registration coverage", description: null, status: "active" },
  { key: "copilot:usage-activity", label: "Copilot usage activity", description: null, status: "active" },
];

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function renderWizard(existingAssessments: AssessmentNode[], onClose: () => void) {
  return render(
    <Dialog open>
      <DialogContent>
        <AssessmentCreationWizard existingAssessments={existingAssessments} onClose={onClose} />
      </DialogContent>
    </Dialog>,
  );
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/admin/monitoring-packages") {
      return jsonResponse({ packages: PACKAGES });
    }
    if (method === "GET" && url === "/api/admin/monitor-checks") {
      return jsonResponse({ checks: CHECKS });
    }
    if (method === "POST" && url === "/api/admin/monitoring-packages") {
      const body = JSON.parse(init!.body as string);
      return jsonResponse({ package: { key: body.key, label: body.label } }, true);
    }
    if (method === "PUT" && url.includes("/checks")) {
      const body = JSON.parse(init!.body as string);
      return jsonResponse({ updated: true, checkKeys: body.checkKeys });
    }
    if (method === "POST" && url === "/api/admin/services") {
      const body = JSON.parse(init!.body as string);
      return jsonResponse({ id: 99, ...body }, true);
    }
    return jsonResponse({});
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function fillStep1(name: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /Next/i }));
}

describe("AssessmentCreationWizard — create new package path", () => {
  it("submits POST monitoring-packages, then PUT checks, then POST services in order", async () => {
    const onClose = vi.fn();
    renderWizard(EXISTING, onClose);

    await fillStep1("Entra ID Governance Assessment");

    // Step 2 defaults to "create" — fill package name, key auto-derives from slug.
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Entra ID Governance" } });
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/monitoring-packages"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    // Step 3 — select a check.
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/monitor-checks"));
    fireEvent.click(await screen.findByText("MFA registration coverage"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    // Step 4 — Review, submit.
    fireEvent.click(screen.getByRole("button", { name: /Create Assessment/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const calls = fetchWithAuth.mock.calls.filter(
      (c) => c[1]?.method === "POST" || c[1]?.method === "PUT",
    );
    expect(calls[0][0]).toBe("/api/admin/monitoring-packages");
    expect(calls[1][0]).toBe("/api/admin/monitoring-packages/assess%3Aentra-id-governance-assessment/checks");
    expect(calls[2][0]).toBe("/api/admin/services");

    const svcBody = JSON.parse(calls[2][1].body as string);
    expect(svcBody.typeAttributes.packageKey).toBe("assess:entra-id-governance-assessment");
    expect(svcBody.category).toBe("assessment");
  });
});

describe("AssessmentCreationWizard — attach to existing package path", () => {
  it("submits only POST services, with typeAttributes.packageKey set to the chosen package", async () => {
    const onClose = vi.fn();
    renderWizard(EXISTING, onClose);

    await fillStep1("Entra ID Governance Assessment");

    fireEvent.click(screen.getByText("Attach to existing package"));
    await screen.findByText("Copilot Readiness");
    fireEvent.click(screen.getByText("Core Security Baseline"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    fireEvent.click(screen.getByRole("button", { name: /Create Assessment/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const postCalls = fetchWithAuth.mock.calls.filter((c) => c[1]?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][0]).toBe("/api/admin/services");
    const svcBody = JSON.parse(postCalls[0][1].body as string);
    expect(svcBody.typeAttributes.packageKey).toBe("core:security-baseline");

    expect(fetchWithAuth).not.toHaveBeenCalledWith(expect.stringContaining("/checks"), expect.anything());
  });

  it("discloses when the chosen package already backs other assessments, without blocking the choice", async () => {
    renderWizard(EXISTING, vi.fn());
    await fillStep1("Entra ID Governance Assessment");
    fireEvent.click(screen.getByText("Attach to existing package"));
    fireEvent.click(await screen.findByText("Copilot Readiness"));

    expect(await screen.findByText(/already backs 2 other assessments/i)).toBeTruthy();
    // Not blocked — Next is still enabled and works.
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(await screen.findByText(/POST \/api\/admin\/services/i)).toBeTruthy();
  });
});

describe("AssessmentCreationWizard — partial-failure surfacing", () => {
  it("surfaces the created package key when the service POST fails after the package succeeded", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/admin/monitoring-packages") return jsonResponse({ packages: PACKAGES });
      if (method === "GET" && url === "/api/admin/monitor-checks") return jsonResponse({ checks: CHECKS });
      if (method === "POST" && url === "/api/admin/monitoring-packages") {
        const body = JSON.parse(init!.body as string);
        return jsonResponse({ package: { key: body.key, label: body.label } });
      }
      if (method === "PUT" && url.includes("/checks")) return jsonResponse({ updated: true });
      if (method === "POST" && url === "/api/admin/services") {
        return jsonResponse({ error: "A service with that slug already exists." }, false);
      }
      return jsonResponse({});
    });

    const onClose = vi.fn();
    renderWizard(EXISTING, onClose);

    await fillStep1("Entra ID Governance Assessment");
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Entra ID Governance" } });
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/monitoring-packages"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    fireEvent.click(await screen.findByText("MFA registration coverage"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    fireEvent.click(screen.getByRole("button", { name: /Create Assessment/i }));

    const banner = await screen.findByText(/was created \(with its checks set\), but creating the assessment failed/i);
    expect(banner.textContent).toContain("assess:entra-id-governance-assessment");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AssessmentCreationWizard — slug uniqueness", () => {
  it("blocks advancing past Step 1 when the derived slug collides with an existing assessment", async () => {
    renderWizard(EXISTING, vi.fn());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Copilot Readiness Assessment" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    // Still on Step 1 — Step 2's package-mode choices never render.
    expect(screen.queryByText("Create new package")).toBeNull();
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });

  it("allows advancing once the slug is edited to a unique value", async () => {
    renderWizard(EXISTING, vi.fn());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Copilot Readiness Assessment" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "copilot-readiness-assessment-v2" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    expect(await screen.findByText("Create new package")).toBeTruthy();
  });
});
