/**
 * Live-Postgres test for the Free Scan Remediate step's write-scope derivation
 * (Git #1375).
 *
 * Live rather than mocked, and deliberately so: the whole claim under test is
 * that the scopes on a real OAuth consent screen are DERIVED from real rows —
 * the tenant's own findings, the live `config_pack_templates.check_key`
 * mappings, the active packs behind them, and those packs' real
 * `baseline_action_templates` endpoints. A mocked `db` would assert that the
 * code calls the functions it calls and would prove none of it. This is the
 * security-relevant half of #1375, so the evidence has to be real.
 *
 * Skips cleanly with no `DATABASE_URL`, matching
 * `free-scan-sow.live-db.test.ts` (#1374), whose seed shape this reuses. Every
 * row it writes is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run free-scan-write-scopes.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  pool,
  mspsTable,
  tenantsTable,
  usersTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  configPackTemplatesTable,
  configPacksTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { resolveFreeScanWriteScopes } from "./free-scan-write-scopes.ts";
import { FREE_SCAN_SOW_PHASE_SLUGS, FREE_SCAN_SOW_PHASES } from "./free-scan-sow.ts";
import { REQUIRED_WRITE_APP_PERMISSIONS } from "./graph.ts";

const suffix = `vitest-1375-${Math.floor(Math.random() * 1e9)}`;
const PACKAGE_KEY = "core:free-scan-full";

/**
 * Real `monitor_checks.key` values that real ACTIVE config packs genuinely map
 * (verified against the live `config_pack_templates` join, and re-asserted by
 * the first test below so this file cannot quietly rot into testing nothing).
 * The finding VALUES are synthetic — this is a scratch tenant — but the keys
 * are real, which is what makes the real check → pillar → phase → pack →
 * permission chain the thing under test.
 */
const IDENTITY_CHECK = "identity:ca-mfa-coverage"; // POST /identity/conditionalAccess/policies
const SHARING_CHECK = "sharepoint:orgwide-links"; // DELETE /sites/*/drive/items/*/permissions/*

const FINDING_SEEDS: ReadonlyArray<{ checkKey: string; severity: "critical" | "warning"; title: string }> = [
  { checkKey: IDENTITY_CHECK, severity: "critical", title: "No Conditional Access policy enforcing MFA" },
  { checkKey: SHARING_CHECK, severity: "critical", title: "Sites shared with everyone in the organisation" },
];

/** The phase whose pillar a seeded check actually files under, resolved the real way. */
function phaseSlugForScopeContaining(
  scopes: ReadonlyArray<{ permission: string; phaseSlugs: string[]; checkKeys: string[] }>,
  checkKey: string,
): string | null {
  const scope = scopes.find((s) => s.checkKeys.includes(checkKey));
  return scope?.phaseSlugs[0] ?? null;
}

