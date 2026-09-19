/**
 * Git #4839 — four census checks stored their TOTAL as the flagged count.
 *
 * Pins the four rewritten `monitor_checks.mapping` rules by behaviour. The mappings are read out of the
 * migration file itself (lib/db/migrations/manual/2026-09-19-census-checks-real-filters-4839.sql), so this
 * test cannot pass against a copy that has drifted from what actually gets run. Report rows are parsed from
 * CSV text shaped like Graph's getTeamsTeamActivityDetail output, through the executor's own parseCsvReport.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";

// monitor-executor.ts imports @workspace/db at module scope, which throws without a DATABASE_URL.
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantCheckItemDetailsTable: {},
  tenantsTable: {},
}));

import { applyMapping, parseCsvReport } from "./monitor-executor.ts";
import type { MappingRule } from "./monitor-executor.ts";
import { toSiteInventoryItem } from "./sharepoint-admin.ts";

const MIGRATION = readFileSync(
  new URL("../../../../lib/db/migrations/manual/2026-09-19-census-checks-real-filters-4839.sql", import.meta.url),
  "utf8",
);

function migrationMapping(checkKey: string): MappingRule[] {
  const block = MIGRATION.split("UPDATE monitor_checks").find((b) => b.includes(`WHERE key = '${checkKey}'`));
  const json = block && /\$j\$(.*?)\$j\$/s.exec(block)?.[1];
  if (!json) throw new Error(`no mapping for ${checkKey} in the migration`);
  return JSON.parse(json) as MappingRule[];
}

const TEAMS_CSV = [
  "Report Refresh Date,Team Id,Team Name,Last Activity Date,Team Type,Is Deleted,Report Period,Active Users,Guests",
  // active, has a guest
  "2026-09-14,t1,Alpha,2026-09-10,Private,False,90,7,2",
  // active, no guests
  "2026-09-14,t2,Beta,2026-09-12,Public,False,90,3,0",
  // nothing in the window (blank last-activity), no guests
  "2026-09-14,t3,Gamma,,Private,False,90,0,0",
  // stale (older than the window), one guest
  "2026-09-14,t4,Delta,2023-10-06,Public,False,90,0,1",
  // deleted team that would otherwise count on both signals
  "2026-09-14,t5,Epsilon,,Private,True,90,0,4",
].join("\r\n");

describe("#4839 — Teams checks over the activity report", () => {
  const rows = parseCsvReport(TEAMS_CSV);

  it("teams:inactive-teams counts non-deleted teams with no active users, not the total", () => {
    const out = applyMapping(rows, migrationMapping("teams:inactive-teams"), []);
    expect(out.inactiveTeamCount).toBe(2); // Gamma + Delta; Epsilon is deleted
    expect(out._itemCount).toBe(5);
  });

  it("teams:guest-membership counts non-deleted teams with guests, not the total", () => {
    const out = applyMapping(rows, migrationMapping("teams:guest-membership"), []);
    expect(out.teamsWithGuestsCount).toBe(2); // Alpha + Delta; Epsilon is deleted
    expect(out._itemCount).toBe(5);
  });

  it("reports 0, not the total, when no team qualifies", () => {
    const none = parseCsvReport(
      ["Team Name,Is Deleted,Active Users,Guests", "A,False,4,0", "B,False,1,0"].join("\n"),
    );
    expect(applyMapping(none, migrationMapping("teams:inactive-teams"), []).inactiveTeamCount).toBe(0);
    expect(applyMapping(none, migrationMapping("teams:guest-membership"), []).teamsWithGuestsCount).toBe(0);
  });

  it("fails closed rather than counting 0 when the report lacks the column (requireField)", () => {
    const noColumns = parseCsvReport(["Team Name,Is Deleted", "A,False"].join("\n"));
    expect(() => applyMapping(noColumns, migrationMapping("teams:guest-membership"), [])).not.toThrow();
    const out = applyMapping(noColumns, migrationMapping("teams:guest-membership"), []);
    expect(out).not.toHaveProperty("teamsWithGuestsCount");
  });
});

const GUID_A = "5b4f2d3c-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function site(over: Record<string, unknown>): Record<string, unknown> {
  return { Url: "https://t.sharepoint.com/sites/x", Title: "X", Template: "GROUP#0", StorageUsage: 10, StorageMaximumLevel: 1000, SensitivityLabel: `/Guid(${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)})/`, ...over };
}

describe("#4839 — toSiteInventoryItem", () => {
  it("treats the all-zero guid CSOM returns for an unlabelled site as no label", () => {
    const item = toSiteInventoryItem(site({}));
    expect(item.hasSensitivityLabel).toBe(false);
    expect(item.sensitivityLabelId).toBeNull();
  });

  it("recognises a real label guid, wrapped or bare", () => {
    expect(toSiteInventoryItem(site({ SensitivityLabel: `/Guid(${GUID_A})/` })).sensitivityLabelId).toBe(GUID_A);
    expect(toSiteInventoryItem(site({ SensitivityLabel: GUID_A.toUpperCase() })).hasSensitivityLabel).toBe(true);
  });

  it("treats a missing or unparseable label as none rather than guessing", () => {
    expect(toSiteInventoryItem(site({ SensitivityLabel: undefined })).hasSensitivityLabel).toBe(false);
    expect(toSiteInventoryItem(site({ SensitivityLabel: "Confidential" })).hasSensitivityLabel).toBe(false);
  });

  it("derives storage percent from usage over the site's own quota; null when the quota is not positive", () => {
    expect(toSiteInventoryItem(site({ StorageUsage: 900, StorageMaximumLevel: 1000 })).storageUsedPercent).toBe(90);
    expect(toSiteInventoryItem(site({ StorageMaximumLevel: 0 })).storageUsedPercent).toBeNull();
  });
});

describe("#4839 — SharePoint checks over the site inventory", () => {
  const inventory = [
    toSiteInventoryItem(site({ Url: "u1", StorageUsage: 10, StorageMaximumLevel: 1000 })),
    toSiteInventoryItem(site({ Url: "u2", StorageUsage: 900, StorageMaximumLevel: 1000, SensitivityLabel: `/Guid(${GUID_A})/` })),
    toSiteInventoryItem(site({ Url: "u3", StorageUsage: 899, StorageMaximumLevel: 1000 })),
    toSiteInventoryItem(site({ Url: "u4", StorageUsage: 5, StorageMaximumLevel: 0 })),
  ] as unknown as Record<string, unknown>[];

  it("sharepoint:site-label-coverage counts only labelled sites", () => {
    const out = applyMapping(inventory, migrationMapping("sharepoint:site-label-coverage"), []);
    expect(out.sitesWithLabelCount).toBe(1);
    expect(out._itemCount).toBe(4);
  });

  it("sharepoint:storage-near-limit counts sites at/over 90 % of quota, excluding 89.9 % and unknown quota", () => {
    const out = applyMapping(inventory, migrationMapping("sharepoint:storage-near-limit"), []);
    expect(out.sitesNearStorageLimitCount).toBe(1);
    expect(out._itemCount).toBe(4);
  });

  it("an all-unlabelled tenant reports 0 labelled sites", () => {
    const none = inventory.filter((s) => s.hasSensitivityLabel === false);
    expect(applyMapping(none, migrationMapping("sharepoint:site-label-coverage"), []).sitesWithLabelCount).toBe(0);
  });
});
