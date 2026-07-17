/**
 * routes/sales-offers.ts
 *
 * Sales Offer Engine — REST API
 *
 * Plan-gated with requirePlanFeature('sales_offers').
 * All write endpoints are admin-only.
 *
 * Lifecycle state transitions:
 *   draft → sent → accepted | rejected | expired
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  salesOffersTable,
  salesOfferEventsTable,
  salesOfferConfigTable,
  salesOfferRuleGroupsTable,
  SALES_OFFER_STATES,
  SALES_OFFER_RULE_TYPES,
  type SalesOfferState,
} from "@workspace/db";
import { eq, desc, and, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { requirePlanFeature } from "../lib/msp-entitlement";
import {
  runSalesOfferEngineForTenant,
  persistSalesOfferCandidates,
  transitionOfferState,
  expireStaleSalesOffers,
  loadSalesOfferConfig,
} from "../lib/sales-offer-engine";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "engine.offer" });

const router = Router();

// ── List offers ──────────────────────────────────────────────────────────────

/**
 * GET /api/sales-offers
 * Query params: customerId?, state?, mspId?, limit?, offset?
 */
router.get(
  "/api/sales-offers",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = req.query["customerId"] ? parseInt(req.query["customerId"] as string, 10) : undefined;
      const state = req.query["state"] as SalesOfferState | undefined;
      const mspId = req.query["mspId"] ? parseInt(req.query["mspId"] as string, 10) : undefined;
      const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10) || 50, 200);
      const offset = parseInt((req.query["offset"] as string) ?? "0", 10) || 0;

      const conditions = [];
      if (customerId != null && !isNaN(customerId)) conditions.push(eq(salesOffersTable.customerId, customerId));
      if (state && SALES_OFFER_STATES.includes(state)) conditions.push(eq(salesOffersTable.state, state));
      if (mspId != null && !isNaN(mspId)) conditions.push(eq(salesOffersTable.mspId, mspId));

      const rows = await db
        .select()
        .from(salesOffersTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(salesOffersTable.score), desc(salesOffersTable.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({ offers: rows, limit, offset });
    } catch (err) {
      log.error({ err }, "GET /api/sales-offers failed");
      res.status(500).json({ error: "Failed to list sales offers" });
    }
  },
);

// ── Get single offer ─────────────────────────────────────────────────────────

/**
 * GET /api/sales-offers/:id
 */
router.get(
  "/api/sales-offers/:id",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid offer id" });
        return;
      }

      const [offer] = await db.select().from(salesOffersTable).where(eq(salesOffersTable.id, id)).limit(1);
      if (!offer) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const events = await db
        .select()
        .from(salesOfferEventsTable)
        .where(eq(salesOfferEventsTable.offerId, id))
        .orderBy(asc(salesOfferEventsTable.createdAt));

      res.json({ offer, events });
    } catch (err) {
      log.error({ err }, "GET /api/sales-offers/:id failed");
      res.status(500).json({ error: "Failed to fetch sales offer" });
    }
  },
);

// ── Generate offers ───────────────────────────────────────────────────────────

/**
 * POST /api/sales-offers/generate
 * Body: { customerId: number, mspId?: number }
 *
 * Runs the full Sales Offer Engine for a tenant and persists draft offers.
 * Idempotent — duplicate signal sets skip insert (ON CONFLICT DO NOTHING).
 */
router.post(
  "/api/sales-offers/generate",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { customerId, mspId = null } = req.body as { customerId?: number; mspId?: number | null };
      if (!customerId || isNaN(Number(customerId))) {
        res.status(400).json({ error: "customerId is required" });
        return;
      }

      const engineOutput = await runSalesOfferEngineForTenant(Number(customerId), mspId ? Number(mspId) : null);
      const insertedIds = await persistSalesOfferCandidates(
        engineOutput.candidates,
        Number(customerId),
        mspId ? Number(mspId) : null,
        engineOutput as unknown as Record<string, unknown>,
      );

      log.info({ customerId, insertedCount: insertedIds.length }, "POST /api/sales-offers/generate completed");
      res.status(201).json({
        insertedOfferIds: insertedIds,
        candidateCount: engineOutput.candidates.length,
        firedSignals: engineOutput.firedSignals,
        config: engineOutput.config,
      });
    } catch (err) {
      log.error({ err }, "POST /api/sales-offers/generate failed");
      res.status(500).json({ error: "Failed to generate sales offers" });
    }
  },
);

// ── Transition offer state ────────────────────────────────────────────────────

/**
 * PATCH /api/sales-offers/:id/state
 * Body: { newState: SalesOfferState, rejectionReason?: string }
 */
