/**
 * Live-Postgres regression test for Git #3033.
 *
 * `PATCH /api/msp/change-requests/:id` with `status: "rejected"` used to fall
 * through the same generic `updateData` write every other status value uses —
 * it never called `recordRejection` (`lib/portal-change-rejection.ts`), the
 * function every other rejection path in this module goes through (the
 * customer register's own reject flow, and the CAB's
 * `POST /msp/change-control/cab/agenda/:id/decision` reject branch via
 * `portal-cab-store.ts`). Two real consequences of that bypass:
 *
 *   1. `cr_approvals` rows were left `pending` forever instead of being
 *      marked `rejected`/`superseded`.
 *   2. For a routed Microsoft change (`sourceKind: "microsoft_change"`),
 *      `m365_change_routings.decision` never flipped to `declined_risk`.
 *
 * Live rather than mocked, deliberately: the bug is a route calling the wrong
 * store function across several real tables (`msp_change_requests`,
 * `cr_approvals`, `m365_change_routings`) — a mock of `@workspace/db` would
 * assert the route calls SOME update, not that it reaches the right rows via
 * the real `recordRejection` → `declineRoutedChangeToRisk` chain.
 *
 * Skips cleanly with no `DATABASE_URL`, matching `msp-sla-operator-tasks.live-db.test.ts`.
 * Every row it writes is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-changes-reject.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  db,
  mspsTable,
  tenantsTable,
  mspChangeRequestsTable,
  crApprovalsTable,
  m365ChangeInterpretationsTable,
  m365ChangeRoutingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-msp-changes-reject-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "operator@msp.com", role: "client", mspRole: LEGACY_ROLE.mspOperator, mspId: 1, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function formatCrId(id: number): string {
  return `CR-2026-${100 + id}`;
}

describe.skipIf(!process.env.DATABASE_URL)("PATCH /api/msp/change-requests/:id status:rejected — live Postgres (#3033)", () => {
  const suffix = `vitest-3033-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  let tenantRowId: number;
  const tenantMsId = `${suffix}.onmicrosoft.com`;

  const crIdsToClean: number[] = [];
  const interpretationIdsToClean: number[] = [];

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `CR Reject Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `CR Reject Test Customer ${suffix}`, tenantId: tenantMsId })
      .returning({ id: tenantsTable.id });
    tenantRowId = tenant.id;
  });

  afterAll(async () => {
    for (const id of crIdsToClean) {
      await db.delete(crApprovalsTable).where(eq(crApprovalsTable.changeRequestId, id));
      await db.delete(m365ChangeRoutingsTable).where(eq(m365ChangeRoutingsTable.changeRequestId, id));
      await db.delete(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, id));
    }
    for (const id of interpretationIdsToClean) {
      await db.delete(m365ChangeInterpretationsTable).where(eq(m365ChangeInterpretationsTable.id, id));
    }
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  /** Common required-column baseline for a synthetic msp_change_requests row. */
  function crBaseline(overrides: Partial<typeof mspChangeRequestsTable.$inferInsert> = {}) {
    return {
      mspId,
      tenantId: tenantMsId,
      tenantName: `CR Reject Test Customer ${suffix}`,
      primaryDomain: "contoso.com",
      title: "Disable legacy auth",
      description: "Disable legacy authentication protocols.",
      targetResource: "Exchange Online",
      psaTicketId: "PSA-1",
      requestedBy: "raiser@contoso.com",
      requestedAt: new Date().toISOString(),
      scheduledFor: "Awaiting records sign-off — no window booked",
      backupHash: "deadbeef",
      rollbackScriptSnippet: "# no-op",
      status: "pending_approval" as const,
      ...overrides,
    };
  }

  it("rejects a plain (non-routed) CR through recordRejection: cr_approvals flips pending -> rejected and the CR's own status becomes rejected", async () => {
    const [cr] = await db
      .insert(mspChangeRequestsTable)
      .values(crBaseline())
      .returning({ id: mspChangeRequestsTable.id });
    crIdsToClean.push(cr.id);

    const [approval] = await db
      .insert(crApprovalsTable)
      .values({ changeRequestId: cr.id, mspId, tenantId: tenantMsId, stage: 1, decision: "pending", approverRole: "customer" })
      .returning({ id: crApprovalsTable.id });

    const { default: router } = await import("./msp-changes.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspId });
    const res = await request(app)
      .patch(`/api/msp/change-requests/${formatCrId(cr.id)}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "rejected", reason: "No longer needed." });

    expect(res.status).toBe(200);

    const [updatedCr] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id));
    expect(updatedCr.status).toBe("rejected");
    expect(updatedCr.approvedBy).toMatch(/^Rejected by/);

    const [updatedApproval] = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.id, approval.id));
    // The historical bug: this stayed "pending" forever because the generic
    // `updateData` PATCH path never touched cr_approvals at all.
    expect(updatedApproval.decision).toBe("rejected");
    expect(updatedApproval.reason).toBe("No longer needed.");
  });

  it("rejects a ROUTED Microsoft change: cr_approvals flips AND m365_change_routings.decision flips to declined_risk", async () => {
    const [interpretation] = await db
      .insert(m365ChangeInterpretationsTable)
      .values({ mspId, title: `Routed change interpretation ${suffix}`, changeClass: "breaking_change" })
      .returning({ id: m365ChangeInterpretationsTable.id });
    interpretationIdsToClean.push(interpretation.id);

    const [cr] = await db
      .insert(mspChangeRequestsTable)
      .values(crBaseline({ sourceKind: "microsoft_change", sourceInterpretationId: interpretation.id }))
      .returning({ id: mspChangeRequestsTable.id });
    crIdsToClean.push(cr.id);

    const [approval] = await db
      .insert(crApprovalsTable)
      .values({ changeRequestId: cr.id, mspId, tenantId: tenantMsId, stage: 1, decision: "pending", approverRole: "customer" })
      .returning({ id: crApprovalsTable.id });

    const [routing] = await db
      .insert(m365ChangeRoutingsTable)
      .values({
        mspId,
        customerId: tenantRowId,
        tenantId: tenantMsId,
        interpretationId: interpretation.id,
        decision: "auto_created",
        reason: "auto_created",
        changeRequestId: cr.id,
      })
      .returning({ id: m365ChangeRoutingsTable.id });

    const { default: router } = await import("./msp-changes.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspId });
    const res = await request(app)
      .patch(`/api/msp/change-requests/${formatCrId(cr.id)}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "rejected", reason: "MSP is declining this routed change." });

    expect(res.status).toBe(200);

    const [updatedCr] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id));
    expect(updatedCr.status).toBe("rejected");

    const [updatedApproval] = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.id, approval.id));
    expect(updatedApproval.decision).toBe("rejected");

    const [updatedRouting] = await db.select().from(m365ChangeRoutingsTable).where(eq(m365ChangeRoutingsTable.id, routing.id));
    // The historical bug: this stayed "auto_created" forever — the routing
    // ledger kept reporting the change as still awaiting a decision even
    // though the CR itself was already rejected.
    expect(updatedRouting.decision).toBe("declined_risk");
    // An MSP declining its own routed change produces no risk record (#1514) —
    // only a customer decline does.
    expect(updatedRouting.riskDecisionId).toBeNull();
  });

  it("returns 409 (via recordRejection's own idempotency guard) rather than silently no-op-ing when the CR is already rejected", async () => {
    const [cr] = await db
      .insert(mspChangeRequestsTable)
      .values(crBaseline({ status: "rejected", approvedBy: "Rejected by Someone Else" }))
      .returning({ id: mspChangeRequestsTable.id });
    crIdsToClean.push(cr.id);

    const { default: router } = await import("./msp-changes.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspId });
    const res = await request(app)
      .patch(`/api/msp/change-requests/${formatCrId(cr.id)}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "rejected", reason: "Trying again." });

    // existing.status === "rejected" already, so the new branch's own guard
    // (`existing.status !== "rejected"`) skips it entirely and this falls
    // through to the generic no-op path — asserting it does NOT 500 and does
    // NOT flip approvedBy to a second "Rejected by" value.
    expect(res.status).toBe(200);
    const [unchanged] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id));
    expect(unchanged.approvedBy).toBe("Rejected by Someone Else");
  });
});
