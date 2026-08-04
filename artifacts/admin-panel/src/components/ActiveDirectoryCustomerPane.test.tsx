// @vitest-environment jsdom
/**
 * Tests: #371 (+ addendum) — expandable diagnostic run findings on the
 * Customer Object pane, plus the refresh and copy-to-clipboard additions.
 *
 * Coverage:
 *   - Clicking a run row expands it, fetches its findings on-demand, and
 *     renders real data (counts, severity, title, description) rather than
 *     placeholder content.
 *   - A finding carrying #374's extractedProperties._rawGraphError renders
 *     that raw error distinctly from the friendly description.
 *   - The refresh button re-fetches only the runs-list endpoint (not the
 *     full customer detail) and the new row appears without a full reload.
 *   - The copy button on the raw error writes the exact shown text to the
 *     clipboard and flips to a checkmark.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";

const CUSTOMER_DETAIL = {
  customer: {
    id: 10,
    mspId: 1,
    name: "Acme Corp",
    domain: "acme.com",
    industry: null,
    tenantId: "guid-1234",
    tenantUrl: null,
    status: "active",
    isTestbed: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  owningMsp: { id: 1, name: "Acme MSP", slug: "acme-msp" },
  users: [],
  userCount: 0,
  graphConsent: null,
  sharePointConsent: null,
  writeConsent: null,
  purchasedServices: [],
  recentDiagnosticRuns: [
    { runId: "run-1", packageKey: "core:security-baseline", status: "completed", startedAt: "2026-08-01T00:00:00.000Z", completedAt: "2026-08-01T00:05:00.000Z" },
  ],
};

const RUN_1_FINDINGS = {
  run: { checksTotal: 3, checksOk: 1, checksError: 1, checksRequiresScript: 1, checksLicenseGap: 0 },
  findings: [
    {
      findingId: "f-ok",
      runId: "run-1",
      checkKey: "identity:mfa-registration",
      checkLabel: "MFA Registration",
      severity: "ok",
      title: "MFA registration healthy",
      description: "All users have MFA registered.",
      extractedProperties: null,
      checkStatus: "ok",
    },
    {
      findingId: "f-error",
      runId: "run-1",
      checkKey: "sharepoint:external-sharing",
      checkLabel: "External Sharing",
      severity: "critical",
      title: "External sharing check failed",
      description: "This check couldn't complete — the request format needs adjustment.",
      extractedProperties: { _rawGraphError: "Graph 403: Forbidden — Insufficient privileges to complete the operation." },
      checkStatus: "error",
    },
  ],
};

let runsResponse: unknown[] = CUSTOMER_DETAIL.recentDiagnosticRuns;
const runsRefetchCalls: string[] = [];

// #376 — "Remove from scan package" fixtures.
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
  if (url.includes("/monitoring-packages/") && url.endsWith("/checks")) {
    if (method === "PUT") {
      putCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return jsonResponse(putChecksResult.body, putChecksResult.ok);
    }
    return jsonResponse({ checks: packageChecksResponse });
  }
  if (url.includes("/diagnostics/runs/run-1")) {
    return jsonResponse(RUN_1_FINDINGS);
  }
  if (url.endsWith("/diagnostics/runs")) {
    runsRefetchCalls.push(url);
    return jsonResponse({ recentDiagnosticRuns: runsResponse });
  }
  if (url.endsWith(`/customer/${CUSTOMER_DETAIL.customer.id}`)) {
    return jsonResponse({ ...CUSTOMER_DETAIL, recentDiagnosticRuns: runsResponse });
  }
  return jsonResponse([]);
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { ActiveDirectoryCustomerPane } from "./ActiveDirectoryCustomerPane";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

afterEach(() => {
  cleanup();
  fetchWithAuth.mockClear();
  runsRefetchCalls.length = 0;
  runsResponse = CUSTOMER_DETAIL.recentDiagnosticRuns;
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

describe("ActiveDirectoryCustomerPane — diagnostic runs", () => {
  it("expands a run in place and renders its real findings, errors first", async () => {
    render(<ActiveDirectoryCustomerPane customerId={10} />);

    const runRow = await screen.findByText("core:security-baseline");
    fireEvent.click(runRow);

    await waitFor(() => expect(screen.getByText("External sharing check failed")).toBeTruthy());

    // Real counts, not placeholder.
    expect(screen.getByText("3 checks")).toBeTruthy();
    expect(screen.getByText("1 error")).toBeTruthy();

    // Error finding sorted before the ok finding despite ok being listed first in the response.
    const titles = screen.getAllByText(/registration healthy|sharing check failed/).map((el) => el.textContent);
    expect(titles[0]).toBe("External sharing check failed");
    expect(titles[1]).toBe("MFA registration healthy");

    // #374 raw error renders distinctly from the friendly description.
    expect(
      screen.getByText("Graph 403: Forbidden — Insufficient privileges to complete the operation."),
    ).toBeTruthy();
    expect(screen.getByText("This check couldn't complete — the request format needs adjustment.")).toBeTruthy();
  });

  it("refresh button re-fetches only the runs-list endpoint and shows a new run without reloading", async () => {
    render(<ActiveDirectoryCustomerPane customerId={10} />);
    await screen.findByText("core:security-baseline");

    runsResponse = [
      ...CUSTOMER_DETAIL.recentDiagnosticRuns,
      { runId: "run-2", packageKey: "copilot:readiness", status: "completed", startedAt: "2026-08-04T00:00:00.000Z", completedAt: "2026-08-04T00:05:00.000Z" },
    ];

    fireEvent.click(screen.getByTitle("Refresh recent diagnostic runs"));

    await waitFor(() => expect(screen.getByText("copilot:readiness")).toBeTruthy());
    expect(runsRefetchCalls.length).toBe(1);
    expect(runsRefetchCalls[0]).toContain("/diagnostics/runs");
    expect(runsRefetchCalls[0]).not.toContain(`/customer/${CUSTOMER_DETAIL.customer.id}"`);
  });

  it("copy button copies the exact raw error text shown and confirms with a checkmark", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActiveDirectoryCustomerPane customerId={10} />);
    fireEvent.click(await screen.findByText("core:security-baseline"));
    await screen.findByText("External sharing check failed");

    const rawErrorText = "Graph 403: Forbidden — Insufficient privileges to complete the operation.";
    const rawErrorBlock = screen.getByText(rawErrorText).closest("div")!;
    const copyBtn = within(rawErrorBlock).getByTitle("Copy raw error");

    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(rawErrorText));
    await waitFor(() => expect(within(rawErrorBlock).getByTitle("Copy raw error").querySelector("svg")?.getAttribute("class")).toContain("lucide-check"));
  });
});

describe("ActiveDirectoryCustomerPane — #378 search box for expanded run findings", () => {
  it("filters to only findings matching a check_key substring", async () => {
    render(<ActiveDirectoryCustomerPane customerId={10} />);
    fireEvent.click(await screen.findByText("core:security-baseline"));
    await screen.findByText("External sharing check failed");
    expect(screen.getByText("MFA registration healthy")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search findings…"), { target: { value: "sharepoint:" } });

    expect(screen.getByText(/External sharing check failed/)).toBeTruthy();
    expect(screen.queryByText("MFA registration healthy")).toBeNull();
  });

  it("surfaces a finding matched only inside its raw error/extractedProperties text, not its check name", async () => {
    render(<ActiveDirectoryCustomerPane customerId={10} />);
    fireEvent.click(await screen.findByText("core:security-baseline"));
    await screen.findByText("External sharing check failed");

    // "Insufficient privileges" appears only inside the raw Graph error, not
    // in either finding's title, checkKey, or description.
    fireEvent.change(screen.getByPlaceholderText("Search findings…"), { target: { value: "insufficient privileges" } });

    expect(screen.getByText(/External sharing check failed/)).toBeTruthy();
    expect(screen.queryByText("MFA registration healthy")).toBeNull();
  });

  it("clearing the search box restores the full findings list", async () => {
    render(<ActiveDirectoryCustomerPane customerId={10} />);
    fireEvent.click(await screen.findByText("core:security-baseline"));
    await screen.findByText("External sharing check failed");

    const input = screen.getByPlaceholderText("Search findings…");
    fireEvent.change(input, { target: { value: "sharepoint:" } });
    expect(screen.queryByText("MFA registration healthy")).toBeNull();

    fireEvent.change(input, { target: { value: "" } });

    expect(screen.getByText("MFA registration healthy")).toBeTruthy();
    expect(screen.getByText(/External sharing check failed/)).toBeTruthy();
  });
});

describe("ActiveDirectoryCustomerPane — #376 remove from scan package", () => {
  async function expandRun1() {
    render(<ActiveDirectoryCustomerPane customerId={10} />);
    fireEvent.click(await screen.findByText("core:security-baseline"));
    await screen.findByText("External sharing check failed");
  }

  it("shows the shared-package confirmation, and removing genuinely drops the check from the package", async () => {
    assessmentsResponse = [
      { id: 101, name: "Copilot Readiness Snapshot", packageKey: "core:security-baseline" },
      { id: 102, name: "Copilot Readiness Assessment", packageKey: "core:security-baseline" },
    ];
    await expandRun1();

    const findingRow = screen.getByText("identity:mfa-registration").closest("div")!;
    fireEvent.click(within(findingRow).getByTitle("Remove this check from the scan package"));

    await waitFor(() =>
      expect(
        screen.getByText(/also used by 2 other assessments.*Copilot Readiness Snapshot, Copilot Readiness Assessment/),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByText("Remove from all"));

    await waitFor(() => expect(putCalls.length).toBe(1));
    // Genuinely removed from the package's check list, not just the check clicked being dropped silently —
    // the PUT carries every OTHER check but not this one.
    expect(putCalls[0].body).toEqual({ checkKeys: ["sharepoint:external-sharing", "other:unrelated-check"] });
    expect(putCalls[0].url).toContain("/monitoring-packages/core%3Asecurity-baseline/checks");

    await waitFor(() => expect(screen.queryByText("identity:mfa-registration")).toBeNull());
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(expect.stringContaining("2 other assessments"));
  });

  it("removing from a non-shared package skips the confirmation and just works", async () => {
    assessmentsResponse = []; // nothing else references this package
    await expandRun1();

    const findingRow = screen.getByText("identity:mfa-registration").closest("div")!;
    fireEvent.click(within(findingRow).getByTitle("Remove this check from the scan package"));

    // No confirmation prompt for a non-shared package.
    await waitFor(() => expect(putCalls.length).toBe(1));
    expect(screen.queryByText(/remove it from all of them/)).toBeNull();
    expect(putCalls[0].body).toEqual({ checkKeys: ["sharepoint:external-sharing", "other:unrelated-check"] });

    await waitFor(() => expect(screen.queryByText("identity:mfa-registration")).toBeNull());
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
  });

  it("a failed PUT surfaces a real error and leaves the finding in place", async () => {
    assessmentsResponse = [];
    putChecksResult = { ok: false, body: { error: "Package is locked for editing." } };
    await expandRun1();

    const findingRow = screen.getByText("identity:mfa-registration").closest("div")!;
    fireEvent.click(within(findingRow).getByTitle("Remove this check from the scan package"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Package is locked for editing."));
    // Not a silent no-op — the finding is still there.
    expect(screen.getByText("identity:mfa-registration")).toBeTruthy();
  });
});