router.patch(
  "/api/sales-offers/:id/state",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid offer id" });
        return;
      }

      const { newState, rejectionReason } = req.body as { newState?: string; rejectionReason?: string };
      if (!newState || !SALES_OFFER_STATES.includes(newState as SalesOfferState)) {
        res.status(400).json({ error: `newState must be one of: ${SALES_OFFER_STATES.join(", ")}` });
        return;
      }

      const actorId = (req as unknown as Record<string, unknown>)["userId"] as number | undefined ?? null;
      const updated = await transitionOfferState(id, newState as SalesOfferState, actorId, { rejectionReason });
      res.json({ offer: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Invalid transition") || message.includes("not found")) {
        res.status(422).json({ error: message });
        return;
      }
      log.error({ err }, "PATCH /api/sales-offers/:id/state failed");
      res.status(500).json({ error: "Failed to transition offer state" });
    }
  },
);

// ── Delete draft offer ────────────────────────────────────────────────────────

/**
 * DELETE /api/sales-offers/:id
 * Only draft offers may be deleted.
 */
router.delete(
  "/api/sales-offers/:id",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid offer id" });
        return;
      }

      const [offer] = await db
        .select({ id: salesOffersTable.id, state: salesOffersTable.state })
        .from(salesOffersTable)
        .where(eq(salesOffersTable.id, id))
        .limit(1);
      if (!offer) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (offer.state !== "draft") {
        res.status(422).json({ error: "Only draft offers may be deleted" });
        return;
      }

      await db.delete(salesOffersTable).where(eq(salesOffersTable.id, id));
      res.json({ deleted: true, id });
    } catch (err) {
      log.error({ err }, "DELETE /api/sales-offers/:id failed");
      res.status(500).json({ error: "Failed to delete sales offer" });
    }
  },
);

// ── Expire stale offers ───────────────────────────────────────────────────────

/**
 * POST /api/sales-offers/expire-stale
 * Admin-only — marks sent offers whose TTL has passed as expired.
 */
router.post(
  "/api/sales-offers/expire-stale",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const expired = await expireStaleSalesOffers();
      res.json({ expired });
    } catch (err) {
      log.error({ err }, "POST /api/sales-offers/expire-stale failed");
      res.status(500).json({ error: "Failed to expire stale offers" });
    }
  },
);

// ── Config (engine-level) ─────────────────────────────────────────────────────

/**
 * GET /api/admin/sales-offers/config
 * Returns the active config for a given mspId (or platform defaults).
 */
router.get(
  "/api/admin/sales-offers/config",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = req.query["mspId"] ? parseInt(req.query["mspId"] as string, 10) : null;
      const config = await loadSalesOfferConfig(mspId != null && !isNaN(mspId) ? mspId : null);
      res.json({ config });
    } catch (err) {
      log.error({ err }, "GET /api/admin/sales-offers/config failed");
      res.status(500).json({ error: "Failed to load sales offer config" });
    }
  },
);

/**
 * PUT /api/admin/sales-offers/config
 * Upsert engine-level configuration. mspId=null = platform defaults.
 */
router.put(
  "/api/admin/sales-offers/config",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        mspId = null,
        minScore,
        maxOffersPerGenerate,
        defaultExpirationDays,
        bundlingThreshold,
        scoringWeights,
        extra,
      } = req.body as {
        mspId?: number | null;
        minScore?: number;
        maxOffersPerGenerate?: number;
        defaultExpirationDays?: number;
        bundlingThreshold?: number;
        scoringWeights?: Record<string, number>;
        extra?: Record<string, unknown>;
      };

      const values: typeof salesOfferConfigTable.$inferInsert = {
        mspId: mspId != null ? Number(mspId) : null,
        scoringWeights: scoringWeights ?? {},
        minScore: minScore != null ? Number(minScore) : 40,
        maxOffersPerGenerate: maxOffersPerGenerate != null ? Number(maxOffersPerGenerate) : 5,
        defaultExpirationDays: defaultExpirationDays != null ? Number(defaultExpirationDays) : 30,
        bundlingThreshold: bundlingThreshold != null ? Number(bundlingThreshold) : 2,
        extra: extra ?? {},
        updatedAt: new Date(),
      };

      const [upserted] = await db
        .insert(salesOfferConfigTable)
        .values(values)
        .onConflictDoUpdate({ target: salesOfferConfigTable.mspId, set: values })
        .returning();

      res.json({ config: upserted });
    } catch (err) {
      log.error({ err }, "PUT /api/admin/sales-offers/config failed");
      res.status(500).json({ error: "Failed to save sales offer config" });
    }
  },
);

// ── Rule Groups ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/sales-offers/rule-groups
 */
