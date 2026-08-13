/**
 * msp-sales-offers.ts
 *
 * MSP Portal-scoped Sales Offer endpoints.
 *
 * Auth: requireRole("MSPOperator") — MSP JWT with at least MSPOperator role.
 * Plan: requirePlanFeature("sales_offers") on write operations.
 * Scope: all queries are automatically filtered to the caller's mspId.
 *
 * Routes:
 *   GET    /api/msp/:mspId/sales-offers       — list offers for this MSP
 *                                                (requireMspScope: PlatformAdmin may
 *                                                pass any :mspId; everyone else must
 *                                                match their own JWT mspId)
 *   GET    /api/msp/sales-offers/sse          — SSE stream for real-time updates
 *   POST   /api/msp/sales-offers/generate     — run engine + persist drafts
 *   POST   /api/msp/:mspId/sales-offers/expire-stale — expire overdue sent offers
 *                                                (requireMspScope, path-based mspId)
 *   GET    /api/msp/:mspId/sales-offers/:id    — get single offer
 *                                                (requireMspScope, path-based mspId)
 *   GET    /api/msp/sales-offers/:id/events   — get offer event log
 *   PATCH  /api/msp/sales-offers/:id          — edit title / rationale (draft only)
 *   PATCH  /api/msp/sales-offers/:id/state    — transition offer state
 *   DELETE /api/msp/sales-offers/:id          — delete draft offer
 */

