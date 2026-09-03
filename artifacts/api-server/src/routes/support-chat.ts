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
  insightsGeneratedDocumentsTable,
  documentTypesTable,
  mspDiagnosticRunsTable,
  tenantsTable,
  clientServicesTable,
  servicesTable,
} from "@workspace/db";
import { eq, and, or, desc, notInArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { anthropic, withAiAttribution } from "@workspace/integrations-anthropic-ai";
import { resolveBillingMspId } from "../lib/ai-billing.ts";
import { enqueueEscalationTicket } from "../lib/zoho-desk.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import { listRemediableOffers, type RemediableOffer } from "./portal-mission-control.ts";
import { LIVE_RENDERED_DOC_TYPES } from "./portal-documents.ts";
import { generateDocument } from "../lib/document-engine.ts";
import { generateSowDocument } from "../lib/document-engine-sow.ts";
import { runDiagnostics } from "../lib/diagnostics-runner.ts";
import {
  buildGrounding,
  resolveInstance,
  assembleSystemPrompt,
  routeRequestedActions,
  stripActionTokens,
  routeRequestedCards,
  stripCardTokens,
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

/**
 * The action layer (#363). Shared with shanebot-engine.ts's action_router,
 * which already logs proposal/authorization decisions under this same leaf —
 * kept together so the whole propose→confirm→execute lifecycle for
 * regenerate_document/rerun_scan traces on one channel.
 */
const actionLog = logger.child({ channel: "engine.shanebot" });

const router: IRouter = Router();

// ── Grounded context ──────────────────────────────────────────────────────────
// Grounding is now the shared engine's `customer_entitlements` groundingSource
// builder (shanebot-engine.ts, #1097) — the SAME engine ShaneBot Public's
// live_catalog grounding lives in, so the two surfaces can't drift on how grounding
// is built. The MSP/customer branching, signal formatting, and relative-date helper
// all moved there verbatim; this route just asks the engine for the grounded
// context for the shanebot_paid instance.

// ── Action layer (#363) — regenerate document / rerun scan ───────────────────
// shanebot-engine.ts's action_router only parses an [ACTION:x] token and gates
// it against the emitting instance's allowedActions — it deliberately does not
// resolve WHAT to regenerate/rerun (see that module's action_router header
// comment: "the actual action handlers... are a later build"). That's this
// section: resolve the requesting customer's own current eligible target,
// fresh from the DB every time (never trusted from the model's token or an
// earlier turn), then call the SAME real functions admin-document-generator.ts
// and msp-diagnostics.ts already use — no new pipeline, no new abstraction.

/** The customer's own most recent regenerable document, or null if none exists. */
async function findRegenerableDocument(customerId: number): Promise<{
  id: number;
  docType: string;
  projectId: number | null;
  title: string;
} | null> {
  const [doc] = await db
    .select({
      id: insightsGeneratedDocumentsTable.id,
      docType: insightsGeneratedDocumentsTable.docType,
      projectId: insightsGeneratedDocumentsTable.projectId,
      title: insightsGeneratedDocumentsTable.title,
    })
    .from(insightsGeneratedDocumentsTable)
    .where(
      and(
        // mspCustomerId (tenants.id), NOT the sibling customerId column — that
        // one is a users.id (which login generated it), not the tenant scope.
        eq(insightsGeneratedDocumentsTable.mspCustomerId, customerId),
        eq(insightsGeneratedDocumentsTable.status, "delivered"),
        // Live-rendered doc types (portal-documents.ts) have no meaningful
        // stored HTML to regenerate — refreshing what the customer actually
        // sees for those is a rescan, not a regenerate.
        notInArray(insightsGeneratedDocumentsTable.docType, [...LIVE_RENDERED_DOC_TYPES]),
      ),
    )
    .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
    .limit(1);
  return doc ?? null;
}

/** Whether this customer has ever had a diagnostics run — "rerun" implies one already exists. */
async function hasScanHistory(customerId: number): Promise<boolean> {
  const [run] = await db
    .select({ runId: mspDiagnosticRunsTable.runId })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.customerId, customerId))
    .limit(1);
  return Boolean(run);
}

/**
 * Same subscription-derived packageKey lookup msp-diagnostics.ts's manual
 * rerun trigger uses (falls back to the always-present baseline package).
 */
async function resolveScanPackageKey(customerId: number): Promise<string> {
  const [pkgRow] = await db
    .select({ packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'` })
    .from(usersTable)
    .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, usersTable.id))
    .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
    .where(
      and(
        eq(usersTable.tenantId, customerId),
        eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
        eq(clientServicesTable.status, "active"),
      ),
    )
    .orderBy(desc(clientServicesTable.id))
    .limit(1);
  return pkgRow?.packageKey ?? "core:security-baseline";
}