router.get(
  "/api/admin/sales-offers/rule-groups",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const rows = await db
        .select()
        .from(salesOfferRuleGroupsTable)
        .orderBy(asc(salesOfferRuleGroupsTable.sortOrder), asc(salesOfferRuleGroupsTable.id));
      res.json({ ruleGroups: rows });
    } catch (err) {
      log.error({ err }, "GET /api/admin/sales-offers/rule-groups failed");
      res.status(500).json({ error: "Failed to list rule groups" });
    }
  },
);

/**
 * POST /api/admin/sales-offers/rule-groups
 */
router.post(
  "/api/admin/sales-offers/rule-groups",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        key, label, description, ruleType, serviceId, requiredSignalKeys, logic,
        pricingAdjustmentPct, scoreContribution, expirationDays, bundleWithServiceIds, sortOrder,
      } = req.body as {
        key: string; label: string; description?: string;
        ruleType?: string; serviceId?: number | null;
        requiredSignalKeys?: string[]; logic?: "AND" | "OR";
        pricingAdjustmentPct?: number; scoreContribution?: number;
        expirationDays?: number; bundleWithServiceIds?: number[];
        sortOrder?: number;
      };

      if (!key || !label) {
        res.status(400).json({ error: "key and label are required" });
        return;
      }
      if (ruleType && !SALES_OFFER_RULE_TYPES.includes(ruleType as typeof SALES_OFFER_RULE_TYPES[number])) {
        res.status(400).json({ error: `ruleType must be one of: ${SALES_OFFER_RULE_TYPES.join(", ")}` });
        return;
      }

      const [row] = await db.insert(salesOfferRuleGroupsTable).values({
        key,
        label,
        description,
        ruleType: (ruleType ?? "eligibility") as typeof SALES_OFFER_RULE_TYPES[number],
        serviceId: serviceId ?? null,
        requiredSignalKeys: requiredSignalKeys ?? [],
        logic: logic ?? "OR",
        pricingAdjustmentPct: pricingAdjustmentPct ?? 0,
        scoreContribution: scoreContribution ?? 0,
        expirationDays: expirationDays ?? 0,
        bundleWithServiceIds: bundleWithServiceIds ?? [],
        sortOrder: sortOrder ?? 0,
      }).returning();

      res.status(201).json({ ruleGroup: row });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("unique") || message.includes("duplicate")) {
        res.status(409).json({ error: "Rule group key already exists" });
        return;
      }
      log.error({ err }, "POST /api/admin/sales-offers/rule-groups failed");
      res.status(500).json({ error: "Failed to create rule group" });
    }
  },
);

/**
 * PATCH /api/admin/sales-offers/rule-groups/:id
 */
router.patch(
  "/api/admin/sales-offers/rule-groups/:id",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }

      const allowed = [
        "label", "description", "ruleType", "serviceId", "requiredSignalKeys", "logic",
        "pricingAdjustmentPct", "scoreContribution", "expirationDays", "bundleWithServiceIds",
        "sortOrder", "isActive",
      ] as const;

      const updates: Partial<typeof salesOfferRuleGroupsTable.$inferInsert> = { updatedAt: new Date() };
      for (const field of allowed) {
        if (field in req.body) (updates as Record<string, unknown>)[field] = req.body[field];
      }

      const [updated] = await db
        .update(salesOfferRuleGroupsTable)
        .set(updates)
        .where(eq(salesOfferRuleGroupsTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ ruleGroup: updated });
    } catch (err) {
      log.error({ err }, "PATCH /api/admin/sales-offers/rule-groups/:id failed");
      res.status(500).json({ error: "Failed to update rule group" });
    }
  },
);

/**
 * DELETE /api/admin/sales-offers/rule-groups/:id
 */
router.delete(
  "/api/admin/sales-offers/rule-groups/:id",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }

      await db.delete(salesOfferRuleGroupsTable).where(eq(salesOfferRuleGroupsTable.id, id));
      res.json({ deleted: true, id });
    } catch (err) {
      log.error({ err }, "DELETE /api/admin/sales-offers/rule-groups/:id failed");
      res.status(500).json({ error: "Failed to delete rule group" });
    }
  },
);

// ── Offer events ──────────────────────────────────────────────────────────────

/**
 * GET /api/sales-offers/:id/events
 */
router.get(
  "/api/sales-offers/:id/events",
  requireAdmin,
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid offer id" });
        return;
      }

      const events = await db
        .select()
        .from(salesOfferEventsTable)
        .where(eq(salesOfferEventsTable.offerId, id))
        .orderBy(asc(salesOfferEventsTable.createdAt));

      res.json({ events });
    } catch (err) {
      log.error({ err }, "GET /api/sales-offers/:id/events failed");
      res.status(500).json({ error: "Failed to fetch offer events" });
    }
  },
);

export default router;
