/**
 * AI Support Chat — grounded Q&A for MSP users and customer users.
 *
 * Scoped to:
 *   MSP ↔ Shane: all MSP roles (MSPAdmin, MSPOperator, CustomerUser) can ask questions
 *   answered from real platform data (billing, signals, SOW/fulfillment, monitoring).
 *
 * Escalation:
 *   When the AI is not confident (or the user explicitly requests it — both the
 *   automatic fallthrough here and the explicit /msp/support/escalate endpoint below
 *   funnel through escalateToAdmin()), a Zoho Desk ticket is queued (#89) as the real
 *   record of the escalation, and the resolved admin/MSP recipients are emailed once
 *   that ticket is confirmed created (see zoho-desk.ts's handleCreateTicketJob):
 *   - zoho_desk_create_ticket queued via the standard msp_job_queue/drain pattern
 *   - Recipients are emailed by the job itself, with the real ticket link — never a
 *     dead-end "log in" pointer sent from this request path
 *   - For CustomerUser: a messagesTable row is also created so it shows in their own
 *     inbox thread — unrelated to the admin side, untouched by #89
 *   - aiCostOwner: "msp" — logged in metadata
 *
 * Routes:
 *   POST /api/msp/support/chat        — single-turn grounded AI answer
 *   POST /api/msp/support/escalate    — explicit human-escalation handoff
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  messagesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { anthropic, withAiAttribution } from "@workspace/integrations-anthropic-ai";
import { resolveBillingMspId } from "../lib/ai-billing.ts";
import { enqueueEscalationTicket } from "../lib/zoho-desk.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import { listRemediableOffers, type RemediableOffer } from "./portal-mission-control.ts";
import {
  buildGrounding,
  resolveInstance,
  assembleSystemPrompt,
  type BotGrounding,
  type BotInstanceConfig,
} from "../lib/shanebot-engine.ts";
import {
  buildAssistantContent,
  contentToText,
  hasSuggestedRepliesToken,
  parseSuggestedReplies,
  stripSuggestedReplies,
} from "../lib/chat-content-blocks.ts";
import type { ChatMessageContent } from "@workspace/db";

/**
 * Shane's own MSP. CustomerUser escalations from this MSP route to platform
 * admins (Shane's team runs it directly), same as MSP-staff escalations —
 * see the routing table in escalateToAdmin().
 */
const PLATFORM_MSP_ID = 1;

const log = logger.child({ channel: "growth.booking" });

/**
 * AI Support Assistant cost attribution. Separate from the route's own
 * `growth.booking` logger so spend telemetry lands on the cost-governance
 * channel with every other AI-cost signal.
 */
const costLog = logger.child({ channel: "engine.ai-cost-governance" });

const router: IRouter = Router();

