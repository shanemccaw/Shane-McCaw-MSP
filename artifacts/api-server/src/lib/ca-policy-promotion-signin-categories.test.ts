/**
 * ca-policy-promotion-signin-categories.test.ts — Git #4552.
 *
 * `evaluateCaPolicyImpact` used to read only v1.0 `/auditLogs/signIns` (interactive
 * user sign-ins). It now also reads the beta `signInEventTypes` filter for
 * `nonInteractiveUser`, `servicePrincipal` and `managedIdentity`, and folds all four
 * into one aggregate impact. This covers the real Graph call shapes issued and that
 * a workload identity sign-in (no userId/userPrincipalName) still counts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  caPolicyPromotionsTable: {},
  mspAuditLogsTable: {},
  tenantsTable: {},
  writeActionCatalogTable: {},
}));
vi.mock("./launch-control-change-request.ts", () => ({
  raiseChangeRequestForLaunchControlExecution: vi.fn(),
  recordLaunchControlExecutionOutcome: vi.fn(),
}));
vi.mock("./logger.ts", () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const graphFetchForTenant = vi.fn();
vi.mock("./graph.ts", () => ({
  graphFetchForTenant: (...a: unknown[]) => graphFetchForTenant(...a),
  ConsentRevokedError: class extends Error {},
  LicenseGapError: class extends Error {},
}));

const { evaluateCaPolicyImpact } = await import("./ca-policy-promotion.ts");

const TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const POLICY_ID = "6f2a1b0e-2c1d-4d8e-9a55-0b7f1c3e9d21";
const NOW = new Date("2026-09-17T12:00:00Z");

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const policyBody = {
  id: POLICY_ID,
  displayName: "Baseline: Require MFA for All Users (report-only)",
  state: "enabledForReportingButNotEnforced",
  createdDateTime: "2026-09-01T09:00:00Z",
  modifiedDateTime: "2026-09-03T09:00:00Z",
};

const appliedBlock = [{ id: POLICY_ID, displayName: "Baseline", result: "reportOnlyFailure", enforcedGrantControls: ["block"] }];

beforeEach(() => {
  graphFetchForTenant.mockReset();
});

describe("evaluateCaPolicyImpact — sign-in event type coverage (#4552)", () => {
  it("reads all four sign-in categories and folds them into one aggregate impact", async () => {
    const calls: string[] = [];
    graphFetchForTenant.mockImplementation(async (_tenantId: string, path: string) => {
      calls.push(path);
      if (path.includes("/identity/conditionalAccess/policies/")) return jsonResponse(policyBody);
      if (path === "/auditLogs/signIns?$filter=createdDateTime%20ge%202026-09-03T09:00:00.000Z&$top=500") {
        return jsonResponse({ value: [{ id: "s1", createdDateTime: "2026-09-10T08:00:00Z", userId: "u-alice", userPrincipalName: "alice@contoso.com", appliedConditionalAccessPolicies: appliedBlock }] });
      }
      if (path.includes("signInEventTypes/any(t:t%20eq%20'nonInteractiveUser')")) {
        return jsonResponse({ value: [{ id: "s2", createdDateTime: "2026-09-11T08:00:00Z", userId: "u-bob", userPrincipalName: "bob@contoso.com", appliedConditionalAccessPolicies: appliedBlock }] });
      }
      if (path.includes("signInEventTypes/any(t:t%20eq%20'servicePrincipal')")) {
        return jsonResponse({
          value: [{ id: "s3", createdDateTime: "2026-09-12T08:00:00Z", servicePrincipalId: "sp-1", servicePrincipalName: "Backup Sync App", appliedConditionalAccessPolicies: appliedBlock }],
        });
      }
      if (path.includes("signInEventTypes/any(t:t%20eq%20'managedIdentity')")) {
        return jsonResponse({ value: [] });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const impact = await evaluateCaPolicyImpact(TENANT_ID, POLICY_ID, NOW);

    expect(impact.status).toBe("ok");
    expect(impact.complete).toBe(true);
    // Every category was actually queried, on the expected transport (v1.0 relative
    // for interactive, absolute beta URL for the other three).
    expect(calls.some((p) => p.startsWith("/auditLogs/signIns?"))).toBe(true);
    expect(calls.filter((p) => p.startsWith("https://graph.microsoft.com/beta/auditLogs/signIns?"))).toHaveLength(3);

    // Real fix: a service principal sign-in with no userId still counts toward the
    // aggregate wouldBlock/affectedUserCount an operator promotes on.
    expect(impact.summary).toMatchObject({ wouldBlock: 3, affectedUserCount: 3 });
    expect(impact.readByCategory).toMatchObject({
      interactiveUser: { pagesRead: 1, complete: true },
      nonInteractiveUser: { pagesRead: 1, complete: true },
      servicePrincipal: { pagesRead: 1, complete: true },
      managedIdentity: { pagesRead: 1, complete: true },
    });
    expect(impact.summary!.byCategory.servicePrincipal.wouldBlock).toBe(1);
    expect(impact.summary!.affectedUsers.find((u) => u.userDisplayName === "Backup Sync App")).toMatchObject({
      userId: "sp-1", userPrincipalName: null, wouldBlock: 1,
    });
  });

  it("fails the whole evaluation when any one category's read errors, rather than reporting a partial count as complete", async () => {
    graphFetchForTenant.mockImplementation(async (_tenantId: string, path: string) => {
      if (path.includes("/identity/conditionalAccess/policies/")) return jsonResponse(policyBody);
      if (path.includes("signInEventTypes/any(t:t%20eq%20'servicePrincipal')")) return jsonResponse({}, false);
      return jsonResponse({ value: [] });
    });

    const impact = await evaluateCaPolicyImpact(TENANT_ID, POLICY_ID, NOW);
    expect(impact.status).toBe("graph_error");
    expect(impact.summary).toBeNull();
    expect(impact.detail).toContain("servicePrincipal");
  });
});