import { Router, type IRouter, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import {
  salesOffersTable,
  salesOfferEventsTable,
  SALES_OFFER_STATES,
  type SalesOfferState,
} from "@workspace/db";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { requireRole, requireMspScope, assertCustomerAccess } from "../middlewares/requireAuth";
import { requirePlanFeature } from "../lib/msp-entitlement";
import {
  runSalesOfferEngineForTenant,
  persistSalesOfferCandidates,
  transitionOfferState,
  expireStaleSalesOffers,
} from "../lib/sales-offer-engine";
import {
  registerMspOfferSSEClient,
  broadcastMspOfferChange,
  broadcastCustomerOfferChange,
} from "../lib/sse-channels";
import { logger } from "../lib/logger";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import type { AuthUser } from "../middlewares/requireAuth";

const log = logger.child({ channel: "engine.offer" });

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function apiErr(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/** Resolve the calling MSP's id from the JWT.
 *  PlatformAdmin can override with ?mspId= query param. */

// ── GET /api/msp/:mspId/sales-offers ──────────────────────────────────────────

router.get(
  "/msp/:mspId/sales-offers",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(String(req.params.mspId ?? ""), 10);
    if (isNaN(mspId)) { apiErr(res, 400, "mspId must be a number"); return; }

    try {
      const state = req.query["state"] as SalesOfferState | undefined;
      const customerId = req.query["customerId"] ? parseInt(String(req.query["customerId"]), 10) : undefined;
      const limit = Math.min(parseInt(String(req.query["limit"] ?? "200"), 10) || 200, 500);
      const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;

      const conditions = [eq(salesOffersTable.mspId, mspId)];
      if (state && SALES_OFFER_STATES.includes(state)) conditions.push(eq(salesOffersTable.state, state));
      if (customerId != null && !isNaN(customerId)) conditions.push(eq(salesOffersTable.customerId, customerId));

      const offers = await db
        .select()
        .from(salesOffersTable)
        .where(and(...conditions))
        .orderBy(desc(salesOffersTable.score), desc(salesOffersTable.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({ offers, limit, offset });
    } catch (err) {
      log.error({ err, mspId }, "GET /api/msp/:mspId/sales-offers failed");
      apiErr(res, 500, "Failed to list offers");
    }
  },
);

// ── GET /api/msp/sales-offers/sse ─────────────────────────────────────────────
// SSE channel for real-time offer state changes.
// EventSource cannot set Authorization headers, so we accept the JWT via ?token=.

router.get("/msp/sales-offers/sse", (req: Request, res: Response): void => {
  const token = String(req.query["token"] ?? "");
  const secret = process.env["JWT_SECRET"];
  if (!token || !secret) {
    res.status(401).json({ error: "Missing token" });
    return;
  }

  let user: AuthUser;
  try {
    user = jwt.verify(token, secret) as AuthUser;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const effectiveMspRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;
  const ROLE_ORDER = ["Assessment", "Free", "CustomerUser", "ServiceAccount", "MSPOperator", "MSPAdmin", "PlatformAdmin"];
  if (ROLE_ORDER.indexOf(effectiveMspRole ?? "") < ROLE_ORDER.indexOf("MSPOperator")) {
    res.status(403).json({ error: "Insufficient privileges" });
    return;
  }

  const mspId = user.role === "admin" || user.mspRole === "PlatformAdmin"
    ? (req.query["mspId"] ? parseInt(String(req.query["mspId"]), 10) : null)
    : (user.mspId ?? null);

  if (!mspId || isNaN(mspId)) {
    res.status(400).json({ error: "mspId required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected", mspId })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 30_000);

  registerMspOfferSSEClient(mspId, res, () => {
    clearInterval(heartbeat);
    log.debug({ mspId }, "msp-sales-offers: SSE client disconnected");
  });
});

// ── POST /api/msp/sales-offers/generate ──────────────────────────────────────

router.post(
  "/msp/sales-offers/generate",
  requireRole("MSPOperator"),
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }

    try {
      const { customerId } = req.body as { customerId?: number };
      if (!customerId || isNaN(Number(customerId))) {
        apiErr(res, 400, "customerId is required");
        return;
      }

      // Ownership + per-staff scoping: verify this customer is one the caller may
      // act on before running the engine. (Previously this route trusted
      // body.customerId and relied solely on the engine's mspId scoping.)
      if (!(await assertCustomerAccess(req.user!, Number(customerId)))) {
        apiErr(res, 404, "Customer not found");
        return;
      }

      const engineOutput = await runSalesOfferEngineForTenant(Number(customerId), mspId);
      const insertedIds = await persistSalesOfferCandidates(
        engineOutput.candidates,
        Number(customerId),
        mspId,
        engineOutput as unknown as Record<string, unknown>,
      );

      if (insertedIds.length > 0) {
        broadcastMspOfferChange(mspId, { offersGenerated: insertedIds.length, tenantId: Number(customerId) });
      }

      log.info({ mspId, customerId, insertedCount: insertedIds.length }, "POST /api/msp/sales-offers/generate completed");
      res.status(201).json({
        insertedOfferIds: insertedIds,
        candidateCount: engineOutput.candidates.length,
        firedSignals: engineOutput.firedSignals,
      });
    } catch (err) {
      log.error({ err, mspId }, "POST /api/msp/sales-offers/generate failed");
      apiErr(res, 500, "Failed to generate sales offers");
    }
  },
);

// ── POST /api/msp/:mspId/sales-offers/expire-stale ───────────────────────────

router.post(
  "/msp/:mspId/sales-offers/expire-stale",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(String(req.params.mspId ?? ""), 10);
    if (isNaN(mspId)) { apiErr(res, 400, "mspId must be a number"); return; }

    try {
      const expired = await expireStaleSalesOffers(mspId);
      res.json({ expired });
    } catch (err) {
      log.error({ err, mspId }, "POST /api/msp/:mspId/sales-offers/expire-stale failed");
      apiErr(res, 500, "Failed to expire stale offers");
    }
  },
);

// ── GET /api/msp/:mspId/sales-offers/:id ─────────────────────────────────────

router.get(
  "/msp/:mspId/sales-offers/:id",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(String(req.params.mspId ?? ""), 10);
    if (isNaN(mspId)) { apiErr(res, 400, "mspId must be a number"); return; }

    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) { apiErr(res, 400, "Invalid offer id"); return; }

      const [offer] = await db
        .select()
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, id), eq(salesOffersTable.mspId, mspId)))
        .limit(1);

      if (!offer) { apiErr(res, 404, "Offer not found"); return; }
      res.json({ offer });
    } catch (err) {
      log.error({ err, mspId }, "GET /api/msp/:mspId/sales-offers/:id failed");
      apiErr(res, 500, "Failed to fetch offer");
    }
  },
);

// ── GET /api/msp/sales-offers/:id/events ─────────────────────────────────────

router.get(
  "/msp/sales-offers/:id/events",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }

    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) { apiErr(res, 400, "Invalid offer id"); return; }

      const [offer] = await db
        .select({ id: salesOffersTable.id })
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, id), eq(salesOffersTable.mspId, mspId)))
        .limit(1);
      if (!offer) { apiErr(res, 404, "Offer not found"); return; }

      const events = await db
        .select()
        .from(salesOfferEventsTable)
        .where(eq(salesOfferEventsTable.offerId, id))
        .orderBy(asc(salesOfferEventsTable.createdAt));

      res.json({ events });
    } catch (err) {
      log.error({ err, mspId }, "GET /api/msp/sales-offers/:id/events failed");
      apiErr(res, 500, "Failed to fetch offer events");
    }
  },
);

