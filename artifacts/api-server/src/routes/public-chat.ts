/**
 * Public Contact Form — POST /api/public-chat
 *
 * The public site's ONLY "talk to a human" front door (it replaces the removed
 * /contact form and /book calendar). Deterministic, zero-AI-cost form submission
 * endpoint (#4625, part of #4624: Decommission ShaneBot Public's AI chat) — it
 * replaced the earlier per-turn Anthropic-backed chat. A fixed-field form has no
 * surface for an open-ended personal question about Shane, so the previous
 * guardrail/persona/transcript-parsing apparatus that defended an open-ended chat
 * has nothing to guard against here and is intentionally not used by this route.
 *
 * Storage: one row per submission in publicChatConversationsTable — no transcript,
 * no session continuation, `needsReview: true` always (a real visitor filling in a
 * real form is real intent by definition, no AI screening needed to decide that).
 *
 * Escalation (#726, part of #719, preserved unchanged): every submission queues a
 * real Zoho Desk ticket via enqueueEscalationTicket() — the same job
 * support-chat.ts's authenticated side already built (#89), reused as-is. On ticket
 * confirmation the job fires a web-push notification to admins (pushNotify), never
 * an email: `notifyEmails` is always empty for this path. That stays a deliberate
 * personal-safety requirement — this route never emails a visitor's submission
 * anywhere, it only pushes a heads-up to Shane's own devices.
 *
 * This route is authenticated customers' opposite number: paying/authenticated users
 * are served by the separate portal support chat (support-chat.ts), which is out of
 * scope and intentionally untouched (it keeps its own Anthropic call).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, publicChatConversationsTable } from "@workspace/db";
import { enqueueEscalationTicket } from "../lib/zoho-desk.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "growth.public_chat" });

// Deterministic form submission — no AI call to guard against abuse of, just plain
// spam-POST protection. 10 submissions/min/IP is generous for a real visitor.
const submitLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

// ── Request schema ──────────────────────────────────────────────────────────
// Flat form fields only — no messages[] array, no sessionId-as-conversation-
// continuation. One submission is one row.
const bodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email").max(320),
  company: z.string().trim().max(200).optional(),
  serviceInterest: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1, "Message is required").max(5000),
});

// ── POST /api/public-chat ────────────────────────────────────────────────────
router.post("/public-chat", submitLimiter, async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.flatten().fieldErrors });
    return;
  }

  const { name, email, company, serviceInterest, message } = parsed.data;
  const userAgent = (req.get("user-agent") ?? "").slice(0, 500);
  // Client never supplies this — the column is notNull().unique(), so a real
  // stable key is generated per-row purely as its own identity, not a
  // conversation-continuation token.
  const sessionId = randomUUID();

  try {
    await db.insert(publicChatConversationsTable).values({
      sessionId,
      messageCount: 1,
      needsReview: true,
      reviewReason: "explicit_request",
      declinedPersonalTopic: false,
      contactName: name,
      contactEmail: email,
      contactCompany: company ?? null,
      serviceInterest: serviceInterest ?? null,
      requestSummary: message,
      userAgent,
    });
  } catch (err) {
    log.error({ err, sessionId }, "public-chat: failed to persist submission");
    res.status(503).json({ error: "Could not submit your request. Please try again in a moment." });
    return;
  }

  // Escalation ticket is a best-effort notification channel on top of the row
  // that's already persisted above — a Zoho outage must not turn an otherwise
  // successful, stored submission into a visitor-facing failure.
  const title = `Public contact form submission from ${name}`;
  const description = `Message: "${message.slice(0, 300)}${message.length > 300 ? "…" : ""}"`;
  try {
    await enqueueEscalationTicket({
      subject: title,
      description,
      contactEmail: email,
      contactName: name,
      notifyEmails: [],
      notifySubject: title,
      pushNotify: true,
    });
  } catch (err) {
    log.error({ err, sessionId }, "public-chat: failed to queue Zoho Desk escalation ticket");
  }

  res.json({ success: true });
});

export default router;
