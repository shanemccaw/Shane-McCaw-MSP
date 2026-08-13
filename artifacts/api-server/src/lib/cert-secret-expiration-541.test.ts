/**
 * Git #541 — appgov:cert-secret-expiration never fired (empty severity_rules)
 * and its mapping counted ALL credentials, not expiring ones. This replays the
 * fix's mapping + severity_rules
 * (lib/db/migrations/manual/2026-08-07-cert-secret-expiration-mapping-severity-541.sql)
 * against a fixture shaped like the real testbed tenant
 * (c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com) the
 * issue describes: 11 real credentials across several app registrations,
 * several already expired (one from 2018, one from 2023, one that expired 3
 * days before the scan ran).
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

// Mirrors the migration's UPDATE for appgov:cert-secret-expiration.
const CERT_SECRET_EXPIRATION_MAPPING: MappingRule[] = [
  { sourceField: "passwordCredentials", targetField: "passwordCredentialCount", transform: "countWhere('{{keyId}} != null')" },
  { sourceField: "keyCredentials", targetField: "keyCredentialCount", transform: "countWhere('{{keyId}} != null')" },
  { sourceField: "passwordCredentials", targetField: "expiredPasswordCredentialCount", transform: "countWhere('{{endDateTime}} olderThanDays 0')" },
  { sourceField: "keyCredentials", targetField: "expiredKeyCredentialCount", transform: "countWhere('{{endDateTime}} olderThanDays 0')" },
];

const CERT_SECRET_EXPIRATION_RULES: SeverityRule[] = [
  {
    severity: "warning",
    expression: "{{expiredPasswordCredentialCount}} > 0 || {{expiredKeyCredentialCount}} > 0",
    label:
      "{{expiredPasswordCredentialCount}} expired secret(s) and {{expiredKeyCredentialCount}} expired certificate(s) found on this tenant's app registrations",
  },
];

// One /applications item per real app registration, credentials shaped as
// Graph actually returns them (endDateTime top-level on each entry).
function appRegistration(
  passwordEndDates: string[],
  keyEndDates: string[] = [],
): Record<string, unknown> {
  return {
    id: "app-id",
    passwordCredentials: passwordEndDates.map((endDateTime, i) => ({
      keyId: `pw-${i}`,
      endDateTime,
      startDateTime: "2015-01-01T00:00:00Z",
    })),
    keyCredentials: keyEndDates.map((endDateTime, i) => ({
      keyId: `key-${i}`,
      endDateTime,
      startDateTime: "2015-01-01T00:00:00Z",
      type: "AsymmetricX509Cert",
      usage: "Verify",
    })),
  };
}

describe("#541 — appgov:cert-secret-expiration mapping + severity rules", () => {
  it("documents the OLD mapping's actual bug: plain \"count\" on an array sourceField counts APPS with a non-null array, not credentials — deeper than the issue's own paraphrase", () => {
    // applyMapping's "count" case maps sourceField to ONE value PER ITEM
    // (resolvePathInData returns the whole array, or undefined), then counts
    // non-null values — i.e. it counts app registrations that HAVE a
    // passwordCredentials array, never the entries inside it. The issue's own
    // text describes the old mapping as counting "every credential the app
    // has" — real investigation (this test) shows it's actually coarser than
    // that: 3 apps with 8 total password credentials still reads 3, not 8.
    const OLD_MAPPING: MappingRule[] = [
      { sourceField: "passwordCredentials", targetField: "expiringCredentialCount", transform: "count" },
    ];
    const items = [
      appRegistration(["2018-06-01T00:00:00Z", "2099-01-01T00:00:00Z", "2099-06-01T00:00:00Z"]),
      appRegistration(["2023-03-15T00:00:00Z", "2099-01-01T00:00:00Z"]),
      appRegistration(["2099-01-01T00:00:00Z", "2099-06-01T00:00:00Z", "2099-06-02T00:00:00Z"]),
    ];
    const extracted = applyMapping(items, OLD_MAPPING, []);
    expect(extracted.expiringCredentialCount).toBe(3); // apps, not the real 8 credentials
  });

  it("counts only genuinely expired credentials, not the raw total (the mapping bug)", () => {
    // Real-shaped tenant: 11 total credentials across 3 apps, 3 expired
    // (2018, 2023, 3 days before a scan run "now").
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const items = [
      appRegistration(["2018-06-01T00:00:00Z", "2099-01-01T00:00:00Z", "2099-06-01T00:00:00Z"]),
      appRegistration(["2023-03-15T00:00:00Z", "2099-01-01T00:00:00Z"], ["2099-01-01T00:00:00Z"]),
      appRegistration([threeDaysAgo, "2099-01-01T00:00:00Z", "2099-06-01T00:00:00Z"], ["2099-01-01T00:00:00Z", "2099-06-01T00:00:00Z"]),
    ];

    const extracted = applyMapping(items, CERT_SECRET_EXPIRATION_MAPPING, []);

    expect(extracted.passwordCredentialCount).toBe(8);
    expect(extracted.keyCredentialCount).toBe(3);
    // Only the 3 truly-expired-in-the-past entries count, not the 8 total —
    // this is the field the old mapping never produced at all.
    expect(extracted.expiredPasswordCredentialCount).toBe(3);
    expect(extracted.expiredKeyCredentialCount).toBe(0);
  });

  it("fires a real warning finding on the real expired-credential shape (the severity_rules bug)", () => {
    const extracted = {
      passwordCredentialCount: 8,
      keyCredentialCount: 3,
      expiredPasswordCredentialCount: 3,
      expiredKeyCredentialCount: 0,
    };
    expect(classifySeverity(CERT_SECRET_EXPIRATION_RULES, extracted)).toEqual({
      severity: "warning",
      label: "3 expired secret(s) and 0 expired certificate(s) found on this tenant's app registrations",
    });
  });

  it("stays clean (previously always did, now for the right reason) when nothing is actually expired", () => {
    const items = [appRegistration(["2099-01-01T00:00:00Z"], ["2099-06-01T00:00:00Z"])];
    const extracted = applyMapping(items, CERT_SECRET_EXPIRATION_MAPPING, []);
    expect(extracted.expiredPasswordCredentialCount).toBe(0);
    expect(extracted.expiredKeyCredentialCount).toBe(0);
    expect(classifySeverity(CERT_SECRET_EXPIRATION_RULES, extracted)).toBe(null);
  });

  it("fires on an expired CERTIFICATE alone, with zero expired secrets — the previously-unmapped keyCredentials half", () => {
    const items = [appRegistration(["2099-01-01T00:00:00Z"], ["2019-01-01T00:00:00Z"])];
    const extracted = applyMapping(items, CERT_SECRET_EXPIRATION_MAPPING, []);
    expect(extracted.expiredPasswordCredentialCount).toBe(0);
    expect(extracted.expiredKeyCredentialCount).toBe(1);
    expect(classifySeverity(CERT_SECRET_EXPIRATION_RULES, extracted)).toEqual({
      severity: "warning",
      label: "0 expired secret(s) and 1 expired certificate(s) found on this tenant's app registrations",
    });
  });

  it("a healthy app with only future-dated credentials never fires (guards against the too-broad `> 0 on raw count` failure mode)", () => {
    // A single normal client secret, 2 years out — exactly the "having a
    // secret at all is normal" case the issue warned a naive fix would flag.
    const items = [appRegistration(["2028-01-01T00:00:00Z"])];
    const extracted = applyMapping(items, CERT_SECRET_EXPIRATION_MAPPING, []);
    expect(extracted.passwordCredentialCount).toBe(1);
    expect(extracted.expiredPasswordCredentialCount).toBe(0);
    expect(classifySeverity(CERT_SECRET_EXPIRATION_RULES, extracted)).toBe(null);
  });
});
