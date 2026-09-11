/**
 * Live-Postgres regression test for Git #3451.
 *
 * #3451 found that no path anywhere in the codebase could ever put a row into
 * `record_deletions` — the accelerated-delete review queue (`msp-retention-queue.ts`)
 * was real, live and mounted, but the registries its `softDelete()`/`requestAcceleration()`
 * calls depend on (`lib/retention/registry.ts`, `origin-registry.ts`) shipped empty, and
 * zero routes called `softDelete()` or `requestAcceleration()` anywhere.
 *
 * This exercises the real producer wired for that gap: `msp_poams` soft-delete
 * (`lib/retention/wiring/msp-poams.ts`), end to end against real Postgres —
 *
 *   MSP admin soft-deletes a POA&M (DELETE /api/msp/poams/:poamId)
 *     -> a real `record_deletions` row exists, stage 'soft'
 *   the customer requests acceleration (POST /api/portal/poams/:poamId/request-acceleration)
 *     -> `acceleration_state` flips to 'pending' — the exact state
 *        `GET /api/msp/retention/queue` filters on
 *   the operator queue actually returns it (GET /api/msp/retention/queue)
 *   the operator approves it (POST /api/msp/retention/queue/:id/decide)
 *     -> the POA&M is genuinely purged (row gone), the ledger row survives, stage 'purged'
 *
 * Live rather than mocked, deliberately: the whole point of #3451 is that these real
 * routes, real registries and the real ledger table actually connect end to end — a
 * mocked `db` would assert each route calls SOME retention function, not that a real
 * `record_deletions` row is produced, queued, and resolved.
 *
 * Skips cleanly with no `DATABASE_URL`, matching the rest of this directory's
 * `*.live-db.test.ts` files. Every row it writes is synthetic, suffixed, and removed
 * in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-retention-queue-poam-producer.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db, mspsTable, tenantsTable, mspPoamsTable, recordDeletionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-msp-retention-queue-poam-producer-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function mspAdminToken(mspId: number): string {
  return jwt.sign(
    { id: 1, email: "admin@msp.com", name: "MSP Admin", role: "client", mspRole: LEGACY_ROLE.mspAdmin, mspId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function customerToken(customerId: number): string {
  return jwt.sign(
    { id: 2, email: "customer@contoso.com", role: "client", mspRole: LEGACY_ROLE.customer, customerId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe.skipIf(!process.env.DATABASE_URL)("record_deletions gains a real row — live Postgres (#3451)", () => {
  const suffix = `vitest-3451-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  let customerId: number; // tenants.id
  const tenantMsId = `${suffix}.onmicrosoft.com`;
  let poamId: number;
  let poamCode: string;

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `Retention Queue Producer Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `Retention Queue Producer Test Customer ${suffix}`, tenantId: tenantMsId })
      .returning({ id: tenantsTable.id });
    customerId = tenant.id;

    poamCode = `POAM-TEST-${suffix}`;
    const [poam] = await db
      .insert(mspPoamsTable)
      .values({
        mspId,
        poamId: poamCode,
        tenantId: tenantMsId,
        tenantName: `Retention Queue Producer Test Customer ${suffix}`,
        primaryDomain: "contoso.com",
        title: "Disable legacy auth protocols",
        weaknessDescription: "Legacy authentication remains enabled on Exchange Online.",
        scheduledCompletionDate: "2026-12-01",
        originalScheduledCompletionDate: "2026-12-01",
        interimCompensatingControl: "Conditional Access blocks legacy auth for all but the break-glass account.",
        resourcesRequired: "2 engineer-days",
        status: "active",
      })
      .returning({ id: mspPoamsTable.id });
    poamId = poam.id;
  });

  afterAll(async () => {
    await db.delete(recordDeletionsTable).where(eq(recordDeletionsTable.recordType, "msp_poams"));
    await db.delete(mspPoamsTable).where(eq(mspPoamsTable.id, poamId));
    await db.delete(tenantsTable).where(eq(tenantsTable.tenantId, tenantMsId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  async function mountApp(routeModule: string) {
    const { default: router } = await import(routeModule);
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    return app;
  }

  it("goes from no producer at all to a real, queryable, decidable queue row", async () => {
    // ── 1. Before anything: the queue is honestly empty for this record ──────────
    const queueBefore = await db
      .select()
      .from(recordDeletionsTable)
      .where(eq(recordDeletionsTable.recordType, "msp_poams"));
    expect(queueBefore.length).toBe(0);

    // ── 2. MSP admin soft-deletes the POA&M ───────────────────────────────────────
    const mspApp = await mountApp("./msp-poams.ts");
    const deleteRes = await request(mspApp)
      .delete(`/api/msp/poams/${poamCode}`)
      .set("Authorization", `Bearer ${mspAdminToken(mspId)}`)
      .send({ reason: "Created against the wrong tenant by mistake." });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deletion).toBeTruthy();
    expect(deleteRes.body.deletion.stage).toBe("soft");
    const deletionId: number = deleteRes.body.deletion.id;

    const [ledgerRow] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, deletionId));
    expect(ledgerRow.recordType).toBe("msp_poams");
    expect(ledgerRow.recordId).toBe(String(poamId));
    expect(ledgerRow.tenantId).toBe(customerId);
    expect(ledgerRow.mspId).toBe(mspId);
    expect(ledgerRow.deleteReason).toBe("Created against the wrong tenant by mistake.");
    expect(ledgerRow.deletedBySide).toBe("operator");

    const [softDeletedPoam] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, poamId));
    expect(softDeletedPoam.deletedAt).not.toBeNull();
    expect(softDeletedPoam.deleteReason).toBe("Created against the wrong tenant by mistake.");

    // Soft-deleted rows are excluded from the plain list read by default.
    const listRes = await request(mspApp)
      .get("/api/msp/poams")
      .set("Authorization", `Bearer ${mspAdminToken(mspId)}`);
    expect(listRes.body.find((r: { id: number }) => r.id === poamId)).toBeUndefined();

    // ── 3. The customer requests acceleration ─────────────────────────────────────
    const portalApp = await mountApp("./portal-poams.ts");
    const accelRes = await request(portalApp)
      .post(`/api/portal/poams/${poamCode}/request-acceleration`)
      .set("Authorization", `Bearer ${customerToken(customerId)}`)
      .send({ reasonKind: "no_longer_needed", reason: "We disabled legacy auth a different way already." });

    expect(accelRes.status).toBe(200);
    expect(accelRes.body.deletion.accelerationState).toBe("pending");

    // ── 4. THE ACTUAL #3451 CLAIM, falsified: the operator queue now returns a real row ──
    const queueApp = await mountApp("./msp-retention-queue.ts");
    const queueRes = await request(queueApp)
      .get("/api/msp/retention/queue")
      .set("Authorization", `Bearer ${mspAdminToken(mspId)}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.total).toBeGreaterThanOrEqual(1);
    const queueItem = queueRes.body.queue.find((i: { deletionId: number }) => i.deletionId === deletionId);
    expect(queueItem).toBeTruthy();
    expect(queueItem.recordType).toBe("msp_poams");
    expect(queueItem.deleteReason).toBe("Created against the wrong tenant by mistake.");
    expect(queueItem.accelerationReason).toBe("We disabled legacy auth a different way already.");

    // ── 5. The operator approves it — a real purge happens ────────────────────────
    const decideRes = await request(queueApp)
      .post(`/api/msp/retention/queue/${deletionId}/decide`)
      .set("Authorization", `Bearer ${mspAdminToken(mspId)}`)
      .send({ approve: true, note: "Confirmed with the customer, safe to purge now." });

    expect(decideRes.status).toBe(200);
    expect(decideRes.body.deletion.stage).toBe("purged");

    const purgedRows = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, poamId));
    expect(purgedRows.length).toBe(0); // genuinely destroyed

    const [survivingLedgerRow] = await db.select().from(recordDeletionsTable).where(eq(recordDeletionsTable.id, deletionId));
    expect(survivingLedgerRow).toBeTruthy(); // the ledger row survives the purge it describes
    expect(survivingLedgerRow.stage).toBe("purged");
    expect(survivingLedgerRow.purgedAt).not.toBeNull();
  });
});
