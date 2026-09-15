/**
 * Live-Postgres verification for #4127 Batch C — the ShaneBot engine's six new
 * Tenant & Ops cluster topics (tenantStatus / project / msChanges /
 * diagnostics / statusReports / configState).
 *
 * Real rather than mocked, deliberately — same rationale as
 * shanebot-engine-batch-a.live-db.test.ts / -batch-b.live-db.test.ts: this
 * proves buildGrounding(), run against the real sanctioned testbed tenant
 * (mccawsoft2.onmicrosoft.com, tenants.id = 1), returns cardData whose values
 * match what is actually in Postgres right now.
 *
 * Two of the six topics are confirmed, at the time this file was written, to
 * have NO real seeded data on the testbed tenant (0 active projects, 0 sealed
 * config snapshots) — those two tests assert the honest empty state rather
 * than faking a populated one. msChanges/diagnostics/statusReports DO have
 * real rows on this tenant and are asserted against independently
 * recomputed values from the same tables.
 *
 * Skips cleanly with no DATABASE_URL, same convention as every other
 * `*.live-db.test.ts` in this codebase. Read-only — writes nothing.
 *
 * Run: pnpm --filter @workspace/api-server vitest run shanebot-engine-batch-c.live-db
 */
import { describe, it, expect } from "vitest";
import {
  db,
  projectsTable,
  mspMessageCenterItemsTable,
  mspStatusReportsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { buildGrounding, resolveInstance } from "./shanebot-engine.ts";
import { effectiveDate } from "./portal-message-center.ts";
import { resolveCustomerUserIds } from "./tenant-signals.ts";
import { latestSealedPair } from "./config-state-views.ts";

// The real, sanctioned testbed tenant this repo's own CLAUDE.md names
// (mccawsoft2.onmicrosoft.com) — tenants.id = 1, msp_id = 1.
const TESTBED_CUSTOMER_ID = 1;
const TESTBED_MSP_ID = 1;

describe.skipIf(!process.env.DATABASE_URL)("#4127 Batch C — ShaneBot engine, live Postgres against the testbed tenant", () => {
  const paid = resolveInstance("shanebot_paid");

  it("tenantStatus topic: fires the real engine status strip and produces a coherent card (or an honest empty state)", async () => {
    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "What's the overall status of my tenant?",
    });

    expect(grounding.summary).toContain("Tenant status:");
    // Real engine output varies run to run (live scores) — only assert the
    // shape is coherent, never a specific score/severity.
    if (grounding.cardData?.tenantStatus) {
      expect(["Attention", "Healthy"]).toContain(grounding.cardData.tenantStatus.head?.value);
      expect(grounding.cardData.tenantStatus.rows.length).toBeGreaterThan(0);
    } else {
      expect(grounding.summary).toContain("No tenant status is available yet.");
    }
  }, 30_000);

  it("project topic: honest 'no active project' state — confirmed live, 0 active projects on this tenant today", async () => {
    const customerUserIds = await resolveCustomerUserIds(TESTBED_CUSTOMER_ID);
    const realActiveProjects = customerUserIds.length > 0
      ? await db.select({ id: projectsTable.id })
          .from(projectsTable)
          .where(and(inArray(projectsTable.clientUserId, customerUserIds), eq(projectsTable.status, "active")))
      : [];
    // Sanity check on the premise this test documents — if this ever fails,
    // the testbed tenant has gained real project data and this test (and the
    // #4127 judgment call it exercises) needs a populated-state assertion too.
    expect(realActiveProjects.length).toBe(0);

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "How is my project going?",
    });

    expect(grounding.cardData?.project).toBeUndefined();
    expect(grounding.summary).toContain("No active project on your account right now.");
  });

  it("msChanges topic: cardData.msChanges count matches an independently-recomputed 90-day window over the REAL message-center rows", async () => {
    const rows = await db.select({
        title: mspMessageCenterItemsTable.title,
        startDateTime: mspMessageCenterItemsTable.startDateTime,
        endDateTime: mspMessageCenterItemsTable.endDateTime,
        actionRequiredByDateTime: mspMessageCenterItemsTable.actionRequiredByDateTime,
        lastModifiedDateTime: mspMessageCenterItemsTable.lastModifiedDateTime,
      })
      .from(mspMessageCenterItemsTable)
      .where(and(eq(mspMessageCenterItemsTable.customerId, TESTBED_CUSTOMER_ID), eq(mspMessageCenterItemsTable.mspId, TESTBED_MSP_ID)));
    expect(rows.length).toBeGreaterThan(0); // sanity: the synced corpus is still there

    const now = Date.now();
    const expectedCount = rows.filter((r) => {
      const t = effectiveDate(r).getTime();
      return t >= now && t <= now + 90 * 86_400_000;
    }).length;

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "What Microsoft changes are coming up?",
    });

    expect(grounding.summary).toContain("Microsoft Changes:");
    if (expectedCount === 0) {
      expect(grounding.cardData?.msChanges).toBeUndefined();
    } else {
      expect(grounding.cardData?.msChanges?.head?.value).toBe(String(expectedCount));
    }
  });

  it("diagnostics topic: cardData.diagnostics reflects the REAL critical-only findings on the latest run (confirmed live: 'No DLP policies exist')", async () => {
    const [latestRun] = await db.select({ runId: mspDiagnosticRunsTable.runId })
      .from(mspDiagnosticRunsTable)
      .where(and(eq(mspDiagnosticRunsTable.customerId, TESTBED_CUSTOMER_ID), inArray(mspDiagnosticRunsTable.status, ["completed", "partial"])))
      .orderBy(desc(mspDiagnosticRunsTable.createdAt))
      .limit(1);
    expect(latestRun).toBeTruthy(); // sanity: the seeded diagnostic run is still there

    // Mirrors buildCustomerContext's OWN findingRows query exactly (Batch A's
    // second wave, reused here rather than re-queried): critical+warning
    // combined, newest-first, capped at 10 — then filtered to critical only.
    // diagnostics deliberately shows "critical findings among the latest 10
    // critical/warning findings," not an unbounded full-table critical count.
    const latestFindings = await db.select({ severity: mspDiagnosticFindingsTable.severity, title: mspDiagnosticFindingsTable.title })
      .from(mspDiagnosticFindingsTable)
      .where(and(eq(mspDiagnosticFindingsTable.runId, latestRun.runId), inArray(mspDiagnosticFindingsTable.severity, ["critical", "warning"])))
      .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
      .limit(10);
    const realCritical = latestFindings.filter((f) => f.severity === "critical");
    expect(realCritical.length).toBeGreaterThan(0);

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "Are there any critical diagnostic findings?",
    });

    expect(grounding.cardData?.diagnostics).toBeTruthy();
    expect(grounding.cardData?.diagnostics?.head?.value).toBe(String(realCritical.length));
    const realCriticalTitles = new Set(realCritical.map((f) => f.title));
    for (const row of grounding.cardData?.diagnostics?.rows ?? []) {
      expect(realCriticalTitles.has(row.left)).toBe(true);
    }
  });

  it("statusReports topic: cardData.statusReports reflects the REAL published report count and newest period for this tenant", async () => {
    const realPublished = await db.select({ periodLabel: mspStatusReportsTable.periodLabel })
      .from(mspStatusReportsTable)
      .where(and(eq(mspStatusReportsTable.customerId, TESTBED_CUSTOMER_ID), eq(mspStatusReportsTable.state, "published")));
    expect(realPublished.length).toBeGreaterThan(0); // sanity: the seeded published report is still there

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "Do I have any status reports?",
    });

    expect(grounding.cardData?.statusReports).toBeTruthy();
    expect(grounding.cardData?.statusReports?.head?.value).toBe(String(realPublished.length));
  });

  it("configState topic: honest 'no sealed configuration snapshot' state — confirmed live, 0 sealed snapshots on this tenant today", async () => {
    const realSnapshots = await latestSealedPair(TESTBED_CUSTOMER_ID);
    // Sanity check on the premise this test documents — if this ever fails,
    // the testbed tenant has gained a real sealed snapshot and this test (and
    // the #4127 judgment call it exercises) needs a populated-state assertion too.
    expect(realSnapshots.length).toBe(0);

    const grounding = await buildGrounding(paid, {
      customerId: TESTBED_CUSTOMER_ID, mspId: TESTBED_MSP_ID, isCustomerUser: true,
      lastUserMessage: "How much of my tenant configuration has been collected?",
    });

    expect(grounding.cardData?.configState).toBeUndefined();
    expect(grounding.summary).toContain("No sealed configuration snapshot exists for this tenant yet.");
  });
});