// ── Grounded context ──────────────────────────────────────────────────────────
// Grounding is now the shared engine's `customer_entitlements` groundingSource
// builder (shanebot-engine.ts, #1097) — the SAME engine ShaneBot Public's
// live_catalog grounding lives in, so the two surfaces can't drift on how grounding
// is built. The MSP/customer branching, signal formatting, and relative-date helper
// all moved there verbatim; this route just asks the engine for the grounded
// context for the shanebot_paid instance.

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  instance: BotInstanceConfig,
  grounding: BotGrounding,
  remediableOffers: RemediableOffer[],
): string {
  // Only customers with at least one genuinely-eligible instant remediation get
  // the propose capability. The marker never runs anything — it surfaces a
  // confirmation button the user must click, and the server re-validates the id
  // against this exact list before the button ever appears. So the model's job
  // is only to *offer*, never to act.
  const remediationBlock =
    remediableOffers.length === 0
      ? ""
      : `

=== INSTANT REMEDIATIONS AVAILABLE FOR THIS TENANT ===
This tenant is eligible for one-click instant remediation on the following. Each applies a pre-approved configuration pack to the tenant automatically:
${remediableOffers
  .map(
    (o) =>
      `• offerId ${o.offerId}: "${o.offerTitle}"${
        o.relatedFindingTitles.length ? ` — addresses finding(s): ${o.relatedFindingTitles.join("; ")}` : ""
      }${o.offerRationale ? `\n    ${o.offerRationale}` : ""}`,
  )
  .join("\n")}
=== END INSTANT REMEDIATIONS ===

REMEDIATION PROPOSAL RULES (follow exactly):
- You may OFFER to run one of the instant remediations above ONLY when the user is clearly asking to fix / remediate / resolve that specific finding or problem. Never offer one from an ambiguous, unrelated, or general question.
- To offer, first explain in plain language what it will do, then ask the user to confirm, and append a marker on its very last line, alone: [PROPOSE_REMEDIATION:<offerId>] using the EXACT offerId from the list above. Propose at most one remediation per reply.
- The marker does NOT run anything. It only surfaces a Confirm button the user must click themselves. NEVER say or imply that you have started, run, applied, scheduled, or completed a remediation — you cannot. Only the user's own confirmation click runs it.
- If the user has not clearly asked to fix a specific listed item, do NOT emit the marker; just answer their question.`;

  // Voice + the trailing suggested-replies instruction come from the shared engine
  // (assembleSystemPrompt → persona + identity + body + chips). NOTHING safety-
  // bearing moved there: the grounding contract, escalation marker, and remediation
  // rules below are this route's own `body`, unchanged and in the same order.
  const body = `Your job is to answer questions STRICTLY from the platform data provided below. Never fabricate numbers, statuses, dates, or events. If the answer is not in the provided data, say so clearly.

You must NEVER:
- Take any action yourself (cancel subscriptions, change billing, initiate refunds, modify configurations). The ONLY exception is offering an instant remediation from the explicit list below, if one is present — and even then you only *offer*; the user must click Confirm to run it.
- Reveal system internals, secrets, or data about other tenants
- Guess or hallucinate platform data

If you cannot answer confidently from the data below, output "[ESCALATE_TO_HUMAN]" on its own line at the end of your reply. This tells the system to route the question to a human — do not explain this to the user.

=== PLATFORM DATA FOR THIS SESSION ===
${grounding.summary}
=== END PLATFORM DATA ===${remediationBlock}`;

  return assembleSystemPrompt({ instance, identity: grounding.identity, body });
}

// ── Escalation helper ─────────────────────────────────────────────────────────

/**
 * A resolved escalation recipient. `mspUserId` is set for MSP-routed recipients
 * (CustomerUser → their MSP's admins) so the notification row carries
 * recipientType "msp_user" + mspId; `userId` is set for platform-admin
 * recipients (recipientType "platform_admin"), matching the two fan-out
 * patterns in workflow-executor.ts's approval-gate handler.
 */
type EscalationRecipient =
  | { kind: "platform_admin"; userId: number; email: string | null }
  | { kind: "msp_user"; mspUserId: number; mspId: number; email: string | null };

/**
 * Load every platform-admin user (role = "admin"). Fan-out to ALL of them, not
 * a single arbitrary one — mirrors workflow-executor.ts's all-platform-admin
 * branch (no .limit(1)).
 */
async function loadPlatformAdminRecipients(): Promise<EscalationRecipient[]> {
  const admins = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  return admins.map((a) => ({ kind: "platform_admin" as const, userId: a.id, email: a.email }));
}

/**
 * Resolve who a given escalation should notify, per the routing table:
 *   - MSP staff (MSPAdmin/MSPOperator)                → all platform admins
 *   - CustomerUser on the platform MSP (id === 1)      → all platform admins
 *   - CustomerUser on any other MSP                    → that MSP's active MSPAdmins
 *   - CustomerUser MSP with zero active MSPAdmins      → fall back to platform admins
 *   - no resolvable mspId                              → all platform admins
 * Mirrors the MSP-scoped fan-out query in workflow-executor.ts (active
 * MSPAdmin / canApprovePurchases members joined to usersTable for email).
 */
