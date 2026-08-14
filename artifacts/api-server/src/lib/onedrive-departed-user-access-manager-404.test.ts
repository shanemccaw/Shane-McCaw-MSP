/**
 * Git #404 — onedrive:departed-user-access measured the wrong thing: plain
 * `accountEnabled == false` off GET /users, i.e. every disabled account in
 * the tenant, not a OneDrive exposure signal at all.
 *
 * The real mechanism (confirmed via research in the issue body): on account
 * deletion, Microsoft automatically grants the departed user's MANAGER (or a
 * designated secondary owner) access to their OneDrive — but only if one is
 * assigned. No manager assigned means nobody gets that automatic grant and
 * the content sits unhandled. This replays the fix's real config
 * (lib/db/migrations/manual/2026-08-14-onedrive-departed-user-access-manager-based-404.sql)
 * against fixtures shaped like a real GET /users?$expand=manager($select=id)
 * payload, covering all three plausible "no manager" response shapes (null,
 * absent key, empty object) since the live shape could not be confirmed here
 * (no DATABASE_URL/Graph credential in this environment).
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

const NEW_PROPERTIES = ["id", "accountEnabled", "manager", "signInActivity"];

const NEW_MAPPING: MappingRule[] = [
  { sourceField: "accountEnabled", targetField: "departedUserOneDriveExposureCount", transform: "countWhere('{{accountEnabled}} == false && {{manager.id}} == null')" },
  { sourceField: "accountEnabled", targetField: "departedUserOneDriveExposureOver30dCount", transform: "countWhere('{{accountEnabled}} == false && {{manager.id}} == null && {{signInActivity.lastSignInDateTime}} olderThanDays 30')" },
];

const SEVERITY_RULES: SeverityRule[] = [
  { severity: "critical", expression: "{{departedUserOneDriveExposureOver30dCount}} > 0", label: "{{departedUserOneDriveExposureOver30dCount}} departed-user OneDrive account(s) unhandled for over 30 days -- no manager was ever assigned to receive automatic access" },
  { severity: "warning", expression: "{{departedUserOneDriveExposureCount}} > 0", label: "{{departedUserOneDriveExposureCount}} departed-user OneDrive account(s) with no manager assigned -- automatic access transfer cannot occur" },
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function user(opts: {
  id: string;
  accountEnabled: boolean;
  manager?: unknown; // undefined = key absent entirely
  lastSignInDaysAgo?: number; // undefined = no signInActivity at all
}): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: opts.id,
    accountEnabled: opts.accountEnabled,
  };
  if (opts.manager !== undefined) item.manager = opts.manager;
  if (opts.lastSignInDaysAgo !== undefined) {
    item.signInActivity = { lastSignInDateTime: daysAgoIso(opts.lastSignInDaysAgo) };
  }
  return item;
}

describe("#404 — the defect: plain accountEnabled == false counts ALL disabled accounts", () => {
  const OLD_MAPPING: MappingRule[] = [
    { sourceField: "accountEnabled", targetField: "departedUserOneDriveTransferPendingCount", transform: "countWhere('{{accountEnabled}} == false')" },
  ];

  const USERS = [
    user({ id: "disabled-with-manager", accountEnabled: false, manager: { id: "mgr-1" }, lastSignInDaysAgo: 5 }),
    user({ id: "disabled-no-manager", accountEnabled: false, manager: null, lastSignInDaysAgo: 60 }),
    user({ id: "enabled-active", accountEnabled: true, manager: { id: "mgr-2" } }),
  ];

  it("reads a disabled account WITH a manager the same as one without — no exposure discrimination at all", () => {
    const result = applyMapping(USERS, OLD_MAPPING, NEW_PROPERTIES);
    // Both disabled accounts count, even though only one is genuinely unhandled.
    expect(result.departedUserOneDriveTransferPendingCount).toBe(2);
  });
});

describe("#404 — the fix: manager.id == null discriminates real OneDrive exposure", () => {
  it("a disabled account WITH a manager assigned does not count — automatic access transfer will occur", () => {
    const result = applyMapping(
      [user({ id: "u1", accountEnabled: false, manager: { id: "mgr-1" } })],
      NEW_MAPPING,
      NEW_PROPERTIES,
    );
    expect(result.departedUserOneDriveExposureCount).toBe(0);
  });

  it("an ENABLED account with no manager does not count — not departed", () => {
    const result = applyMapping(
      [user({ id: "u1", accountEnabled: true, manager: null })],
      NEW_MAPPING,
      NEW_PROPERTIES,
    );
    expect(result.departedUserOneDriveExposureCount).toBe(0);
  });

  describe("all three plausible 'no manager' response shapes count identically", () => {
    it("manager: null", () => {
      const result = applyMapping(
        [user({ id: "u1", accountEnabled: false, manager: null })],
        NEW_MAPPING,
        NEW_PROPERTIES,
      );
      expect(result.departedUserOneDriveExposureCount).toBe(1);
    });

    it("manager key absent entirely", () => {
      const result = applyMapping(
        [user({ id: "u1", accountEnabled: false })],
        NEW_MAPPING,
        NEW_PROPERTIES,
      );
      expect(result.departedUserOneDriveExposureCount).toBe(1);
    });

    it("manager: {} (empty object — id itself undefined)", () => {
      const result = applyMapping(
        [user({ id: "u1", accountEnabled: false, manager: {} })],
        NEW_MAPPING,
        NEW_PROPERTIES,
      );
      expect(result.departedUserOneDriveExposureCount).toBe(1);
    });
  });

  it("mixed tenant: only the genuinely unhandled disabled accounts count, not the whole disabled population", () => {
    const USERS = [
      user({ id: "disabled-with-manager", accountEnabled: false, manager: { id: "mgr-1" } }),
      user({ id: "disabled-no-manager-1", accountEnabled: false, manager: null }),
      user({ id: "disabled-no-manager-2", accountEnabled: false }),
      user({ id: "enabled-with-manager", accountEnabled: true, manager: { id: "mgr-2" } }),
      user({ id: "enabled-no-manager", accountEnabled: true, manager: null }),
    ];
    const result = applyMapping(USERS, NEW_MAPPING, NEW_PROPERTIES);
    expect(result.departedUserOneDriveExposureCount).toBe(2);
  });
});

describe("#404 — the age band: departedUserOneDriveExposureOver30dCount factors in how long it's sat unhandled", () => {
  it("a just-departed, manager-less account with recent sign-in does NOT count toward the 30d band (mid-offboarding)", () => {
    const result = applyMapping(
      [user({ id: "u1", accountEnabled: false, manager: null, lastSignInDaysAgo: 3 })],
      NEW_MAPPING,
      NEW_PROPERTIES,
    );
    expect(result.departedUserOneDriveExposureCount).toBe(1);
    expect(result.departedUserOneDriveExposureOver30dCount).toBe(0);
  });

  it("a manager-less account with no sign-in in 60 days counts toward the 30d band — genuinely stuck", () => {
    const result = applyMapping(
      [user({ id: "u1", accountEnabled: false, manager: null, lastSignInDaysAgo: 60 })],
      NEW_MAPPING,
      NEW_PROPERTIES,
    );
    expect(result.departedUserOneDriveExposureCount).toBe(1);
    expect(result.departedUserOneDriveExposureOver30dCount).toBe(1);
  });

  it("no signInActivity at all fails closed — does not count toward the 30d band (null timestamp, not treated as infinitely old)", () => {
    const result = applyMapping(
      [user({ id: "u1", accountEnabled: false, manager: null })],
      NEW_MAPPING,
      NEW_PROPERTIES,
    );
    expect(result.departedUserOneDriveExposureCount).toBe(1);
    expect(result.departedUserOneDriveExposureOver30dCount).toBe(0);
  });

  it("the 30d band is a strict subset of the unqualified exposure count", () => {
    const USERS = [
      user({ id: "u1", accountEnabled: false, manager: null, lastSignInDaysAgo: 60 }),
      user({ id: "u2", accountEnabled: false, manager: null, lastSignInDaysAgo: 45 }),
      user({ id: "u3", accountEnabled: false, manager: null, lastSignInDaysAgo: 3 }),
    ];
    const result = applyMapping(USERS, NEW_MAPPING, NEW_PROPERTIES);
    expect(result.departedUserOneDriveExposureCount).toBe(3);
    expect(result.departedUserOneDriveExposureOver30dCount).toBe(2);
    expect(result.departedUserOneDriveExposureOver30dCount as number)
      .toBeLessThanOrEqual(result.departedUserOneDriveExposureCount as number);
  });
});

describe("#404 — severity bands over the real exposure counts", () => {
  it("at least one account unhandled over 30 days is critical", () => {
    const USERS = [user({ id: "u1", accountEnabled: false, manager: null, lastSignInDaysAgo: 60 })];
    const result = applyMapping(USERS, NEW_MAPPING, NEW_PROPERTIES);
    const match = classifySeverity(SEVERITY_RULES, result);
    expect(match?.severity).toBe("critical");
    expect(match?.label).toContain("over 30 days");
  });

  it("unhandled accounts present but all recently departed (none over 30d) is a warning, not critical", () => {
    const USERS = [user({ id: "u1", accountEnabled: false, manager: null, lastSignInDaysAgo: 3 })];
    const result = applyMapping(USERS, NEW_MAPPING, NEW_PROPERTIES);
    const match = classifySeverity(SEVERITY_RULES, result);
    expect(match?.severity).toBe("warning");
    expect(match?.label).toContain("no manager assigned");
  });

  it("a tenant with no unhandled departed-user accounts at all matches no rule", () => {
    const USERS = [
      user({ id: "u1", accountEnabled: false, manager: { id: "mgr-1" } }),
      user({ id: "u2", accountEnabled: true, manager: null }),
    ];
    const result = applyMapping(USERS, NEW_MAPPING, NEW_PROPERTIES);
    expect(classifySeverity(SEVERITY_RULES, result)).toBeNull();
  });

  it("bands are evaluated critical-first, so a tenant with both counts nonzero reads critical", () => {
    const USERS = [
      user({ id: "u1", accountEnabled: false, manager: null, lastSignInDaysAgo: 60 }),
      user({ id: "u2", accountEnabled: false, manager: null, lastSignInDaysAgo: 3 }),
    ];
    const result = applyMapping(USERS, NEW_MAPPING, NEW_PROPERTIES);
    const match = classifySeverity(SEVERITY_RULES, result);
    expect(match?.severity).toBe("critical");
  });
});
