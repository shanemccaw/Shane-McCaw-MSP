/**
 * admin-rbd.ts — the AdminV2 Risk-Based Decisions module's API (Git #1294).
 *
 * Shane's platform-admin console reads and writes Risk-Based Decisions here.
 * This is the PlatformAdmin-only rebuild called for by #1294: the msp-portal
 * RiskBasedDecisionConsole.tsx (MSP-operator tooling) leaves the live app with
 * #1297, so its create/edit flow — and crucially the linked-check picker that
 * makes #1279's accepted-risk alert suppression reachable — is rebuilt here as
 * a fresh AdminV2 surface rather than relocated.
 *
 *   GET    /api/admin/rbd/customers       — every customer + how many RBDs it has
 *   GET    /api/admin/rbd/:customerId     — that customer's Risk-Based Decisions
 *   POST   /api/admin/rbd/:customerId     — create a Risk-Based Decision
 *   PATCH  /api/admin/rbd/entry/:id       — edit one decision (incl. its linked check)
 *
 * The linked-check catalog itself is served by the existing
 * `GET /api/msp/rbd/available-checks` (routes/msp-rbd.ts), reused as-is — it is
 * PlatformAdmin-reachable (admin sessions rank as PlatformAdmin, above the
 * route's MSPOperator gate) and carries no MSP scoping, so no second catalog
 * route is added here.
 *
 * Auth: `requireAdmin` — the platform-admin session the AdminV2 console carries.
 * Every row is scoped by resolving the customer's own tenant (mspId + M365
 * tenantId) through `resolveTenantScope`, exactly as admin-retainer.ts does, so
 * a stamped `msp_id`/`tenant_id` is always the customer's real identity, never
 * assumed and never taken from the request body.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspRiskDecisionsTable, tenantsTable, RISK_ACCEPTANCE_STATUSES } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { resolveTenantScope } from "../lib/portal-customer-scope.ts";
import { assignRegisterRef } from "../lib/risk-register-ref.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const RAW_RISK_LEVELS = ["critical", "high", "medium"] as const;
const RESIDUAL_RISK_LEVELS = ["high", "medium", "low"] as const;
// `expired` was removed on #1507 — an acceptance is a signed fact and does not
// expire; what lapses is the review clock. See RISK_ACCEPTANCE_STATUSES (Git #2697).

// ── Wire mapper ─────────────────────────────────────────────────────────────
// Only the fields the AdminV2 surface reads. The register-extension columns
// (likelihood/impact/heat-map etc.) belong to the customer portal's Risk
// Register, not this MSP-side management view, so they are not surfaced here.
export function rbdToWire(row: typeof mspRiskDecisionsTable.$inferSelect) {
  return {
    id: row.id,
    rbdId: row.rbdId,
    tenantName: row.tenantName,
    title: row.title,
    controlViolated: row.controlViolated,
    framework: row.framework,
    checkKey: row.checkKey,
    rawRiskLevel: row.rawRiskLevel,
    residualRiskLevel: row.residualRiskLevel,
    rawRiskScore: row.rawRiskScore,
    residualRiskScore: row.residualRiskScore,
    liabilityValueUsd: row.liabilityValueUsd,
    hazardDescription: row.hazardDescription,
    graphEndpoint: row.graphEndpoint,
    expirationDate: row.expirationDate,
    status: row.status,
    rationale: row.rationale,
    clientApproverName: row.clientApprover?.name ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

// ── GET /admin/rbd/customers ────────────────────────────────────────────────
// Every customer, with a count of its Risk-Based Decisions and how many are
// active, so the AdminV2 picker can show who has decisions on file.
router.get("/admin/rbd/customers", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const tenants = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.customerName,
        mspId: tenantsTable.mspId,
        tenantId: tenantsTable.tenantId,
      })
      .from(tenantsTable)
      .orderBy(tenantsTable.customerName);

    const decisions = await db
      .select({
        mspId: mspRiskDecisionsTable.mspId,
        tenantId: mspRiskDecisionsTable.tenantId,
        status: mspRiskDecisionsTable.status,
        checkKey: mspRiskDecisionsTable.checkKey,
      })
      .from(mspRiskDecisionsTable);

    // Key by mspId + tenantId — the pair every msp_risk_decisions row is scoped by.
    const byKey = new Map<string, { total: number; active: number; linked: number }>();
    for (const d of decisions) {
      const key = `${d.mspId}::${(d.tenantId ?? "").trim()}`;
      const agg = byKey.get(key) ?? { total: 0, active: 0, linked: 0 };
      agg.total += 1;
      if (d.status === "active") agg.active += 1;
      if (d.checkKey) agg.linked += 1;
      byKey.set(key, agg);
    }

    const customers = tenants.map((t) => {
      const key = `${t.mspId}::${(t.tenantId ?? "").trim()}`;
      const agg = byKey.get(key) ?? { total: 0, active: 0, linked: 0 };
      return {
        customerId: t.id,
        name: t.name,
        // A blank M365 tenant identifier means the MSP-era tables can't be
        // scoped to this customer at all — surfaced so the UI can say why.
        hasTenantIdentity: !!(t.tenantId ?? "").trim(),
        decisionCount: agg.total,
        activeCount: agg.active,
        linkedCount: agg.linked,
      };
    });

    res.json({ customers });
  } catch (err) {
    log.error({ err }, "GET /admin/rbd/customers failed");
    res.status(500).json({ error: "Failed to load customers" });
  }
});

// ── GET /admin/rbd/:customerId ──────────────────────────────────────────────
router.get("/admin/rbd/:customerId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }
    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(404).json({ error: "Customer not found or has no tenant identity" });
      return;
    }

    const rows = await db
      .select()
      .from(mspRiskDecisionsTable)
      .where(and(eq(mspRiskDecisionsTable.mspId, scope.mspId), eq(mspRiskDecisionsTable.tenantId, scope.tenantId)))
      .orderBy(desc(mspRiskDecisionsTable.id));

    res.json({
      customer: { customerId, name: scope.tenantName, primaryDomain: scope.primaryDomain },
      decisions: rows.map(rbdToWire),
    });
  } catch (err) {
    log.error({ err }, "GET /admin/rbd/:customerId failed");
    res.status(500).json({ error: "Failed to load risk decisions" });
  }
});

// ── POST /admin/rbd/:customerId ─────────────────────────────────────────────
// Create a Risk-Based Decision for a customer. The identity fields (mspId,
// tenantId, tenantName, primaryDomain) come from the resolved tenant, never the
// body; the assessor is the signed-in admin.
const createSchema = z.object({
  title: z.string().min(1).max(500),
  controlViolated: z.string().max(500).optional(),
  framework: z.string().max(200).optional(),
  hazardDescription: z.string().max(4000).optional(),
  graphEndpoint: z.string().max(1000).optional(),
  checkKey: z.string().max(200).nullable().optional(),
  rawRiskLevel: z.enum(RAW_RISK_LEVELS).optional(),
  residualRiskLevel: z.enum(RESIDUAL_RISK_LEVELS).optional(),
  rawRiskScore: z.number().int().min(0).max(100).optional(),
  residualRiskScore: z.number().int().min(0).max(100).optional(),
  liabilityValueUsd: z.number().int().min(0).optional(),
  expirationDate: z.string().max(100).optional(),
  status: z.enum(RISK_ACCEPTANCE_STATUSES).optional(),
  rationale: z.string().max(4000).nullable().optional(),
});

function oneYearOut(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

router.post("/admin/rbd/:customerId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(404).json({ error: "Customer not found or has no tenant identity" });
      return;
    }

    const d = parsed.data;
    const nowUtc = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";
    const rbdId = `RBD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;

    const [inserted] = await db
      .insert(mspRiskDecisionsTable)
      .values({
        mspId: scope.mspId,
        rbdId,
        tenantId: scope.tenantId,
        tenantName: scope.tenantName,
        primaryDomain: scope.primaryDomain,
        title: d.title,
        controlViolated: d.controlViolated ?? d.title,
        framework: d.framework ?? "Custom",
        checkKey: d.checkKey ?? null,
        rawRiskLevel: d.rawRiskLevel ?? "high",
        residualRiskLevel: d.residualRiskLevel ?? "low",
        rawRiskScore: d.rawRiskScore ?? 0,
        residualRiskScore: d.residualRiskScore ?? 0,
        liabilityValueUsd: d.liabilityValueUsd ?? 0,
        hazardDescription: d.hazardDescription ?? "",
        graphEndpoint: d.graphEndpoint ?? "",
        compensatingControls: [],
        mspAssessor: {
          name: req.user?.name || "Platform Admin",
          upn: req.user?.email || "unknown@mspplatform.com",
          timestamp: nowUtc,
        },
        // No customer signature at authoring time — a PlatformAdmin-authored
        // record starts with an empty approver. The existing sign route fills
        // it if the decision is ever routed for signature.
        clientApprover: { name: "", title: "", email: "", signedAt: null, ipAddress: null, signatureHash: null },
        expirationDate: d.expirationDate || oneYearOut(),
        status: d.status ?? "active",
        rationale: d.rationale ?? null,
      })
      .returning();

    inserted.registerRef = await assignRegisterRef(inserted.id);

    log.info({ customerId, rbdId, checkKey: inserted.checkKey }, "risk-based decision created");
    res.status(201).json({ decision: rbdToWire(inserted) });
  } catch (err) {
    log.error({ err }, "POST /admin/rbd/:customerId failed");
    res.status(500).json({ error: "Failed to create risk decision" });
  }
});

// ── PATCH /admin/rbd/entry/:id ──────────────────────────────────────────────
// Edit one decision. `checkKey` is the field that activates #1279's accepted-
// risk alert suppression when the decision is `status = 'active'`.
const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  controlViolated: z.string().max(500).optional(),
  framework: z.string().max(200).optional(),
  hazardDescription: z.string().max(4000).optional(),
  graphEndpoint: z.string().max(1000).optional(),
  checkKey: z.string().max(200).nullable().optional(),
  rawRiskLevel: z.enum(RAW_RISK_LEVELS).optional(),
  residualRiskLevel: z.enum(RESIDUAL_RISK_LEVELS).optional(),
  rawRiskScore: z.number().int().min(0).max(100).optional(),
  residualRiskScore: z.number().int().min(0).max(100).optional(),
  liabilityValueUsd: z.number().int().min(0).optional(),
  expirationDate: z.string().max(100).optional(),
  status: z.enum(RISK_ACCEPTANCE_STATUSES).optional(),
  rationale: z.string().max(4000).nullable().optional(),
});

router.patch("/admin/rbd/entry/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid decision id" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const patch: Partial<typeof mspRiskDecisionsTable.$inferInsert> = { updatedAt: new Date() };
    const d = parsed.data;
    if (d.title !== undefined) patch.title = d.title;
    if (d.controlViolated !== undefined) patch.controlViolated = d.controlViolated;
    if (d.framework !== undefined) patch.framework = d.framework;
    if (d.hazardDescription !== undefined) patch.hazardDescription = d.hazardDescription;
    if (d.graphEndpoint !== undefined) patch.graphEndpoint = d.graphEndpoint;
    if (d.checkKey !== undefined) patch.checkKey = d.checkKey;
    if (d.rawRiskLevel !== undefined) patch.rawRiskLevel = d.rawRiskLevel;
    if (d.residualRiskLevel !== undefined) patch.residualRiskLevel = d.residualRiskLevel;
    if (d.rawRiskScore !== undefined) patch.rawRiskScore = d.rawRiskScore;
    if (d.residualRiskScore !== undefined) patch.residualRiskScore = d.residualRiskScore;
    if (d.liabilityValueUsd !== undefined) patch.liabilityValueUsd = d.liabilityValueUsd;
    if (d.expirationDate !== undefined) patch.expirationDate = d.expirationDate;
    if (d.status !== undefined) patch.status = d.status;
    if (d.rationale !== undefined) patch.rationale = d.rationale;

    const [updated] = await db
      .update(mspRiskDecisionsTable)
      .set(patch)
      .where(eq(mspRiskDecisionsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Risk decision not found" });
      return;
    }
    res.json({ decision: rbdToWire(updated) });
  } catch (err) {
    log.error({ err }, "PATCH /admin/rbd/entry/:id failed");
    res.status(500).json({ error: "Failed to update risk decision" });
  }
});

export default router;