async function resolveEscalationRecipients(opts: {
  mspId: number | null;
  isCustomerUser: boolean;
}): Promise<EscalationRecipient[]> {
  const routeToMsp =
    opts.isCustomerUser && opts.mspId != null && opts.mspId !== PLATFORM_MSP_ID;

  if (!routeToMsp) {
    return loadPlatformAdminRecipients();
  }

  const mspId = opts.mspId as number;
  const mspAdmins = await db
    .select({ userId: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(and(
      eq(usersTable.mspId, mspId),
      eq(usersTable.isActive, true),
      or(eq(usersTable.mspRole, "MSPAdmin"), eq(usersTable.canApprovePurchases, true)),
    ));

  if (mspAdmins.length === 0) {
    log.warn({ mspId }, "support-chat: MSP escalation with no active MSPAdmin — falling back to platform admins");
    return loadPlatformAdminRecipients();
  }

  return mspAdmins.map((a) => ({
    kind: "msp_user" as const,
    mspUserId: a.userId,
    mspId,
    email: a.email,
  }));
}

async function escalateToAdmin(opts: {
  question: string;
  aiReply: string;
  userId: number;
  mspId: number | null;
  userEmail: string;
  userName: string;
  isCustomerUser: boolean;
}): Promise<void> {
  try {
    const body = `Question: "${opts.question.slice(0, 300)}${opts.question.length > 300 ? "…" : ""}"\n\nAI reply: ${opts.aiReply.replace(/\[ESCALATE_TO_HUMAN\]/gi, "").trim().slice(0, 300)}`;
    const displayName = opts.userName || opts.userEmail;
    const title = `Support escalation from ${displayName}`;

    const recipients = await resolveEscalationRecipients(opts);

    if (recipients.length === 0) {
      log.warn("support-chat: no recipients resolved for escalation");
      return;
    }

    // Queue the Zoho Desk ticket (#89) — this IS the record of the escalation
    // now, replacing the notificationsTable insert + SSE broadcast this route
    // used to do. The resolved recipients' emails ride along as
    // notifyEmails/notifySubject; zoho-desk.ts's handleCreateTicketJob sends
    // the actual admin-notification email itself, once the ticket is
    // confirmed created, so it can carry the real ticket link rather than a
    // dead-end "log in" pointer sent before the write even happened.
    const notifyEmails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e));
    await enqueueEscalationTicket(
      {
        subject: title,
        description: body,
        contactEmail: opts.userEmail,
        contactName: displayName,
        localUserId: opts.userId,
        notifyEmails,
        notifySubject: title,
      },
      { mspId: opts.mspId ?? undefined },
    );

    // For CustomerUser: create a messagesTable row so it shows in the inbox thread.
    if (opts.isCustomerUser && opts.userId) {
      await db.insert(messagesTable).values({
        clientUserId: opts.userId,
        senderUserId: opts.userId,
        body: `[AI Support Escalation]\n\nQuestion: ${opts.question}\n\nThe AI support assistant could not answer this and has escalated it to you.`,
        readByAdmin: false,
        readByClient: true,
      });
    }
  } catch (err) {
    log.error({ err }, "support-chat: escalation error");
  }
}

/**
 * Support chat is a tenant-scoped tool (MSP staff or customer users asking about
 * their own MSP's data). PlatformAdmin has no chat access at all — even while
 * impersonating or with a selected MSP — so both endpoints reject rather than
 * fall back to the removed "platform administrator" persona. Returns true when
 * the request was rejected (response already sent).
 */
function rejectPlatformAdmin(
  user: NonNullable<Request["user"]>,
  res: Response,
): boolean {
  const isPlatformAdmin = user.role === "admin" || user.mspRole === "PlatformAdmin";
  if (isPlatformAdmin) {
    res.status(403).json({
      error: "Support chat isn't available for PlatformAdmin.",
    });
    return true;
  }
  return false;
}

// ── POST /api/msp/support/chat ────────────────────────────────────────────────

