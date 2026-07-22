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
 * row per browser session, regardless of outcome.
 *
 * Escalation is PULL-BASED ONLY. When the assistant sees genuine purchase/service
 * intent or a real business question only Shane can answer, it flags the conversation
 * (needsReview) so it lands in an admin queue Shane reviews on his own schedule.
 * NOTHING in this route pushes — no email, no notification, no web-push, no SSE. That
 * is a deliberate personal-safety requirement; do not add a push path here.
 *
 * This route is authenticated customers' opposite number: paying/authenticated users
 * are served by the separate portal support chat (support-chat.ts), which is out of
 * scope and intentionally untouched.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  servicesTable,
  publicChatConversationsTable,
  type PublicChatStoredMessage,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger.ts";
import {
  buildPublicChatSystemPrompt,
  detectPersonalTopic,
  parseReviewFlag,
  parseStructuredRequest,
  stripControlTokens,
  PERSONAL_TOPIC_DECLINE,
  type ReviewReason,
} from "../lib/public-chat-guardrail.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "growth.public_chat" });

// LLM-backed public endpoint — keep it tight against abuse (each turn is an
// Anthropic call). 20 turns/min/IP is generous for a real conversation.
const chatLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// ── Grounded catalog context ────────────────────────────────────────────────
// A compact, real snapshot of the public services catalog, cached in-process so a
// busy public endpoint doesn't re-query per turn. Grounding is pragmatic, not a full
// RAG system — real names, taglines, categories, and pricing are enough for honest
// answers.

const CATALOG_TTL_MS = 5 * 60_000;
let catalogCache: { summary: string; expires: number } | null = null;

function formatPrice(priceCents: number | null, billingType: string | null): string {
  if (priceCents == null || priceCents <= 0) return "pricing varies";
  const dollars = Math.round(priceCents / 100).toLocaleString("en-US");
  const suffix =
    billingType === "subscription" || billingType === "recurring" || billingType === "monthly"
      ? "/mo"
      : "";
  return `$${dollars}${suffix}`;
}

async function buildCatalogSummary(): Promise<string> {
  const now = Date.now();
  if (catalogCache && catalogCache.expires > now) return catalogCache.summary;

  try {
    const rows = await db
      .select({
        name: servicesTable.name,
        tagline: servicesTable.tagline,
        description: servicesTable.description,
        category: servicesTable.category,
        serviceType: servicesTable.serviceType,
        billingType: servicesTable.billingType,
        priceCents: servicesTable.priceCents,
        isFreeOffering: servicesTable.isFreeOffering,
      })
      .from(servicesTable)
      .where(eq(servicesTable.visibility, "public"))
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt))
      .limit(60);

    if (rows.length === 0) {
      const fallback = FALLBACK_CATALOG_SUMMARY;
      catalogCache = { summary: fallback, expires: now + CATALOG_TTL_MS };
      return fallback;
    }

    const lines = rows.map((s) => {
      const price = s.isFreeOffering ? "free" : formatPrice(s.priceCents, s.billingType);
      const blurb = (s.tagline ?? s.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      const cat = s.category ?? s.serviceType ?? "service";
      return `• ${s.name} [${cat}] — ${price}${blurb ? ` — ${blurb}` : ""}`;
    });

    const summary = lines.join("\n");
    catalogCache = { summary, expires: now + CATALOG_TTL_MS };
    return summary;
  } catch (err) {
    log.error({ err }, "public-chat: failed to build catalog summary; using fallback");
    return FALLBACK_CATALOG_SUMMARY;
  }
}

// Degraded-mode grounding if the catalog query fails — the high-level shape of the
// practice, so the assistant stays honest and useful rather than blank. No specific
// prices are invented here (the model is told pricing "varies" and to say so).
const FALLBACK_CATALOG_SUMMARY = [
  "• Assessments — a review of your Microsoft 365 tenant's security, configuration, and health, delivered as a written findings report.",
  "• Monitoring — ongoing, continuous monitoring of your M365 tenant against best-practice baselines (recurring).",
  "• Quick-Start Packs — fixed-scope, fixed-price packages that stand up a specific M365 capability quickly.",
  "• Projects — larger scoped engagements (migrations, governance rollouts, Power Platform, SharePoint).",
  "• Retainer — an ongoing advisory/architecture relationship for continued support.",
  "(Live pricing is temporarily unavailable — tell the visitor pricing varies and offer to take their request so it can be reviewed.)",
].join("\n");

// ── Request schema ──────────────────────────────────────────────────────────
const bodySchema = z.object({
  sessionId: z.string().min(8).max(128).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
});

const GREETING =
  "Hi! I'm Shane McCaw Consulting's assistant. I can walk you through the services, pricing, and how things work — or take your details if you'd like to get started. What can I help you with?";

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
    res.json({ reply: GREETING, sessionId });
    return;
  }

  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  const personal = detectPersonalTopic(lastUser?.content ?? "");

  // ── Guardrail backstop (deterministic, model-independent) ───────────────────
  // If the latest user turn is about Shane personally, we NEVER call the model and
  // NEVER escalate: we answer with the canned warm decline. Even a jailbroken model
  // couldn't leak a path to Shane because the model never sees this turn, and a
  // personal-topic request can never reach the review queue. The system prompt is
  // the primary guard for phrasings the detector doesn't catch; this is the backstop
  // that makes the guarantee hold regardless of the model.
  let visibleReply: string;
  let turnReviewReason: ReviewReason | null = null;
  let structured = null as ReturnType<typeof parseStructuredRequest>;

  if (personal.matched) {
    visibleReply = PERSONAL_TOPIC_DECLINE;
    log.info(
      { sessionId, category: personal.category },
      "public-chat: personal-topic request declined (not escalated)",
    );
  } else {
    // Call the model, grounded in the real catalog.
    let modelReply: string;
    try {
      const catalogSummary = await buildCatalogSummary();
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 900,
        system: buildPublicChatSystemPrompt(catalogSummary),
        messages: incoming.slice(-20),
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
    visibleReply = stripControlTokens(modelReply);
    if (!visibleReply) {
      // Model emitted only control tokens — give the visitor something human.
      visibleReply = "Thanks — I've noted that. Is there anything else I can help you with?";
    }
  }

  // ── Persist the full transcript (every conversation, every outcome) ──────────
  const stamp = new Date();
  const fullMessages: PublicChatStoredMessage[] = [
    ...incoming.map((m) => ({ role: m.role, content: m.content, at: stamp.toISOString() })),
    { role: "assistant" as const, content: visibleReply, at: stamp.toISOString() },
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
  } catch (err) {
    // Storage failure must not break the visitor's chat — log and still reply.
    log.error({ err, sessionId }, "public-chat: failed to persist conversation");
  }

  res.json({ reply: visibleReply, sessionId });
});

export default router;
