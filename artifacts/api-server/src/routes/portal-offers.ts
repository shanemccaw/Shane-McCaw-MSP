/**
 * portal-offers.ts
 *
 * Customer-facing Sales Offer endpoints.
 *
 * Customers see only their own sent offers — no internal scoring data, no rule
 * keys, no engine snapshots are returned. Customers can accept or reject offers,
 * which emits offer.accepted / offer.rejected into the canonical event bus.
 *
 * Auth: requireRole("CustomerUser") — MSP JWT with CustomerUser role.
 *   The customer's own ID is read from the JWT claim (req.user.customerId).
 *
 * Routes:
 *   GET  /api/portal/offers/sse        — SSE stream for real-time offer changes
 *   GET  /api/portal/offers            — list sent offers for this customer
 *   GET  /api/portal/offers/:id        — get single offer detail (customer-safe)
 *   POST /api/portal/offers/:id/accept — accept an offer
 *   POST /api/portal/offers/:id/reject — reject an offer
 */

import { Router, type IRouter, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { salesOffersTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { transitionOfferState } from "../lib/sales-offer-engine";
import {
  registerCustomerOfferSSEClient,
  broadcastMspOfferChange,
  broadcastCustomerOfferChange,
} from "../lib/sse-broadcast";
import { logger } from "../lib/logger";
import type { AuthUser } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ── Customer-safe offer shape ─────────────────────────────────────────────────
// Strip all internal signals/scoring/snapshot — expose only what a customer
// needs to understand and decide on an offer.

interface CustomerOffer {
  id: number;
  title: string;
  rationale: string | null;
  adjustedPriceCents: number;
  state: string;
  expiresAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

function toCustomerOffer(row: typeof salesOffersTable.$inferSelect): CustomerOffer {
  return {
    id: row.id,
    title: row.title,
    rationale: row.rationale ?? null,
    adjustedPriceCents: row.adjustedPriceCents,
    state: row.state,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** States visible to a customer — includes terminal states so history works. */
const CUSTOMER_VISIBLE_STATES = ["sent", "accepted", "rejected", "expired"] as const;
type CustomerVisibleState = typeof CUSTOMER_VISIBLE_STATES[number];

/** Resolve the customer's tenant ID from their JWT. Returns null if unavailable. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

// ── GET /api/portal/offers/sse ────────────────────────────────────────────────
// SSE stream keyed by customerId. Fires `offer_changed` whenever an offer for
// this customer changes state. EventSource cannot set custom headers, so the
// JWT is accepted via ?token= query parameter.

router.get("/portal/offers/sse", (req: Request, res: Response): void => {
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

  const customerId = user.customerId ?? null;
  if (!customerId) {
    res.status(403).json({ error: "No customer identity on token" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected", customerId })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 30_000);

  registerCustomerOfferSSEClient(customerId, res, () => {
    clearInterval(heartbeat);
    logger.debug({ customerId }, "portal-offers: customer SSE client disconnected");
  });
});

// ── GET /api/portal/offers ────────────────────────────────────────────────────

router.get(
  "/portal/offers",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      const visibleStates: CustomerVisibleState[] = [...CUSTOMER_VISIBLE_STATES];
      const rows = await db
        .select()
        .from(salesOffersTable)
        .where(
          and(
            eq(salesOffersTable.customerId, customerId),
            inArray(salesOffersTable.state, visibleStates),
          ),
        )
        .orderBy(desc(salesOffersTable.sentAt), desc(salesOffersTable.createdAt));

      res.json({ offers: rows.map(toCustomerOffer) });
    } catch (err) {
      logger.error({ err }, "GET /api/portal/offers failed");
      res.status(500).json({ error: "Failed to load offers" });
    }
  },
);

// ── GET /api/portal/offers/:id ────────────────────────────────────────────────

router.get(
  "/portal/offers/:id",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid offer id" });
        return;
      }

      const [row] = await db
        .select()
        .from(salesOffersTable)
        .where(
          and(
            eq(salesOffersTable.id, id),
            eq(salesOffersTable.customerId, customerId),
          ),
        )
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Offer not found" });
        return;
      }

      if (!CUSTOMER_VISIBLE_STATES.includes(row.state as typeof CUSTOMER_VISIBLE_STATES[number])) {
        res.status(404).json({ error: "Offer not found" });
        return;
      }

      res.json({ offer: toCustomerOffer(row) });
    } catch (err) {
      logger.error({ err }, "GET /api/portal/offers/:id failed");
      res.status(500).json({ error: "Failed to load offer" });
    }
  },
);

// ── POST /api/portal/offers/:id/accept ───────────────────────────────────────

router.post(
  "/portal/offers/:id/accept",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid offer id" });
        return;
      }

      // Verify ownership before transitioning
      const [row] = await db
        .select({
          id: salesOffersTable.id,
          state: salesOffersTable.state,
          customerId: salesOffersTable.customerId,
          mspId: salesOffersTable.mspId,
        })
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, id), eq(salesOffersTable.customerId, customerId)))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Offer not found" });
        return;
      }
      if (row.state !== "sent") {
        res.status(422).json({ error: `Only sent offers can be accepted (current state: ${row.state})` });
        return;
      }

      const actorId = (req.user as { id?: number } | undefined)?.id ?? null;
      const updated = await transitionOfferState(id, "accepted", actorId, {});

      // Broadcast to both the customer's SSE channel and the MSP's channel
      broadcastCustomerOfferChange(customerId, { offerId: id, state: "accepted" });
      if (row.mspId) broadcastMspOfferChange(row.mspId, { offerId: id, state: "accepted", customerId: customerId });

      res.json({ offer: toCustomerOffer(updated) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Invalid transition") || message.includes("not found")) {
        res.status(422).json({ error: message });
        return;
      }
      logger.error({ err }, "POST /api/portal/offers/:id/accept failed");
      res.status(500).json({ error: "Failed to accept offer" });
    }
  },
);

// ── POST /api/portal/offers/:id/reject ───────────────────────────────────────

router.post(
  "/portal/offers/:id/reject",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      const id = parseInt(String(req.params["id"] ?? ""), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid offer id" });
        return;
      }

      const rejectionReason = (req.body as { rejectionReason?: string })?.rejectionReason?.trim() ?? undefined;

      // Verify ownership before transitioning
      const [row] = await db
        .select({
          id: salesOffersTable.id,
          state: salesOffersTable.state,
          customerId: salesOffersTable.customerId,
          mspId: salesOffersTable.mspId,
        })
        .from(salesOffersTable)
        .where(and(eq(salesOffersTable.id, id), eq(salesOffersTable.customerId, customerId)))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Offer not found" });
        return;
      }
      if (row.state !== "sent") {
        res.status(422).json({ error: `Only sent offers can be rejected (current state: ${row.state})` });
        return;
      }

      const actorId = (req.user as { id?: number } | undefined)?.id ?? null;
      const updated = await transitionOfferState(id, "rejected", actorId, { rejectionReason });

      // Broadcast to both channels
      broadcastCustomerOfferChange(customerId, { offerId: id, state: "rejected" });
      if (row.mspId) broadcastMspOfferChange(row.mspId, { offerId: id, state: "rejected", customerId: customerId });

      res.json({ offer: toCustomerOffer(updated) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Invalid transition") || message.includes("not found")) {
        res.status(422).json({ error: message });
        return;
      }
      logger.error({ err }, "POST /api/portal/offers/:id/reject failed");
      res.status(500).json({ error: "Failed to reject offer" });
    }
  },
);

export default router;