// ── PATCH /api/msp/sales-offers/:id — edit title / rationale ─────────────────

router.patch(
  "/msp/sales-offers/:id",
  requireRole("MSPOperator"),
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }

    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) { apiErr(res, 400, "Invalid offer id"); return; }

      const { title, rationale } = req.body as { title?: string; rationale?: string };
      if (title == null && rationale == null) {
        apiErr(res, 400, "At least one of title or rationale must be provided");
        return;
      }

      const [existing] = await db
        .select({ id: salesOffersTable.id, state: salesOffersTable.state, mspId: salesOffersTable.mspId })
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, id), eq(salesOffersTable.mspId, mspId)))
        .limit(1);
      if (!existing) { apiErr(res, 404, "Offer not found"); return; }
      if (existing.state !== "draft") {
        apiErr(res, 422, `Only draft offers can be edited (current state: ${existing.state})`);
        return;
      }

      const updates: Partial<typeof salesOffersTable.$inferInsert> = { updatedAt: new Date() };
      if (title != null) updates.title = title.trim();
      if (rationale != null) updates.rationale = rationale.trim() || null;

      const [updated] = await db
        .update(salesOffersTable)
        .set(updates)
        .where(eq(salesOffersTable.id, id))
        .returning();

      broadcastMspOfferChange(mspId, { offerId: id, state: updated.state });
      res.json({ offer: updated });
    } catch (err) {
      log.error({ err, mspId }, "PATCH /api/msp/sales-offers/:id failed");
      apiErr(res, 500, "Failed to update offer");
    }
  },
);

// ── PATCH /api/msp/sales-offers/:id/state ────────────────────────────────────

router.patch(
  "/msp/sales-offers/:id/state",
  requireRole("MSPOperator"),
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }

    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) { apiErr(res, 400, "Invalid offer id"); return; }

      const { newState, rejectionReason } = req.body as { newState?: string; rejectionReason?: string };
      if (!newState || !SALES_OFFER_STATES.includes(newState as SalesOfferState)) {
        apiErr(res, 400, `newState must be one of: ${SALES_OFFER_STATES.join(", ")}`);
        return;
      }

      const [existing] = await db
        .select({ id: salesOffersTable.id, customerId: salesOffersTable.customerId, mspId: salesOffersTable.mspId })
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, id), eq(salesOffersTable.mspId, mspId)))
        .limit(1);
      if (!existing) { apiErr(res, 404, "Offer not found"); return; }

      const actorId = req.user?.id ?? null;
      const updated = await transitionOfferState(id, newState as SalesOfferState, actorId, { rejectionReason });

      broadcastMspOfferChange(mspId, { offerId: id, state: newState });
      if (existing.customerId) {
        broadcastCustomerOfferChange(existing.customerId, { offerId: id, state: newState });
      }

      res.json({ offer: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Invalid transition") || message.includes("not found")) {
        res.status(422).json({ error: message });
        return;
      }
      log.error({ err, mspId }, "PATCH /api/msp/sales-offers/:id/state failed");
      apiErr(res, 500, "Failed to transition offer state");
    }
  },
);

// ── DELETE /api/msp/sales-offers/:id ─────────────────────────────────────────

router.delete(
  "/msp/sales-offers/:id",
  requireRole("MSPOperator"),
  requirePlanFeature("sales_offers"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }

    try {
      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) { apiErr(res, 400, "Invalid offer id"); return; }

      const [offer] = await db
        .select({ id: salesOffersTable.id, state: salesOffersTable.state })
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, id), eq(salesOffersTable.mspId, mspId)))
        .limit(1);
      if (!offer) { apiErr(res, 404, "Offer not found"); return; }
      if (offer.state !== "draft") {
        apiErr(res, 422, "Only draft offers may be deleted");
        return;
      }

      await db.delete(salesOffersTable).where(eq(salesOffersTable.id, id));
      broadcastMspOfferChange(mspId, { offerId: id, deleted: true });
      res.json({ deleted: true, id });
    } catch (err) {
      log.error({ err, mspId }, "DELETE /api/msp/sales-offers/:id failed");
      apiErr(res, 500, "Failed to delete offer");
    }
  },
);

export default router;
