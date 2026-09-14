/**
 * Live-Postgres regression test for Git #4086.
 *
 * `admin-m365-interpretations.ts`'s 12 routes were gated `requireAdmin` — the legacy
 * literal `role: "admin"` check — even though #1688's 2026-09-12 decision put
 * interpretation authoring in the MSP Console, not AdminV2. An MSPOperator or MSPAdmin
 * session (the console's real users) could not reach any of them; only a legacy
 * PlatformAdmin account could. The fix re-gates every route to
 * `requireCapability("ladder.msp-operator")`, the same pattern
 * `msp-message-center.ts:24` already uses — which admits MSPOperator, MSPAdmin and
 * PlatformAdmin, and refuses a Customer/Free session.
 *
 * Runs the real router and the real seeded ladder rows against the local
 * DATABASE_URL, and proves for the three real roles named in #4086's dispatch:
 *   1. PlatformAdmin reaches GET (list) and POST (create).
 *   2. MSPAdmin reaches GET (list) and POST (create) — was 403 before this fix.
 *   3. MSPOperator reaches GET (list), POST (create), and POST .../confirm — was 403
 *      before this fix.
 *   4. A Customer session is still refused (403) — the widen is bounded, not open.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row is synthetic, suffixed, and removed
 * in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run admin-m365-interpretations-rung.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db, mspsTable, usersTable, tenantsTable, m365ChangeInterpretationsTable, M365_CHANGE_CLASSES } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { LEGACY_ROLE, type LegacyRole } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-admin-m365-interpretations-rung-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

describe.skipIf(!process.env.DATABASE_URL)(
  "admin-m365-interpretations.ts admits MSPOperator/MSPAdmin/PlatformAdmin, refuses Customer — live Postgres (#4086)",
  () => {
    const suffix = `vitest-4086-${Math.floor(Math.random() * 1e9)}`;
    let mspId: number;
    let tenantId: number;
    const ids = {} as Record<"platformAdmin" | "mspAdmin" | "mspOperator" | "customer", number>;
    const tokens = {} as Record<"platformAdmin" | "mspAdmin" | "mspOperator" | "customer", string>;
    const createdInterpretationIds: number[] = [];

    // users_role_scope_check (#3608) requires a tenant for the Customer/Free rungs.
    const TENANT_SCOPED_ROLES: readonly LegacyRole[] = [LEGACY_ROLE.customer, LEGACY_ROLE.free];

    async function insertUser(key: keyof typeof ids, mspRole: LegacyRole): Promise<void> {
      const [row] = await db
        .insert(usersTable)
        .values({
          email: `${key}-${suffix}@example.com`,
          role: "client",
          mspRole,
          mspId,
          tenantId: TENANT_SCOPED_ROLES.includes(mspRole) ? tenantId : null,
        })
        .returning({ id: usersTable.id });
      ids[key] = row.id;
      tokens[key] = jwt.sign(
        { id: row.id, email: `${key}-${suffix}@example.com`, role: "client", mspRole, mspId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
    }

    beforeAll(async () => {
      const [msp] = await db
        .insert(mspsTable)
        .values({ name: `M365 Interpretations Rung Test MSP ${suffix}`, slug: suffix })
        .returning({ id: mspsTable.id });
      mspId = msp.id;

      const [tenant] = await db
        .insert(tenantsTable)
        .values({ mspId, customerName: `M365 Interpretations Rung Test Tenant ${suffix}`, tenantId: suffix })
        .returning({ id: tenantsTable.id });
      tenantId = tenant.id;

      await insertUser("platformAdmin", LEGACY_ROLE.platformAdmin);
      await insertUser("mspAdmin", LEGACY_ROLE.mspAdmin);
      await insertUser("mspOperator", LEGACY_ROLE.mspOperator);
      await insertUser("customer", LEGACY_ROLE.customer);
    });

    afterAll(async () => {
      if (createdInterpretationIds.length > 0) {
        await db.delete(m365ChangeInterpretationsTable).where(inArray(m365ChangeInterpretationsTable.id, createdInterpretationIds));
      }
      const userIds = Object.values(ids);
      if (userIds.length > 0) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
      if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
      if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    }, 120_000);

    async function buildApp() {
      const { default: router } = await import("./admin-m365-interpretations.ts");
      const app = express();
      app.use(express.json());
      app.use("/api", router);
      return app;
    }

    function createBody(title: string) {
      return {
        sourceKind: "manual",
        title,
        changeClass: M365_CHANGE_CLASSES[0],
      };
    }

    it("PlatformAdmin reaches GET (list) and POST (create)", async () => {
      const app = await buildApp();
      const listRes = await request(app).get("/api/admin/m365/interpretations").set("Authorization", `Bearer ${tokens.platformAdmin}`);
      expect(listRes.status).toBe(200);

      const createRes = await request(app)
        .post("/api/admin/m365/interpretations")
        .set("Authorization", `Bearer ${tokens.platformAdmin}`)
        .send(createBody(`PlatformAdmin create ${suffix}`));
      expect(createRes.status).toBe(201);
      createdInterpretationIds.push(createRes.body.interpretation.id);
    });

    it("MSPAdmin reaches GET (list) and POST (create) — was 403 before #4086's fix", async () => {
      const app = await buildApp();
      const listRes = await request(app).get("/api/admin/m365/interpretations").set("Authorization", `Bearer ${tokens.mspAdmin}`);
      expect(listRes.status).toBe(200);

      const createRes = await request(app)
        .post("/api/admin/m365/interpretations")
        .set("Authorization", `Bearer ${tokens.mspAdmin}`)
        .send(createBody(`MSPAdmin create ${suffix}`));
      expect(createRes.status).toBe(201);
      createdInterpretationIds.push(createRes.body.interpretation.id);
    });

    it("MSPOperator reaches GET (list), POST (create), and POST .../confirm — was 403 before #4086's fix", async () => {
      const app = await buildApp();
      const listRes = await request(app).get("/api/admin/m365/interpretations").set("Authorization", `Bearer ${tokens.mspOperator}`);
      expect(listRes.status).toBe(200);

      const createRes = await request(app)
        .post("/api/admin/m365/interpretations")
        .set("Authorization", `Bearer ${tokens.mspOperator}`)
        .send(createBody(`MSPOperator create ${suffix}`));
      expect(createRes.status).toBe(201);
      const id = createRes.body.interpretation.id;
      createdInterpretationIds.push(id);

      const confirmRes = await request(app)
        .post(`/api/admin/m365/interpretations/${id}/confirm`)
        .set("Authorization", `Bearer ${tokens.mspOperator}`);
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.interpretation.status).toBe("confirmed");
    });

    it("a Customer session is still refused — 403", async () => {
      const app = await buildApp();
      const listRes = await request(app).get("/api/admin/m365/interpretations").set("Authorization", `Bearer ${tokens.customer}`);
      expect(listRes.status).toBe(403);

      const createRes = await request(app)
        .post("/api/admin/m365/interpretations")
        .set("Authorization", `Bearer ${tokens.customer}`)
        .send(createBody(`Customer create ${suffix}`));
      expect(createRes.status).toBe(403);
    });
  },
);
