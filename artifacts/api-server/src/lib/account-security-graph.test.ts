import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Git #1593 — real-tenant-shaped coverage for the three signals
 * `useAccountSecurityLive.ts`'s header comment flagged as having no backend.
 * `graphFetchForTenant` is mocked at the module boundary; `ConsentRevokedError`
 * / `LicenseGapError` are the real classes (imported via importActual) so the
 * `instanceof` checks in account-security-graph.ts exercise real behavior.
 */

const mockGraphFetchForTenant = vi.fn();

vi.mock("./graph", async () => {
  const actual = await vi.importActual<typeof import("./graph")>("./graph");
  return {
    ...actual,
    graphFetchForTenant: (...args: unknown[]) => mockGraphFetchForTenant(...args),
  };
});

let mockUsersResultQueue: any[][] = [];
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockUsersResultQueue.shift() ?? []),
        }),
      }),
    }),
  },
  usersTable: { id: "id", failedLoginAttempts: "failed_login_attempts", lastFailedLoginAt: "last_failed_login_at", lockedUntil: "locked_until" },
}));

import { ConsentRevokedError, LicenseGapError } from "./graph";
import {
  getPasswordAgeSignal,
  getFailedSignInsSignal,
  getDeviceComplianceSignal,
  getLocalFailedLoginSignal,
  PASSWORD_STALE_THRESHOLD_DAYS,
} from "./account-security-graph";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  mockGraphFetchForTenant.mockReset();
  mockUsersResultQueue = [];
});

describe("getPasswordAgeSignal", () => {
  it("returns a real stale/total breakdown from /users, confirmed against the testbed tenant's actual shape (24 users, 18 stale)", async () => {
    const now = Date.now();
    const staleDate = new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString();
    const freshDate = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [
          { id: "1", userPrincipalName: "a@x.com", lastPasswordChangeDateTime: staleDate },
          { id: "2", userPrincipalName: "b@x.com", lastPasswordChangeDateTime: freshDate },
          { id: "3", userPrincipalName: "c@x.com", lastPasswordChangeDateTime: null },
        ],
      }),
    );

    const result = await getPasswordAgeSignal("tenant-1");
    expect(result).toEqual({
      available: true,
      staleThresholdDays: PASSWORD_STALE_THRESHOLD_DAYS,
      totalUsers: 3,
      staleCount: 1,
      oldestChangeAt: staleDate,
    });
  });

  it("paginates via @odata.nextLink across multiple pages", async () => {
    mockGraphFetchForTenant
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ id: "1", userPrincipalName: "a@x.com", lastPasswordChangeDateTime: null }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=abc",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: [{ id: "2", userPrincipalName: "b@x.com", lastPasswordChangeDateTime: null }] }),
      );

    const result = await getPasswordAgeSignal("tenant-1");
    expect(result).toMatchObject({ available: true, totalUsers: 2 });
    expect(mockGraphFetchForTenant).toHaveBeenCalledTimes(2);
    expect(mockGraphFetchForTenant.mock.calls[1]?.[1]).toBe("/users?$skiptoken=abc");
  });

  it("reports consent_revoked honestly rather than fabricating a value", async () => {
    mockGraphFetchForTenant.mockRejectedValueOnce(new ConsentRevokedError("tenant-1"));
    const result = await getPasswordAgeSignal("tenant-1");
    expect(result).toEqual({
      available: false,
      reason: "consent_revoked",
      detail: "Admin consent for this tenant has been revoked or was never granted.",
    });
  });
});

