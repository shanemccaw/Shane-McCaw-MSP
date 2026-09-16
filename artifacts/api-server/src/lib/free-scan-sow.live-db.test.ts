/**
 * Live-Postgres test for the Free Scan SOW engagement (Git #1374).
 *
 * Live rather than mocked, deliberately. What this covers is a read across the
 * real Products Catalog (the six `category = 'project'` phase rows, their real
 * fees, durations and `type_attributes.deliverables`), the real
 * `buildPillarSummary` chain, and a real `free_scan_engagements` row with a
 * CHECK constraint that is the whole point of the design (a signed row cannot
 * carry a partial signature block). A mocked `db` would assert that the code
 * calls the functions it calls and would prove none of that.
 *
 * Skips cleanly with no `DATABASE_URL`, matching
 * `config-change-attribution.live-db.test.ts`. Every row it writes is synthetic,
 * suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run free-scan-sow.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  pool,
  mspsTable,
  tenantsTable,
  usersTable,
  servicesTable,
  freeScanEngagementsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  buildFreeScanSow,
  FREE_SCAN_SOW_PHASES,
  FREE_SCAN_SOW_PHASE_SLUGS,
  FULL_SCOPE_DISCOUNT_PCT,
  PHASED_DEPOSIT_PCT,
} from "./free-scan-sow.ts";
import {
  loadOrCreateEngagement,
  normaliseRequestedSelection,
  selectionFromRow,
  sowForEngagement,
} from "./free-scan-engagement.ts";

const suffix = `vitest-1374-${Math.floor(Math.random() * 1e9)}`;

/**
 * The free-scan package this Prospect is scanned with, so the scoring
 * denominator resolves against a real curated check set (#413/#1392) rather
 * than the catalog-wide fallback.
 */
const PACKAGE_KEY = "core:free-scan-full";

/**
 * Real check keys, one per pillar the six phases map to. Each is a genuine
 * `monitor_checks.key` in this catalog — the findings below are synthetic in
 * VALUE (this is a scratch tenant), but they are filed under real keys so the
 * real check → pillar resolution is what groups them.
 */
const FINDING_SEEDS: ReadonlyArray<{ checkKey: string; severity: "critical" | "warning"; title: string }> = [
  { checkKey: "identity:mfa-coverage", severity: "critical", title: "Accounts without MFA" },
  { checkKey: "sharepoint:org-wide-sharing", severity: "critical", title: "Sites shared org-wide" },
  { checkKey: "compliance:dlp-policy-coverage", severity: "warning", title: "No DLP policy covering Teams chat" },
  { checkKey: "licensing:unassigned-seats", severity: "warning", title: "Paid seats sitting unassigned" },
  { checkKey: "adoption:teams-activity-trend", severity: "warning", title: "Dormant users over 30 days" },
  { checkKey: "intune:device-compliance", severity: "warning", title: "Non-compliant devices" },
];

