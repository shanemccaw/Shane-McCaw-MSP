/**
 * MSP Admin Settings Routes — PlatformAdmin surface for MSP tenant management.
 *
 * GET  /api/admin/msps                        — list all MSP tenants (paginated, filterable)
 * POST /api/admin/msps                        — create a new MSP tenant
 * GET  /api/admin/msps/:mspId                 — get MSP detail + subscription info
 * PATCH /api/admin/msps/:mspId               — update MSP profile / status
 * POST /api/admin/msps/:mspId/suspend         — suspend an MSP
 * POST /api/admin/msps/:mspId/reactivate      — reactivate a suspended MSP
 *
 * GET  /api/admin/msps/:mspId/overrides        — get per-MSP overrides
 * PUT  /api/admin/msps/:mspId/overrides        — upsert per-MSP overrides (audit-logged)
 * DELETE /api/admin/msps/:mspId/overrides      — remove overrides
 *
 * GET  /api/admin/plan-capabilities            — list all plan capability rules
 * PUT  /api/admin/plan-capabilities/:serviceId/:capabilityKey — upsert rule
 * DELETE /api/admin/plan-capabilities/:serviceId/:capabilityKey — remove rule
 *
 * GET  /api/admin/msps/:mspId/sessions         — list refresh token + impersonation sessions
 * DELETE /api/admin/msps/:mspId/sessions/:sessionId — revoke a session
 *
 * All routes require PlatformAdmin role (role === "admin").
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspsTable,
  mspSubscriptionsTable,
  mspUsersTable,
  mspOverridesTable,
  mspPlanCapabilitiesTable,
  mspRefreshTokensTable,
  mspImpersonationTokensTable,
  mspAuditLogsTable,
  servicesTable,
} from "@workspace/db";
import { eq, and, desc, asc, count, sql, ilike, or, isNull, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { z } from "zod";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";

const router: IRouter = Router();

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function writeAuditLog(params: {
  req: Request;
  actionType: string;
  entityType: string;
  entityId: string;
  entityLabel?: string;
  mspId?: number;
  outcome?: "success" | "failure" | "partial";
  metadata?: Record<string, unknown>;
}) {
  const user = params.req.user!;
  return db.insert(mspAuditLogsTable).values({
    actorUserId: user.id,
    actorRole: user.role,
    mspId: params.mspId,
    actionType: params.actionType,
    entityType: params.entityType,
    entityId: params.entityId,
    entityLabel: params.entityLabel,
    correlationId: getRequestContext()?.traceId ?? randomUUID(),
    ipAddress: params.req.ip,
    userAgent: params.req.get("user-agent"),
    outcome: params.outcome ?? "success",
    metadata: params.metadata,
  });
}

// ── List MSPs ─────────────────────────────────────────────────────────────────

router.get("/admin/msps", requireAdmin, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(p(req.query["page"] as string | undefined) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(p(req.query["limit"] as string | undefined) || "25", 10)));
  const offset = (page - 1) * limit;
  const search = p(req.query["search"] as string | undefined);
  const status = p(req.query["status"] as string | undefined);

  const conditions = [];
  if (search) {
    conditions.push(
      or(
        ilike(mspsTable.name, `%${search}%`),
        ilike(mspsTable.slug, `%${search}%`),
        ilike(mspsTable.domain, `%${search}%`),
      ),
    );
  }
  if (status && ["active", "suspended", "trial"].includes(status)) {
    conditions.push(eq(mspsTable.status, status as "active" | "suspended" | "trial"));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ total: count() }).from(mspsTable).where(where);
  const rows = await db
    .select({
      id: mspsTable.id,
      name: mspsTable.name,
      slug: mspsTable.slug,
      domain: mspsTable.domain,
      logoUrl: mspsTable.logoUrl,
      status: mspsTable.status,
      trialEndsAt: mspsTable.trialEndsAt,
      offboardingState: mspsTable.offboardingState,
      isDirectBusiness: mspsTable.isDirectBusiness,
      isTestbed: mspsTable.isTestbed,
      createdAt: mspsTable.createdAt,
    })
    .from(mspsTable)
    .where(where)
    .orderBy(desc(mspsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ msps: rows, total: totalRow?.total ?? 0, page, limit });
});

// ── Create MSP ────────────────────────────────────────────────────────────────

const createMspSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  domain: z.string().optional(),
  status: z.enum(["active", "trial"]).default("trial"),
  isDirectBusiness: z.boolean().default(false),
});

router.post("/admin/msps", requireAdmin, async (req: Request, res: Response) => {
  const parsed = createMspSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }
  const data = parsed.data;

  const existing = await db
    .select({ id: mspsTable.id })
    .from(mspsTable)
    .where(eq(mspsTable.slug, data.slug))
    .limit(1);
  if (existing.length > 0) {
    apiError(res, 409, `An MSP with slug "${data.slug}" already exists`);
    return;
  }

  const [msp] = await db
    .insert(mspsTable)
    .values({ ...data, trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) })
    .returning();

  await writeAuditLog({
    req,
    actionType: "msp.create",
    entityType: "msp",
    entityId: String(msp!.id),
    entityLabel: msp!.name,
    mspId: msp!.id,
  });

  res.status(201).json(msp);
});

// ── Get MSP detail ────────────────────────────────────────────────────────────

router.get("/admin/msps/:mspId", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  const [msp] = await db.select().from(mspsTable).where(eq(mspsTable.id, mspId)).limit(1);
  if (!msp) { apiError(res, 404, "MSP not found"); return; }

  const [subscription] = await db
    .select({
      id: mspSubscriptionsTable.id,
      status: mspSubscriptionsTable.status,
      dunningState: mspSubscriptionsTable.dunningState,
      stripeCustomerId: mspSubscriptionsTable.stripeCustomerId,
      stripeSubscriptionId: mspSubscriptionsTable.stripeSubscriptionId,
      stripePriceId: mspSubscriptionsTable.stripePriceId,
      currentPeriodStart: mspSubscriptionsTable.currentPeriodStart,
      currentPeriodEnd: mspSubscriptionsTable.currentPeriodEnd,
      tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
      serviceName: servicesTable.name,
    })
    .from(mspSubscriptionsTable)
    .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
    .where(eq(mspSubscriptionsTable.mspId, mspId))
    .limit(1);

  const [userCount] = await db
    .select({ n: count() })
    .from(mspUsersTable)
    .where(eq(mspUsersTable.mspId, mspId));

  const [override] = await db
    .select()
    .from(mspOverridesTable)
    .where(eq(mspOverridesTable.mspId, mspId))
    .limit(1);

  res.json({ ...msp, subscription: subscription ?? null, userCount: userCount?.n ?? 0, override: override ?? null });
});

// ── Update MSP ────────────────────────────────────────────────────────────────

const updateMspSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  domain: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

router.patch("/admin/msps/:mspId", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  const parsed = updateMspSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(mspsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(mspsTable.id, mspId))
    .returning();

  if (!updated) { apiError(res, 404, "MSP not found"); return; }

  await writeAuditLog({
    req,
    actionType: "msp.update",
    entityType: "msp",
    entityId: String(mspId),
    entityLabel: updated.name,
    mspId,
    metadata: parsed.data,
  });

  res.json(updated);
});

// ── Suspend / Reactivate MSP ──────────────────────────────────────────────────

router.post("/admin/msps/:mspId/suspend", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  const now = new Date();
  const [updated] = await db
    .update(mspsTable)
    .set({ status: "suspended", suspendedAt: now, updatedAt: now })
    .where(and(eq(mspsTable.id, mspId), eq(mspsTable.status, "active")))
    .returning({ id: mspsTable.id, name: mspsTable.name });

  if (!updated) { apiError(res, 404, "MSP not found or not in active state"); return; }

  await writeAuditLog({ req, actionType: "msp.suspend", entityType: "msp", entityId: String(mspId), mspId });
  res.json({ ok: true, status: "suspended" });
});

router.post("/admin/msps/:mspId/reactivate", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  const reactivateNow = new Date();
  const [updated] = await db
    .update(mspsTable)
    .set({ status: "active", suspendedAt: null, updatedAt: reactivateNow })
    .where(and(eq(mspsTable.id, mspId), eq(mspsTable.status, "suspended")))
    .returning({ id: mspsTable.id, name: mspsTable.name });

  if (!updated) { apiError(res, 404, "MSP not found or not in suspended state"); return; }

  await writeAuditLog({ req, actionType: "msp.reactivate", entityType: "msp", entityId: String(mspId), mspId });
  res.json({ ok: true, status: "active" });
});

// ── MSP Overrides ─────────────────────────────────────────────────────────────

router.get("/admin/msps/:mspId/overrides", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  const [override] = await db
    .select()
    .from(mspOverridesTable)
    .where(eq(mspOverridesTable.mspId, mspId))
    .limit(1);

  res.json(override ?? null);
});

const overrideSchema = z.object({
  featureFlags: z.record(z.boolean()).default({}),
  tenantAllowanceOverride: z.number().int().positive().nullable().optional(),
  aiCreditAllowanceOverride: z.number().int().positive().nullable().optional(),
  reason: z.string().min(5).max(500),
  expiresAt: z.string().datetime().nullable().optional(),
});

router.put("/admin/msps/:mspId/overrides", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const values = {
    mspId,
    featureFlags: parsed.data.featureFlags,
    tenantAllowanceOverride: parsed.data.tenantAllowanceOverride ?? null,
    aiCreditAllowanceOverride: parsed.data.aiCreditAllowanceOverride ?? null,
    reason: parsed.data.reason,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    createdByUserId: req.user!.id,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(mspOverridesTable)
    .values(values)
    .onConflictDoUpdate({ target: mspOverridesTable.mspId, set: values })
    .returning();

  await writeAuditLog({
    req,
    actionType: "msp.overrides.upsert",
    entityType: "msp_override",
    entityId: String(mspId),
    mspId,
    metadata: { featureFlags: parsed.data.featureFlags, reason: parsed.data.reason },
  });

  res.json(row);
});

router.delete("/admin/msps/:mspId/overrides", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  await db.delete(mspOverridesTable).where(eq(mspOverridesTable.mspId, mspId));

  await writeAuditLog({
    req,
    actionType: "msp.overrides.delete",
    entityType: "msp_override",
    entityId: String(mspId),
    mspId,
  });

  res.json({ ok: true });
});

// ── Plan Capability Rules ─────────────────────────────────────────────────────

router.get("/admin/plan-capabilities", requireAdmin, async (_req: Request, res: Response) => {
  const caps = await db
    .select({
      id: mspPlanCapabilitiesTable.id,
      serviceId: mspPlanCapabilitiesTable.serviceId,
      capabilityKey: mspPlanCapabilitiesTable.capabilityKey,
      enabled: mspPlanCapabilitiesTable.enabled,
      updatedAt: mspPlanCapabilitiesTable.updatedAt,
      serviceName: servicesTable.name,
    })
    .from(mspPlanCapabilitiesTable)
    .leftJoin(servicesTable, eq(servicesTable.id, mspPlanCapabilitiesTable.serviceId))
    .orderBy(asc(mspPlanCapabilitiesTable.serviceId), asc(mspPlanCapabilitiesTable.capabilityKey));

  res.json(caps);
});

const capabilityRuleSchema = z.object({
  enabled: z.boolean(),
});

router.put(
  "/admin/plan-capabilities/:serviceId/:capabilityKey",
  requireAdmin,
  async (req: Request, res: Response) => {
    const serviceId = parseInt(p(req.params["serviceId"]), 10);
    const capabilityKey = p(req.params["capabilityKey"]);
    if (isNaN(serviceId) || !capabilityKey) { apiError(res, 400, "Invalid params"); return; }

    const parsed = capabilityRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }

    const values = {
      serviceId,
      capabilityKey,
      enabled: parsed.data.enabled,
      updatedAt: new Date(),
      updatedByUserId: req.user!.id,
    };

    const [row] = await db
      .insert(mspPlanCapabilitiesTable)
      .values(values)
      .onConflictDoUpdate({
        target: [mspPlanCapabilitiesTable.serviceId, mspPlanCapabilitiesTable.capabilityKey],
        set: { enabled: values.enabled, updatedAt: values.updatedAt, updatedByUserId: values.updatedByUserId },
      })
      .returning();

    await writeAuditLog({
      req,
      actionType: "plan_capability.upsert",
      entityType: "msp_plan_capability",
      entityId: `${serviceId}:${capabilityKey}`,
      metadata: { serviceId, capabilityKey, enabled: parsed.data.enabled },
    });

    res.json(row);
  },
);

router.delete(
  "/admin/plan-capabilities/:serviceId/:capabilityKey",
  requireAdmin,
  async (req: Request, res: Response) => {
    const serviceId = parseInt(p(req.params["serviceId"]), 10);
    const capabilityKey = p(req.params["capabilityKey"]);
    if (isNaN(serviceId) || !capabilityKey) { apiError(res, 400, "Invalid params"); return; }

    await db
      .delete(mspPlanCapabilitiesTable)
      .where(
        and(
          eq(mspPlanCapabilitiesTable.serviceId, serviceId),
          eq(mspPlanCapabilitiesTable.capabilityKey, capabilityKey),
        ),
      );

    await writeAuditLog({
      req,
      actionType: "plan_capability.delete",
      entityType: "msp_plan_capability",
      entityId: `${serviceId}:${capabilityKey}`,
      metadata: { serviceId, capabilityKey },
    });

    res.json({ ok: true });
  },
);

// ── Sessions (refresh tokens + impersonation tokens) ──────────────────────────

router.get("/admin/msps/:mspId/sessions", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(p(req.params["mspId"]), 10);
  if (isNaN(mspId)) { apiError(res, 400, "mspId must be a number"); return; }

  const users = await db
    .select({ userId: mspUsersTable.userId })
    .from(mspUsersTable)
    .where(eq(mspUsersTable.mspId, mspId));

  const userIds = users.map((u) => u.userId);

  if (userIds.length === 0) {
    res.json({ refreshTokens: [], impersonationTokens: [] });
    return;
  }

  const [refreshTokens, impersonationTokens] = await Promise.all([
    db
      .select()
      .from(mspRefreshTokensTable)
      .where(
        and(
          sql`${mspRefreshTokensTable.userId} = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}`), sql`, `)}]::int[])`,
          isNull(mspRefreshTokensTable.revokedAt),
        ),
      )
      .orderBy(desc(mspRefreshTokensTable.issuedAt))
      .limit(50),
    db
      .select()
      .from(mspImpersonationTokensTable)
      .where(
        and(
          eq(mspImpersonationTokensTable.targetMspId, mspId),
          isNull(mspImpersonationTokensTable.revokedAt),
        ),
      )
      .orderBy(desc(mspImpersonationTokensTable.issuedAt))
      .limit(20),
  ]);

  res.json({ refreshTokens, impersonationTokens });
});

router.delete(
  "/admin/msps/:mspId/sessions/:type/:sessionId",
  requireAdmin,
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    const type = p(req.params["type"]);
    const sessionId = p(req.params["sessionId"]);
    if (isNaN(mspId) || !sessionId) { apiError(res, 400, "Invalid params"); return; }

    if (type === "refresh") {
      await db
        .update(mspRefreshTokensTable)
        .set({ revokedAt: new Date() })
        .where(eq(mspRefreshTokensTable.tokenHash, sessionId));
    } else if (type === "impersonation") {
      await db
        .update(mspImpersonationTokensTable)
        .set({ revokedAt: new Date() })
        .where(eq(mspImpersonationTokensTable.tokenId, sessionId));
    } else {
      apiError(res, 400, "type must be 'refresh' or 'impersonation'");
      return;
    }

    await writeAuditLog({
      req,
      actionType: `session.${type}.revoke`,
      entityType: "session",
      entityId: sessionId,
      mspId,
    });

    logger.info({ mspId, type, sessionId }, "msp-admin: session revoked");
    res.json({ ok: true });
  },
);

export default router;
