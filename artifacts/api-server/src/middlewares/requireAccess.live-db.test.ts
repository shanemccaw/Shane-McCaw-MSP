/**
 * Live-Postgres acceptance test for #4192 — `requireAccess` decided by the REAL rows.
 *
 * ./requireAccess.test.ts proves the branching against fixture rows and mocked tier
 * readers. That cannot prove the seeded database agrees, and a gate is only as
 * fail-closed as the rows it reads. So this drives the real middleware, through a real
 * Express app and a real `requireAuth` JWT, against the real local database, and asserts
 * all three real outcomes plus the real audit lines:
 *
 *   1. an RBAC denial  → 403, `basis: "rbac"`
 *   2. an entitlement denial → 402, `basis: "entitlement"`, the real `requiredTier` named
 *      from the live `services` catalog by `sort_order`
 *   3. an allow → 200
 *   4. both denials present in `platform_log_stream` on channel `auth` — the audit gap
 *      #4191 found, closed and verified end to end rather than asserted against a spy.
 *
 * ── The synthetic principal ─────────────────────────────────────────────────
 *
 * The decision depends on the caller's tier, so this needs a customer on a KNOWN tier.
 * It creates one: a `zz-test-4192-*` tenant, one `zz-test-4192-*@example.invalid` login
 * on the `Customer` rung, and one active `client_services` row against the real
 * Foundation catalog row — the reserved synthetic-identity prefix CLAUDE.md names, no
 * real tenant or person touched, nothing granted, nothing privileged. `afterAll` deletes
 * every row it created (log rows included) and the last test asserts zero residue.
 *
 * Skips cleanly with no `DATABASE_URL`, matching rbac-ladder.live-db.test.ts.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run requireAccess.live-db
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { LEGACY_ROLE, ladderCapabilityKey } from "@workspace/db/rbac/legacy-ladder";
import { PORTAL_TIER_MODULE_KEYS } from "@workspace/db/rbac/tier-modules";

// This file is about the REAL rows; vitest.config.ts installs setup-file mocks of both
// row sources for the suites that need them, so opt back out of both.
vi.unmock("./rbac-ladder-source.ts");
vi.unmock("./rbac-capability-source.ts");

const JWT_SECRET = "test-requireAccess-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

/** Reserved synthetic-identity prefix (CLAUDE.md). Also how every row here is found again to delete it. */
const TAG = `zz-test-4192-${randomUUID().slice(0, 8)}`;
/** Unique route prefix, so the audit lines this test causes are identifiable in platform_log_stream. */
const ROUTE = `/${TAG}`;

const CUSTOMER_LADDER = ladderCapabilityKey(LEGACY_ROLE.customer);