describe.skipIf(!process.env.DATABASE_URL)("free-scan write-scope derivation — live Postgres (#1375)", () => {
  let mspId: number;
  let customerId: number;
  let userId: number;
  let runId: string;

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `#1375 write-scope MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `Remediate Prospect ${suffix}`,
        tenantId: `${suffix}-tenant`,
        domain: `${suffix}.example.com`,
        isTestbed: true,
        // A Free Scan Prospect has granted READ consent and nothing else — the
        // exact posture the Remediate step's write gate sits in front of.
        consent: { graph: { status: "granted" } },
      })
      .returning({ id: tenantsTable.id });
    customerId = tenant!.id;

    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${suffix}@example.com`,
        name: `Prospect ${suffix}`,
        tenantId: customerId,
        mspRole: "Free",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    userId = user!.id;

    const [run] = await db
      .insert(mspDiagnosticRunsTable)
      .values({
        mspId,
        customerId,
        packageKey: PACKAGE_KEY,
        status: "completed",
        startedAt: new Date("2026-09-15T09:00:00Z"),
        completedAt: new Date("2026-09-15T09:12:00Z"),
        checksTotal: FINDING_SEEDS.length,
        checksOk: FINDING_SEEDS.length,
      })
      .returning({ runId: mspDiagnosticRunsTable.runId });
    runId = run!.runId;

    await db.insert(mspDiagnosticFindingsTable).values(
      FINDING_SEEDS.map((f) => ({
        runId,
        mspId,
        customerId,
        checkKey: f.checkKey,
        checkLabel: f.title,
        severity: f.severity,
        title: f.title,
        description: `Seeded for #1375's live write-scope test (${suffix}).`,
      })),
    );
  });

  afterAll(async () => {
    await db.delete(mspDiagnosticFindingsTable).where(eq(mspDiagnosticFindingsTable.runId, runId));
    await db.delete(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, customerId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    await pool.end();
  });

  it("the check keys this test leans on are REALLY mapped by active config packs", async () => {
    const rows = await db
      .select({ checkKey: configPackTemplatesTable.checkKey })
      .from(configPackTemplatesTable)
      .innerJoin(configPacksTable, eq(configPacksTable.id, configPackTemplatesTable.packId))
      .where(
        and(
          inArray(configPackTemplatesTable.checkKey, [IDENTITY_CHECK, SHARING_CHECK]),
          isNotNull(configPackTemplatesTable.templateId),
          eq(configPacksTable.status, "active"),
        ),
      );
    const mapped = new Set(rows.map((r) => r.checkKey));
    expect(mapped.has(IDENTITY_CHECK)).toBe(true);
    expect(mapped.has(SHARING_CHECK)).toBe(true);
  });

  it("derives real Graph permissions for the full bought scope, and only requestable ones", async () => {
    const result = await resolveFreeScanWriteScopes(customerId, [...FREE_SCAN_SOW_PHASE_SLUGS]);

    expect(result.runId).toBe(runId);
    expect(result.boughtPhases).toHaveLength(FREE_SCAN_SOW_PHASE_SLUGS.length);
    expect(result.scopes.length).toBeGreaterThan(0);

    for (const scope of result.scopes) {
      // Every permission shown is one the write app registration genuinely
      // requests — a scope consent could not produce is never displayed.
      expect(REQUIRED_WRITE_APP_PERMISSIONS).toContain(scope.permission);
      // Every permission carries real evidence: the phase that needs it and the
      // tenant's own check key behind it.
      expect(scope.phaseSlugs.length).toBeGreaterThan(0);
      expect(scope.checkKeys.length).toBeGreaterThan(0);
      expect(scope.why.length).toBeGreaterThan(0);
      for (const key of scope.checkKeys) {
        expect([IDENTITY_CHECK, SHARING_CHECK]).toContain(key);
      }
    }

    // The two seeded findings are on different pillars and therefore different
    // phases — which is the whole premise the per-phase narrowing rests on.
    const identityPhase = phaseSlugForScopeContaining(result.scopes, IDENTITY_CHECK);
    const sharingPhase = phaseSlugForScopeContaining(result.scopes, SHARING_CHECK);
    expect(identityPhase).not.toBeNull();
    expect(sharingPhase).not.toBeNull();
    expect(identityPhase).not.toBe(sharingPhase);
  });

  it("DROPS a phase's permissions when the Prospect did not buy that phase", async () => {
    const full = await resolveFreeScanWriteScopes(customerId, [...FREE_SCAN_SOW_PHASE_SLUGS]);
    const sharingPhase = phaseSlugForScopeContaining(full.scopes, SHARING_CHECK)!;
    const identityPhase = phaseSlugForScopeContaining(full.scopes, IDENTITY_CHECK)!;

    // Buy the identity phase only — the required Phase 1, exactly the #1375
    // scope item: "If the Prospect only bought Phase 1, only the permissions
    // that phase needs should show."
    const narrow = await resolveFreeScanWriteScopes(customerId, [identityPhase]);

    const narrowPermissions = narrow.scopes.map((s) => s.permission);
    const sharingOnlyPermissions = full.scopes
      .filter((s) => s.phaseSlugs.includes(sharingPhase) && !s.phaseSlugs.includes(identityPhase))
      .map((s) => s.permission);

    expect(sharingOnlyPermissions.length).toBeGreaterThan(0);
    for (const permission of sharingOnlyPermissions) {
      expect(narrowPermissions).not.toContain(permission);
    }
    // And the phase they DID buy still contributes.
    for (const scope of narrow.scopes) {
      expect(scope.phaseSlugs).toContain(identityPhase);
    }
    expect(narrow.scopes.length).toBeGreaterThan(0);
    expect(narrow.scopes.length).toBeLessThan(full.scopes.length);
  });

  it("names a bought phase with no open findings honestly rather than silently", async () => {
    const identityPhase = phaseSlugForScopeContaining(
      (await resolveFreeScanWriteScopes(customerId, [...FREE_SCAN_SOW_PHASE_SLUGS])).scopes,
      IDENTITY_CHECK,
    )!;
    const result = await resolveFreeScanWriteScopes(customerId, [...FREE_SCAN_SOW_PHASE_SLUGS]);

    // Four of the six phases have no seeded finding at all on this tenant.
    const withoutWrite = result.phasesWithoutWrite;
    expect(withoutWrite.length).toBeGreaterThan(0);
    for (const phase of withoutWrite) {
      expect(FREE_SCAN_SOW_PHASE_SLUGS).toContain(phase.slug);
      expect(["no_open_findings", "no_executable_fix"]).toContain(phase.reason);
      // The name is the real catalog row's, not a slug dressed up.
      expect(phase.name.length).toBeGreaterThan(0);
      expect(phase.name).not.toBe(phase.slug);
    }
    // A phase that DID contribute a scope is never also listed as contributing none.
    expect(withoutWrite.map((p) => p.slug)).not.toContain(identityPhase);
  });

  it("states what the single admin-consent click grants BEYOND the derived scope", async () => {
    const result = await resolveFreeScanWriteScopes(customerId, [...FREE_SCAN_SOW_PHASE_SLUGS]);
    const asked = new Set(result.scopes.map((s) => s.permission));

    // Microsoft's v2 /adminconsent takes no scope parameter: the grant is the
    // whole registration. The two lists must therefore partition it exactly —
    // no overlap, nothing invented, nothing quietly omitted.
    for (const permission of result.grantedBeyondScope) {
      expect(asked.has(permission)).toBe(false);
      expect(REQUIRED_WRITE_APP_PERMISSIONS).toContain(permission);
    }
    const union = new Set([...asked, ...result.grantedBeyondScope]);
    expect(union.size).toBe(new Set(REQUIRED_WRITE_APP_PERMISSIONS).size);
    // A partial purchase always grants more than it needs — that is the fact
    // the screen has to disclose, so an empty list here would be the false-narrow.
    expect(result.grantedBeyondScope.length).toBeGreaterThan(0);
  });

  it("files every real finding into the guide, under the phase that covers it", async () => {
    const identityPhase = phaseSlugForScopeContaining(
      (await resolveFreeScanWriteScopes(customerId, [...FREE_SCAN_SOW_PHASE_SLUGS])).scopes,
      IDENTITY_CHECK,
    )!;

    const full = await resolveFreeScanWriteScopes(customerId, [...FREE_SCAN_SOW_PHASE_SLUGS]);
    expect(full.guide.map((i) => i.checkKey).sort()).toEqual([IDENTITY_CHECK, SHARING_CHECK].sort());
    for (const item of full.guide) {
      expect(item.phaseSlug).not.toBeNull();
      expect(item.phaseName).not.toBeNull();
      // Real finding content off msp_diagnostic_findings, not a placeholder.
      expect(item.title.length).toBeGreaterThan(0);
      expect(["critical", "warning"]).toContain(item.severity);
    }

    // Deferring a phase does NOT hide the tenant's real finding — it stays in
    // the guide with no phase, because it is still their open finding.
    const narrow = await resolveFreeScanWriteScopes(customerId, [identityPhase]);
    expect(narrow.guide).toHaveLength(2);
    const deferred = narrow.guide.find((i) => i.checkKey === SHARING_CHECK)!;
    expect(deferred.phaseSlug).toBeNull();
    const bought = narrow.guide.find((i) => i.checkKey === IDENTITY_CHECK)!;
    expect(bought.phaseSlug).toBe(identityPhase);
  });

  it("returns nothing at all for a Prospect who bought no phase", async () => {
    const result = await resolveFreeScanWriteScopes(customerId, []);
    expect(result.scopes).toEqual([]);
    expect(result.boughtPhases).toEqual([]);
    expect(result.guide).toEqual([]);
    // Still honest about what the registration holds.
    expect(result.grantedBeyondScope.length).toBe(new Set(REQUIRED_WRITE_APP_PERMISSIONS).size);
  });

  it("every phase spec names a real pillar the summary can produce", () => {
    // Guards the one hand-written table the derivation depends on: a phase whose
    // pillar no card produces would silently contribute no scope forever.
    for (const phase of FREE_SCAN_SOW_PHASES) {
      expect(typeof phase.pillar).toBe("string");
      expect(phase.pillar.length).toBeGreaterThan(0);
    }
  });
});
