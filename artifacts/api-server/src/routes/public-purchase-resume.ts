/**
 * public-purchase-resume.ts — the returning-buyer and selection routes for the
 * account-first checkout order (Git #4377). The logic lives in
 * lib/account-first-purchase.ts (see its header).
 *
 *   GET  /api/public/purchase/resume               (Bearer) the signed-in
 *        buyer's own unfinished Monitoring/Pack purchase, renewed if lapsed
 *   POST /api/public/purchase/monitoring-selection  (session UUID) tier/seats
 *        change on an unpaid Monitoring session, in place
 *
 * /api/public/* is on the pending-purchase gate's allowlist (#4375), so a
 * `*Pending` account's token reaches the resume route — that account can reach
 * nothing else, and resuming the purchase is exactly what it is for.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { findResumablePurchase, updateMonitoringSelection } from "../lib/account-first-purchase.ts";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";

const resumeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 600 : 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

const selectionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 600 : 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

// ── GET /api/public/purchase/resume ───────────────────────────────────────────
//
// GET with a side effect on a lapsed session (its expiry is extended). That
// renewal is idempotent and owner-only, and the page calls this once right after
// sign-in; it is not something a crawler or prefetch can reach without the token.

router.get("/public/purchase/resume", resumeLimiter, requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const purchase = await findResumablePurchase(userId);

  if (!purchase) {
    log.info({ userId }, "purchase resume: signed-in buyer has no unfinished account-first purchase");
    res.status(404).json({ error: "no_purchase_in_progress" });
    return;
  }

  await createAuditLog({
    actorUserId: userId,
    actorName: "public:purchase-flow",
    actorRole: "client",
    actionType: "purchase_flow_resumed",
    entityType: "checkout_session",
    entityId: purchase.sessionId,
    metadata: { status: purchase.status, productCategory: purchase.productCategory, renewed: purchase.renewed },
  });

  log.info(
    { userId, sessionId: purchase.sessionId, status: purchase.status, renewed: purchase.renewed },
    "purchase resume: signed-in buyer resumed their own purchase session",
  );
  res.json(purchase);
});

// ── POST /api/public/purchase/monitoring-selection ────────────────────────────

const selectionSchema = z.object({
  sessionId: z.string(),
  productSlug: z.string().trim().min(1).max(200),
  seats: z.number().int().min(1).max(1_000_000),
});

router.post("/public/purchase/monitoring-selection", selectionLimiter, async (req: Request, res: Response) => {
  const parsed = selectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const result = await updateMonitoringSelection(parsed.data.sessionId, parsed.data.productSlug, parsed.data.seats);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, ...(result.message ? { message: result.message } : {}) });
    return;
  }
  res.json(result);
});

export default router;