describe("getFailedSignInsSignal", () => {
  it("returns real failed sign-in data when the tenant has the required license", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [
          { id: "1", createdDateTime: "2026-08-29T10:00:00Z", status: { errorCode: 50126 } },
          { id: "2", createdDateTime: "2026-08-28T10:00:00Z", status: { errorCode: 50053 } },
        ],
      }),
    );
    const result = await getFailedSignInsSignal("tenant-1");
    expect(result).toEqual({ available: true, failedCount: 2, mostRecentFailureAt: "2026-08-29T10:00:00Z" });
  });

  it("reports entra_premium_required for the real testbed tenant's confirmed 403 (Authentication_RequestFromNonPremiumTenantOrB2CTenant)", async () => {
    mockGraphFetchForTenant.mockRejectedValueOnce(
      new LicenseGapError(
        "tenant-1",
        "Microsoft Entra ID Premium (P1/P2)",
        "Authentication_RequestFromNonPremiumTenantOrB2CTenant",
        "",
      ),
    );
    const result = await getFailedSignInsSignal("tenant-1");
    expect(result).toEqual({
      available: false,
      reason: "entra_premium_required",
      detail: "Failed sign-in history requires Microsoft Entra ID Premium (P1/P2), which this tenant does not have.",
    });
  });
});

describe("getDeviceComplianceSignal", () => {
  it("reports no_intune_license for a tenant whose only device-management plan is the limited INTUNE_O365 (the real testbed tenant's shape)", async () => {
    mockGraphFetchForTenant.mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            skuPartNumber: "ENTERPRISEPACK",
            servicePlans: [{ servicePlanName: "INTUNE_O365", provisioningStatus: "PendingActivation" }],
          },
        ],
      }),
    );
    const result = await getDeviceComplianceSignal("tenant-1");
    expect(result).toMatchObject({ available: false, reason: "no_intune_license" });
    expect(mockGraphFetchForTenant).toHaveBeenCalledTimes(1); // never calls /deviceManagement without a real entitlement
  });

  it("returns real compliance counts for a tenant with an active full-Intune entitlement", async () => {
    mockGraphFetchForTenant
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            { skuPartNumber: "SPE_E5", servicePlans: [{ servicePlanName: "INTUNE_A", provisioningStatus: "Success" }] },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            { id: "d1", complianceState: "compliant" },
            { id: "d2", complianceState: "noncompliant" },
            { id: "d3", complianceState: "compliant" },
          ],
        }),
      );
    const result = await getDeviceComplianceSignal("tenant-1");
    expect(result).toEqual({ available: true, totalDevices: 3, compliantCount: 2, noncompliantCount: 1 });
  });
});

describe("getLocalFailedLoginSignal", () => {
  it("returns this user's own real local login-lockout state — not a Graph call", async () => {
    mockUsersResultQueue.push([
      { failedLoginAttempts: 2, lastFailedLoginAt: new Date("2026-08-29T10:00:00Z"), lockedUntil: null },
    ]);
    const result = await getLocalFailedLoginSignal(42);
    expect(result).toEqual({
      available: true,
      failedAttempts: 2,
      lastFailedLoginAt: "2026-08-29T10:00:00.000Z",
      lockedUntil: null,
    });
    expect(mockGraphFetchForTenant).not.toHaveBeenCalled();
  });

  it("reports a still-active lockedUntil, but clears one that has already lapsed", async () => {
    const future = new Date(Date.now() + 60_000);
    mockUsersResultQueue.push([{ failedLoginAttempts: 5, lastFailedLoginAt: null, lockedUntil: future }]);
    const active = await getLocalFailedLoginSignal(42);
    expect(active).toMatchObject({ lockedUntil: future.toISOString() });

    const past = new Date(Date.now() - 60_000);
    mockUsersResultQueue.push([{ failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: past }]);
    const lapsed = await getLocalFailedLoginSignal(42);
    expect(lapsed).toMatchObject({ lockedUntil: null });
  });

  it("reports available:false rather than a fabricated zero when the user row can't be found", async () => {
    mockUsersResultQueue.push([]);
    const result = await getLocalFailedLoginSignal(999);
    expect(result).toEqual({ available: false, reason: "error", detail: "No user row found for this account." });
  });
});
