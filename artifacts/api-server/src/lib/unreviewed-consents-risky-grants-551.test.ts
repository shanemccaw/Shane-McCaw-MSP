/**
 * Git #551 Phase 3 — appgov:unreviewed-consents and appgov:risky-permission-grants
 * both computed the same bare count() of every /oauth2PermissionGrants row (37 on
 * the live test tenant, c4c814d4-3afe-441e-9145-62461d0a4fd3), under two different
 * names. This replays the fix's mapping + severity_rules
 * (lib/db/migrations/manual/2026-08-08-unreviewed-consents-risky-grants-consenttype-551.sql)
 * against a fixture shaped like the confirmed live split: 24 consentType
 * AllPrincipals, 13 consentType Principal, 37 total.
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
  tenantsTable: {},
}));

import { applyMapping, classifySeverity } from "./monitor-executor";
import type { MappingRule, SeverityRule } from "./monitor-executor";

// Mirrors the migration's UPDATE for appgov:unreviewed-consents.
const UNREVIEWED_CONSENTS_MAPPING: MappingRule[] = [
  { sourceField: "consentType", targetField: "totalConsentGrantCount", transform: "count" },
  { sourceField: "consentType", targetField: "unreviewedConsentCount", transform: "countEquals('Principal')" },
];
const UNREVIEWED_CONSENTS_RULES: SeverityRule[] = [
  {
    severity: "high",
    expression: "{{unreviewedConsentCount}} > 0",
    label: "{{unreviewedConsentCount}} of {{totalConsentGrantCount}} OAuth consent grant(s) were self-consented by an end user with no administrator review (consentType Principal)",
  },
];

// Mirrors the migration's UPDATE for appgov:risky-permission-grants.
const RISKY_PERMISSION_GRANTS_MAPPING: MappingRule[] = [
  { sourceField: "consentType", targetField: "totalConsentGrantCount", transform: "count" },
  { sourceField: "consentType", targetField: "riskyPermissionGrantCount", transform: "countEquals('AllPrincipals')" },
];
const RISKY_PERMISSION_GRANTS_RULES: SeverityRule[] = [
  {
    severity: "critical",
    expression: "{{riskyPermissionGrantCount}} >= 15",
    label: "{{riskyPermissionGrantCount}} of {{totalConsentGrantCount}} OAuth consent grant(s) are tenant-wide (consentType AllPrincipals) -- each one lets its application act as ANY user in this tenant",
  },
  {
    severity: "warning",
    expression: "{{riskyPermissionGrantCount}} >= 5",
    label: "{{riskyPermissionGrantCount}} of {{totalConsentGrantCount}} OAuth consent grant(s) are tenant-wide (consentType AllPrincipals) -- each one lets its application act as ANY user in this tenant",
  },
];

function grant(consentType: "AllPrincipals" | "Principal", i: number): Record<string, unknown> {
  return {
    id: `grant-${consentType}-${i}`,
    clientId: "sp-guid",
    consentType,
    principalId: consentType === "Principal" ? "user-guid" : null,
    resourceId: "resource-guid",
    scope: "User.Read",
  };
}

// The confirmed live split: 24 AllPrincipals, 13 Principal, 37 total.
function liveShapedGrants(): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < 24; i++) items.push(grant("AllPrincipals", i));
  for (let i = 0; i < 13; i++) items.push(grant("Principal", i));
  return items;
}

describe("#551 Phase 3 — appgov:unreviewed-consents and appgov:risky-permission-grants", () => {
  it("documents the OLD mapping's bug: bare count() on consentType/scope both just count every grant, identically", () => {
    const items = liveShapedGrants();
    const oldUnreviewed = applyMapping(items, [
      { sourceField: "consentType", targetField: "unreviewedConsentCount", transform: "count" },
    ], []);
    const oldRisky = applyMapping(items, [
      { sourceField: "scope", targetField: "riskyPermissionGrantCount", transform: "count" },
    ], []);
    // Same 37 grants, twice, under two different field names — the exact
    // defect this migration exists to remove.
    expect(oldUnreviewed.unreviewedConsentCount).toBe(37);
    expect(oldRisky.riskyPermissionGrantCount).toBe(37);
  });

  it("splits the real consentType axis into two distinct, real numbers that reconcile to the total", () => {
    const items = liveShapedGrants();
    const unreviewed = applyMapping(items, UNREVIEWED_CONSENTS_MAPPING, []);
    const risky = applyMapping(items, RISKY_PERMISSION_GRANTS_MAPPING, []);

    expect(unreviewed.totalConsentGrantCount).toBe(37);
    expect(unreviewed.unreviewedConsentCount).toBe(13);

    expect(risky.totalConsentGrantCount).toBe(37);
    expect(risky.riskyPermissionGrantCount).toBe(24);

    // The two subsets partition the total — no grant is double-counted or lost.
    expect((unreviewed.unreviewedConsentCount as number) + (risky.riskyPermissionGrantCount as number))
      .toBe(37);
  });

  it("fires 'high' on the real unreviewed-consents split", () => {
    const extracted = { totalConsentGrantCount: 37, unreviewedConsentCount: 13 };
    expect(classifySeverity(UNREVIEWED_CONSENTS_RULES, extracted)).toEqual({
      severity: "high",
      label: "13 of 37 OAuth consent grant(s) were self-consented by an end user with no administrator review (consentType Principal)",
    });
  });

  it("unreviewed-consents stays clean when every grant was admin-consented (0 Principal grants)", () => {
    const items = Array.from({ length: 10 }, (_, i) => grant("AllPrincipals", i));
    const extracted = applyMapping(items, UNREVIEWED_CONSENTS_MAPPING, []);
    expect(extracted.unreviewedConsentCount).toBe(0);
    expect(classifySeverity(UNREVIEWED_CONSENTS_RULES, extracted)).toBe(null);
  });

  it("fires 'critical' on the real risky-permission-grants split (24 clears the >= 15 band)", () => {
    const extracted = { totalConsentGrantCount: 37, riskyPermissionGrantCount: 24 };
    expect(classifySeverity(RISKY_PERMISSION_GRANTS_RULES, extracted)).toEqual({
      severity: "critical",
      label: "24 of 37 OAuth consent grant(s) are tenant-wide (consentType AllPrincipals) -- each one lets its application act as ANY user in this tenant",
    });
  });

  it("risky-permission-grants does NOT fire on an ordinary small tenant's handful of first-party AllPrincipals grants (guards the '> 0 on a normal field' failure mode #541 warned against)", () => {
    // 3 Microsoft first-party AllPrincipals grants is completely ordinary
    // tenant setup, not a finding — a bare `> 0` rule would have fired here.
    const items = [
      grant("AllPrincipals", 0),
      grant("AllPrincipals", 1),
      grant("AllPrincipals", 2),
      grant("Principal", 0),
    ];
    const extracted = applyMapping(items, RISKY_PERMISSION_GRANTS_MAPPING, []);
    expect(extracted.riskyPermissionGrantCount).toBe(3);
    expect(classifySeverity(RISKY_PERMISSION_GRANTS_RULES, extracted)).toBe(null);
  });

  it("risky-permission-grants fires only 'warning', not 'critical', in the 5-14 band", () => {
    const items = Array.from({ length: 8 }, (_, i) => grant("AllPrincipals", i));
    const extracted = applyMapping(items, RISKY_PERMISSION_GRANTS_MAPPING, []);
    expect(extracted.totalConsentGrantCount).toBe(8);
    expect(extracted.riskyPermissionGrantCount).toBe(8);
    expect(classifySeverity(RISKY_PERMISSION_GRANTS_RULES, extracted)).toEqual({
      severity: "warning",
      label: "8 of 8 OAuth consent grant(s) are tenant-wide (consentType AllPrincipals) -- each one lets its application act as ANY user in this tenant",
    });
  });
});
