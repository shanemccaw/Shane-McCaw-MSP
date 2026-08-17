/**
 * Public AI Chat — admin review queue.
 *
 * This is how Shane reviews public-chat conversations — this queue is the record.
 * Since #726/#719, a legitimate escalation also queues a real Zoho Desk ticket and
 * fires a web-push notification (never email — see public-chat.ts's docblock), but
 * these endpoints themselves remain read/status-update only.
 *
 * Since #361, the actual transcript lives in the shared `bot_conversations` table
 * (shanebot-engine.ts), not on this row — this table now carries only the review
 * queue's own business metadata (needsReview, contact capture, escalation reason).
 * Both endpoints below join the two by sessionId so the response shape the
 * ChatQueue.tsx frontend already expects (a `messages` array on each row) is
 * unchanged.
 *
 * Routes (all requireAdmin):
 *   GET   /api/admin/public-chat/stats
 *   GET   /api/admin/public-chat/conversations        — list (filterable)
 *   GET   /api/admin/public-chat/conversations/:id    — full transcript
 *   PATCH /api/admin/public-chat/conversations/:id     — set review status
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, publicChatConversationsTable, type BotConversationMessage } from "@workspace/db";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { contentToText } from "../lib/chat-content-blocks.ts";
import { getBotConversationTranscript, getBotConversationTranscripts } from "../lib/shanebot-engine.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "growth.public_chat" });

const REVIEW_STATUSES = ["new", "reviewed", "resolved", "archived"] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Preview text for the queue list. Reads through contentToText() so it works on
 * both vintages: pre-#361 rows whose `content` is a bare string (none possible
 * from bot_conversations, which only ever holds the block shape, but the helper
 * is shared and stays tolerant), and rows stored as structured content blocks.
 */
function lastVisitorMessage(messages: BotConversationMessage[] | null | undefined): string | null {
  if (!messages || messages.length === 0) return null;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;
  const text = contentToText(lastUser.content);
  return text ? text.slice(0, 200) : null;
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

    // Transcripts live in bot_conversations (#361) — one batch query for the
    // whole page rather than one per row.
    const transcripts = await getBotConversationTranscripts(rows.map((r) => r.sessionId));

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
      lastMessage: lastVisitorMessage(transcripts.get(r.sessionId)),
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
    // Transcript lives in bot_conversations (#361) — merged in under the same
    // `messages` field the ChatQueue.tsx detail view already reads.
    const messages = (await getBotConversationTranscript(row.sessionId)) ?? [];
    res.json({ ...row, messages });
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
