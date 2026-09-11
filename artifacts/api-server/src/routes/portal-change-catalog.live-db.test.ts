/**
 * Live-Postgres regression test for Git #3044.
 *
 * `POST /api/portal/change-catalog/:id/execute` used to insert a real
 * `msp_change_requests` row directly, with none of the freeze/maintenance
 * enforcement `raiseChangeRequest` (the ordinary wizard path) runs before its
 * own insert — see `portal-change-catalog.ts`'s header for the full "why".
 *
 * Live rather than mocked, deliberately: the fix reads a real
 * `portal_change_control_policy` row, then evaluates real
 * `change_freeze_windows` / `change_maintenance_windows` rows against "now" —
 * a mock of `@workspace/db` would assert the route calls SOME freeze
 * function, not that an ACTIVE freeze/maintenance-gap genuinely blocks the
 * insert while an inactive one lets it through.
 *
 * Skips cleanly with no `DATABASE_URL`, matching `msp-changes-reject.live-db.test.ts`.
 * Every row it writes is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run portal-change-catalog.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  db,
  mspsTable,
  tenantsTable,
  tenantAddOnEntitlementsTable,
  configPacksTable,
  changeCatalogItemsTable,
  changeFreezeWindowsTable,
  changeMaintenanceWindowsTable,
  portalChangeControlPolicyTable,
  mspChangeRequestsTable,
  crApprovalsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-portal-change-catalog-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(customerId: number): string {
  return jwt.sign(
    { id: 1, email: "customer@contoso.com", role: "client", mspRole: LEGACY_ROLE.customer, customerId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe.skipIf(!process.env.DATABASE_URL)("POST /api/portal/change-catalog/:id/execute — freeze/maintenance gates — live Postgres (#3044)", () => {
  const suffix = `vitest-3044-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  let customerId: number; // tenants.id
  const tenantMsId = `${suffix}.onmicrosoft.com`;
  const packKey = `pack-${suffix}`;

  const crIdsToClean: number[] = [];
  const freezeIdsToClean: number[] = [];
  const maintenanceIdsToClean: number[] = [];
  let catalogItemId: number;

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `Catalog Freeze Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `Catalog Freeze Test Customer ${suffix}`, tenantId: tenantMsId })
      .returning({ id: tenantsTable.id });
    customerId = tenant.id;

    await db.insert(tenantAddOnEntitlementsTable).values({
      tenantId: customerId,
      featureKey: "change_control",
      status: "active",
    });

    await db.insert(configPacksTable).values({
      packKey,
      label: `Test pack ${suffix}`,
      status: "active",
    });

    const [item] = await db
      .insert(changeCatalogItemsTable)
      .values({
        mspId,
        packKey,
        title: `Standard change ${suffix}`,
        category: "Identity",
        riskLevel: "low",
        status: "approved",
        approvedByName: "Test Approver",
      })
      .returning({ id: changeCatalogItemsTable.id });
    catalogItemId = item.id;
  });

  afterAll(async () => {
    for (const id of crIdsToClean) {
      await db.delete(crApprovalsTable).where(eq(crApprovalsTable.changeRequestId, id));
      await db.delete(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, id));
    }
    for (const id of freezeIdsToClean) {
      await db.delete(changeFreezeWindowsTable).where(eq(changeFreezeWindowsTable.id, id));
    }
    for (const id of maintenanceIdsToClean) {
      await db.delete(changeMaintenanceWindowsTable).where(eq(changeMaintenanceWindowsTable.id, id));
    }
    await db.delete(portalChangeControlPolicyTable).where(eq(portalChangeControlPolicyTable.customerId, customerId));
    await db.delete(changeCatalogItemsTable).where(eq(changeCatalogItemsTable.id, catalogItemId));
    await db.delete(configPacksTable).where(eq(configPacksTable.packKey, packKey));
    await db.delete(tenantAddOnEntitlementsTable).where(eq(tenantAddOnEntitlementsTable.tenantId, customerId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  async function buildApp() {
    const { default: router } = await import("./portal-change-catalog.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    return app;
  }

  async function setPolicy(overrides: Partial<typeof portalChangeControlPolicyTable.$inferInsert>) {
    await db.delete(portalChangeControlPolicyTable).where(eq(portalChangeControlPolicyTable.customerId, customerId));
    await db.insert(portalChangeControlPolicyTable).values({ customerId, enabled: true, ...overrides });
  }

  /** Every freeze/maintenance window this suite has created so far — cleared
   *  before each test that sets up its own, so an earlier test's still-active
   *  window can't leak into a later test's "no active window" assertion. */
  async function clearFreezeAndMaintenanceWindows() {
    await db.delete(changeFreezeWindowsTable).where(eq(changeFreezeWindowsTable.mspId, mspId));
    await db.delete(changeMaintenanceWindowsTable).where(eq(changeMaintenanceWindowsTable.mspId, mspId));
    freezeIdsToClean.length = 0;
    maintenanceIdsToClean.length = 0;
  }

  /** The most recently inserted CR for this test's catalog item, or undefined. */
  async function latestCr() {
    const [row] = await db
      .select()
      .from(mspChangeRequestsTable)
      .where(eq(mspChangeRequestsTable.catalogItemId, catalogItemId))
      .orderBy(desc(mspChangeRequestsTable.id))
      .limit(1);
    return row;
  }

  async function crCount(): Promise<number> {
    const rows = await db.select({ id: mspChangeRequestsTable.id }).from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.catalogItemId, catalogItemId));
    return rows.length;
  }

  it("executes normally (201) when no policy row exists at all — enforcement is opt-in", async () => {
    await db.delete(portalChangeControlPolicyTable).where(eq(portalChangeControlPolicyTable.customerId, customerId));

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/portal/change-catalog/${catalogItemId}/execute`)
      .set("Authorization", `Bearer ${makeToken(customerId)}`)
      .send({});

    expect(res.status).toBe(201);
    const cr = await latestCr();
    expect(cr).toBeDefined();
    crIdsToClean.push(cr!.id);
  });

  it("409s and inserts NO change request when a global freeze covering 'now' is enforced (the #3044 bug itself)", async () => {
    await setPolicy({ enforceFreezeCalendar: true });
    await clearFreezeAndMaintenanceWindows();

    const now = Date.now();
    const [freeze] = await db
      .insert(changeFreezeWindowsTable)
      .values({
        mspId,
        scope: "global",
        name: `Active freeze ${suffix}`,
        startsAt: new Date(now - 60 * 60 * 1000),
        endsAt: new Date(now + 60 * 60 * 1000),
        active: true,
      })
      .returning({ id: changeFreezeWindowsTable.id });
    freezeIdsToClean.push(freeze.id);

    const beforeCount = await crCount();

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/portal/change-catalog/${catalogItemId}/execute`)
      .set("Authorization", `Bearer ${makeToken(customerId)}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.freeze?.id).toBe(freeze.id);

    // The historical bug: this insert happened unconditionally.
    expect(await crCount()).toBe(beforeCount);
  });

  it("executes normally (201) once the freeze is no longer active (expired)", async () => {
    await setPolicy({ enforceFreezeCalendar: true });
    await clearFreezeAndMaintenanceWindows();

    const now = Date.now();
    const [freeze] = await db
      .insert(changeFreezeWindowsTable)
      .values({
        mspId,
        scope: "global",
        name: `Expired freeze ${suffix}`,
        startsAt: new Date(now - 5 * 60 * 60 * 1000),
        endsAt: new Date(now - 4 * 60 * 60 * 1000),
        active: true,
      })
      .returning({ id: changeFreezeWindowsTable.id });
    freezeIdsToClean.push(freeze.id);

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/portal/change-catalog/${catalogItemId}/execute`)
      .set("Authorization", `Bearer ${makeToken(customerId)}`)
      .send({});

    expect(res.status).toBe(201);
    const latest = await latestCr();
    expect(latest).toBeDefined();
    crIdsToClean.push(latest!.id);
  });

  it("409s when maintenance-window enforcement is on and 'now' falls outside every approved window", async () => {
    await setPolicy({ enforceMaintenanceWindows: true });
    await clearFreezeAndMaintenanceWindows();

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/portal/change-catalog/${catalogItemId}/execute`)
      .set("Authorization", `Bearer ${makeToken(customerId)}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.maintenanceWindowRequired).toBe(true);
  });

  it("executes normally (201) when maintenance-window enforcement is on and 'now' falls inside an approved window", async () => {
    await setPolicy({ enforceMaintenanceWindows: true });
    await clearFreezeAndMaintenanceWindows();

    const now = Date.now();
    const [maintenance] = await db
      .insert(changeMaintenanceWindowsTable)
      .values({
        mspId,
        scope: "global",
        name: `Covering maintenance window ${suffix}`,
        startsAt: new Date(now - 60 * 60 * 1000),
        endsAt: new Date(now + 60 * 60 * 1000),
        active: true,
      })
      .returning({ id: changeMaintenanceWindowsTable.id });
    maintenanceIdsToClean.push(maintenance.id);

    const app = await buildApp();
    const res = await request(app)
      .post(`/api/portal/change-catalog/${catalogItemId}/execute`)
      .set("Authorization", `Bearer ${makeToken(customerId)}`)
      .send({});

    expect(res.status).toBe(201);
    const latest = await latestCr();
    expect(latest).toBeDefined();
    crIdsToClean.push(latest!.id);
  });
});
