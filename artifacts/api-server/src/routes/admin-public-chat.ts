/**
 * Public AI Chat — admin review queue (PULL-BASED).
 *
 * These endpoints are how Shane reviews public-chat conversations on his own
 * schedule. This is the ONLY way a flagged conversation reaches him: he checks the
 * queue. Nothing here (or in public-chat.ts) pushes — no email, notification,
 * web-push, or SSE — by deliberate personal-safety design.
 *
 * Routes (all requireAdmin):
 *   GET   /api/admin/public-chat/stats
 *   GET   /api/admin/public-chat/conversations        — list (filterable)
 *   GET   /api/admin/public-chat/conversations/:id    — full transcript
 *   PATCH /api/admin/public-chat/conversations/:id     — set review status
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  publicChatConversationsTable,
  type PublicChatStoredMessage,
} from "@workspace/db";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "growth.public_chat" });

const REVIEW_STATUSES = ["new", "reviewed", "resolved", "archived"] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

function lastVisitorMessage(messages: PublicChatStoredMessage[] | null): string | null {
  if (!messages || messages.length === 0) return null;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return lastUser?.content?.slice(0, 200) ?? null;
}

// ── GET /api/admin/public-chat/stats ─────────────────────────────────────────
router.get("/admin/public-chat/stats", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [totalRow, needsReviewRow, newRow] = await Promise.all([
      db.select({ n: count() }).from(publicChatConversationsTable),
      db
        .select({ n: count() })
        .from(publicChatConversationsTable)
        .where(eq(publicChatConversationsTable.needsReview, true)),
      db
        .select({ n: count() })
        .from(publicChatConversationsTable)
        .where(
          and(
            eq(publicChatConversationsTable.needsReview, true),
            eq(publicChatConversationsTable.reviewStatus, "new"),
          ),
        ),
    ]);
    res.json({
      total: totalRow[0]?.n ?? 0,
      needsReview: needsReviewRow[0]?.n ?? 0,
      awaitingReview: newRow[0]?.n ?? 0,
    });
  } catch (err) {
    log.error({ err }, "admin/public-chat stats failed");
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// ── GET /api/admin/public-chat/conversations ─────────────────────────────────
// Query params:
//   flagged = "yes" (default) | "no" | "all"   — needsReview filter
//   status  = new | reviewed | resolved | archived
//   page, limit
router.get("/admin/public-chat/conversations", requireAdmin, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];
  const flagged = String(req.query.flagged ?? "yes");
  if (flagged === "yes") conditions.push(eq(publicChatConversationsTable.needsReview, true));
  else if (flagged === "no") conditions.push(eq(publicChatConversationsTable.needsReview, false));

  const statusParam = String(req.query.status ?? "");
  if ((REVIEW_STATUSES as readonly string[]).includes(statusParam)) {
    conditions.push(eq(publicChatConversationsTable.reviewStatus, statusParam as ReviewStatus));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  try {
    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(publicChatConversationsTable)
        .where(where)
        .orderBy(desc(publicChatConversationsTable.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(publicChatConversationsTable).where(where),
    ]);

    // List view: never ship the whole transcript — just a preview + metadata.
    const conversations = rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      messageCount: r.messageCount,
      needsReview: r.needsReview,
      reviewReason: r.reviewReason,
      reviewStatus: r.reviewStatus,
      declinedPersonalTopic: r.declinedPersonalTopic,
      contactName: r.contactName,
      contactEmail: r.contactEmail,
      contactCompany: r.contactCompany,
      serviceInterest: r.serviceInterest,
      lastMessage: lastVisitorMessage(r.messages),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    res.json({ conversations, total: totalRow[0]?.n ?? 0, page, limit });
  } catch (err) {
    log.error({ err }, "admin/public-chat conversations list failed");
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

// ── GET /api/admin/public-chat/conversations/:id ─────────────────────────────
router.get("/admin/public-chat/conversations/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }
  try {
    const [row] = await db
      .select()
      .from(publicChatConversationsTable)
      .where(eq(publicChatConversationsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    log.error({ err, id }, "admin/public-chat conversation detail failed");
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

// ── PATCH /api/admin/public-chat/conversations/:id ───────────────────────────
// Body: { reviewStatus: "new" | "reviewed" | "resolved" | "archived" }
router.patch("/admin/public-chat/conversations/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const { reviewStatus } = req.body as { reviewStatus?: string };
  if (!reviewStatus || !(REVIEW_STATUSES as readonly string[]).includes(reviewStatus)) {
    res.status(400).json({ error: "reviewStatus must be one of: " + REVIEW_STATUSES.join(", ") });
    return;
  }

  try {
    const [updated] = await db
      .update(publicChatConversationsTable)
      .set({
        reviewStatus: reviewStatus as ReviewStatus,
        reviewedAt: new Date(),
        reviewedByUserId: req.user?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(publicChatConversationsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    log.error({ err, id }, "admin/public-chat status update failed");
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

export default router;
