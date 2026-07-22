/**
 * build-tenant-profile.test.ts
 *
 * Regression test for tenant-signals.ts:buildTenantProfile — the single shared
 * profile builder every engine (priority, pricing, drift, forecasting, security,
 * sales_offer, health, crm) and the SOW generator route their signal evaluation
 * through.
 *
 * The exact production bug this locks in (2026-07-18): the old per-engine copies
 * resolved tenantId/mspId with `msp_users WHERE userId = <customerId>`, which
 * only ever matched when a customer's numeric id happened to coincide with an
 * active portal user's id. When that coincidence broke, tenantId came back null,
 * the tenant_monitor_profiles merge was skipped, and every threshold-based signal
 * silently evaluated to 0 with no error.
 *
 * The fix resolves the two independent id spaces explicitly:
 *   - tenantId/mspId  → `msp_customers WHERE id = customerId` (direct, no user)
 *   - profile/findings → keyed by the customer's ACTIVE portal user id, resolved
 *     via `msp_users WHERE customerId = customerId AND isActive = true`
 *
 * These tests prove monitor-derived signal inputs are populated for a customer
 * whose numeric id has NO matching `msp_users.userId` row — the precise scenario
 * that had zero coverage when it broke.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (must precede the import of the code under test) ──────────────
//
// Table objects are opaque identity markers here — the db mock only needs to
// tell them apart, so each is a distinct sentinel string tagged with its name.
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    selectDistinctOn: vi.fn(),
  },
  clientM365ProfilesTable: { __table: "client_m365_profiles", clientId: "clientId", profile: "profile" },
  scriptRunResultsTable: { __table: "script_run_results", customerId: "customerId", status: "status", parsedFindings: "parsedFindings", profileUpdates: "profileUpdates", createdAt: "createdAt" },
  mspCustomersTable: { __table: "msp_customers", id: "id", tenantId: "tenantId", mspId: "mspId" },
  mspUsersTable: { __table: "msp_users", userId: "userId", customerId: "customerId", isActive: "isActive" },
  tenantMonitorProfilesTable: { __table: "tenant_monitor_profiles", checkKey: "checkKey", extractedProperties: "extractedProperties", tenantId: "tenantId", collectedAt: "collectedAt" },
}));

vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// sla-engine is imported transitively by tenant-signals; stub it so the module
// graph loads without pulling real DB/SLA machinery into these unit tests.
vi.mock("./sla-engine", () => ({
  startSlaTimer: vi.fn(() => Promise.resolve({ timerId: 1, alreadyExisted: false })),
}));

import { db } from "@workspace/db";
import {
  buildTenantProfile,
  mergeMonitorProfileRows,
  deriveMonitorFindings,
  type TenantMonitorProfileRow,
} from "./tenant-signals.ts";

// ── Table-aware db mock ────────────────────────────────────────────────────────
//
// buildTenantProfile issues (in order):
//   1. db.select(...).from(mspCustomers).where(...).limit(1)            → tenant/msp
//   2. db.select(...).from(mspUsers).where(...).limit(1)                → portal user
//   3. db.select(...).from(clientM365Profiles).where(...).limit(1)      → profile
//   4. db.select(...).from(scriptRunResults).where(...).orderBy().limit → findings
//   5. db.selectDistinctOn(...).from(tenantMonitorProfiles)...orderBy() → monitor
//
// Each builder records which table `.from()` received and, when awaited at its
// terminal call, resolves to that table's canned rows. `.orderBy()` is terminal
// for selectDistinctOn (thenable) but chains to `.limit()` for the scriptRuns
// select — so builders are made thenable and also chainable.

type Rows = Record<string, unknown>[];

function makeDb(canned: {
  mspCustomers: Rows;
  mspUsers: Rows;
  clientM365Profiles: Rows;
  scriptRunResults: Rows;
  tenantMonitorProfiles: Rows;
}) {
  const rowsFor = (table: { __table?: string } | undefined): Rows => {
    switch (table?.__table) {
      case "msp_customers": return canned.mspCustomers;
      case "msp_users": return canned.mspUsers;
      case "client_m365_profiles": return canned.clientM365Profiles;
      case "script_run_results": return canned.scriptRunResults;
      case "tenant_monitor_profiles": return canned.tenantMonitorProfiles;
      default: return [];
    }
  };

  const builder = () => {
    let table: { __table?: string } | undefined;
    const resolve = () => Promise.resolve(rowsFor(table));
    const b: Record<string, unknown> = {
      from: vi.fn((t: { __table?: string }) => { table = t; return b; }),
      where: vi.fn(() => b),
      limit: vi.fn(() => resolve()),
      // orderBy is terminal for selectDistinctOn, non-terminal for scriptRuns —
      // return a thenable that is ALSO chainable to a subsequent .limit().
      orderBy: vi.fn(() => {
        const thenable: Record<string, unknown> = {
          limit: vi.fn(() => resolve()),
          then: (onF: (v: Rows) => unknown, onR?: (e: unknown) => unknown) => resolve().then(onF, onR),
        };
        return thenable;
      }),
    };
    return b;
  };

  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => builder());
  (db.selectDistinctOn as ReturnType<typeof vi.fn>).mockImplementation(() => builder());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildTenantProfile — id-space resolution", () => {
  it("merges tenant_monitor_profiles item counts for a customer whose id has NO matching msp_users.userId row", async () => {
    // The regression scenario: customerId 42 is a valid msp_customers row with a
    // tenant, and its ACTIVE portal user is a DIFFERENT id (777). There is NO
    // msp_users row where userId = 42 — the old join would have found nothing,
    // resolved tenantId to null, and skipped the monitor merge entirely.
    makeDb({
      mspCustomers: [{ tenantId: "tenant-abc", mspId: 9 }],
      mspUsers: [{ userId: 777 }], // resolved via customerId=42 & isActive, NOT userId=42
      clientM365Profiles: [{ profile: { baseKey: "base" } }],
      scriptRunResults: [{ parsedFindings: ["finding-x"], profileUpdates: { fromScript: 1 } }],
      tenantMonitorProfiles: [
        { checkKey: "orphanedTeams", extractedProperties: { _itemCount: 5 } },
        { checkKey: "disabledAccounts", extractedProperties: { _itemCount: 12 } },
        { checkKey: "noProps", extractedProperties: null }, // → defaults to 0
      ],
    });

    const result = await buildTenantProfile(42);

    // tenant/msp resolved directly off msp_customers (not via a userId=42 join).
    expect(result.tenantId).toBe("tenant-abc");
    expect(result.mspId).toBe(9);
    expect(result.customerId).toBe(42);

    // The monitor merge fired — the exact inputs threshold-type signal rules read.
    expect(result.mergedProfile["orphanedTeams__itemCount"]).toBe(5);
    expect(result.mergedProfile["disabledAccounts__itemCount"]).toBe(12);
    expect(result.mergedProfile["noProps__itemCount"]).toBe(0);

    // Profile + script-run inputs (keyed by the active portal user) still merge.
    expect(result.mergedProfile["baseKey"]).toBe("base");
    expect(result.mergedProfile["fromScript"]).toBe(1);
    expect(result.findings).toEqual(["finding-x"]);
  });

  it("still resolves tenant/monitor data when the customer has NO active portal user (unclaimed)", async () => {
    // No active msp_users row → profile/findings contribute nothing, but tenant
    // resolution and the monitor merge proceed off the customer id. This must not
    // throw — an unclaimed customer is a valid state, not an error.
    makeDb({
      mspCustomers: [{ tenantId: "tenant-xyz", mspId: 3 }],
      mspUsers: [], // no active portal user
      clientM365Profiles: [{ profile: { shouldNotAppear: true } }],
      scriptRunResults: [{ parsedFindings: ["ignored"], profileUpdates: { ignored: 1 } }],
      tenantMonitorProfiles: [{ checkKey: "secureScoreDrift", extractedProperties: { _itemCount: 7 } }],
    });

    const result = await buildTenantProfile(100);

    expect(result.tenantId).toBe("tenant-xyz");
    expect(result.mspId).toBe(3);
    // Monitor signals still fire off the tenant.
    expect(result.mergedProfile["secureScoreDrift__itemCount"]).toBe(7);
    // Profile/findings from the users.id-keyed tables are absent — not fetched.
    expect(result.mergedProfile["shouldNotAppear"]).toBeUndefined();
    expect(result.findings).toEqual([]);
  });

  it("skips the monitor merge (no throw) when the customer row has no tenantId", async () => {
    makeDb({
      mspCustomers: [{ tenantId: null, mspId: 4 }],
      mspUsers: [{ userId: 501 }],
      clientM365Profiles: [{ profile: { onlyBase: true } }],
      scriptRunResults: [],
      tenantMonitorProfiles: [{ checkKey: "wouldNotApply", extractedProperties: { _itemCount: 99 } }],
    });

    const result = await buildTenantProfile(200);

    expect(result.tenantId).toBeNull();
    expect(result.mspId).toBe(4);
    expect(result.mergedProfile["onlyBase"]).toBe(true);
    // No tenantId → no monitor keys merged at all.
    expect(result.mergedProfile["wouldNotApply__itemCount"]).toBeUndefined();
  });

  it("merges FULL extracted properties, applies Graph-wins precedence, and bridges monitor findings", async () => {
    makeDb({
      mspCustomers: [{ tenantId: "tenant-abc", mspId: 9 }],
      mspUsers: [{ userId: 777 }],
      clientM365Profiles: [{ profile: { mfaEnforced: true } }], // stale script-era claim
      scriptRunResults: [{ parsedFindings: ["script-finding"], profileUpdates: {} }],
      tenantMonitorProfiles: [
        // Graph pipeline says MFA is NOT enforced — fresher data must win.
        { checkKey: "identity:mfa-state", status: "ok", severityMatched: "warning", extractedProperties: { _itemCount: 3, mfaEnforced: false } },
        { checkKey: "license_gap", status: "license_gap", severityMatched: null, extractedProperties: { _licenseGap: true, hasAADP1orP2: false, hasDefender: false } },
      ],
    });

    const result = await buildTenantProfile(42);

    // Full extracted-properties merge — the license-gap upsell flags and any
    // DB-configured mapping targetField reach the profile, not just __itemCount.
    expect(result.mergedProfile["hasAADP1orP2"]).toBe(false);
    expect(result.mergedProfile["hasDefender"]).toBe(false);
    // Precedence: monitor (fresh Graph) beats the script-era profile claim.
    expect(result.mergedProfile["mfaEnforced"]).toBe(false);
    // Script findings retained AND real severity-matched monitor findings bridged.
    expect(result.findings).toContain("script-finding");
    expect(result.findings.some(f => f.startsWith("identity:mfa-state: warning severity"))).toBe(true);
    // license_gap row is NOT a finding (status != ok).
    expect(result.findings.some(f => f.startsWith("license_gap"))).toBe(false);
  });
});

// ─── mergeMonitorProfileRows — legacy-vocabulary bridge (pure) ────────────────

describe("mergeMonitorProfileRows — legacy key bridge", () => {
  const row = (checkKey: string, status: string, props: Record<string, unknown> | null, severityMatched: string | null = null): TenantMonitorProfileRow =>
    ({ checkKey, status, severityMatched, extractedProperties: props });

  it("aliases producer spelling conditionalAccessPoliciesCount → rules' conditionalAccessPolicyCount", () => {
    const profile: Record<string, unknown> = { conditionalAccessPoliciesCount: 4 };
    mergeMonitorProfileRows(profile, []);
    expect(profile["conditionalAccessPolicyCount"]).toBe(4);
  });

  it("aliases rules' spelling back to producer spelling", () => {
    const profile: Record<string, unknown> = { conditionalAccessPolicyCount: 2 };
    mergeMonitorProfileRows(profile, []);
    expect(profile["conditionalAccessPoliciesCount"]).toBe(2);
  });

  it("derives CA policy count from identity:ca-policy-count's _itemCount (ok row only)", () => {
    const profile: Record<string, unknown> = {};
    mergeMonitorProfileRows(profile, [row("identity:ca-policy-count", "ok", { _itemCount: 0 })]);
    // 0 is a REAL measured zero from a successful check — the eq-0 gap rule may fire.
    expect(profile["conditionalAccessPolicyCount"]).toBe(0);
    expect(profile["conditionalAccessPoliciesCount"]).toBe(0);
  });

  it("does NOT derive CA count from an errored check — unknown must not read as zero policies", () => {
    const profile: Record<string, unknown> = {};
    mergeMonitorProfileRows(profile, [row("identity:ca-policy-count", "error", null)]);
    expect("conditionalAccessPolicyCount" in profile).toBe(false);
    // __itemCount synthetic key still stamps 0 (pre-existing threshold-rule contract).
    expect(profile["identity:ca-policy-count__itemCount"]).toBe(0);
  });

  it("derives securityScore as a percent from security:secure-score currentScore/maxScore", () => {
    const profile: Record<string, unknown> = {};
    mergeMonitorProfileRows(profile, [row("security:secure-score", "ok", { currentScore: 33, maxScore: 100, _itemCount: 1 })]);
    expect(profile["securityScore"]).toBe(33);
  });

  it("falls back to a stored percentage field, mirroring dashboard-resolvers", () => {
    const profile: Record<string, unknown> = {};
    mergeMonitorProfileRows(profile, [row("security:secure-score", "ok", { percentage: 41.6 })]);
    expect(profile["securityScore"]).toBe(42);
  });

  it("never overwrites an explicitly-present securityScore (absent-only derivation)", () => {
    const profile: Record<string, unknown> = { securityScore: 88 };
    mergeMonitorProfileRows(profile, [row("security:secure-score", "ok", { currentScore: 10, maxScore: 100 })]);
    expect(profile["securityScore"]).toBe(88);
  });

  it("does not derive securityScore from a license-gapped secure-score row", () => {
    const profile: Record<string, unknown> = {};
    mergeMonitorProfileRows(profile, [row("security:secure-score", "license_gap", { _licenseGap: true })]);
    expect("securityScore" in profile).toBe(false);
  });

  it("does not fabricate keys with no real producer (mfaEnforced/governanceScore stay absent)", () => {
    const profile: Record<string, unknown> = {};
    mergeMonitorProfileRows(profile, [
      row("identity:mfa-registration", "ok", { registeredCount: 5, _itemCount: 20 }),
      row("identity:ca-mfa-coverage", "ok", { _itemCount: 0 }),
    ]);
    expect("mfaEnforced" in profile).toBe(false);
    expect("governanceScore" in profile).toBe(false);
  });
});

// ─── deriveMonitorFindings — real problem findings only (pure) ────────────────

describe("deriveMonitorFindings", () => {
  it("bridges only severity-matched ok rows; errors and license gaps are state-unknown, not findings", () => {
    const findings = deriveMonitorFindings([
      { checkKey: "sharepoint:anonymous-links", status: "ok", severityMatched: "warning", extractedProperties: { _itemCount: 7 } },
      { checkKey: "identity:global-admin-count", status: "ok", severityMatched: null, extractedProperties: { _itemCount: 2 } }, // passed — no finding
      { checkKey: "exchange:auto-forwarding-rules", status: "error", severityMatched: null, extractedProperties: null },
      { checkKey: "identity:risky-users", status: "license_gap", severityMatched: null, extractedProperties: { _licenseGap: true } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toBe("sharepoint:anonymous-links: warning severity condition matched on latest monitoring scan (7 items)");
    // The checkKey carries the keyword surface findings_keyword rules match on.
    expect(findings[0]!.toLowerCase()).toContain("sharepoint");
  });
});
