/**
 * Git #551 (final phase) — appgov:stale-app-registrations flagged EVERY app
 * registration as stale, unconditionally.
 *
 * The live audit (2026-08-07, re-confirmed 2026-08-12) settled the defect on
 * real tenant data:
 *     endpoint: /applications
 *     mapping:  [{countIfLastSignInOlderThan(180), createdDateTime -> staleAppRegistrationCount}]
 *     result:   item_count 11, staleAppRegistrationCount 11, severity_rules []
 *
 * `countIfLastSignInOlderThan` is hardcoded to read
 * `signInActivity.lastSignInDateTime` off each item — `application` objects
 * never carry that property (it lives on the service principal side), so the
 * miss branch ("never signed in" => stale) fires on every item regardless of
 * the `180` argument or the tenant's real data.
 *
 * This replays the fix's real config
 * (lib/db/migrations/manual/2026-08-12-stale-app-registrations-age-based-551.sql)
 * against fixtures shaped like a real /applications payload, so the
 * correction is pinned by behaviour rather than by the migration's own prose.
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

// ── The real config, mirroring the migration's UPDATE ─────────────────────────

const NEW_PROPERTIES = ["id", "displayName", "appId", "createdDateTime"];

const NEW_MAPPING: MappingRule[] = [
  { sourceField: "createdDateTime", targetField: "appRegistrationsOver180dCount", transform: "countWhere('{{createdDateTime}} olderThanDays 180')" },
  { sourceField: "createdDateTime", targetField: "appRegistrationsOver365dCount", transform: "countWhere('{{createdDateTime}} olderThanDays 365')" },
];

const SEVERITY_RULES: SeverityRule[] = [
  { severity: "critical", expression: "{{appRegistrationsOver365dCount}} > 0", label: "{{appRegistrationsOver365dCount}} app registration(s) over a year old, unreviewed" },
  { severity: "warning", expression: "{{appRegistrationsOver180dCount}} > 0", label: "{{appRegistrationsOver180dCount}} app registration(s) over 180 days old, unreviewed" },
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** One entry of a real GET /applications payload — never carries signInActivity. */
function appRegistration(name: string, createdDateTime: string, appId = `app-${name}`): Record<string, unknown> {
  return {
    id: `objid-${name}`,
    appId,
    displayName: name,
    createdDateTime,
    // NOTE: no `signInActivity` key. That is the whole defect — the old
    // config's transform reads signInActivity.lastSignInDateTime and this
    // resource has never carried it.
  };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("#551 — the defect: countIfLastSignInOlderThan fires on every /applications item", () => {
  const OLD_MAPPING: MappingRule[] = [
    { sourceField: "createdDateTime", targetField: "staleAppRegistrationCount", transform: "countIfLastSignInOlderThan(180)" },
  ];

  // Mirrors the live tenant: 11 app registrations, some created weeks ago,
  // some years ago — genuinely different ages.
  const APPS = [
    appRegistration("Two Weeks Old", daysAgoIso(14)),
    appRegistration("Four Weeks Old", daysAgoIso(28)),
    appRegistration("Ninety Days Old", daysAgoIso(90)),
    appRegistration("Six Months Old", daysAgoIso(200)),
    appRegistration("One Year Old", daysAgoIso(400)),
    appRegistration("Five Years Old", daysAgoIso(1825)),
    appRegistration("Legacy App A", daysAgoIso(2000)),
    appRegistration("Legacy App B", daysAgoIso(2200)),
    appRegistration("Legacy App C", daysAgoIso(2500)),
    appRegistration("Legacy App D", daysAgoIso(3000)),
    appRegistration("Legacy App E", daysAgoIso(3500)),
  ];

  it("reproduces the live defect exactly: 11/11 read as stale, including 2- and 4-week-old apps", () => {
    const result = applyMapping(APPS, OLD_MAPPING, NEW_PROPERTIES);
    expect(result.staleAppRegistrationCount).toBe(APPS.length);
  });

  it("the 180 argument is completely inert — any window produces the same 11/11", () => {
    const withDifferentWindow: MappingRule[] = [
      { sourceField: "createdDateTime", targetField: "staleAppRegistrationCount", transform: "countIfLastSignInOlderThan(999999)" },
    ];
    const result = applyMapping(APPS, withDifferentWindow, NEW_PROPERTIES);
    expect(result.staleAppRegistrationCount).toBe(APPS.length);
  });

  it("never fires a finding, because severity_rules was empty", () => {
    const result = applyMapping(APPS, OLD_MAPPING, NEW_PROPERTIES);
    expect(classifySeverity([], result)).toBeNull();
  });
});

describe("#551 — the fix: countWhere('{{createdDateTime}} olderThanDays N') discriminates by real age", () => {
  const APPS = [
    appRegistration("Two Weeks Old", daysAgoIso(14)),
    appRegistration("Four Weeks Old", daysAgoIso(28)),
    appRegistration("Ninety Days Old", daysAgoIso(90)),
    appRegistration("Six Months Old", daysAgoIso(200)),
    appRegistration("One Year Old", daysAgoIso(400)),
    appRegistration("Five Years Old", daysAgoIso(1825)),
  ];

  it("only genuinely old items count at the 180-day cutoff", () => {
    const result = applyMapping(APPS, NEW_MAPPING, NEW_PROPERTIES);
    // 200d, 400d, 1825d are older than 180 days; 14d/28d/90d are not.
    expect(result.appRegistrationsOver180dCount).toBe(3);
  });

  it("the 365-day cutoff is a strict subset of the 180-day cutoff", () => {
    const result = applyMapping(APPS, NEW_MAPPING, NEW_PROPERTIES);
    // Only 400d and 1825d clear a full year.
    expect(result.appRegistrationsOver365dCount).toBe(2);
    expect(result.appRegistrationsOver365dCount as number)
      .toBeLessThanOrEqual(result.appRegistrationsOver180dCount as number);
  });

  it("does NOT read signInActivity at all — the fix has no dependency on the missing property", () => {
    // A registration with a (nonsensical, but present) signInActivity block
    // must not change the result — the new predicate never looks at it.
    const withSignInActivity = {
      ...appRegistration("Confusable", daysAgoIso(5)),
      signInActivity: { lastSignInDateTime: daysAgoIso(9999) },
    };
    const result = applyMapping([withSignInActivity], NEW_MAPPING, NEW_PROPERTIES);
    expect(result.appRegistrationsOver180dCount).toBe(0);
    expect(result.appRegistrationsOver365dCount).toBe(0);
  });

  it("a tenant with no old app registrations reports zero on both fields, not the item count", () => {
    const recentOnly = [
      appRegistration("Brand New", daysAgoIso(1)),
      appRegistration("Two Weeks Old", daysAgoIso(14)),
    ];
    const result = applyMapping(recentOnly, NEW_MAPPING, NEW_PROPERTIES);
    expect(result.appRegistrationsOver180dCount).toBe(0);
    expect(result.appRegistrationsOver365dCount).toBe(0);
  });

  it("per-app identity (name, app ID, creation date) is still captured via raw property extraction", () => {
    const result = applyMapping(APPS, NEW_MAPPING, NEW_PROPERTIES);
    expect(result.displayName_count).toBe(APPS.length);
    expect(result.appId_count).toBe(APPS.length);
    expect(result.createdDateTime_values).toHaveLength(APPS.length);
  });
});

describe("#551 — severity bands over the real age counts", () => {
  function agedAppsFixture(over180: number, over365: number): Record<string, unknown> {
    const apps = [
      ...Array.from({ length: over365 }, (_, i) => appRegistration(`Legacy ${i}`, daysAgoIso(400))),
      ...Array.from({ length: over180 - over365 }, (_, i) => appRegistration(`Aging ${i}`, daysAgoIso(200))),
    ];
    return applyMapping(apps, NEW_MAPPING, NEW_PROPERTIES);
  }

  it("at least one registration over a year old is critical", () => {
    const match = classifySeverity(SEVERITY_RULES, agedAppsFixture(1, 1));
    expect(match?.severity).toBe("critical");
    expect(match?.label).toContain("over a year old");
  });

  it("registrations over 180 days but none over 365 days is a warning, not critical", () => {
    const match = classifySeverity(SEVERITY_RULES, agedAppsFixture(3, 0));
    expect(match?.severity).toBe("warning");
    expect(match?.label).toContain("180 days old");
  });

  it("a tenant with no aged app registrations at all matches no rule", () => {
    const clean = applyMapping(
      [appRegistration("Brand New", daysAgoIso(1))],
      NEW_MAPPING,
      NEW_PROPERTIES,
    );
    expect(classifySeverity(SEVERITY_RULES, clean)).toBeNull();
  });

  it("bands are evaluated critical-first, so a tenant with both counts nonzero reads critical", () => {
    // Both {{appRegistrationsOver365dCount}} > 0 and {{appRegistrationsOver180dCount}} > 0
    // are true here; rule order is what makes the answer critical rather than warning.
    const match = classifySeverity(SEVERITY_RULES, agedAppsFixture(5, 2));
    expect(match?.severity).toBe("critical");
  });
});

/**
 * Issue item 5 — package membership. Not exercised through the DB (no
 * DATABASE_URL here), so this pins the MIGRATION FILE'S own SQL text rather
 * than live state, mirroring how the rest of this suite pins behaviour
 * against the file the migration actually ships.
 */
describe("#551 — package wiring: assess:copilot-readiness membership added idempotently", () => {
  it("the migration inserts appgov:stale-app-registrations into assess:copilot-readiness with ON CONFLICT DO NOTHING", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const migrationPath = path.resolve(
      __dirname,
      "../../../../lib/db/migrations/manual/2026-08-12-stale-app-registrations-age-based-551.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("'assess:copilot-readiness'");
    expect(sql).toContain("'appgov:stale-app-registrations'");
    expect(sql).toContain("INSERT INTO monitoring_package_checks");
    expect(sql).toContain("ON CONFLICT (package_key, check_key) DO NOTHING");
  });
});
