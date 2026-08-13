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
import { toast } from "sonner";

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
    visibility: "public",
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
    visibility: "public",
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
  {
    key: "identity:mfa-registration",
    label: "MFA registration coverage",
    description: null,
    status: "active",
    endpoint: "/reports/authenticationMethods/userRegistrationDetails",
    method: "GET",
    properties: ["isMfaRegistered"],
  },
  {
    key: "copilot:usage-activity",
    label: "Copilot usage activity",
    description: null,
    status: "active",
    endpoint: "/reports/getM365CopilotUsageUserDetail",
    method: "GET",
    properties: ["lastActivityDate"],
  },
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

// ── Phase 6 (#29): edit mode ────────────────────────────────────────────────

const FULL_ROW_ATTACHED: Record<string, unknown> = {
  id: 1,
  name: "Copilot Readiness Assessment",
  slug: "copilot-readiness-assessment",
  description: "Evaluates Copilot rollout readiness.",
  tagline: "Know before you buy seats",
  bestFor: "Mid-market IT teams",
  isFreeOffering: false,
  allowFreeCheckout: false,
  basePrice: "500",
  maxPrice: "750",
  sortOrder: 25,
  category: "assessment",
  // Fields this wizard never manages — must survive a save untouched.
  iconName: "Sparkles",
  tags: ["ai", "copilot"],
  requiredAppPermissions: [{ scope: "User.Read", reason: "profile lookup" }],
  typeAttributes: { packageKey: "assess:copilot-readiness" },
  priceCents: 50000,
  internalCostCents: 35000,
};

const FULL_ROW_FALLBACK: Record<string, unknown> = {
  id: 10,
  name: "Fallback Assessment",
  slug: "fallback-assessment",
  description: null,
  tagline: null,
  bestFor: null,
  isFreeOffering: true,
  allowFreeCheckout: true,
  basePrice: null,
  maxPrice: null,
  sortOrder: 5,
  category: "assessment",
  iconName: null,
  tags: null,
  requiredAppPermissions: null,
  typeAttributes: {},
};

const FULL_ROW_SOLO: Record<string, unknown> = {
  id: 3,
  name: "Solo Package Assessment",
  slug: "solo-package-assessment",
  description: null,
  tagline: null,
  bestFor: null,
  isFreeOffering: false,
  allowFreeCheckout: false,
  basePrice: null,
  maxPrice: null,
  sortOrder: 30,
  category: "assessment",
  iconName: null,
  tags: null,
  requiredAppPermissions: null,
  typeAttributes: { packageKey: "assess:solo-package" },
};

const EXISTING_WITH_EDIT_TARGETS: AssessmentNode[] = [
  ...EXISTING,
  {
    id: 3,
    name: "Solo Package Assessment",
    slug: "solo-package-assessment",
    isFreeOffering: false,
    sortOrder: 30,
    visibility: "public",
    packageKey: "assess:solo-package",
    hasDedicatedPackage: true,
    checkKeys: ["identity:mfa-registration"],
    checkCount: 1,
  },
  {
    id: 10,
    name: "Fallback Assessment",
    slug: "fallback-assessment",
    isFreeOffering: true,
    sortOrder: 5,
    visibility: "public",
    packageKey: null,
    hasDedicatedPackage: false,
    checkKeys: null,
    checkCount: null,
  },
];

const PACKAGES_WITH_SOLO = [...PACKAGES, { key: "assess:solo-package", label: "Solo Package", description: null, status: "active" }];

function packageChecksResponse(packageKey: string, checkKeys: string[]) {
  return jsonResponse({ checks: checkKeys.map((checkKey, i) => ({ packageKey, checkKey, sortOrder: i })) });
}

function editModeFetchImpl(opts: {
  fullRowsById: Record<number, Record<string, unknown>>;
  checksByPackage: Record<string, string[]>;
  packages?: typeof PACKAGES;
}) {
  const packages = opts.packages ?? PACKAGES_WITH_SOLO;
  return async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const servicesIdMatch = url.match(/^\/api\/admin\/services\/(\d+)$/);
    if (method === "GET" && servicesIdMatch) {
      const id = Number(servicesIdMatch[1]);
      return jsonResponse(opts.fullRowsById[id]);
    }
    if (method === "GET" && url === "/api/admin/monitoring-packages") {
      return jsonResponse({ packages });
    }
    if (method === "GET" && url === "/api/admin/monitor-checks") {
      return jsonResponse({ checks: CHECKS });
    }
    const packageChecksMatch = url.match(/^\/api\/admin\/monitoring-packages\/([^/]+)\/checks$/);
    if (method === "GET" && packageChecksMatch) {
      const key = decodeURIComponent(packageChecksMatch[1]!);
      return packageChecksResponse(key, opts.checksByPackage[key] ?? []);
    }
    if (method === "POST" && url === "/api/admin/monitoring-packages") {
      const body = JSON.parse(init!.body as string);
      return jsonResponse({ package: { key: body.key, label: body.label } });
    }
    if (method === "PUT" && packageChecksMatch) {
      const body = JSON.parse(init!.body as string);
      return jsonResponse({ updated: true, checkKeys: body.checkKeys });
    }
    if (method === "PUT" && servicesIdMatch) {
      const body = JSON.parse(init!.body as string);
      return jsonResponse({ id: Number(servicesIdMatch[1]), ...body });
    }
    return jsonResponse({});
  };
}

