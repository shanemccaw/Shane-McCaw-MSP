import { describe, it, expect, vi } from "vitest";

// risk-authority.ts pulls in the real "@workspace/db" module (transitively via
// tenant-workloads.ts and portal-customer-scope.ts), which throws at import
// time without a live DATABASE_URL — same stub pattern tenant-workloads.test.ts
// already uses. These tests only exercise the pure resolution function; the
// DB-backed queries (currentAHolderPersonIds, aHoldersAsOf, namesForPersonIds)
// are proven against the real local database in-session rather than mocked
// here, since mocking drizzle's chained query builder would test the mock, not
// the query.
vi.mock("@workspace/db", () => {
  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));
  return {
    db: { select: vi.fn(), transaction: vi.fn() },
    monitorChecksTable: tbl(["key", "status", "endpoint"]),
    tenantMonitorProfilesTable: tbl(["tenantId", "checkKey", "rawResponse", "collectedAt", "status"]),
    tenantServicePlansTable: tbl(["mspId", "tenantId", "servicePlanId"]),
    tenantsTable: tbl(["id", "mspId", "tenantId"]),
    skuPriceReferenceTable: tbl(["skuPartNumber"]),
    portalOwnershipAssignmentsTable: tbl(["customerId", "objectId", "roleKey", "ownerPersonId", "orderRank", "id"]),
    portalOwnershipEventsTable: tbl(["customerId", "objectId", "roleKey", "ownerPersonId", "createdAt"]),
    usersTable: tbl(["id", "email", "name", "tenantId", "mspId"]),
  };
});

import { resolveRiskWorkload } from "./risk-authority.ts";

describe("resolveRiskWorkload", () => {
  it("resolves a real checkKey to its workload's matrix object id", () => {
    expect(resolveRiskWorkload("identity:mfa-registration")).toEqual({
      objectId: "wl-icam",
      key: "icam",
      label: "Identity & Access (Entra ID)",
    });
    expect(resolveRiskWorkload("exchange:distribution-list-count")).toEqual({
      objectId: "wl-exchange",
      key: "exchange",
      label: "Exchange Online",
    });
  });

  it("returns null for a null checkKey — a free-standing liability record with no automated check behind it", () => {
    expect(resolveRiskWorkload(null)).toBeNull();
  });

  it("returns null for a checkKey whose category has no single-workload owner", () => {
    expect(resolveRiskWorkload("cost:unused-unassigned-licenses")).toBeNull();
    expect(resolveRiskWorkload("appgov:stale-app-registrations")).toBeNull();
  });
});