describe.skipIf(!process.env.DATABASE_URL)("free-scan SOW engagement — live Postgres (#1374)", () => {
  let mspId: number;
  let customerId: number;
  let userId: number;
  let runId: string;

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `#1374 SOW MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `Halden Materials ${suffix}`,
        tenantId: `${suffix}-tenant`,
        domain: `${suffix}.example.com`,
        isTestbed: true,
        // A Free Scan Prospect has granted READ consent and nothing else.
        consent: { graph: { status: "granted" } },
      })
      .returning({ id: tenantsTable.id });
    customerId = tenant!.id;

    // The Prospect's own passwordless shell account (#1355): `users.tenant_id`
    // is the customerId, and the role is the free ladder rung.
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${suffix}@example.com`,
        name: `Prospect ${suffix}`,
        tenantId: customerId,
        // `users_role_scope_check` requires the capitalised ladder rung name
        // alongside a non-null tenant_id — same rung `free-scan-return-link.ts`
        // gates its own Prospect lookup on.
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
        startedAt: new Date("2026-09-01T09:00:00Z"),
        completedAt: new Date("2026-09-01T09:14:00Z"),
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
        description: `Seeded for #1374's live SOW test (${suffix}).`,
      })),
    );
  });

  afterAll(async () => {
    await db.delete(freeScanEngagementsTable).where(eq(freeScanEngagementsTable.customerId, customerId));
    await db.delete(mspDiagnosticFindingsTable).where(eq(mspDiagnosticFindingsTable.runId, runId));
    await db.delete(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, customerId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    await pool.end();
  });

  it("the six phases are REAL catalog rows, not a list in code", async () => {
    const rows = await db
      .select({
        slug: servicesTable.slug,
        name: servicesTable.name,
        category: servicesTable.category,
        basePrice: servicesTable.basePrice,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(inArray(servicesTable.slug, [...FREE_SCAN_SOW_PHASE_SLUGS]));

    expect(rows).toHaveLength(FREE_SCAN_SOW_PHASE_SLUGS.length);
    for (const row of rows) {
      expect(row.category).toBe("project");
      const attrs = (row.typeAttributes ?? {}) as { durationWeeks?: number; deliverables?: unknown };
      expect(typeof attrs.durationWeeks).toBe("number");
      // Written by 2026-09-15-free-scan-sow-phase-attributes-1374.sql.
      expect(Array.isArray(attrs.deliverables)).toBe(true);
    }
  });

  it("builds a real SOW for this Prospect, priced from the catalog and counted from the scan", async () => {
    const result = await buildFreeScanSow(
      customerId,
      { phaseSlugs: [...FREE_SCAN_SOW_PHASE_SLUGS], addons: [], paymentPlan: "full" },
      { reference: "SMC-TEST-2026-0901", signature: { signed: false, signedAt: null, signerName: null, signerRole: null }, status: "draft" },
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const sow = result.sow;

    // Real tenant identity, not a placeholder.
    expect(sow.customerName).toContain("Halden Materials");
    expect(sow.reference).toBe("SMC-TEST-2026-0901");

    // Real catalog prices — every phase carries a positive fee off its own row.
    expect(sow.phases).toHaveLength(6);
    for (const phase of sow.phases) {
      expect(phase.feeCents).toBeGreaterThan(0);
      expect(phase.durationWeeks).toBeGreaterThan(0);
      expect(phase.deliverables.length).toBeGreaterThan(0);
    }

    // The gross total IS the sum of the real per-phase fees — nothing rounded in
    // from somewhere else.
    const summed = sow.phases.reduce((s, p) => s + p.feeCents, 0);
    expect(sow.totals.servicesGrossCents).toBe(summed);

    // Full scope, paid in full, takes the real discount.
    expect(sow.totals.discountApplies).toBe(true);
    expect(sow.totals.discountPct).toBe(FULL_SCOPE_DISCOUNT_PCT);
    expect(sow.totals.servicesFullPlanCents).toBe(Math.round(summed * (1 - FULL_SCOPE_DISCOUNT_PCT / 100)));
    expect(sow.totals.depositCents).toBe(Math.round((summed * PHASED_DEPOSIT_PCT) / 100));
    expect(sow.totals.chargedNowCents).toBe(sow.totals.servicesFullPlanCents);

    // Real findings, counted off the seeded run rather than asserted.
    expect(sow.totals.totalFindings).toBe(FINDING_SEEDS.length);
    expect(sow.totals.criticalFindings).toBe(FINDING_SEEDS.filter((f) => f.severity === "critical").length);
    expect(sow.totals.findingsInScope).toBe(sow.totals.totalFindings);
    expect(sow.gateBlockers.map((b) => b.title).sort()).toEqual(
      FINDING_SEEDS.filter((f) => f.severity === "critical").map((f) => f.title).sort(),
    );

    // The schedule is the real one: phases 1–3 stagger, 4–6 follow.
    expect(sow.phases[0]!.startWeek).toBe(0);
    expect(sow.totals.weeksToCertification).toBeGreaterThan(0);
    expect(sow.totals.weeksToCopilotEnablement).toBeLessThanOrEqual(sow.totals.weeksToCertification);

    // The gate threshold is the platform's real constant, echoed rather than re-stated.
    expect(sow.readiness.threshold).toBe(82);
    // A projected score is never worse than today's, and never invented when the
    // pillar has no score to project from (#517).
    if (sow.readiness.now !== null && sow.readiness.projected !== null) {
      expect(sow.readiness.projected).toBeGreaterThanOrEqual(sow.readiness.now);
    }
    for (const phase of sow.phases) {
      if (phase.pillarScoreNow === null) expect(phase.pillarScoreProjected).toBeNull();
    }
  });

  it("deferring a phase drops its fee, its findings and its bar — and shortens the critical path", async () => {
    const full = await buildFreeScanSow(
      customerId,
      { phaseSlugs: [...FREE_SCAN_SOW_PHASE_SLUGS], addons: [], paymentPlan: "full" },
      { reference: "R", signature: { signed: false, signedAt: null, signerName: null, signerRole: null }, status: "draft" },
    );
    const trimmed = await buildFreeScanSow(
      customerId,
      { phaseSlugs: [FREE_SCAN_SOW_PHASES[0]!.slug], addons: [], paymentPlan: "full" },
      { reference: "R", signature: { signed: false, signedAt: null, signerName: null, signerRole: null }, status: "draft" },
    );
    expect(full.status).toBe("ready");
    expect(trimmed.status).toBe("ready");
    if (full.status !== "ready" || trimmed.status !== "ready") return;

    expect(trimmed.sow.totals.phasesSelected).toBe(1);
    expect(trimmed.sow.totals.servicesGrossCents).toBe(trimmed.sow.phases[0]!.feeCents);
    expect(trimmed.sow.totals.servicesGrossCents).toBeLessThan(full.sow.totals.servicesGrossCents);
    expect(trimmed.sow.totals.findingsInScope).toBeLessThan(full.sow.totals.findingsInScope);
    expect(trimmed.sow.totals.weeksToCertification).toBeLessThan(full.sow.totals.weeksToCertification);
    // A narrower scope is not a discount.
    expect(trimmed.sow.totals.discountApplies).toBe(false);
    expect(trimmed.sow.totals.servicesFullPlanCents).toBe(trimmed.sow.totals.servicesGrossCents);
    // The five deferred phases still render, with no start week.
    expect(trimmed.sow.phases.filter((p) => p.startWeek === null)).toHaveLength(5);
  });

  it("persists scope against the Prospect's customerId and reads it back", async () => {
    const engagement = await loadOrCreateEngagement({
      customerId,
      checkoutSessionId: null,
      email: `${suffix}@example.com`,
      fullName: "Prospect",
      company: null,
    });

    // Opens on full scope — the Prospect narrows, they do not assemble.
    expect(engagement.selectedPhaseSlugs).toEqual([...FREE_SCAN_SOW_PHASE_SLUGS]);
    expect(engagement.status).toBe("draft");
    expect(engagement.sowReference).toMatch(/^SMC-/);

    // A second touch returns the same row, not a second engagement.
    const again = await loadOrCreateEngagement({
      customerId,
      checkoutSessionId: null,
      email: null,
      fullName: null,
      company: null,
    });
    expect(again.id).toBe(engagement.id);

    const narrowed = normaliseRequestedSelection({
      phaseSlugs: ["sharing-exposure-remediation", "not-a-real-phase"],
      addons: [{ addonId: "tenant-monitoring", tierId: "growth" }],
      paymentPlan: "phased",
    });
    // The required phase is re-asserted whatever the caller sent, and a slug
    // with no catalog row behind it is dropped rather than stored.
    expect(narrowed.phaseSlugs).toEqual(["identity-access-hardening", "sharing-exposure-remediation"]);
    expect(narrowed.paymentPlan).toBe("phased");

    const [updated] = await db
      .update(freeScanEngagementsTable)
      .set({
        selectedPhaseSlugs: narrowed.phaseSlugs,
        selectedAddons: narrowed.addons,
        paymentPlan: narrowed.paymentPlan,
      })
      .where(eq(freeScanEngagementsTable.id, engagement.id))
      .returning();

    expect(selectionFromRow(updated!).phaseSlugs).toEqual(narrowed.phaseSlugs);

    const reread = await sowForEngagement(updated!);
    expect(reread.status).toBe("ready");
    if (reread.status !== "ready") return;
    expect(reread.sow.totals.phasesSelected).toBe(2);
    expect(reread.sow.selection.paymentPlan).toBe("phased");
    expect(reread.sow.totals.chargedNowCents).toBe(reread.sow.totals.depositCents);
  });

  it("refuses to record a signature without the whole signature block", async () => {
    const engagement = await loadOrCreateEngagement({
      customerId,
      checkoutSessionId: null,
      email: null,
      fullName: null,
      company: null,
    });

    await expect(
      db
        .update(freeScanEngagementsTable)
        .set({ signedAt: new Date(), signerName: "Partial Only" })
        .where(eq(freeScanEngagementsTable.id, engagement.id)),
    ).rejects.toThrow();
  });

  it("serves a signed document from its own snapshot, not a recompute", async () => {
    const engagement = await loadOrCreateEngagement({
      customerId,
      checkoutSessionId: null,
      email: null,
      fullName: null,
      company: null,
    });

    const computed = await buildFreeScanSow(customerId, selectionFromRow(engagement), {
      reference: engagement.sowReference,
      signature: { signed: false, signedAt: null, signerName: null, signerRole: null },
      status: "draft",
    });
    expect(computed.status).toBe("ready");
    if (computed.status !== "ready") return;
    const agreedCents = computed.sow.totals.servicesGrossCents;

    const now = new Date();
    const [signed] = await db
      .update(freeScanEngagementsTable)
      .set({
        signerName: "Dana Okonkwo",
        signerRole: "IT Director",
        signatureData: "data:image/png;base64,iVBORw0KGgo=",
        termsAcceptedAt: now,
        signedAt: now,
        signedSowSnapshot: computed.sow,
        agreedServicesCents: agreedCents,
        chargedCents: computed.sow.totals.chargedNowCents,
        status: "signed",
      })
      .where(eq(freeScanEngagementsTable.id, engagement.id))
      .returning();

    const served = await sowForEngagement(signed!);
    expect(served.status).toBe("ready");
    if (served.status !== "ready") return;

    expect(served.sow.signature.signed).toBe(true);
    expect(served.sow.signature.signerName).toBe("Dana Okonkwo");
    expect(served.sow.signature.signerRole).toBe("IT Director");
    expect(served.sow.status).toBe("signed");
    // The agreed figure is the snapshot's, so a catalog price edit after
    // signature cannot restate what was signed.
    expect(served.sow.totals.servicesGrossCents).toBe(agreedCents);
  });
});
