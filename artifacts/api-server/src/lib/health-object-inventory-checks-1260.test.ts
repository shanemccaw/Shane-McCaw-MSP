/**
 * Git #1260 — the 4 missing Health page stale-object-inventory checks.
 *
 * #1229 found 4 of 9 hltDashboardData.ts HLT_OBJECTS rows already backed by a
 * real check, and left the other 5 (stale device records, duplicate device
 * records, service principals with no sign-in, empty security groups,
 * unassigned Intune profiles) on fixture rather than half-fill the section.
 * This pins the 4 new checks' real config
 * (lib/db/migrations/manual/2026-08-24-health-object-inventory-4-missing-checks-1260.sql)
 * against fixtures shaped like real Graph payloads for each endpoint, so the
 * transforms are proven by behaviour, matching the #551 test's own pattern.
 */

import { describe, it, expect, vi } from "vitest";

// applyMapping/classifySeverity are pure, but monitor-executor.ts imports
// @workspace/db at module scope, which throws without a DATABASE_URL (none in
// this environment).
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantCheckItemDetailsTable: {},
  tenantsTable: {},
}));

import { applyMapping, classifySeverity } from "./monitor-executor";
import type { MappingRule, SeverityRule } from "./monitor-executor";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ══════════════════════════════════════════════════════════════════════════
// devices:stale-duplicate-records
// ══════════════════════════════════════════════════════════════════════════

