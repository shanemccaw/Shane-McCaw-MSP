/**
 * Live-Postgres regression test for Git #3570.
 *
 * `PATCH /msp/settings/users/:userId/approve-purchases` granted the platform
 * `cap.purchases.approve` role to ANY user carrying the caller's `msp_id` — and
 * customer-tier users (Customer/Free) carry that id too. A Customer holding the role is
 * reported by `purchaseApproverUserIds` as a real MSP purchase-approval recipient, even
 * though the old `can_approve_purchases` column never granted anything below
 * MSPOperator. The fix gates the GRANT on the target clearing `ladder.msp-operator` (the
 * decide route's own gate); a revoke stays open.
 *
 * Runs the real router, the real ladder snapshot and the real seeded RBAC rows against
 * the local DATABASE_URL, and proves:
 *   1. granting to a Customer or Free target → 400, and no `cap.purchases.approve` row
 *      is written;
 *   2. granting to an MSPOperator target → 200, the row is written, and
 *      `purchaseApproverUserIds` now returns that operator;
 *   3. a stale grant a Customer already holds can still be REVOKED → 200, row gone;
 *   4. the listing marks exactly the MSPOperator-and-above members grantable, and still
 *      reports a stale grant on a Customer truthfully.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row is synthetic, suffixed, and removed in
 * `afterAll` (`msp_user_roles` cascades on the user delete).
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-settings-approve-purchases-rung.live-db
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db, mspsTable, usersTable, mspAuditLogsTable, mspRolesTable, mspUserRolesTable } from "@workspace/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { CAPABILITY_COLUMN_ROLE_KEYS, LEGACY_ROLE, type LegacyRole } from "@workspace/db/rbac/legacy-ladder";

// The suite-wide setupFiles replace both RBAC row sources with in-memory fixtures. This
// test is about the real rows — the real ladder deciding eligibility, the real
// `msp_user_roles` receiving (or not receiving) the grant — so both are un-mocked, the
// same way rbac-ladder.live-db.test.ts and rbac-capability.live-db.test.ts do it.
vi.unmock("../middlewares/rbac-ladder-source.ts");
vi.unmock("../middlewares/rbac-capability-source.ts");

vi.mock("../lib/mailer.ts", () => ({
  sendEmailForMsp: vi.fn().mockResolvedValue(undefined),
  emailButton: vi.fn().mockReturnValue(""),
  brandedEmail: vi.fn().mockReturnValue(""),
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  passwordResetEmail: vi.fn().mockReturnValue(""),
}));

const JWT_SECRET = "test-msp-settings-approve-purchases-rung-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

describe.skipIf(!process.env.DATABASE_URL)(
  "msp-settings.ts approve-purchases grant is refused below MSPOperator — live Postgres (#3570)",
  () => {
    const suffix = `vitest-3570-${Math.floor(Math.random() * 1e9)}`;
    let mspId: number;
    let capRoleId: string;
    let mspAdminToken: string;
    const ids = {} as Record<"mspAdmin" | "mspOperator" | "customer" | "free" | "staleCustomer", number>;

    async function insertUser(key: keyof typeof ids, mspRole: LegacyRole): Promise<void> {
      const [row] = await db
        .insert(usersTable)
        .values({ email: `${key}-${suffix}@example.com`, role: "client", mspRole, mspId })
        .returning({ id: usersTable.id });
      ids[key] = row.id;
    }

    async function holdsGrant(userId: number): Promise<boolean> {
      const rows = await db
        .select({ userId: mspUserRolesTable.userId })
        .from(mspUserRolesTable)
        .where(and(eq(mspUserRolesTable.userId, userId), eq(mspUserRolesTable.roleId, capRoleId)));
      return rows.length > 0;
    }

    beforeAll(async () => {
      const [capRole] = await db
        .select({ id: mspRolesTable.id })
        .from(mspRolesTable)
        .where(and(eq(mspRolesTable.key, CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases), isNull(mspRolesTable.mspId)));
      if (!capRole) throw new Error("cap.purchases.approve is not seeded — run 2026-09-09-rbac-seed-current-model-2457.sql");
      capRoleId = capRole.id;

      const [msp] = await db
        .insert(mspsTable)
        .values({ name: `Approve Purchases Rung Test MSP ${suffix}`, slug: suffix })
        .returning({ id: mspsTable.id });
      mspId = msp.id;

      await insertUser("mspAdmin", LEGACY_ROLE.mspAdmin);
      await insertUser("mspOperator", LEGACY_ROLE.mspOperator);
      await insertUser("customer", LEGACY_ROLE.customer);
      await insertUser("free", LEGACY_ROLE.free);
      await insertUser("staleCustomer", LEGACY_ROLE.customer);

      // The state #3570 reports is reachable: a Customer already holding the grant. Written
      // directly, the way the pre-fix route wrote it, so the revoke path has something to remove.
      await db.insert(mspUserRolesTable).values({ userId: ids.staleCustomer, roleId: capRoleId });

      mspAdminToken = jwt.sign(
        { id: ids.mspAdmin, email: `mspAdmin-${suffix}@example.com`, role: "client", mspRole: LEGACY_ROLE.mspAdmin, mspId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
    });

    afterAll(async () => {
      if (!mspId) return;
      await db.delete(mspAuditLogsTable).where(eq(mspAuditLogsTable.mspId, mspId));
      const userIds = Object.values(ids);
      if (userIds.length > 0) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
      await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
      // A user/msp delete fans out over every FK that references them; against a local DB
      // the dev server is also loading, that ran past the suite's 20s hookTimeout and left
      // rows behind. Cleanup gets real headroom rather than being abandoned mid-way.
    }, 120_000);

    async function buildApp() {
      const { default: router } = await import("./msp-settings.ts");
      const app = express();
      app.use(express.json());
      app.use("/api", router);
      return app;
    }

    function patchGrant(app: express.Express, userId: number, canApprovePurchases: boolean) {
      return request(app)
        .patch(`/api/msp/settings/users/${userId}/approve-purchases`)
        .set("Authorization", `Bearer ${mspAdminToken}`)
        .send({ canApprovePurchases });
    }

    it("refuses to grant to a Customer target — 400, no role row written", async () => {
      const res = await patchGrant(await buildApp(), ids.customer, true);
      expect(res.status).toBe(400);
      expect(await holdsGrant(ids.customer)).toBe(false);
    });

    it("refuses to grant to a Free target — 400, no role row written", async () => {
      const res = await patchGrant(await buildApp(), ids.free, true);
      expect(res.status).toBe(400);
      expect(await holdsGrant(ids.free)).toBe(false);
    });

    it("grants to an MSPOperator target — 200, row written, and they become a real approver", async () => {
      const res = await patchGrant(await buildApp(), ids.mspOperator, true);
      expect(res.status).toBe(200);
      expect(await holdsGrant(ids.mspOperator)).toBe(true);

      const { purchaseApproverUserIds } = await import("../middlewares/rbac-capability.ts");
      const approvers = await purchaseApproverUserIds(mspId);
      expect(approvers).toContain(ids.mspOperator);
      expect(approvers).not.toContain(ids.customer);
      expect(approvers).not.toContain(ids.free);
    });

    it("still revokes a stale grant a Customer already holds — 200, row removed", async () => {
      expect(await holdsGrant(ids.staleCustomer)).toBe(true);
      const res = await patchGrant(await buildApp(), ids.staleCustomer, false);
      expect(res.status).toBe(200);
      expect(await holdsGrant(ids.staleCustomer)).toBe(false);
    });

    it("the listing marks only MSPOperator-and-above grantable, and reports a held grant truthfully", async () => {
      const app = await buildApp();
      // Re-create the stale grant so the listing has one to report (the revoke test removed it).
      await db.insert(mspUserRolesTable).values({ userId: ids.staleCustomer, roleId: capRoleId }).onConflictDoNothing();

      const res = await request(app).get("/api/msp/settings/users").set("Authorization", `Bearer ${mspAdminToken}`);
      expect(res.status).toBe(200);

      const byId = new Map<number, { approvePurchasesGrantable: boolean; canApprovePurchases: boolean; legacyRole?: unknown }>(
        (res.body as Array<{ userId: number; approvePurchasesGrantable: boolean; canApprovePurchases: boolean }>).map((u) => [u.userId, u]),
      );
      expect(byId.get(ids.mspAdmin)?.approvePurchasesGrantable).toBe(true);
      expect(byId.get(ids.mspOperator)?.approvePurchasesGrantable).toBe(true);
      expect(byId.get(ids.customer)?.approvePurchasesGrantable).toBe(false);
      expect(byId.get(ids.free)?.approvePurchasesGrantable).toBe(false);

      const stale = byId.get(ids.staleCustomer);
      expect(stale?.approvePurchasesGrantable).toBe(false);
      expect(stale?.canApprovePurchases).toBe(true);
      // The rung input is read for the decision only, never echoed onto the wire.
      expect(stale && "legacyRole" in stale).toBe(false);
    });
  },
);
