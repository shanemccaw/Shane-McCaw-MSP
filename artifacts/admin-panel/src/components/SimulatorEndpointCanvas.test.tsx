// @vitest-environment jsdom
/**
 * Tests: #390 — "Remove from Copilot Package" button in Simulator Studio's
 * Endpoint canvas.
 *
 * Coverage:
 *   - The button only renders once the check is confirmed to be in
 *     assess:copilot-readiness's real check list (not for every check).
 *   - Clicking it when the package is shared with other assessments shows
 *     the inline confirm, and confirming genuinely drops the check from the
 *     package's PUT body (not just the row disappearing from the UI).
 *   - Clicking it for a package not shared with any other assessment skips
 *     the confirm and removes directly.
 *   - A failed PUT surfaces a real toast error and leaves the button state
 *     unchanged (not a silent no-op).
 *
 * Reuses the same shared-package detection concept #376 already built for
 * ActiveDirectoryCustomerPane.tsx (itself reusing AssessmentCreationWizard.tsx's
 * attachSharedWith filter): GET /api/admin/simulator/assessments filtered by
 * packageKey, then GET/PUT /api/admin/monitoring-packages/:key/checks.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";

const COPILOT_PACKAGE_KEY = "assess:copilot-readiness";

const CHECK = {
  key: "identity:mfa-registration",
  label: "MFA Registration",
  description: "Checks whether MFA is registered.",
  endpoint: "/reports/credentialUserRegistrationDetails",
  method: "GET",
  selectParams: null,
  filterParams: null,
  requestBody: null,
  properties: [],
  mapping: [],
  requiresCustomerScript: false,
  status: "active",
};

let assessmentsResponse: { id: number; name: string; packageKey: string | null }[] = [];
let packageChecksResponse: { checkKey: string; sortOrder: number }[] = [
  { checkKey: "identity:mfa-registration", sortOrder: 0 },
  { checkKey: "sharepoint:external-sharing", sortOrder: 1 },
  { checkKey: "other:unrelated-check", sortOrder: 2 },
];
let putChecksResult: { ok: boolean; body: unknown } = { ok: true, body: { updated: true } };
const putCalls: { url: string; body: unknown }[] = [];

const fetchWithAuth = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? "GET";
  if (url.includes("/simulator/assessments")) {
    return jsonResponse({ assessments: assessmentsResponse });
  }
  if (url.includes(`/monitoring-packages/${encodeURIComponent(COPILOT_PACKAGE_KEY)}/checks`)) {
    if (method === "PUT") {
      putCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return jsonResponse(putChecksResult.body, putChecksResult.ok);
    }
    return jsonResponse({ checks: packageChecksResponse });
  }
  return jsonResponse([]);
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

vi.mock("@/contexts/TestbedContext", () => ({
  useTestbedContext: () => ({ selectedCustomerId: 42 }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { SimulatorEndpointCanvas } from "./SimulatorEndpointCanvas";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

afterEach(() => {
  cleanup();
  fetchWithAuth.mockClear();
  assessmentsResponse = [];
  packageChecksResponse = [
    { checkKey: "identity:mfa-registration", sortOrder: 0 },
    { checkKey: "sharepoint:external-sharing", sortOrder: 1 },
    { checkKey: "other:unrelated-check", sortOrder: 2 },
  ];
  putChecksResult = { ok: true, body: { updated: true } };
  putCalls.length = 0;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("SimulatorEndpointCanvas — #390 remove from Copilot Package", () => {
  it("only renders the button once the check is confirmed to be in the Copilot package", async () => {
    packageChecksResponse = [{ checkKey: "other:unrelated-check", sortOrder: 0 }];
    render(<SimulatorEndpointCanvas check={CHECK} />);

    await waitFor(() =>
      expect(fetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining(`/monitoring-packages/${encodeURIComponent(COPILOT_PACKAGE_KEY)}/checks`),
      ),
    );
    expect(screen.queryByTitle("Remove this check from the Copilot Readiness monitoring package")).toBeNull();
  });

  it("shows the shared-package confirmation, and confirming genuinely drops the check from the package", async () => {
    assessmentsResponse = [
      { id: 101, name: "Copilot Readiness Snapshot", packageKey: COPILOT_PACKAGE_KEY },
      { id: 102, name: "Copilot Readiness Assessment", packageKey: COPILOT_PACKAGE_KEY },
    ];
    render(<SimulatorEndpointCanvas check={CHECK} />);

    const removeBtn = await screen.findByTitle("Remove this check from the Copilot Readiness monitoring package");
    fireEvent.click(removeBtn);

    await waitFor(() =>
      expect(
        screen.getByText(/also used by 2 other assessments.*Copilot Readiness Snapshot, Copilot Readiness Assessment/),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByText("Remove from all"));

    await waitFor(() => expect(putCalls.length).toBe(1));
    // Genuinely removed from the package's check list, not just the row hiding client-side —
    // the PUT carries every OTHER check but not this one.
    expect(putCalls[0].body).toEqual({ checkKeys: ["sharepoint:external-sharing", "other:unrelated-check"] });

    await waitFor(() =>
      expect(screen.queryByTitle("Remove this check from the Copilot Readiness monitoring package")).toBeNull(),
    );
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(expect.stringContaining("2 other assessments"));
  });

  it("removing a check not shared with any other assessment skips the confirmation and just works", async () => {
    assessmentsResponse = []; // nothing else references this package
    render(<SimulatorEndpointCanvas check={CHECK} />);

    const removeBtn = await screen.findByTitle("Remove this check from the Copilot Readiness monitoring package");
    fireEvent.click(removeBtn);

    await waitFor(() => expect(putCalls.length).toBe(1));
    expect(screen.queryByText(/remove it from all of them/)).toBeNull();
    expect(putCalls[0].body).toEqual({ checkKeys: ["sharepoint:external-sharing", "other:unrelated-check"] });
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
  });

  it("a failed PUT surfaces a real error and does not silently succeed", async () => {
    assessmentsResponse = [];
    putChecksResult = { ok: false, body: { error: "Package is locked for editing." } };
    render(<SimulatorEndpointCanvas check={CHECK} />);

    const removeBtn = await screen.findByTitle("Remove this check from the Copilot Readiness monitoring package");
    fireEvent.click(removeBtn);

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Package is locked for editing."));
    // Not a silent no-op — the button is still there (removal never applied).
    expect(screen.getByTitle("Remove this check from the Copilot Readiness monitoring package")).toBeTruthy();
  });
});