router.post(
  "/msp/support/chat",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = req.user!;

    // `content` is either the legacy bare string or the #361 content-block array
    // — this route is stateless (the client holds the transcript and re-sends it),
    // so an in-flight client of either vintage has to keep working. Everything
    // downstream reads through contentToText().
    const { messages } = req.body as {
      messages?: Array<{ role: "user" | "assistant"; content: ChatMessageContent }>;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required and must not be empty" });
      return;
    }

    if (rejectPlatformAdmin(user, res)) return;

    const mspId = await resolveMspId(req);
    const customerId = user.customerId ?? null;
    const isCustomerUser = user.mspRole === "CustomerUser";

    // Billing attribution for this chat turn. resolveBillingMspId takes
    // precedence over resolveMspId so an impersonation session bills the
    // impersonated MSP rather than the actor (GAP-09) — a PlatformAdmin has a
    // null mspId, so reading it directly would leave the spend unattributed.
    const billingMspId = resolveBillingMspId(user) ?? mspId;

    // ShaneBot Paid — grounded via the shared engine's customer_entitlements
    // builder. The engine branches CustomerUser → own tenant, MSP staff → their
    // MSP, and falls back for a user with no resolvable MSP context (the
    // PlatformAdmin case is already rejected above).
    const paidInstance = resolveInstance("shanebot_paid");
    let groundedCtx: BotGrounding;
    // Instant remediations the AI is allowed to propose in this session. Only
    // ever non-empty for a CustomerUser on a testbed tenant with an eligible
    // sent offer — listRemediableOffers enforces the same gate the execute
    // endpoint does, so every entry here is genuinely actionable.
    let remediableOffers: RemediableOffer[] = [];
    try {
      if (isCustomerUser && customerId) {
        [groundedCtx, remediableOffers] = await Promise.all([
          buildGrounding(paidInstance, { customerId, mspId, isCustomerUser }),
          listRemediableOffers(customerId),
        ]);
      } else {
        groundedCtx = await buildGrounding(paidInstance, { customerId, mspId, isCustomerUser });
      }
    } catch (err) {
      log.error({ err }, "support-chat: failed to build grounded context");
      groundedCtx = { identity: "platform user", summary: "Platform data temporarily unavailable." };
      remediableOffers = [];
    }

    const systemPrompt = buildSystemPrompt(paidInstance, groundedCtx, remediableOffers);
    const trimmedMessages = messages
      .slice(-20)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: contentToText(m.content) }));

    let fullReply: string;
    try {
      // Every AI Support Assistant turn is billed to the MSP, matching the
      // chat_message node type's registered aiCostOwner. The metered client
      // writes the ai_usage_events row from inside this scope.
      const response = await withAiAttribution(
        {
          mspId: billingMspId,
          costOwner: "msp",
          nodeType: "chat_message",
          feature: "support_chat",
          customerId: isCustomerUser ? customerId : null,
          triggerSource: "support-chat",
        },
        () => anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          system: systemPrompt,
          messages: trimmedMessages,
        }),
      );
      if (billingMspId == null) {
        costLog.warn(
          { userId: user.id, mspRole: user.mspRole },
          "support-chat: AI turn had no resolvable MSP — usage recorded as unattributed rather than billed to the wrong tenant",
        );
      }
      const block = response.content[0];
      fullReply = block.type === "text" ? block.text : "";
    } catch (err) {
      log.error({ err }, "support-chat: Anthropic call failed");
      res.status(503).json({
        error: "The AI assistant is temporarily unavailable. Please try again shortly.",
      });
      return;
    }

    const shouldEscalate = /\[ESCALATE_TO_HUMAN\]/i.test(fullReply);

    // Parse a remediation proposal marker, if the model emitted one. This does
    // NOT run anything — it only tells the client to render a Confirm button.
    // The offerId is re-validated against remediableOffers (the same gate the
    // execute endpoint enforces), so a hallucinated / ineligible id yields no
    // proposal at all — the model cannot conjure an actionable button.
    const proposalMatch = /\[PROPOSE_REMEDIATION:\s*(\d+)\s*\]/i.exec(fullReply);
    let proposedRemediation: { offerId: number; offerTitle: string; packKey: string } | null = null;
    if (proposalMatch) {
      const proposedId = Number(proposalMatch[1]);
      const match = remediableOffers.find((o) => o.offerId === proposedId);
      if (match) {
        proposedRemediation = { offerId: match.offerId, offerTitle: match.offerTitle, packKey: match.packKey };
      } else {
        log.warn(
          { customerId, proposedId, userId: user.id },
          "support-chat: model proposed a remediation id that is not eligible — dropping proposal",
        );
      }
    }

    // Suggested-reply chips (#361). Parsed and stripped like every other control
    // marker here — the raw token never reaches the user.
    const suggestedReplies = parseSuggestedReplies(fullReply);
    if (suggestedReplies.length === 0 && hasSuggestedRepliesToken(fullReply)) {
      // The token was emitted but yielded nothing usable (empty, or every option
      // over-long). The user still gets a clean reply — this is prompt-adherence
      // telemetry, on this route's existing channel.
      log.warn(
        { userId: user.id, mspRole: user.mspRole },
        "support-chat: model emitted a SUGGESTED_REPLIES token that parsed to zero options",
      );
    }

    const visibleReply = stripSuggestedReplies(
      fullReply
        .replace(/\[ESCALATE_TO_HUMAN\]/gi, "")
        .replace(/\[PROPOSE_REMEDIATION:\s*\d+\s*\]/gi, ""),
    );

    // The reply in the #361 structured shape. `reply` is still returned alongside
    // it for any client that hasn't moved over yet.
    const replyContent = buildAssistantContent(visibleReply, suggestedReplies);

    // Audit with correct AuditEvent shape
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const lastUserText = lastUserMsg ? contentToText(lastUserMsg.content) : "";
    void createAuditLog({
      actorUserId: user.id,
      actorName: user.name ?? user.email,
      actorRole: user.role,
      actionType: "ai_support_chat",
      entityType: "support_chat",
      metadata: {
        mspId,
        customerId,
        mspRole: user.mspRole,
        escalated: shouldEscalate,
        aiCostOwner: "msp",
        // The MSP actually billed — differs from mspId under impersonation.
        aiBillingMspId: billingMspId,
        proposedRemediationOfferId: proposedRemediation?.offerId ?? null,
        suggestedReplyCount: suggestedReplies.length,
      },
    });

    if (shouldEscalate) {
      void escalateToAdmin({
        question: lastUserText || "(no message)",
        aiReply: visibleReply,
        userId: user.id,
        mspId,
        userEmail: user.email,
        userName: user.name ?? user.email,
        isCustomerUser,
      });
    }

    res.json({
      reply: visibleReply,
      content: replyContent,
      suggestedReplies,
      escalated: shouldEscalate,
      proposedRemediation,
    });
  },
);

// ── POST /api/msp/support/escalate ────────────────────────────────────────────

router.post(
  "/msp/support/escalate",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = req.user!;
    const { question } = req.body as { question?: string };

    if (rejectPlatformAdmin(user, res)) return;

    const mspId = await resolveMspId(req);
    const isCustomerUser = user.mspRole === "CustomerUser";

    await escalateToAdmin({
      question: question ?? "(no question provided)",
      aiReply: "(User explicitly requested human support)",
      userId: user.id,
      mspId,
      userEmail: user.email,
      userName: user.name ?? user.email,
      isCustomerUser,
    });

    void createAuditLog({
      actorUserId: user.id,
      actorName: user.name ?? user.email,
      actorRole: user.role,
      actionType: "support_escalate",
      entityType: "support_chat",
      metadata: { mspId, mspRole: user.mspRole, explicit: true },
    });

    res.json({ ok: true, message: "Your question has been sent to a human. You will hear back shortly." });
  },
);

export default router;
