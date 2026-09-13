/**
 * Live-Postgres regression test for Git #3761.
 *
 * Before this route, the ONLY path that could record a decision on a pending
 * `cr_approvals` stage with `approver_role = 'msp'` — the freeze-exception
 * stage `recordFreezeException` materializes (`portal-change-freeze-store.ts`),
 * the design's own "MSP technical review" label — was
 * `recordAgendaDecision` (`portal-cab-store.ts`) via a real CAB agenda item,
 * which requires a CAB meeting to already exist. A tier with no CAB features
 * had no way to clear that stage at all: the design's own Approve/Reject
 * buttons on it rendered against no real endpoint.
 *
 * `POST /api/msp/change-requests/:id/approve` closes that gap by reusing the
 * SAME `recordApproval` (#1496) every other approval surface calls — no
 * second approval model, no bespoke decision state.
 *
 * Live rather than mocked, deliberately: the real behaviour under test is
 * `cr_approvals` actually flipping via the exact ledger every other approval
 * surface writes, plus a real join against `cab_meetings`/`cab_agenda_items`
 * to refuse a change already parked on an open board agenda — a mock of
 * `@workspace/db` would assert the route calls SOME update, not that it
 * reaches the right rows.
 *
 * Skips cleanly with no `DATABASE_URL`, matching `msp-changes-reject.live-db.test.ts`.
 * Every row it writes is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-changes-approve.live-db
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
  changeFreezeWindowsTable,
  cabMeetingsTable,
  cabAgendaItemsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-msp-changes-approve-live-secret";
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

describe.skipIf(!process.env.DATABASE_URL)("POST /api/msp/change-requests/:id/approve — live Postgres (#3761)", () => {
  const suffix = `vitest-3761-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  let tenantRowId: number;
  const tenantMsId = `${suffix}.onmicrosoft.com`;

  const crIdsToClean: number[] = [];
  const freezeWindowIdsToClean: number[] = [];
  const meetingIdsToClean: number[] = [];

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `CR Approve Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `CR Approve Test Customer ${suffix}`, tenantId: tenantMsId })
      .returning({ id: tenantsTable.id });
    tenantRowId = tenant.id;
  });

  afterAll(async () => {
    for (const id of meetingIdsToClean) {
      await db.delete(cabAgendaItemsTable).where(eq(cabAgendaItemsTable.meetingId, id));
      await db.delete(cabMeetingsTable).where(eq(cabMeetingsTable.id, id));
    }
    for (const id of crIdsToClean) {
      await db.delete(crApprovalsTable).where(eq(crApprovalsTable.changeRequestId, id));
      await db.delete(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, id));
    }
    for (const id of freezeWindowIdsToClean) {
      await db.delete(changeFreezeWindowsTable).where(eq(changeFreezeWindowsTable.id, id));
    }
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  /** Common required-column baseline for a synthetic msp_change_requests row. */
  function crBaseline(overrides: Partial<typeof mspChangeRequestsTable.$inferInsert> = {}) {
    return {
      mspId,
      tenantId: tenantMsId,
      tenantName: `CR Approve Test Customer ${suffix}`,
      primaryDomain: "contoso.com",
      title: "Emergency conditional access change",
      description: "Raised inside an active freeze window with a written exception.",
      changeClass: "normal" as const,
      riskLevel: "low" as const,
      category: "ConditionalAccess" as const,
      targetResource: "Entra ID",
      psaTicketId: "PSA-2",
      requestedBy: "raiser@contoso.com",
      requestedAt: new Date().toISOString(),
      scheduledFor: "Awaiting MSP sign-off — no window booked",
      backupHash: "deadbeef",
      rollbackScriptSnippet: "# no-op",
      status: "pending_approval" as const,
      ...overrides,
    };
  }

  async function makeFreezeWindow() {
    const now = Date.now();
    const [window] = await db
      .insert(changeFreezeWindowsTable)
      .values({
        mspId,
        scope: "global",
        name: `Freeze ${suffix}`,
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
      })
      .returning({ id: changeFreezeWindowsTable.id });
    freezeWindowIdsToClean.push(window.id);
    return window.id;
  }

  it("approves a pending MSP-role (freeze-exception) stage directly — no CAB agenda item required", async () => {
    const [cr] = await db.insert(mspChangeRequestsTable).values(crBaseline()).returning({ id: mspChangeRequestsTable.id });
    crIdsToClean.push(cr.id);
    const freezeWindowId = await makeFreezeWindow();

    const [approval] = await db
      .insert(crApprovalsTable)
      .values({
        changeRequestId: cr.id,
        mspId,
        tenantId: tenantMsId,
        stage: 1,
        decision: "pending",
        approverRole: "msp",
        justification: "Time-sensitive fix requested by the customer.",
        freezeWindowId,
      })
      .returning({ id: crApprovalsTable.id });

    const { default: router } = await import("./msp-changes.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspId });
    const res = await request(app)
      .post(`/api/msp/change-requests/${formatCrId(cr.id)}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "Reviewed and cleared." });

    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);

    const [updatedApproval] = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.id, approval.id));
    // The historical gap: there was no route that could ever flip this row —
    // only a CAB agenda decision could, and only once a meeting existed.
    expect(updatedApproval.decision).toBe("approved");
    expect(updatedApproval.approverRole).toBe("msp");
    expect(updatedApproval.reason).toBe("Reviewed and cleared.");
  });

  it("refuses (409) when the change is already sitting on an OPEN CAB agenda item — the board's decision, not this route's", async () => {
    const [cr] = await db.insert(mspChangeRequestsTable).values(crBaseline()).returning({ id: mspChangeRequestsTable.id });
    crIdsToClean.push(cr.id);
    const freezeWindowId = await makeFreezeWindow();

    const [approval] = await db
      .insert(crApprovalsTable)
      .values({
        changeRequestId: cr.id,
        mspId,
        tenantId: tenantMsId,
        stage: 1,
        decision: "pending",
        approverRole: "msp",
        justification: "Time-sensitive fix requested by the customer.",
        freezeWindowId,
      })
      .returning({ id: crApprovalsTable.id });

    const [meeting] = await db
      .insert(cabMeetingsTable)
      .values({ mspId, meetingType: "cab", status: "scheduled", scheduledFor: new Date() })
      .returning({ id: cabMeetingsTable.id });
    meetingIdsToClean.push(meeting.id);

    await db.insert(cabAgendaItemsTable).values({
      meetingId: meeting.id,
      changeRequestId: cr.id,
      mspId,
      tenantId: tenantMsId,
    });

    const { default: router } = await import("./msp-changes.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspId });
    const res = await request(app)
      .post(`/api/msp/change-requests/${formatCrId(cr.id)}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);

    const [unchangedApproval] = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.id, approval.id));
    expect(unchangedApproval.decision).toBe("pending");
  });

  it("returns recordApproval's own 409 when there is no pending stage left to decide", async () => {
    const [cr] = await db
      .insert(mspChangeRequestsTable)
      .values(crBaseline({ status: "scheduled", approvedBy: "Approved by Someone Else" }))
      .returning({ id: mspChangeRequestsTable.id });
    crIdsToClean.push(cr.id);

    await db.insert(crApprovalsTable).values({
      changeRequestId: cr.id,
      mspId,
      tenantId: tenantMsId,
      stage: 1,
      decision: "approved",
      approverRole: "customer",
      decidedAt: new Date(),
    });

    const { default: router } = await import("./msp-changes.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspId });
    const res = await request(app)
      .post(`/api/msp/change-requests/${formatCrId(cr.id)}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/no approval awaiting a decision/i);
  });
});
