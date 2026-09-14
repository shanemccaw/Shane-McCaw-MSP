/**
 * Live-Postgres verification for #4125 Batch A — the ShaneBot engine's ten new
 * Governance & Risk cluster topics (risk / changes / findings / poams /
 * secplan / raci / raci-workload / policy / conditional-access / signal).
 *
 * Real rather than mocked, deliberately: the point of Batch A is that every
 * number traces to a real, customer-scoped query. A mocked `db` only proves
 * the code SHAPE is right; this proves buildGrounding(), run against the real
 * sanctioned testbed tenant (mccawsoft2.onmicrosoft.com, tenants.id = 1),
 * returns cardData whose values match what is actually in Postgres right now
 * — "real question in, real card out" per #4125's own dispatch.
 *
 * Skips cleanly with no DATABASE_URL, same convention as every other
 * `*.live-db.test.ts` in this codebase. Read-only — writes nothing.
 *
 * Run: pnpm --filter @workspace/api-server vitest run shanebot-engine-batch-a.live-db
 */
import { describe, it, expect } from "vitest";
import { db, mspRiskDecisionsTable, mspChangeRequestsTable, mspPoamsTable, tenantMonitorProfilesTable, tenantServicePlansTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { buildGrounding, resolveInstance } from "./shanebot-engine.ts";
import { groupEnabledServicePlansByWorkload } from "./tenant-workloads.ts";

// The real, sanctioned testbed tenant this repo's own CLAUDE.md names
// (mccawsoft2.onmicrosoft.com) — tenants.id = 1, msp_id = 1.
const TESTBED_CUSTOMER_ID = 1;
const TESTBED_MSP_ID = 1;

describe.skipIf(!process.env.DATABASE_URL)("#4125 Batch A — ShaneBot engine, live Postgres against the testbed tenant", () => {
  const paid = resolveInstance("shanebot_paid");

  it("risk topic: cardData.risk reflects the REAL msp_risk_decisions rows for this tenant", async () => {
    const realRows = await db
      .select({ rbdId: mspRiskDecisionsTable.rbdId, riskStatus: mspRiskDecisionsTable.riskStatus })
      .from(mspRiskDecisionsTable)
      .where(and(eq(mspRiskDecisionsTable.mspId, TESTBED_MSP_ID), eq(mspRiskDecisionsTable.tenantId, "c4c814d4-3afe-441e-9145-62461d0a4fd3")));
    expect(realRows.length).toBeGreaterThan(0); // sanity: the seeded data this test relies on is still there

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "What risks are open on my register?",
    });

    expect(grounding.summary).toContain("Risk register:");
    const openOrMitigating = realRows.filter((r) => r.riskStatus === "Open" || r.riskStatus === "Mitigating").length;
    if (openOrMitigating > 0) {
      expect(grounding.cardData?.risk).toBeTruthy();
      expect(grounding.cardData?.risk?.head?.value).toBe(String(openOrMitigating));
      // Every rbdId the card names must be a REAL id from the table above.
      const realIds = new Set(realRows.map((r) => r.rbdId));
      for (const row of grounding.cardData!.risk!.rows) {
        const id = row.left.split(" — ")[0];
        expect(realIds.has(id)).toBe(true);
      }
    }
  });

  it("changes topic: cardData.changes reflects the REAL msp_change_requests row(s)", async () => {
    const realRows = await db
      .select({ id: mspChangeRequestsTable.id, title: mspChangeRequestsTable.title })
      .from(mspChangeRequestsTable)
      .where(and(eq(mspChangeRequestsTable.mspId, TESTBED_MSP_ID), eq(mspChangeRequestsTable.tenantId, "c4c814d4-3afe-441e-9145-62461d0a4fd3")));
    expect(realRows.length).toBeGreaterThan(0);

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "Any change requests waiting on me?",
    });

    expect(grounding.summary).toContain("Change Control:");
    expect(grounding.cardData?.changes).toBeTruthy();
    const titledRows = grounding.cardData!.changes!.rows.map((r) => r.left);
    expect(titledRows.some((left) => realRows.some((r) => left.includes(r.title)))).toBe(true);
  });

  it("poams topic: cardData.poams reflects the REAL msp_poams row(s), excluding soft-deleted ones", async () => {
    // Same exclusion every other reader of this table applies (portal-poams.ts):
    // a soft-deleted plan is not "active" data, so the engine's own query
    // filters it out too — this queries the SAME live-non-deleted set to stay
    // an honest comparison rather than a stale expectation.
    const realRows = await db
      .select({ poamId: mspPoamsTable.poamId, title: mspPoamsTable.title })
      .from(mspPoamsTable)
      .where(and(
        eq(mspPoamsTable.mspId, TESTBED_MSP_ID),
        eq(mspPoamsTable.tenantId, "c4c814d4-3afe-441e-9145-62461d0a4fd3"),
        isNull(mspPoamsTable.deletedAt),
      ));

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "Do I have any active POA&Ms?",
    });

    expect(grounding.summary).toContain("POA&Ms:");
    if (realRows.length === 0) {
      // Honest: the one seeded row on this tenant is soft-deleted regression
      // fixture data — "no active plans" is the true current state.
      expect(grounding.cardData?.poams).toBeUndefined();
      expect(grounding.summary).toContain("No active plans of action.");
    } else {
      expect(grounding.cardData?.poams).toBeTruthy();
      expect(grounding.cardData!.poams!.rows.some((r) => realRows.some((real) => r.left.includes(real.title)))).toBe(true);
    }
  });

  it("signal topic: a real governance keyword question returns the REAL current tenant_monitor_profiles value", async () => {
    const [latest] = await db
      .select({ extractedProperties: tenantMonitorProfilesTable.extractedProperties })
      .from(tenantMonitorProfilesTable)
      .where(and(
        eq(tenantMonitorProfilesTable.tenantId, "c4c814d4-3afe-441e-9145-62461d0a4fd3"),
        eq(tenantMonitorProfilesTable.checkKey, "governance:ownerless-groups"),
      ))
      .orderBy(desc(tenantMonitorProfilesTable.collectedAt), desc(tenantMonitorProfilesTable.id))
      .limit(1);
    expect(latest).toBeTruthy();
    const realValue = (latest.extractedProperties as Record<string, unknown> | null)?.ownerlessGroupCount;
    expect(typeof realValue).toBe("number");

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "How many groups without an owner do I have?",
    });

    expect(grounding.cardData?.signal).toBeTruthy();
    expect(grounding.cardData?.signal?.head?.value).toBe(String(realValue));
    expect(grounding.cardData?.signal?.rows[0]?.sub).toBe("governance:ownerless-groups");
  });

  it("raci / raci-workload: real enabled workloads from tenant_service_plans surface with an honest unassigned state", async () => {
    const servicePlanRows = await db
      .select({ servicePlanName: tenantServicePlansTable.servicePlanName })
      .from(tenantServicePlansTable)
      .where(and(eq(tenantServicePlansTable.mspId, TESTBED_MSP_ID), eq(tenantServicePlansTable.tenantId, "c4c814d4-3afe-441e-9145-62461d0a4fd3")));
    expect(servicePlanRows.length).toBeGreaterThan(0);
    const realGroups = groupEnabledServicePlansByWorkload(servicePlanRows);
    expect(realGroups.length).toBeGreaterThan(0);
    const targetWorkload = realGroups[0];

    const raciGrounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "What RACI gaps do I have?",
    });
    expect(raciGrounding.summary).not.toContain("No workloads on your ownership matrix yet.");
    expect(raciGrounding.cardData?.raci).toBeTruthy();

    const workloadGrounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: `Who owns ${targetWorkload.label}?`,
    });
    expect(workloadGrounding.cardData?.raciWorkload).toBeTruthy();
    expect(workloadGrounding.cardData?.raciWorkload?.head?.label).toContain(targetWorkload.label);
    // No portal_ownership_assignments rows exist for this tenant today — the
    // honest state is Unassigned, not a fabricated holder.
    expect(workloadGrounding.cardData?.raciWorkload?.rows[0]?.right).toBe("Unassigned");
  });
});