async function waitForEditLoaded(name: string) {
  await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(name));
}

describe("AssessmentCreationWizard — edit mode pre-fill", () => {
  it("pre-fills Step 1 from a fresh GET, and Step 2 to 'attach' with checks pre-populated for a real dedicated package", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 1: FULL_ROW_ATTACHED },
        checksByPackage: { "assess:copilot-readiness": ["copilot:usage-activity"] },
      }),
    );

    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard
            existingAssessments={EXISTING_WITH_EDIT_TARGETS}
            editingAssessment={EXISTING[0]!}
            onClose={vi.fn()}
          />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Copilot Readiness Assessment");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("copilot-readiness-assessment");

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    // Step 2 pre-selected to "attach", targeting the real dedicated package.
    await screen.findByText("Attach to existing package");
    expect(await screen.findByText("assess:copilot-readiness")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    // Step 3 shown (edit + attach) and pre-populated from the real package's
    // checks — appears both in the filter list and the "Selected" panel.
    expect(await screen.findAllByText("Copilot usage activity")).toHaveLength(2);
    expect(screen.getByText("Selected (1)")).toBeTruthy();
  });

  it("defaults Step 2 to 'create new' for a fallback assessment with no dedicated packageKey", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 10: FULL_ROW_FALLBACK },
        checksByPackage: {},
      }),
    );

    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard
            existingAssessments={EXISTING_WITH_EDIT_TARGETS}
            editingAssessment={EXISTING_WITH_EDIT_TARGETS.find((a) => a.id === 10)!}
            onClose={vi.fn()}
          />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Fallback Assessment");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    await screen.findByText("Create new package");
    // "create" mode's own inputs are visible (not the attach list).
    expect(screen.getByLabelText("Package name")).toBeTruthy();
  });
});

describe("AssessmentCreationWizard — edit mode round-trips the full row", () => {
  it("PUT body includes fields the wizard never manages, unchanged", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 1: FULL_ROW_ATTACHED },
        checksByPackage: { "assess:copilot-readiness": ["copilot:usage-activity"] },
      }),
    );

    const onClose = vi.fn();
    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard existingAssessments={EXISTING_WITH_EDIT_TARGETS} editingAssessment={EXISTING[0]!} onClose={onClose} />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Copilot Readiness Assessment");
    fireEvent.click(screen.getByRole("button", { name: /Next/i })); // -> Step 2
    await screen.findByText("Attach to existing package");
    fireEvent.click(screen.getByRole("button", { name: /Next/i })); // -> Step 3 (unchanged selection)
    await screen.findAllByText("Copilot usage activity");
    fireEvent.click(screen.getByRole("button", { name: /Next/i })); // -> Step 4

    fireEvent.click(await screen.findByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const putCall = fetchWithAuth.mock.calls.find((c) => c[0] === "/api/admin/services/1" && c[1]?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1].body as string);
    expect(body.iconName).toBe("Sparkles");
    expect(body.tags).toEqual(["ai", "copilot"]);
    expect(body.requiredAppPermissions).toEqual([{ scope: "User.Read", reason: "profile lookup" }]);
    expect(body.priceCents).toBe(50000);
    expect(body.internalCostCents).toBe(35000);
    // Managed fields still reflect the (unedited) loaded values.
    expect(body.name).toBe("Copilot Readiness Assessment");
    expect(body.typeAttributes.packageKey).toBe("assess:copilot-readiness");

    // Checks were never touched — no PUT to the package's checks endpoint.
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      "/api/admin/monitoring-packages/assess%3Acopilot-readiness/checks",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});