// ── Card layer (#366) — Active Cards ──────────────────────────────────────────
// shanebot-engine.ts's card_router only parses a [SHOW_CARD:x] token and gates
// the TYPE against the instance's allowedCardTypes — it deliberately does not
// resolve the actual data. That's this: pull the pre-built cardData off this
// turn's own grounding result (real DB rows, queried fresh for this customer
// earlier in this same request) and hand back only the type the model asked
// for. Never null-coalesces to fabricated data — an unavailable type yields
// no card at all, same "propose, never silently act" contract as the
// remediation/action proposals above.
function resolveCardData(
  cardType: string,
  cardData: BotGrounding["cardData"] | undefined,
): Record<string, unknown> | null {
  if (!cardData) return null;
  switch (cardType) {
    case "invoice":
      return cardData.invoice ? (cardData.invoice as unknown as Record<string, unknown>) : null;
    case "subscription":
      return cardData.subscription ? (cardData.subscription as unknown as Record<string, unknown>) : null;
    case "score":
      return cardData.score ? (cardData.score as unknown as Record<string, unknown>) : null;
    case "data-answer":
      return cardData.dataAnswer ? (cardData.dataAnswer as unknown as Record<string, unknown>) : null;
    default:
      return null;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  instance: BotInstanceConfig,
  grounding: BotGrounding,
  remediableOffers: RemediableOffer[],
  actionsEnabled: boolean,
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

  // Same "propose, never silently act" shape as the remediation block above,
  // for the two actions shanebot-engine.ts's action_router is allowed to
  // authorize for this instance (regenerate_document, rerun_scan). Gated by
  // `actionsEnabled` (this route only enables it for a CustomerUser on their
  // own tenant) so an MSP-staff turn never even learns the tokens exist.
  const actionsBlock = !actionsEnabled
    ? ""
    : `

=== PLATFORM ACTIONS AVAILABLE ===
You may offer to take ONE of the following actions, but ONLY when the user has clearly asked for it:
- Regenerate their most recent report/document: if they ask to update, regenerate, refresh, or redo their report or document, explain in plain language what will happen, ask them to confirm, then append a marker on its very last line, alone: [ACTION:regenerate_document]
- Re-run their latest scan: if they ask to rerun, redo, refresh, or recheck their scan or monitoring, explain in plain language what will happen, ask them to confirm, then append a marker on its very last line, alone: [ACTION:rerun_scan]
=== END PLATFORM ACTIONS ===

PLATFORM ACTION RULES (follow exactly):
- Only offer an action when the user has clearly asked for it. Never offer one from an ambiguous, unrelated, or general question.
- The marker does NOT run anything. It only surfaces a Confirm button the user must click themselves. NEVER say or imply that you have started, run, applied, or completed the action — you cannot. Only the user's own confirmation click runs it.
- Offer at most one action per reply.
- If there is nothing eligible for that action, the Confirm button will not appear — still explain what you're offering, and let the user know if it turns out nothing was available.`;

  // Active Cards (#366) — same gate as actionsBlock (a CustomerUser on their own
  // tenant), since card data is resolved the same real-per-customer way actions
  // are. The marker never carries data itself; it only tells the client which
  // pre-resolved card (if any) to render alongside the reply.
  //
  // #1624: specific-card-first ordering. Per the contract pack §4.4/§9 DECIDED
  // row, `data-answer` is the fallback of last resort, not a peer choice — it
  // must only be requested when none of the three specific cards fit. Listing
  // it last and naming it explicitly as last-resort (rather than "for any other
  // structured platform-data question", which gave it the broadest mandate) is
  // the fix; the model still makes the live per-turn judgment, this only biases
  // it (verified by asking real questions per #1616 DECIDED, not a unit test).
  const cardsBlock = !actionsEnabled
    ? ""
    : `

=== DATA CARDS AVAILABLE ===
When your answer is about one of these, prefer the specific card for it over any generic one:
- Invoices or billing history → [SHOW_CARD:invoice]
- Subscription or plan status → [SHOW_CARD:subscription]
- Copilot readiness score → [SHOW_CARD:score]
Only if none of those three fit, and the question is still a structured platform-data question you can answer from the data above, you may fall back to [SHOW_CARD:data-answer]. Treat data-answer as the fallback of last resort, not a first choice.
Append the marker on its own line, alone, after your written answer.
=== END DATA CARDS ===

DATA CARD RULES (follow exactly):
- Only request a card type that is actually relevant to what the user just asked.
- Prefer the specific card (invoice, subscription, score) whenever it applies. Only request data-answer when none of those three do.
- Still answer briefly in your own words too — the card supplements your reply, it never replaces it.
- Request at most one card per reply.
- If there is no real data available for that card type, none will be shown — do not claim one is showing.`;

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
=== END PLATFORM DATA ===${remediationBlock}${actionsBlock}${cardsBlock}`;

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
          buildGrounding(paidInstance, { customerId, mspId, isCustomerUser, userId: user.id }),
          listRemediableOffers(customerId),
        ]);
      } else {
        groundedCtx = await buildGrounding(paidInstance, { customerId, mspId, isCustomerUser, userId: user.id });
      }
    } catch (err) {
      log.error({ err }, "support-chat: failed to build grounded context");
      groundedCtx = { identity: "platform user", summary: "Platform data temporarily unavailable." };
      remediableOffers = [];
    }

    const systemPrompt = buildSystemPrompt(
      paidInstance,
      groundedCtx,
      remediableOffers,
      isCustomerUser && Boolean(customerId),
    );
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

    // Action proposal (#363) — regenerate_document / rerun_scan. Only ever
    // computed for a CustomerUser on their own tenant, matching the system
    // prompt's actionsEnabled gate above, so an MSP-staff turn can never
    // surface one even if the model somehow emitted a token. The router
    // (shanebot-engine.ts) already authorized the token name against the
    // instance's allowedActions; this re-validates there is an ACTUAL
    // eligible target for THIS customer, fresh from the DB, before a Confirm
    // button is ever shown — same "propose, never silently act" contract as
    // proposedRemediation above. A hallucinated/ineligible request yields no
    // proposal at all.
    let proposedAction: { action: string; label: string } | null = null;
    if (isCustomerUser && customerId) {
      for (const { action, authorized } of routeRequestedActions(paidInstance, fullReply)) {
        if (!authorized) continue;
        if (action === "regenerate_document") {
          const doc = await findRegenerableDocument(customerId);
          if (doc) {
            proposedAction = { action, label: `Regenerate "${doc.title}"` };
            break;
          }
        } else if (action === "rerun_scan") {
          if (await hasScanHistory(customerId)) {
            proposedAction = { action, label: "Re-run your latest scan" };
            break;
          }
        }
        log.warn(
          { customerId, action, userId: user.id },
          "support-chat: model proposed an action with no eligible target — dropping proposal",
        );
      }
    }

    // Card proposal (#366) — Active Cards. Same "propose, never silently act"
    // contract as proposedAction above: card_router only authorizes the TYPE
    // against allowedCardTypes; the actual data comes from THIS turn's own
    // groundedCtx.cardData (already queried fresh from the DB for this
    // customer above), never from the model's text. A hallucinated/empty
    // request yields no card at all.
    let proposedCard: { cardType: string; data: Record<string, unknown> } | null = null;
    if (isCustomerUser && customerId) {
      for (const { cardType, authorized } of routeRequestedCards(paidInstance, fullReply)) {
        if (!authorized) continue;
        const data = resolveCardData(cardType, groundedCtx.cardData);
        if (data) {
          proposedCard = { cardType, data };
          break;
        }
        log.warn(
          { customerId, cardType, userId: user.id },
          "support-chat: model requested a card with no real data available — dropping",
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

    const visibleReply = stripCardTokens(
      stripActionTokens(
        stripSuggestedReplies(
          fullReply
            .replace(/\[ESCALATE_TO_HUMAN\]/gi, "")
            .replace(/\[PROPOSE_REMEDIATION:\s*\d+\s*\]/gi, ""),
        ),
      ),
    );

    // The reply in the #361 structured shape. `reply` is still returned alongside
    // it for any client that hasn't moved over yet.
    const replyContent = buildAssistantContent(visibleReply, suggestedReplies, proposedCard ? [proposedCard] : []);

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
        proposedAction: proposedAction?.action ?? null,
        proposedCardType: proposedCard?.cardType ?? null,
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
      proposedAction,
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

// ── POST /api/msp/support/actions/regenerate-document ────────────────────────
// Confirmed execution of a [ACTION:regenerate_document] proposal (#363).
// CustomerUser-only, self-service on their OWN tenant's own most recent
// eligible document — the target is re-resolved here from scratch (never
// trusted from the earlier proposal or the request body), so a stale or
// tampered confirm click can never regenerate anything but the caller's own
// current document. Calls the SAME generateDocument()/generateSowDocument()
// admin-document-generator.ts uses — no new generation pipeline. Streams
// progress back over SSE using the identical frame convention as that route's
// own `stream:true` mode, so the chat UI can show a live indicator instead of
// a silent wait.

router.post(
  "/msp/support/actions/regenerate-document",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = req.user!;
    if (user.mspRole !== "CustomerUser" || !user.customerId) {
      res.status(403).json({ error: "Not available for this account" });
      return;
    }
    const customerId = user.customerId;

    const doc = await findRegenerableDocument(customerId);
    if (!doc) {
      res.status(404).json({ error: "No document available to regenerate" });
      return;
    }

    const [docTypeRow] = await db
      .select({ pipelineCategory: documentTypesTable.pipelineCategory, isActive: documentTypesTable.isActive })
      .from(documentTypesTable)
      .where(eq(documentTypesTable.key, doc.docType))
      .limit(1);
    if (!docTypeRow || !docTypeRow.isActive) {
      res.status(400).json({ error: "This document type can no longer be generated" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const sendSSE = (event: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    sendSSE({ type: "phase", label: "Regenerating your document…", pct: 5 });
    const onTextDelta = (text: string): void => {
      sendSSE({ type: "delta", text });
    };

    try {
      const result = docTypeRow.pipelineCategory === "pipeline_output"
        ? await generateSowDocument({ mspCustomerId: customerId, projectId: doc.projectId ?? 0, docTypeKey: doc.docType, forceRegenerate: true })
        : await generateDocument({ mspCustomerId: customerId, projectId: doc.projectId ?? 0, docTypeKey: doc.docType, forceRegenerate: true, onTextDelta });

      actionLog.info(
        { customerId, documentId: result.documentId, docType: doc.docType, userId: user.id },
        "support-chat: chat-initiated document regeneration completed",
      );
      void createAuditLog({
        actorUserId: user.id,
        actorName: user.name ?? user.email,
        actorRole: user.role,
        actionType: "shanebot_action_regenerate_document",
        entityType: "insights_generated_document",
        entityId: result.documentId,
        entityLabel: doc.title,
        metadata: { customerId, docType: doc.docType },
      });
      sendSSE({ type: "done", payload: { documentId: result.documentId, docType: doc.docType, costCents: result.costCents } });
    } catch (err) {
      actionLog.error({ err, customerId, docType: doc.docType }, "support-chat: chat-initiated document regeneration failed");
      sendSSE({ type: "error", message: "Regeneration failed. Please try again shortly." });
    }
    res.end();
  },
);

// ── POST /api/msp/support/actions/rerun-scan ──────────────────────────────────
// Confirmed execution of a [ACTION:rerun_scan] proposal (#363). Same ownership
// discipline as regenerate-document above: customerId comes only from the
// authenticated session, never the request body. Mirrors the customer-facing
// shape of POST /msp/customers/:customerId/diagnostics/run (msp-diagnostics.ts)
// — insert a pending run row, fire-and-forget the SAME runDiagnostics(), return
// the runId immediately. The chat client streams live progress by opening the
// EXISTING customer-permitted
// GET /msp/customers/:customerId/diagnostics/runs/:runId/sse endpoint with the
// returned runId — no new streaming mechanism needed for this action.

router.post(
  "/msp/support/actions/rerun-scan",
  requireAuth,
  async (req: Request, res: Response) => {
    const user = req.user!;
    if (user.mspRole !== "CustomerUser" || !user.customerId) {
      res.status(403).json({ error: "Not available for this account" });
      return;
    }
    const customerId = user.customerId;

    try {
      const [customer] = await db
        .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, tenantId: tenantsTable.tenantId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      if (!customer) {
        res.status(404).json({ error: "Account not found" });
        return;
      }

      const packageKey = await resolveScanPackageKey(customerId);
      const runId = randomUUID();

      await db.insert(mspDiagnosticRunsTable).values({
        runId,
        mspId: customer.mspId,
        customerId,
        tenantId: customer.tenantId ?? undefined,
        packageKey,
        status: "pending",
        triggeredByUserId: user.id,
      });

      res.status(202).json({ runId, status: "pending", packageKey });

      void runDiagnostics({ customerId, packageKey, existingRunId: runId, triggeredByUserId: user.id, isAssessmentTriggered: false })
        .catch((err: unknown) => {
          actionLog.error({ err, runId, customerId }, "support-chat: chat-initiated scan rerun failed");
        });

      void createAuditLog({
        actorUserId: user.id,
        actorName: user.name ?? user.email,
        actorRole: user.role,
        actionType: "shanebot_action_rerun_scan",
        entityType: "msp_diagnostic_run",
        entityId: runId,
        entityLabel: packageKey,
        metadata: { customerId, runId, packageKey },
      });
    } catch (err) {
      actionLog.error({ err, customerId }, "support-chat: rerun-scan request failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to start scan" });
    }
  },
);

export default router;
