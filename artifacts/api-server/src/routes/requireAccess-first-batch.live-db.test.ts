/**
 * Live-Postgres acceptance test for #4193 — the first real routes on `requireAccess()`.
 *
 * #4193 (leaf 3 of #1704) moved the seven READ routes that carried BOTH
 * `requireCapability("ladder.customer-user")` AND `requireTierFeature(...)` onto one
 * `requireAuth, requireAccess("ladder.customer-user", <module>)` chain:
 *
 *   GET /api/portal/risk-register            risk_register     portal-risk-register.ts
 *   GET /api/portal/policy-decisions         policy_decisions  portal-risk-register.ts
 *   GET /api/portal/poams                    poams             portal-poams.ts
 *   GET /api/portal/poams/available-checks   poams             portal-poams.ts
 *   GET /api/portal/poams/:poamId            poams             portal-poams.ts
 *   GET /api/portal/ownership                ownership         portal-ownership.ts
 *   GET /api/portal/ownership/events         ownership         portal-ownership.ts
 *
 * It is a decision-source swap, not a new rule, so this proves "no regression" the
 * #2458 way: the REAL route modules (new gate) and the RETIRED two-gate chain are
 * mounted side by side in one app and asked the same question by the same real
 * principals, against the real rows. For every (principal, route):
 *
 *   - wherever the old chain DENIED, the migrated route denies with the same status and
 *     the same legacy body fields (403 `error.code`/`error.message`; 402
 *     `error`/`code`/`feature`) — plus the deliberate #4192 additions (`basis`,
 *     `requiredTier`, `upgradePath`);
 *   - wherever the old chain ALLOWED, the migrated route lets the request through to
 *     its real handler.
 *
 * The four principals cover RBAC-deny, entitlement-deny (both with no subscription and
 * with a tier that lacks the module) and allow, on the live `services` tier catalog.
 * Both denial kinds must also land in `platform_log_stream` on channel `auth` for the
 * real route paths — the #4191 audit gap, closed on real routes.
 *
 * ── The synthetic principals ────────────────────────────────────────────────
 *
 * Four `zz-test-4193-*` tenants (the reserved synthetic-identity prefix, CLAUDE.md), one
 * `zz-test-4193-*@example.invalid` login each, hung off an existing msps.id, with an
 * active `client_services` row against the real catalog tier row where the case needs
 * one. Nothing privileged, no real tenant or person touched. `afterAll` deletes every row
 * created (log rows included) and the last test asserts the delete predicates match.
 *
 * Skips cleanly with no `DATABASE_URL`.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run requireAccess-first-batch.live-db
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { LEGACY_ROLE, type LegacyRole } from "@workspace/db/rbac/legacy-ladder";
import { PORTAL_TIER_MODULE_KEYS, type PortalTierModuleKey } from "@workspace/db/rbac/tier-modules";

// The decision must come from the REAL mapping rows; vitest.config.ts installs
// setup-file fixtures of both row sources, so opt back out of both.
vi.unmock("../middlewares/rbac-ladder-source.ts");
vi.unmock("../middlewares/rbac-capability-source.ts");

const JWT_SECRET = "test-requireAccess-first-batch-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4193-${randomUUID().slice(0, 8)}`;
const LADDER = "ladder.customer-user";

interface MigratedRoute {
  readonly path: string;
  readonly moduleKey: PortalTierModuleKey;
}

const ROUTES: readonly MigratedRoute[] = [
  { path: "/api/portal/risk-register", moduleKey: PORTAL_TIER_MODULE_KEYS.riskRegister },
  { path: "/api/portal/policy-decisions", moduleKey: PORTAL_TIER_MODULE_KEYS.policyDecisions },
  { path: "/api/portal/poams", moduleKey: PORTAL_TIER_MODULE_KEYS.poams },
  { path: "/api/portal/poams/available-checks", moduleKey: PORTAL_TIER_MODULE_KEYS.poams },
  { path: "/api/portal/poams/999999999", moduleKey: PORTAL_TIER_MODULE_KEYS.poams },
  { path: "/api/portal/ownership", moduleKey: PORTAL_TIER_MODULE_KEYS.ownership },
  { path: "/api/portal/ownership/events", moduleKey: PORTAL_TIER_MODULE_KEYS.ownership },
];

type PrincipalName = "freeOnPremier" | "customerNoSub" | "customerFoundation" | "customerPremier";

interface PrincipalSpec {
  readonly rung: LegacyRole;
  readonly tier: "foundation" | "premier" | null;
}

const PRINCIPALS: Record<PrincipalName, PrincipalSpec> = {
  // RBAC deny: Free is below the Customer rung — even though the org is on Premier.
  freeOnPremier: { rung: LEGACY_ROLE.free, tier: "premier" },
  // Entitlement deny with no active Monitoring subscription at all.
  customerNoSub: { rung: LEGACY_ROLE.customer, tier: null },
  // Mixed: Foundation bundles risk_register + policy_decisions, not poams / ownership.
  customerFoundation: { rung: LEGACY_ROLE.customer, tier: "foundation" },
  // Allow on every migrated route.
  customerPremier: { rung: LEGACY_ROLE.customer, tier: "premier" },
};

describeLive("#4193 — the first dual-gated routes on requireAccess, against the real database", () => {
  let dbm: typeof import("@workspace/db");
  let app: express.Express;
  const tenantIds: number[] = [];
  const userIds: number[] = [];
  const tokens = new Map<PrincipalName, string>();
  const userIdOf = new Map<PrincipalName, number>();
  /** The live catalog's answer to "lowest tier bundling X", read the same way the gate reads it. */
  const lowestTier = new Map<string, string>();

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    const { db, clientServicesTable, servicesTable, tenantsTable, usersTable } = dbm;
    const { requireCapability } = await import("../middlewares/requireAuth.ts");
    const { requireTierFeature } = await import("../lib/portal-tier-features.ts");

    const tierRows = await db
      .select({ id: servicesTable.id, tier: servicesTable.tier, sortOrder: servicesTable.sortOrder, typeAttributes: servicesTable.typeAttributes })
      .from(servicesTable)
      .where(eq(servicesTable.serviceType, "monitoring_tier"))
      .orderBy(asc(servicesTable.sortOrder));
    const tierServiceId = new Map<string, number>();
    for (const row of tierRows) {
      if (!row.tier) continue;
      if (!tierServiceId.has(row.tier)) tierServiceId.set(row.tier, row.id);
      const included = ((row.typeAttributes ?? {}) as { includedFeatures?: unknown }).includedFeatures;
      for (const key of Array.isArray(included) ? included : []) {
        if (typeof key === "string" && !lowestTier.has(key)) lowestTier.set(key, row.tier);
      }
    }
    expect(tierServiceId.get("foundation"), "live catalog must carry a foundation monitoring_tier row").toBeTruthy();
    expect(tierServiceId.get("premier"), "live catalog must carry a premier monitoring_tier row").toBeTruthy();

    const [anyTenant] = await db.select({ mspId: tenantsTable.mspId }).from(tenantsTable).limit(1);
    expect(anyTenant, "the database must carry at least one tenant, for a real msps.id").toBeTruthy();
    const mspId = anyTenant!.mspId;

    for (const [name, spec] of Object.entries(PRINCIPALS) as Array<[PrincipalName, PrincipalSpec]>) {
      const label = `${TAG}-${name.toLowerCase()}`;
      const [tenant] = await db
        .insert(tenantsTable)
        .values({ mspId, customerName: `${label} synthetic`, tenantId: label })
        .returning({ id: tenantsTable.id });
      tenantIds.push(tenant!.id);

      const email = `${label}@example.invalid`;
      const [user] = await db
        .insert(usersTable)
        .values({ email, role: "client", mspRole: spec.rung, tenantId: tenant!.id, mspId, name: `${label} synthetic` })
        .returning({ id: usersTable.id });
      userIds.push(user!.id);
      userIdOf.set(name, user!.id);

      if (spec.tier !== null) {
        await db
          .insert(clientServicesTable)
          .values({ clientUserId: user!.id, serviceId: tierServiceId.get(spec.tier)!, status: "active" });
      }

      tokens.set(
        name,
        jwt.sign(
          { id: user!.id, email, role: "client", mspRole: spec.rung, customerId: tenant!.id, mspId },
          JWT_SECRET,
          { expiresIn: "10m" },
        ),
      );
    }

    app = express();
    app.use(express.json());
    // The REAL route modules, carrying the migrated gate.
    for (const mod of ["./portal-risk-register.ts", "./portal-poams.ts", "./portal-ownership.ts"]) {
      const { default: router } = await import(mod);
      app.use("/api", router);
    }
    // The RETIRED chain, exactly as the routes carried it before #4193, one shadow path per
    // module. The key stays a literal: requireCapability-keys.test.ts rejects any
    // non-literal requireCapability argument, test files included.
    const legacyModules = [...new Set(ROUTES.map((r) => r.moduleKey))];
    for (const moduleKey of legacyModules) {
      app.get(`/legacy/${TAG}/${moduleKey}`, requireCapability("ladder.customer-user"), requireTierFeature(moduleKey), (_req, res) => {
        res.json({ legacyAllowed: true });
      });
    }
  }, 120_000);

  afterAll(async () => {
    if (!dbm) return;
    const { db, clientServicesTable, platformLogStreamTable, tenantsTable, usersTable } = dbm;
    // By the TAG predicate, not by the id arrays — a beforeAll that died half-way (a hook
    // timeout under load) still leaves rows the arrays never recorded.
    const tagged = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `${TAG}-%`));
    const ids = tagged.map((u) => u.id);
    if (ids.length) {
      await db.delete(clientServicesTable).where(inArray(clientServicesTable.clientUserId, ids));
      await db.delete(platformLogStreamTable).where(
        inArray(sql<string>`${platformLogStreamTable.meta}->>'userId'`, ids.map(String)),
      );
      await db.delete(usersTable).where(inArray(usersTable.id, ids));
    }
    await db.delete(tenantsTable).where(like(tenantsTable.tenantId, `${TAG}-%`));
  }, 60_000);

  const get = (who: PrincipalName, path: string) =>
    request(app).get(path).set("Authorization", `Bearer ${tokens.get(who)}`);

  /** A response the GATE wrote, as opposed to one the route handler wrote. */
  function isGateDenial(res: request.Response): boolean {
    if (res.status === 401 || res.status === 503) return true;
    if (res.status === 402 && res.body?.code === "TIER_UPGRADE_REQUIRED") return true;
    if (res.status === 403 && res.body?.error?.details?.basis === "rbac") return true;
    return false;
  }

  it("reads the REAL ladder mapping rows, not the suite-wide fixture", async () => {
    // Proved behaviourally: the Customer rung must clear the live ladder.customer-user
    // row and Free must not. A leaked fixture would make every RBAC case below vacuous.
    const { roleClearsLadderCapability } = await import("../middlewares/rbac-ladder.ts");
    expect((await roleClearsLadderCapability(LEGACY_ROLE.customer, LADDER)).kind).toBe("allow");
    expect((await roleClearsLadderCapability(LEGACY_ROLE.free, LADDER)).kind).toBe("deny");
  });

  for (const route of ROUTES) {
    describe(route.path, () => {
      it("RBAC deny — Free on a Premier org: 403, identical to the retired chain, plus basis", async () => {
        const legacy = await get("freeOnPremier", `/legacy/${TAG}/${route.moduleKey}`);
        const res = await get("freeOnPremier", route.path);

        expect(legacy.status).toBe(403);
        expect(res.status).toBe(legacy.status);
        expect(res.body.error.code).toBe(legacy.body.error.code);
        expect(res.body.error.message).toBe(legacy.body.error.message);
        expect(res.body.error.message).toBe("Insufficient privileges — Customer or above required");
        expect(res.body.error.details).toEqual({ basis: "rbac", capability: LADDER });
      });

      it("entitlement deny — Customer with no subscription: 402, identical to the retired chain, plus upgrade path", async () => {
        const legacy = await get("customerNoSub", `/legacy/${TAG}/${route.moduleKey}`);
        const res = await get("customerNoSub", route.path);

        expect(legacy.status).toBe(402);
        expect(res.status).toBe(402);
        expect({ error: res.body.error, code: res.body.code, feature: res.body.feature }).toEqual(legacy.body);
        expect(res.body).toMatchObject({ basis: "entitlement", upgradePath: "/portal/billing" });
        expect(res.body.requiredTier).toBe(lowestTier.get(route.moduleKey) ?? null);
      });

      it("Customer on Foundation: same outcome as the retired chain", async () => {
        const legacy = await get("customerFoundation", `/legacy/${TAG}/${route.moduleKey}`);
        const res = await get("customerFoundation", route.path);

        if (legacy.status === 200) {
          expect(isGateDenial(res), `gate denied what the retired chain allowed: ${res.status} ${JSON.stringify(res.body)}`).toBe(false);
        } else {
          expect(legacy.status).toBe(402);
          expect(res.status).toBe(402);
          expect({ error: res.body.error, code: res.body.code, feature: res.body.feature }).toEqual(legacy.body);
          expect(res.body.requiredTier).toBe(lowestTier.get(route.moduleKey) ?? null);
        }
      });

      it("allow — Customer on Premier: reaches the real handler, as the retired chain did", async () => {
        const legacy = await get("customerPremier", `/legacy/${TAG}/${route.moduleKey}`);
        const res = await get("customerPremier", route.path);

        expect(legacy.status).toBe(200);
        expect(isGateDenial(res), `gate denied an allowed caller: ${res.status} ${JSON.stringify(res.body)}`).toBe(false);
        // And the real handler genuinely answered: 200, or its own 400/404 for an
        // empty synthetic tenant (no query params on /events, no such POA&M id).
        expect([200, 400, 404], `handler answered ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
      });
    });
  }

  it("audits both denial kinds for the real route paths on channel auth", async () => {
    const { db, platformLogStreamTable } = dbm;
    const rbacUser = userIdOf.get("freeOnPremier")!;
    const entUser = userIdOf.get("customerNoSub")!;
    const deadline = Date.now() + 20_000;
    let rows: Array<{ meta: Record<string, unknown> | null; message: string }> = [];
    while (Date.now() < deadline) {
      rows = await db
        .select({ meta: platformLogStreamTable.meta, message: platformLogStreamTable.message })
        .from(platformLogStreamTable)
        .where(
          and(
            eq(platformLogStreamTable.channel, "auth"),
            sql`${platformLogStreamTable.meta}->>'userId' IN (${String(rbacUser)}, ${String(entUser)})`,
            sql`${platformLogStreamTable.meta}->>'path' LIKE '/api/portal/%'`,
          ),
        );
      if (rows.length >= ROUTES.length * 2) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    for (const route of ROUTES) {
      const rbac = rows.find((r) => r.meta?.path === route.path && r.meta?.userId === rbacUser);
      expect(rbac, `rbac denial audit line for ${route.path}`).toBeTruthy();
      expect(rbac!.message).toBe("requireAccess denied (rbac)");
      expect(rbac!.meta).toMatchObject({ basis: "rbac", capability: LADDER });

      const ent = rows.find((r) => r.meta?.path === route.path && r.meta?.userId === entUser);
      expect(ent, `entitlement denial audit line for ${route.path}`).toBeTruthy();
      expect(ent!.message).toBe("requireAccess denied (entitlement)");
      expect(ent!.meta).toMatchObject({ basis: "entitlement", moduleKey: route.moduleKey, currentTier: null });
    }
  }, 30_000);

  it("leaves no residue — the delete predicates match exactly what was inserted", async () => {
    const { db, tenantsTable, usersTable } = dbm;
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `${TAG}-%`));
    expect(users.map((u) => u.id).sort()).toEqual([...userIds].sort());
    const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(like(tenantsTable.tenantId, `${TAG}-%`));
    expect(tenants.map((t) => t.id).sort()).toEqual([...tenantIds].sort());
  });
});
