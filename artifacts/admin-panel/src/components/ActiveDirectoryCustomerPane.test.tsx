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

// #379 — `classification` is computed SERVER-SIDE by api-server's
// monitor-failure-classifier and arrives on each finding. The two objects below
// are the classifier's REAL output, captured verbatim from it for the two real
// error texts here — not hand-invented shapes — so this file asserts against
// what the server genuinely sends. (Their derivation is covered by
// api-server's own msp-diagnostics-finding-classification.test.ts; the
// classifier itself is unmodified by #379.)
const MISSING_SCOPE_CLASSIFICATION = {
  category: "missing_scope",
  title: "Missing permission",
  summary: "The app's token is missing a required permission: Sites.Read.All.",
  guidance:
    "The permission above is the one Microsoft named in the real response. Sites.Read.All is ALREADY declared on the multi-tenant app — so this is a re-consent problem for this tenant, not a missing declaration. Permissions are declared in REQUIRED_MT_SCOPES (artifacts/api-server/src/lib/graph.ts) and on the Azure App Registration manifest. Nothing here adds one: every added permission forces re-consent on every connected tenant, so that stays a deliberate human decision.",
  evidence: [
    "HTTP 403",
    'message contains "insufficient privileges to complete the operation"',
    'error code contains "authorization_requestdenied"',
  ],
  statusCode: 403,
  permissions: ["Sites.Read.All"],
  alreadyDeclaredPermissions: ["Sites.Read.All"],
  action: { kind: "show_permission", label: "Where this permission is declared" },
} as const;

const PARAMETER_SLOT_CLASSIFICATION = {
  category: "parameter_slot",
  title: "Parameter in the wrong slot",
  summary: "A value landed in a parameter slot that expects something else (a locale/culture identifier).",
  guidance:
    "The request reached the API, but one argument is in the wrong position — a value meant for another parameter is being read as a culture identifier. Check the select params and the request body against the endpoint's real signature.",
  evidence: ["HTTP 400", 'message contains "culturenotfoundexception"'],
  statusCode: 400,
  permissions: [],
  alreadyDeclaredPermissions: [],
  action: { kind: "edit_endpoint", label: "Edit request parameters", focusField: "selectParams" },
} as const;

const PIM_RAW_ERROR =
  "Graph API error 400: {\"error\":{\"code\":\"UnknownError\",\"message\":\"System.Globalization.CultureNotFoundException: '*' is an invalid culture identifier.\"}}";

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
      // A check that passed gets no verdict at all — see #379.
      classification: null,
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
      classification: MISSING_SCOPE_CLASSIFICATION,
    },
    {
      findingId: "f-pim",
      runId: "run-1",
      checkKey: "identity:pim-eligible-roles",
      checkLabel: "PIM Eligible Roles",
      severity: "critical",
      title: "PIM eligible roles check failed",
      description: "This check couldn't complete.",
      extractedProperties: { _rawGraphError: PIM_RAW_ERROR },
      checkStatus: "error",
      classification: PARAMETER_SLOT_CLASSIFICATION,
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
import { simulatorStudioCheckPath } from "./simulatorDeepLink";
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

describe("ActiveDirectoryCustomerPane — #379 inline failure classification", () => {
  async function expandRun1() {
    render(<ActiveDirectoryCustomerPane customerId={10} />);
    fireEvent.click(await screen.findByText("core:security-baseline"));
    await screen.findByText("External sharing check failed");
  }

  /** The <li> for one finding, so assertions can't leak across rows. */
  function findingRow(title: string): HTMLElement {
    return screen.getByText(title).closest("li")!;
  }

  it("shows the real category, its evidence and the named permission on a failing finding", async () => {
    await expandRun1();
    const row = within(findingRow("External sharing check failed"));

    // Real category, from the server's classifier — rendered by Simulator
    // Studio's own component, so the chip and the banner both carry it.
    expect(row.getAllByText("Missing permission").length).toBeGreaterThan(0);
    expect(row.getByText("HTTP 403")).toBeTruthy();

    // The literal evidence — the proof, not a paraphrase.
    expect(row.getByText(/message contains "insufficient privileges to complete the operation"/)).toBeTruthy();
    expect(row.getByText(/error code contains "authorization_requestdenied"/)).toBeTruthy();

    // The named permission, flagged as already declared — the whole difference
    // between "add a permission" and "this tenant must re-consent".
    expect(row.getByText("Sites.Read.All")).toBeTruthy();
    expect(row.getByText("declared")).toBeTruthy();
  });

  it("names the suggested action for a fixable finding, and points it at Simulator Studio", async () => {
    await expandRun1();
    const row = within(findingRow("PIM eligible roles check failed"));

    expect(row.getAllByText("Parameter in the wrong slot").length).toBeGreaterThan(0);
    expect(row.getByText("Suggested: Edit request parameters — in Simulator Studio")).toBeTruthy();
  });

  it("never renders a verdict over a check that passed", async () => {
    await expandRun1();
    const row = within(findingRow("MFA registration healthy"));

    expect(row.queryByText("Missing permission")).toBeNull();
    expect(row.queryByText("Unclassified failure")).toBeNull();
    // No suggested action either — there is nothing to act on.
    expect(row.queryByText(/^Suggested:/)).toBeNull();
  });

  it("offers no button that would apply a fix — missing permission stays display-only", async () => {
    await expandRun1();
    const row = within(findingRow("External sharing check failed"));

    // The classifier's safety boundary, asserted rather than assumed: nothing
    // here grants a permission, and nothing here archives a check.
    expect(
      row.getByText(/Display only — no button here grants a permission/),
    ).toBeTruthy();
    expect(row.queryByText("Edit endpoint")).toBeNull();
    expect(row.queryByText("Retire this check")).toBeNull();
  });
});

describe("ActiveDirectoryCustomerPane — #379 Test in Simulator Studio deep link", () => {
  async function expandRun1() {
    render(<ActiveDirectoryCustomerPane customerId={10} />);
    fireEvent.click(await screen.findByText("core:security-baseline"));
    await screen.findByText("External sharing check failed");
  }

  it("links each finding to that exact check in Simulator Studio, URL-encoded", async () => {
    await expandRun1();

    const link = within(screen.getByText("PIM eligible roles check failed").closest("li")!).getByText(
      /Test in Simulator Studio/,
    );
    // The Part 1 deep-link shape, against admin-panel's real /system/simulator
    // route. Asserted as a literal AND against the shared builder, so this
    // can't quietly agree with a builder that has itself drifted.
    expect(link.closest("a")!.getAttribute("href")).toBe(
      "/system/simulator?checkKey=identity%3Apim-eligible-roles",
    );
    expect(link.closest("a")!.getAttribute("href")).toBe(
      simulatorStudioCheckPath("identity:pim-eligible-roles"),
    );
  });

  it("is present on every finding, not only the failing ones", async () => {
    await expandRun1();

    for (const [title, key] of [
      ["MFA registration healthy", "identity%3Amfa-registration"],
      ["External sharing check failed", "sharepoint%3Aexternal-sharing"],
      ["PIM eligible roles check failed", "identity%3Apim-eligible-roles"],
    ] as const) {
      const link = within(screen.getByText(title).closest("li")!).getByText(/Test in Simulator Studio/);
      expect(link.closest("a")!.getAttribute("href")).toBe(`/system/simulator?checkKey=${key}`);
    }
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
