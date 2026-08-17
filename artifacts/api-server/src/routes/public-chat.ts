/**
 * Public AI Chat — POST /api/public-chat
 *
 * The public site's ONLY "talk to a human" front door (it replaces the removed
 * /contact form and /book calendar). A warm, knowledgeable assistant grounded in the
 * real services catalog, wrapped around one hard, non-negotiable guardrail: it never
 * answers OR escalates anything about Shane personally (NASA role, career, media,
 * speaking, "pick your brain", or a direct personal-contact path). See
 * public-chat-guardrail.ts for the deterministic backstop.
 *
 * Storage: every conversation is stored in full (publicChatConversationsTable), one
 * row per browser session, regardless of outcome. Since #361 each message's
 * `content` is an array of structured blocks ({type:"text"} / {type:"suggested_replies"})
 * rather than a bare string; rows written before that hold a string and are read
 * through toContentBlocks(), so no backfill or DDL was required.
 *
 * Escalation (#726, part of #719): when the assistant sees genuine purchase/service
 * intent or a real business question only Shane can answer, it flags the conversation
 * (needsReview — kept as the conversation's own audit trail, read by the admin queue)
 * AND queues a real Zoho Desk ticket via the same enqueueEscalationTicket() job
 * support-chat.ts's authenticated side already built (#89) — reused, not rebuilt. On
 * ticket confirmation the job fires a web-push notification to admins (pushNotify),
 * never an email: `notifyEmails` is always empty for this path. That stays a
 * deliberate personal-safety requirement — this route still never emails a visitor's
 * conversation anywhere, it only pushes a heads-up to Shane's own devices.
 *
 * This route is authenticated customers' opposite number: paying/authenticated users
 * are served by the separate portal support chat (support-chat.ts), which is out of
 * scope and intentionally untouched.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  publicChatConversationsTable,
  type PublicChatStoredMessage,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { enqueueEscalationTicket } from "../lib/zoho-desk.ts";
import { logger } from "../lib/logger.ts";
import { buildGrounding, resolveInstance } from "../lib/shanebot-engine.ts";
import {
  buildAssistantContent,
  contentToText,
  hasSuggestedRepliesToken,
  parseSuggestedReplies,
  toContentBlocks,
} from "../lib/chat-content-blocks.ts";
import {
  buildPublicChatSystemPrompt,
  detectPersonalTopic,
  parseReviewFlag,
  parseStructuredRequest,
  stripControlTokens,
  PERSONAL_TOPIC_DECLINE,
  type ReviewReason,
} from "../lib/public-chat-guardrail.ts";
import { personaGreeting } from "../lib/shanebot-persona.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "growth.public_chat" });

// LLM-backed public endpoint — keep it tight against abuse (each turn is an
// Anthropic call). 20 turns/min/IP is generous for a real conversation.
const chatLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// ── Grounded catalog context ────────────────────────────────────────────────
// Grounding is now the shared engine's `live_catalog` groundingSource builder
// (shanebot-engine.ts, #1097) — the SAME builder ShaneBot Paid's customer grounding
// lives beside, so the two surfaces can never drift on how grounding is built. The
// public bot's "actually live" source of truth (services.visibility === "public")
// and the #1085 swap-point note both live there now, in one place.

// ── Request schema ──────────────────────────────────────────────────────────
// `content` accepts BOTH shapes: the legacy bare string (any widget build still
// in a visitor's open tab) and the #361 content-block array. Everything
// downstream reads it through contentToText(), so neither vintage breaks.
const contentBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("suggested_replies"), options: z.array(z.string()) }),
  // RESERVED (deferred Active Cards issue) — accepted so a stored transcript can
  // round-trip through the client, never produced by anything today.
  z.object({ type: z.literal("card"), cardType: z.string(), data: z.record(z.unknown()) }),
]);

const bodySchema = z.object({
  sessionId: z.string().min(8).max(128).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.union([z.string(), z.array(contentBlockSchema)]),
      }),
    )
    .default([]),
});

// The opener is the ShaneBot Public persona's own first sample opener — voice
// lives in one place, including the line a visitor sees before the model runs.
const GREETING = personaGreeting("public");

// ── POST /api/public-chat ────────────────────────────────────────────────────
router.post("/public-chat", chatLimiter, async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const sessionId = parsed.data.sessionId ?? randomUUID();
  const incoming = parsed.data.messages.filter((m) => m.role === "user" || m.role === "assistant");
  const userAgent = (req.get("user-agent") ?? "").slice(0, 500);

  // Init turn (widget mount posts an empty array to fetch the opener). No LLM call,
  // no row written yet — a conversation is stored once a real user message arrives.
  const hasUserMessage = incoming.some((m) => m.role === "user");
  if (!hasUserMessage) {
    res.json({
      reply: GREETING,
      content: buildAssistantContent(GREETING),
      suggestedReplies: [],
      sessionId,
    });
    return;
  }

  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  // The guardrail detector runs on the visitor's PLAIN TEXT — flattened from
  // whichever content shape arrived, so a block-shaped turn is screened exactly
  // as a legacy string one was. Reused below for the escalation ticket body.
  const lastUserText = contentToText(lastUser?.content);
  const personal = detectPersonalTopic(lastUserText);

  // ── Guardrail backstop (deterministic, model-independent) ───────────────────
  // If the latest user turn is about Shane personally, we NEVER call the model and
  // NEVER escalate: we answer with the canned warm decline. Even a jailbroken model
  // couldn't leak a path to Shane because the model never sees this turn, and a
  // personal-topic request can never reach the review queue. The system prompt is
  // the primary guard for phrasings the detector doesn't catch; this is the backstop
  // that makes the guarantee hold regardless of the model.
  let visibleReply: string;
  let suggestedReplies: string[] = [];
  let turnReviewReason: ReviewReason | null = null;
  let structured = null as ReturnType<typeof parseStructuredRequest>;

  if (personal.matched) {
    // Deterministic decline path — no model, and deliberately no chips: this
    // turn must offer the visitor nothing that reads as a way to keep pushing.
    visibleReply = PERSONAL_TOPIC_DECLINE;
    log.info(
      { sessionId, category: personal.category },
      "public-chat: personal-topic request declined (not escalated)",
    );
  } else {
    // Call the model, grounded in the real catalog.
    let modelReply: string;
    try {
      const grounding = await buildGrounding(resolveInstance("shanebot_public"));
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 900,
        system: buildPublicChatSystemPrompt(grounding.summary),
        messages: incoming.slice(-20).map((m) => ({ role: m.role, content: contentToText(m.content) })),
      });
      const block = response.content[0];
      modelReply = block && block.type === "text" ? block.text : "";
    } catch (err) {
      log.error({ err }, "public-chat: Anthropic call failed");
      res.status(503).json({
        error: "The assistant is temporarily unavailable. Please try again in a moment.",
      });
      return;
    }

    turnReviewReason = parseReviewFlag(modelReply);
    structured = parseStructuredRequest(modelReply);
    suggestedReplies = parseSuggestedReplies(modelReply);
    if (suggestedReplies.length === 0 && hasSuggestedRepliesToken(modelReply)) {
      // Token emitted but nothing usable came out of it. The visitor still gets a
      // clean reply — this is prompt-adherence telemetry on the existing channel.
      log.warn(
        { sessionId },
        "public-chat: model emitted a SUGGESTED_REPLIES token that parsed to zero options",
      );
    }
    visibleReply = stripControlTokens(modelReply);
    if (!visibleReply) {
      // Model emitted only control tokens — give the visitor something human.
      visibleReply = "Thanks — I've noted that. Is there anything else I can help you with?";
    }
  }

  // ── Persist the full transcript (every conversation, every outcome) ──────────
  // Stored in the #361 content-block shape. No backfill is needed for rows
  // written before this: `messages` is already jsonb (so no DDL either), and
  // every read site goes through toContentBlocks(), which wraps a legacy bare
  // string as a single text block.
  const stamp = new Date();
  const replyContent = buildAssistantContent(visibleReply, suggestedReplies);
  const fullMessages: PublicChatStoredMessage[] = [
    ...incoming.map((m) => ({
      // Normalized on the way in, so a legacy-string turn echoed back by an old
      // widget build is re-persisted in the new shape rather than mixed in.
      content: toContentBlocks(m.content),
      role: m.role,
      at: stamp.toISOString(),
    })),
    { role: "assistant" as const, content: replyContent, at: stamp.toISOString() },
  ];

  try {
    const [existing] = await db
      .select()
      .from(publicChatConversationsTable)
      .where(eq(publicChatConversationsTable.sessionId, sessionId))
      .limit(1);

    // needsReview is sticky (once a legit reason set it, later personal turns can't
    // clear it) and is NEVER set by a personal-topic turn.
    const escalateThisTurn = !personal.matched && (turnReviewReason != null || structured != null);
    const nextNeedsReview = (existing?.needsReview ?? false) || escalateThisTurn;
    const nextReviewReason: ReviewReason | null =
      existing?.reviewReason ?? turnReviewReason ?? (structured ? "purchase_intent" : null);

    if (existing) {
      await db
        .update(publicChatConversationsTable)
        .set({
          messages: fullMessages,
          messageCount: fullMessages.length,
          needsReview: nextNeedsReview,
          reviewReason: nextReviewReason,
          declinedPersonalTopic: existing.declinedPersonalTopic || personal.matched,
          contactName: structured?.contactName ?? existing.contactName,
          contactEmail: structured?.contactEmail ?? existing.contactEmail,
          contactCompany: structured?.contactCompany ?? existing.contactCompany,
          serviceInterest: structured?.serviceInterest ?? existing.serviceInterest,
          requestSummary: structured?.requestSummary ?? existing.requestSummary,
          userAgent: existing.userAgent ?? userAgent,
          updatedAt: stamp,
        })
        .where(eq(publicChatConversationsTable.id, existing.id));
    } else {
      await db.insert(publicChatConversationsTable).values({
        sessionId,
        messages: fullMessages,
        messageCount: fullMessages.length,
        needsReview: nextNeedsReview,
        reviewReason: nextReviewReason,
        declinedPersonalTopic: personal.matched,
        contactName: structured?.contactName ?? null,
        contactEmail: structured?.contactEmail ?? null,
        contactCompany: structured?.contactCompany ?? null,
        serviceInterest: structured?.serviceInterest ?? null,
        requestSummary: structured?.requestSummary ?? null,
        userAgent,
      });
    }

    // Real Zoho Desk ticket on a legitimate escalation (#726, part of #719) —
    // fires only on the turn that actually triggered it, mirroring
    // support-chat.ts's escalateToAdmin(): one ticket per escalation event,
    // not a re-queue on every later message in an already-flagged
    // conversation. A contact email is required to create the Desk contact
    // the ticket attaches to; [FLAG_FOR_REVIEW:...] can fire on its own with
    // no structured request captured yet (e.g. needs_shane/explicit_request
    // with no name+email given), so one may genuinely not be on record yet —
    // in that case the ticket is skipped and needsReview alone carries the
    // audit trail, same as before this change.
    if (escalateThisTurn) {
      const contactEmail = structured?.contactEmail ?? existing?.contactEmail ?? null;
      if (contactEmail) {
        const contactName = structured?.contactName ?? existing?.contactName ?? undefined;
        const title = `Public chat escalation from ${contactName ?? contactEmail}`;
        const description = `Question: "${lastUserText.slice(0, 300)}${lastUserText.length > 300 ? "…" : ""}"\n\nAI reply: ${visibleReply.trim().slice(0, 300)}`;
        enqueueEscalationTicket({
          subject: title,
          description,
          contactEmail,
          contactName,
          notifyEmails: [],
          notifySubject: title,
          pushNotify: true,
        }).catch((err) => {
          log.error({ err, sessionId }, "public-chat: failed to queue Zoho Desk escalation ticket");
        });
      } else {
        log.info(
          { sessionId, reviewReason: nextReviewReason },
          "public-chat: escalation with no contact email on record — Zoho Desk ticket skipped, needsReview flag still set",
        );
      }
    }
  } catch (err) {
    // Storage failure must not break the visitor's chat — log and still reply.
    log.error({ err, sessionId }, "public-chat: failed to persist conversation");
  }

  res.json({ reply: visibleReply, content: replyContent, suggestedReplies, sessionId });
});

export default router;