describeLive("#4192 — requireAccess against the real database", () => {
  // `@workspace/db` THROWS at import without a DATABASE_URL, so it is imported inside
  // beforeAll rather than at module scope — otherwise this file would fail the ordinary
  // no-database `vitest run` outright instead of skipping cleanly.
  let dbm: typeof import("@workspace/db");
  let app: express.Express;
  let tenantId = 0;
  let userId = 0;
  let clientServiceId = 0;
  let token = "";

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    const { db, clientServicesTable, servicesTable, tenantsTable, usersTable } = dbm;
    const { requireAccess } = await import("./requireAccess.ts");
    const { requireAuth } = await import("./requireAuth.ts");

    // The real Foundation catalog row — bundles risk_register, not runbooks.
    const [foundation] = await db
      .select({ id: servicesTable.id, tier: servicesTable.tier })
      .from(servicesTable)
      .where(and(eq(servicesTable.serviceType, "monitoring_tier"), eq(servicesTable.tier, "foundation")))
      .orderBy(servicesTable.sortOrder)
      .limit(1);
    expect(foundation, "the live services catalog must carry a foundation monitoring_tier row").toBeTruthy();

    const [anyTenant] = await db.select({ mspId: tenantsTable.mspId }).from(tenantsTable).limit(1);
    expect(anyTenant, "the database must carry at least one tenant, for a real msps.id to hang the synthetic one off").toBeTruthy();

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId: anyTenant!.mspId, customerName: `${TAG} synthetic`, tenantId: TAG })
      .returning({ id: tenantsTable.id });
    tenantId = tenant!.id;

    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}@example.invalid`,
        role: "client",
        mspRole: LEGACY_ROLE.customer,
        tenantId,
        mspId: anyTenant!.mspId,
        name: `${TAG} synthetic`,
      })
      .returning({ id: usersTable.id });
    userId = user!.id;

    const [clientService] = await db
      .insert(clientServicesTable)
      .values({ clientUserId: userId, serviceId: foundation!.id, status: "active" })
      .returning({ id: clientServicesTable.id });
    clientServiceId = clientService!.id;

    token = jwt.sign(
      { id: userId, email: `${TAG}@example.invalid`, role: "client", mspRole: LEGACY_ROLE.customer, customerId: tenantId, mspId: anyTenant!.mspId },
      JWT_SECRET,
      { expiresIn: "5m" },
    );

    app = express();
    // Mounted AFTER requireAuth, the convention every capability gate uses.
    // `customer:team.manage`, deliberately — NOT `customer:billing.view`. The active
    // client_services row created above fires `client_services_rbac_billing_on_write`
    // (#3629), which grants this user the real `billing` role, and `billing` IS in
    // billing.view's live allow set. So a billing.view denial is not a denial for this
    // principal at all; team.manage's allow set (cap.team.manage, customer-admin and MSP
    // staff) is one the synthetic Customer genuinely clears none of.
    app.get(`${ROUTE}/rbac-deny`, requireAuth, requireAccess("customer:team.manage", PORTAL_TIER_MODULE_KEYS.riskRegister), (_req, res) => {
      res.json({ ok: true });
    });
    app.get(`${ROUTE}/entitlement-deny`, requireAuth, requireAccess(CUSTOMER_LADDER, PORTAL_TIER_MODULE_KEYS.runbooks), (_req, res) => {
      res.json({ ok: true });
    });
    app.get(`${ROUTE}/allow`, requireAuth, requireAccess(CUSTOMER_LADDER, PORTAL_TIER_MODULE_KEYS.riskRegister), (_req, res) => {
      res.json({ ok: true });
    });
  }, 30_000);

  afterAll(async () => {
    if (!dbm) return;
    const { db, clientServicesTable, platformLogStreamTable, tenantsTable, usersTable } = dbm;
    // Every row this file created, in FK order. Deleting the user cascades its
    // customer_user_roles rows (#3408's insert trigger writes them, and #3629's
    // client_services trigger adds the `billing` grant).
    if (clientServiceId) await db.delete(clientServicesTable).where(eq(clientServicesTable.id, clientServiceId));
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    await db.delete(platformLogStreamTable).where(sql`${platformLogStreamTable.meta}->>'path' LIKE ${`${ROUTE}/%`}`);
  }, 30_000);

  const get = (path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`);

  it("is reading the REAL mapping rows, not the suite-wide fixture", async () => {
    // Guards every assertion below. The fixture's role ids are `rbac-test-*` strings and
    // its allow sets are the pre-#3465 transcription, so a fixture leaking in here would
    // quietly turn a real denial into an allow — which is exactly what it did the first
    // time this file ran.
    const { readMappings } = await import("./rbac-capability-source.ts");
    const [mapping] = await readMappings("customer", "team.manage", null);
    expect(mapping, "customer:team.manage must have a real platform mapping row in this database").toBeTruthy();
    for (const id of mapping!.allow) expect(id, `allow role id ${id} looks like a fixture id`).not.toContain("rbac-test-");
  });

  it("403s an RBAC denial — the Customer rung does not hold customer:team.manage", async () => {
    const res = await get(`${ROUTE}/rbac-deny`);

    expect(res.status, "503 would mean the model could not be read, which is not a denial").toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toBe("Insufficient privileges");
    expect(res.body.error.details).toEqual({ basis: "rbac", capability: "customer:team.manage" });
  });

  it("402s an entitlement denial, naming the real tier that bundles the module", async () => {
    const res = await get(`${ROUTE}/entitlement-deny`);

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: "TIER_UPGRADE_REQUIRED",
      feature: PORTAL_TIER_MODULE_KEYS.runbooks,
      basis: "entitlement",
      upgradePath: "/portal/billing",
    });
    // Read from the live catalog by sort_order, not from a list compiled into the code.
    expect(res.body.requiredTier).toBe("growth");
  });

  it("200s the allow — the same principal, a module Foundation really does bundle", async () => {
    const res = await get(`${ROUTE}/allow`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("writes both denials to platform_log_stream on channel auth, with their basis and reason", async () => {
    // The mirror batches on a 1s timer (lib/log-stream-writer.ts), so poll rather than
    // sleep once — and bail out with a real failure rather than hanging if it never lands.
    const { db, platformLogStreamTable } = dbm;
    const deadline = Date.now() + 15_000;
    let rows: Array<{ level: string; message: string; meta: Record<string, unknown> | null }> = [];
    while (Date.now() < deadline) {
      rows = await db
        .select({ level: platformLogStreamTable.level, message: platformLogStreamTable.message, meta: platformLogStreamTable.meta })
        .from(platformLogStreamTable)
        .where(and(eq(platformLogStreamTable.channel, "auth"), sql`${platformLogStreamTable.meta}->>'path' LIKE ${`${ROUTE}/%`}`));
      if (rows.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const byBasis = new Map(rows.map((row) => [String(row.meta?.basis), row]));
    expect([...byBasis.keys()].sort(), "one audited denial per basis — this is the #4191 audit gap, closed").toEqual(["entitlement", "rbac"]);

    const rbac = byBasis.get("rbac")!;
    expect(rbac.level).toBe("warn");
    expect(rbac.message).toBe("requireAccess denied (rbac)");
    expect(rbac.meta).toMatchObject({ capability: "customer:team.manage", userId, customerId: tenantId, path: `${ROUTE}/rbac-deny` });
    expect(String(rbac.meta?.reason)).toContain("customer:team.manage");

    const entitlement = byBasis.get("entitlement")!;
    expect(entitlement.level).toBe("warn");
    expect(entitlement.message).toBe("requireAccess denied (entitlement)");
    expect(entitlement.meta).toMatchObject({
      moduleKey: PORTAL_TIER_MODULE_KEYS.runbooks,
      requiredTier: "growth",
      currentTier: "foundation",
      path: `${ROUTE}/entitlement-deny`,
    });
    expect(String(entitlement.meta?.reason)).toContain("runbooks");

    // An allow is deliberately NOT logged — 1,600 routes of allow lines would bury the denials.
    expect(rows.some((row) => String(row.meta?.path).endsWith("/allow"))).toBe(false);
  }, 30_000);

  it("leaves no residue — every synthetic row is gone once this file's cleanup runs", async () => {
    // Runs BEFORE afterAll, so it asserts the delete predicates match what was inserted
    // rather than that the database happens to be empty.
    const { db, tenantsTable, usersTable } = dbm;
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, "zz-test-4192-%"));
    expect(users.map((u) => u.id)).toEqual([userId]);
    const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(like(tenantsTable.tenantId, "zz-test-4192-%"));
    expect(tenants.map((t) => t.id)).toEqual([tenantId]);
  });
});