describe("AssessmentCreationWizard — shared-package edit warning", () => {
  it("blocks submit until a save-vs-fork choice when checks change on a package used by 2+ assessments", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 1: FULL_ROW_ATTACHED },
        checksByPackage: { "assess:copilot-readiness": ["copilot:usage-activity"] },
      }),
    );

    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard existingAssessments={EXISTING_WITH_EDIT_TARGETS} editingAssessment={EXISTING[0]!} onClose={vi.fn()} />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Copilot Readiness Assessment");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await screen.findByText("Attach to existing package");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    // Change the check selection.
    fireEvent.click(await screen.findByText("MFA registration coverage"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    expect(await screen.findByText(/also backs another assessment/i)).toBeTruthy();

    // Blocked: submit without choosing shows a toast and does not call PUT services.
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => {
      expect(fetchWithAuth).not.toHaveBeenCalledWith("/api/admin/services/1", expect.objectContaining({ method: "PUT" }));
    });
  });

  it("saves directly to the shared package when 'save to shared' is chosen", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 1: FULL_ROW_ATTACHED },
        checksByPackage: { "assess:copilot-readiness": ["copilot:usage-activity"] },
      }),
    );

    const onClose = vi.fn();
    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard existingAssessments={EXISTING_WITH_EDIT_TARGETS} editingAssessment={EXISTING[0]!} onClose={onClose} />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Copilot Readiness Assessment");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await screen.findByText("Attach to existing package");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    fireEvent.click(await screen.findByText("MFA registration coverage"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    fireEvent.click(await screen.findByText(/Save changes to the shared package/i));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const checksCall = fetchWithAuth.mock.calls.find(
      (c) => c[0] === "/api/admin/monitoring-packages/assess%3Acopilot-readiness/checks" && c[1]?.method === "PUT",
    );
    expect(checksCall).toBeTruthy();
    const checksBody = JSON.parse(checksCall![1].body as string);
    expect(checksBody.checkKeys).toEqual(expect.arrayContaining(["copilot:usage-activity", "identity:mfa-registration"]));

    const putCall = fetchWithAuth.mock.calls.find((c) => c[0] === "/api/admin/services/1" && c[1]?.method === "PUT");
    expect(JSON.parse(putCall![1].body as string).typeAttributes.packageKey).toBe("assess:copilot-readiness");
  });

  it("forks a new package, repoints packageKey, and never mutates the shared package", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 1: FULL_ROW_ATTACHED },
        checksByPackage: { "assess:copilot-readiness": ["copilot:usage-activity"] },
      }),
    );

    const onClose = vi.fn();
    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard existingAssessments={EXISTING_WITH_EDIT_TARGETS} editingAssessment={EXISTING[0]!} onClose={onClose} />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Copilot Readiness Assessment");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await screen.findByText("Attach to existing package");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    fireEvent.click(await screen.findByText("MFA registration coverage"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    fireEvent.click(await screen.findByText(/Fork: create a new package/i));
    fireEvent.change(screen.getByLabelText("Fork package key"), { target: { value: "assess:copilot-readiness-fork" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const forkPostCall = fetchWithAuth.mock.calls.find((c) => c[0] === "/api/admin/monitoring-packages" && c[1]?.method === "POST");
    expect(forkPostCall).toBeTruthy();
    expect(JSON.parse(forkPostCall![1].body as string).key).toBe("assess:copilot-readiness-fork");

    const forkChecksCall = fetchWithAuth.mock.calls.find(
      (c) => c[0] === "/api/admin/monitoring-packages/assess%3Acopilot-readiness-fork/checks" && c[1]?.method === "PUT",
    );
    expect(forkChecksCall).toBeTruthy();

    // The shared package's own checks endpoint was NEVER written to.
    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      "/api/admin/monitoring-packages/assess%3Acopilot-readiness/checks",
      expect.objectContaining({ method: "PUT" }),
    );

    const putCall = fetchWithAuth.mock.calls.find((c) => c[0] === "/api/admin/services/1" && c[1]?.method === "PUT");
    expect(JSON.parse(putCall![1].body as string).typeAttributes.packageKey).toBe("assess:copilot-readiness-fork");
  });

  it("does not trigger the warning for a single-owner package", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 3: FULL_ROW_SOLO },
        checksByPackage: { "assess:solo-package": ["identity:mfa-registration"] },
      }),
    );

    const onClose = vi.fn();
    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard
            existingAssessments={EXISTING_WITH_EDIT_TARGETS}
            editingAssessment={EXISTING_WITH_EDIT_TARGETS.find((a) => a.id === 3)!}
            onClose={onClose}
          />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Solo Package Assessment");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await screen.findByText("Attach to existing package");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    fireEvent.click(await screen.findByText("Copilot usage activity")); // add a second check
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    expect(screen.queryByText(/also backs/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const checksCall = fetchWithAuth.mock.calls.find(
      (c) => c[0] === "/api/admin/monitoring-packages/assess%3Asolo-package/checks" && c[1]?.method === "PUT",
    );
    expect(checksCall).toBeTruthy();
  });

  it("does not trigger the warning when the check list is unchanged", async () => {
    fetchWithAuth.mockImplementation(
      editModeFetchImpl({
        fullRowsById: { 1: FULL_ROW_ATTACHED },
        checksByPackage: { "assess:copilot-readiness": ["copilot:usage-activity"] },
      }),
    );

    const onClose = vi.fn();
    render(
      <Dialog open>
        <DialogContent>
          <AssessmentCreationWizard existingAssessments={EXISTING_WITH_EDIT_TARGETS} editingAssessment={EXISTING[0]!} onClose={onClose} />
        </DialogContent>
      </Dialog>,
    );

    await waitForEditLoaded("Copilot Readiness Assessment");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await screen.findByText("Attach to existing package");
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await screen.findAllByText("Copilot usage activity"); // leave selection untouched
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    expect(screen.queryByText(/also backs/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(fetchWithAuth).not.toHaveBeenCalledWith(
      "/api/admin/monitoring-packages/assess%3Acopilot-readiness/checks",
      expect.objectContaining({ method: "PUT" }),
    );
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

// ── Phase 8 (#55): Step 3 check search by endpoint/properties + inline create ──

async function toStep3WithChecks(checks: unknown[]) {
  fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/admin/monitoring-packages") return jsonResponse({ packages: PACKAGES });
    if (method === "GET" && url === "/api/admin/monitor-checks") return jsonResponse({ checks });
    if (method === "POST" && url === "/api/admin/monitor-checks") {
      const body = JSON.parse(init!.body as string);
      return jsonResponse(
        { check: { key: body.key, label: body.label, description: null, status: "active", endpoint: body.endpoint, method: body.method, properties: [] } },
        true,
      );
    }
    return jsonResponse({});
  });

  renderWizard(EXISTING, vi.fn());
  await fillStep1("Entra ID Governance Assessment");
  fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Entra ID Governance" } });
  await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/monitoring-packages"));
  fireEvent.click(screen.getByRole("button", { name: /Next/i }));
  await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/monitor-checks"));
}

describe("AssessmentCreationWizard — Phase 8: search by endpoint/properties", () => {
  const SEARCH_CHECKS = [
    ...CHECKS,
    {
      key: "reports:tenant-summary",
      label: "Tenant Summary Report",
      description: null,
      status: "active",
      endpoint: "/users",
      method: "GET",
      properties: [],
    },
    {
      key: "reports:license-detail",
      label: "License Detail Report",
      description: null,
      status: "active",
      endpoint: "/subscribedSkus",
      method: "GET",
      properties: ["licenseAssignmentStates"],
    },
  ];

  it("matches on endpoint even when neither key nor label contains the search term", async () => {
    await toStep3WithChecks(SEARCH_CHECKS);

    expect(await screen.findByText("Tenant Summary Report")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Filter checks…"), { target: { value: "/users" } });

    expect(await screen.findByText("Tenant Summary Report")).toBeTruthy();
    expect(screen.queryByText("MFA registration coverage")).toBeNull();
    expect(screen.queryByText("Copilot usage activity")).toBeNull();
  });

  it("matches on a properties value", async () => {
    await toStep3WithChecks(SEARCH_CHECKS);

    fireEvent.change(screen.getByPlaceholderText("Filter checks…"), { target: { value: "licenseAssignmentStates" } });

    expect(await screen.findByText("License Detail Report")).toBeTruthy();
    expect(screen.queryByText("MFA registration coverage")).toBeNull();
    expect(screen.queryByText("Tenant Summary Report")).toBeNull();
  });
});

describe("AssessmentCreationWizard — Phase 8: inline check creation", () => {
  it("pre-fills the endpoint field from the current search, appends the created check, and auto-selects it without a reload/event wait", async () => {
    await toStep3WithChecks(CHECKS);

    fireEvent.change(screen.getByPlaceholderText("Filter checks…"), { target: { value: "/users" } });
    fireEvent.click(screen.getByRole("button", { name: /New check/i }));

    expect((screen.getByLabelText("Endpoint") as HTMLInputElement).value).toBe("/users");

    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "identity:users-list" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Users list" } });

    fireEvent.click(screen.getByRole("button", { name: "Add check" }));

    expect(await screen.findAllByText("Users list")).not.toHaveLength(0);
    expect(screen.getByText("Selected (1)")).toBeTruthy();
    // Section collapsed back down after a successful create.
    expect(screen.queryByLabelText("Key")).toBeNull();

    const postCall = fetchWithAuth.mock.calls.find((c) => c[0] === "/api/admin/monitor-checks" && c[1]?.method === "POST");
    expect(postCall).toBeTruthy();
    expect(JSON.parse(postCall![1].body as string)).toEqual({
      key: "identity:users-list",
      label: "Users list",
      endpoint: "/users",
      method: "GET",
    });
  });

  it("rejects a key that doesn't look like domain:check-name, client-side, before hitting the network", async () => {
    await toStep3WithChecks(CHECKS);

    fireEvent.click(screen.getByRole("button", { name: /New check/i }));
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "not-a-valid-key" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Whatever" } });
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "/x" } });

    const postCallsBefore = fetchWithAuth.mock.calls.filter((c) => c[1]?.method === "POST").length;
    fireEvent.click(screen.getByRole("button", { name: "Add check" }));

    expect(await screen.findByText(/must look like domain:check-name/i)).toBeTruthy();
    const postCallsAfter = fetchWithAuth.mock.calls.filter((c) => c[1]?.method === "POST").length;
    expect(postCallsAfter).toBe(postCallsBefore);
  });

  it("shows a duplicate-key error inline within the section, not a toast", async () => {
    fetchWithAuth.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/admin/monitoring-packages") return jsonResponse({ packages: PACKAGES });
      if (method === "GET" && url === "/api/admin/monitor-checks") return jsonResponse({ checks: CHECKS });
      if (method === "POST" && url === "/api/admin/monitor-checks") {
        return jsonResponse({ error: "A check with that key already exists" }, false);
      }
      return jsonResponse({});
    });

    renderWizard(EXISTING, vi.fn());
    await fillStep1("Entra ID Governance Assessment");
    fireEvent.change(screen.getByLabelText("Package name"), { target: { value: "Entra ID Governance" } });
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/monitoring-packages"));
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith("/api/admin/monitor-checks"));

    const toastErrorSpy = vi.spyOn(toast, "error");

    fireEvent.click(screen.getByRole("button", { name: /New check/i }));
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "identity:mfa-registration" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add check" }));

    expect(await screen.findByText("A check with that key already exists")).toBeTruthy();
    // Still expanded — the operator can fix the key without losing their input.
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe("identity:mfa-registration");
    expect(toastErrorSpy).not.toHaveBeenCalledWith("A check with that key already exists");
  });

  it("does not disturb Steps 1-2 form state or an already-selected Step 3 check", async () => {
    await toStep3WithChecks(CHECKS);

    // Re-visit Step 1's description via Back, to prove it survives inline-create untouched.
    // (Already filled by fillStep1's Name; add a Description value directly here.)
    fireEvent.click(screen.getByRole("button", { name: /Back/i })); // -> step 2
    fireEvent.click(screen.getByRole("button", { name: /Back/i })); // -> step 1
    fireEvent.change(screen.getByPlaceholderText("What this assessment evaluates and delivers"), {
      target: { value: "Custom description text" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Next/i })); // -> step 2
    fireEvent.click(screen.getByRole("button", { name: /Next/i })); // -> step 3

    fireEvent.click(await screen.findByText("MFA registration coverage"));
    expect(screen.getByText("Selected (1)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /New check/i }));
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "identity:users-list" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Users list" } });
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "/users" } });
    fireEvent.click(screen.getByRole("button", { name: "Add check" }));

    expect(await screen.findByText("Selected (2)")).toBeTruthy();

    // Steps 1-2 untouched by the inline-create round trip.
    fireEvent.click(screen.getByRole("button", { name: /Back/i })); // -> step 2
    expect((screen.getByLabelText("Package name") as HTMLInputElement).value).toBe("Entra ID Governance");
    fireEvent.click(screen.getByRole("button", { name: /Back/i })); // -> step 1
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Entra ID Governance Assessment");
    expect((screen.getByPlaceholderText("What this assessment evaluates and delivers") as HTMLTextAreaElement).value).toBe(
      "Custom description text",
    );

    // And the prior Step 3 selection (plus the newly-created check) survives the round trip.
    fireEvent.click(screen.getByRole("button", { name: /Next/i })); // -> step 2
    fireEvent.click(screen.getByRole("button", { name: /Next/i })); // -> step 3
    expect(await screen.findByText("Selected (2)")).toBeTruthy();
    expect(await screen.findAllByText("MFA registration coverage")).not.toHaveLength(0);
    expect(await screen.findAllByText("Users list")).not.toHaveLength(0);
  });
});