describe("#1260 — devices:stale-duplicate-records", () => {
  const MAPPING: MappingRule[] = [
    { sourceField: "approximateLastSignInDateTime", targetField: "staleDeviceRecordCount", transform: "countWhere('{{approximateLastSignInDateTime}} == null || {{approximateLastSignInDateTime}} olderThanDays 90')" },
    { sourceField: "deviceId", targetField: "duplicateDeviceRecordCount", transform: "countDuplicates" },
  ];
  const SEVERITY_RULES: SeverityRule[] = [
    { severity: "warning", expression: "{{staleDeviceRecordCount}} > 0", label: "{{staleDeviceRecordCount}} device record(s) with no sign-in in 90+ days (or never signed in)" },
    { severity: "warning", expression: "{{duplicateDeviceRecordCount}} > 0", label: "{{duplicateDeviceRecordCount}} device record(s) share a hardware ID" },
  ];

  function device(name: string, deviceId: string, lastSignIn: string | null): Record<string, unknown> {
    return { id: `objid-${name}`, displayName: name, deviceId, approximateLastSignInDateTime: lastSignIn };
  }

  it("counts records at/over the 90-day cutoff as stale, recent ones not", () => {
    const devices = [
      device("Fresh Laptop", "hw-1", daysAgoIso(5)),
      device("Recent Phone", "hw-2", daysAgoIso(45)),
      device("Old Tablet", "hw-3", daysAgoIso(412)),
      device("Ancient Desktop", "hw-4", daysAgoIso(900)),
    ];
    const result = applyMapping(devices, MAPPING, []);
    expect(result.staleDeviceRecordCount).toBe(2);
  });

  it("a null approximateLastSignInDateTime (never signed in) counts as stale, not excluded", () => {
    const devices = [
      device("Never Signed In", "hw-1", null),
      device("Recent", "hw-2", daysAgoIso(5)),
    ];
    const result = applyMapping(devices, MAPPING, []);
    expect(result.staleDeviceRecordCount).toBe(1);
  });

  it("counts BOTH copies of a re-enrolled device that shares a hardware ID", () => {
    const devices = [
      device("Laptop (old enrollment)", "hw-dup", daysAgoIso(5)),
      device("Laptop (re-enrolled)", "hw-dup", daysAgoIso(1)),
      device("Unique Phone", "hw-unique", daysAgoIso(1)),
    ];
    const result = applyMapping(devices, MAPPING, []);
    expect(result.duplicateDeviceRecordCount).toBe(2);
  });

  it("a clean tenant (no stale, no duplicate) reports zero on both fields and matches no severity rule", () => {
    const devices = [
      device("Laptop A", "hw-a", daysAgoIso(1)),
      device("Laptop B", "hw-b", daysAgoIso(2)),
    ];
    const result = applyMapping(devices, MAPPING, []);
    expect(result.staleDeviceRecordCount).toBe(0);
    expect(result.duplicateDeviceRecordCount).toBe(0);
    expect(classifySeverity(SEVERITY_RULES, result)).toBeNull();
  });

  it("fires a warning once either count is nonzero", () => {
    const devices = [device("Old Tablet", "hw-1", daysAgoIso(412))];
    const result = applyMapping(devices, MAPPING, []);
    const match = classifySeverity(SEVERITY_RULES, result);
    expect(match?.severity).toBe("warning");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// devices:unassigned-intune-profiles
// ══════════════════════════════════════════════════════════════════════════

describe("#1260 — devices:unassigned-intune-profiles", () => {
  const MAPPING: MappingRule[] = [
    { sourceField: "assignments", targetField: "unassignedIntuneProfileCount", transform: "countEmptyArray" },
    { sourceField: "id", targetField: "intuneProfileCount", transform: "count" },
  ];

  function profile(name: string, assignments: unknown[]): Record<string, unknown> {
    return { id: `objid-${name}`, displayName: name, assignments };
  }

  it("counts profiles whose expanded assignments array is empty", () => {
    const profiles = [
      profile("Orphan Profile", []),
      profile("Assigned Profile", [{ id: "assignment-1" }]),
      profile("Another Orphan", []),
    ];
    const result = applyMapping(profiles, MAPPING, []);
    expect(result.unassignedIntuneProfileCount).toBe(2);
    expect(result.intuneProfileCount).toBe(3);
  });

  it("a tenant where every profile is assigned reports zero, not the item count", () => {
    const profiles = [
      profile("Profile A", [{ id: "a1" }]),
      profile("Profile B", [{ id: "b1" }, { id: "b2" }]),
    ];
    const result = applyMapping(profiles, MAPPING, []);
    expect(result.unassignedIntuneProfileCount).toBe(0);
  });

  it("a missing $expand (assignments key absent entirely) under-reports to zero rather than the whole estate", () => {
    // The honest-failure path countEmptyArray's own docstring describes: no
    // array seen anywhere means 0, not "every profile is unassigned".
    const profiles = [{ id: "objid-1", displayName: "No Expand" }];
    const result = applyMapping(profiles, MAPPING, []);
    expect(result.unassignedIntuneProfileCount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// governance:empty-security-groups
// ══════════════════════════════════════════════════════════════════════════

describe("#1260 — governance:empty-security-groups", () => {
  const MAPPING: MappingRule[] = [
    { sourceField: "members", targetField: "emptySecurityGroupCount", transform: "countEmptyArray" },
    { sourceField: "id", targetField: "securityGroupCount", transform: "count" },
  ];

  function group(name: string, members: unknown[]): Record<string, unknown> {
    return { id: `objid-${name}`, displayName: name, members };
  }

  it("counts groups whose expanded members array is empty", () => {
    const groups = [
      group("CA Exclusion Group", []),
      group("Finance Team", [{ id: "user-1" }, { id: "user-2" }]),
      group("Stale Project Group", []),
    ];
    const result = applyMapping(groups, MAPPING, []);
    expect(result.emptySecurityGroupCount).toBe(2);
    expect(result.securityGroupCount).toBe(3);
  });

  it("a tenant with no empty security groups reports zero", () => {
    const groups = [group("Team A", [{ id: "u1" }]), group("Team B", [{ id: "u2" }])];
    const result = applyMapping(groups, MAPPING, []);
    expect(result.emptySecurityGroupCount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// appgov:dormant-service-principals
// ══════════════════════════════════════════════════════════════════════════

describe("#1260 — appgov:dormant-service-principals", () => {
  const MAPPING: MappingRule[] = [
    { sourceField: "appRoleAssignedTo", targetField: "dormantServicePrincipalCount", transform: "countEmptyArray" },
    { sourceField: "id", targetField: "servicePrincipalCount", transform: "count" },
  ];

  function sp(name: string, appRoleAssignedTo: unknown[]): Record<string, unknown> {
    // Real servicePrincipal shape carries no signInActivity and no
    // createdDateTime — the whole reason this check cannot be age- or
    // usage-based. Deliberately omitted here to prove the mapping never
    // depends on either.
    return { id: `objid-${name}`, displayName: name, accountEnabled: true, servicePrincipalType: "Application", appRoleAssignedTo };
  }

  it("counts service principals with zero app role assignments as dormant", () => {
    const sps = [
      sp("Legacy Reporting Service", []),
      sp("Active CRM Integration", [{ id: "assignment-1" }]),
      sp("Forgotten Migration Tool", []),
    ];
    const result = applyMapping(sps, MAPPING, []);
    expect(result.dormantServicePrincipalCount).toBe(2);
    expect(result.servicePrincipalCount).toBe(3);
  });

  it("a service principal with any assignment at all is not counted, regardless of accountEnabled", () => {
    const sps = [{ ...sp("Disabled But Assigned", [{ id: "a1" }]), accountEnabled: false }];
    const result = applyMapping(sps, MAPPING, []);
    expect(result.dormantServicePrincipalCount).toBe(0);
  });

  it("the mapping never reads signInActivity or createdDateTime — absent on real servicePrincipal payloads", () => {
    const withExtraneousFields = {
      ...sp("Confusable", []),
      signInActivity: { lastSignInDateTime: daysAgoIso(9999) },
      createdDateTime: daysAgoIso(1),
    };
    const result = applyMapping([withExtraneousFields], MAPPING, []);
    // Still dormant — the extra fields (which real servicePrincipal payloads
    // never actually carry) have no bearing on the emptyArray predicate.
    expect(result.dormantServicePrincipalCount).toBe(1);
  });
});

/**
 * Package wiring — not exercised through the DB (no DATABASE_URL here), so
 * this pins the MIGRATION FILE'S own SQL text, mirroring #551's own test.
 */
describe("#1260 — package wiring: all 4 checks added to the 4 confirmed-live packages, idempotently", () => {
  it("the migration wires each new check into core:enhanced-monitoring / core:growth / core:premier / detail:full-item-collection", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migrationPath = path.resolve(
      __dirname,
      "../../../../lib/db/migrations/manual/2026-08-24-health-object-inventory-4-missing-checks-1260.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    for (const key of [
      "devices:stale-duplicate-records",
      "devices:unassigned-intune-profiles",
      "governance:empty-security-groups",
      "appgov:dormant-service-principals",
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
    for (const pkg of ["core:enhanced-monitoring", "core:growth", "core:premier", "detail:full-item-collection"]) {
      expect(sql).toContain(`'${pkg}'`);
    }
    expect(sql).toContain("INSERT INTO monitoring_package_checks");
    expect(sql).toContain("ON CONFLICT (package_key, check_key) DO NOTHING");
    expect(sql).toContain("ON CONFLICT (key) DO NOTHING");
  });
});
