/**
 * AI Support Chat — grounded Q&A for MSP users and customer users.
 *
 * Scoped to:
 *   MSP ↔ Shane: all MSP roles (MSPAdmin, MSPOperator, CustomerUser) can ask questions
 *   answered from real platform data (billing, signals, SOW/fulfillment, monitoring).
 *
 * Escalation:
 *   When the AI is not confident (or the user explicitly requests it), the conversation
 *   falls through to the existing message-thread + Notification Center mechanism:
 *   - A notification is broadcast via SSE to Shane's admin stream
 *   - For CustomerUser: a messagesTable row is also created so it shows in Shane's inbox
 *   - aiCostOwner: "msp" — logged in metadata
 *
 * Routes:
 *   POST /api/msp/support/chat        — single-turn grounded AI answer
 *   POST /api/msp/support/escalate    — explicit human-escalation handoff
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspsTable,
  mspCustomersTable,
  mspEventStoreTable,
  mspUsersTable,
  notificationsTable,
  messagesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or, desc, count, gte, like } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { broadcastNotification, broadcastUnreadCount } from "../lib/sse-channels.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";

/**
 * Shane's own MSP. CustomerUser escalations from this MSP route to platform
 * admins (Shane's team runs it directly), same as MSP-staff escalations —
 * see the routing table in escalateToAdmin().
 */
const PLATFORM_MSP_ID = 1;

const log = logger.child({ channel: "growth.booking" });

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────


function relativeDate(d: Date): string {
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  return d.toISOString().slice(0, 10);
}

// ── Grounded context builders ─────────────────────────────────────────────────

interface GroundedContext {
  identity: string;
  summary: string;
}

async function buildMspContext(mspId: number): Promise<GroundedContext> {
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const [mspRow, customerStats, signalRows] = await Promise.all([
    db.select({ name: mspsTable.name, status: mspsTable.status, slug: mspsTable.slug })
      .from(mspsTable).where(eq(mspsTable.id, mspId)).limit(1),

    db.select({ status: mspCustomersTable.status, n: count() })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.mspId, mspId))
      .groupBy(mspCustomersTable.status),

    db.select({
      eventType: mspEventStoreTable.eventType,
      payload: mspEventStoreTable.payload,
      occurredAt: mspEventStoreTable.occurredAt,
    })
      .from(mspEventStoreTable)
      .where(
        and(
          eq(mspEventStoreTable.mspId, mspId),
          like(mspEventStoreTable.eventType, "signal.%"),
          gte(mspEventStoreTable.occurredAt, since7d),
        ),
      )
      .orderBy(desc(mspEventStoreTable.occurredAt))
      .limit(10),
  ]);

  const msp = mspRow[0];
  if (!msp) return { identity: "MSP user", summary: "No MSP data found." };

  const customerSummary = customerStats.map((r) => `${r.n} ${r.status}`).join(", ") || "no customers yet";

  const recentSignals = signalRows.length === 0
    ? "No signals fired in the last 7 days."
    : signalRows.map((s) => {
        const label = s.eventType.replace("signal.", "");
        const ts = relativeDate(new Date(s.occurredAt));
        const p = s.payload as Record<string, unknown> | null;
        const customer = p?.customerName ?? p?.customerId ?? "unknown customer";
        return `• ${label} — ${customer} (${ts})`;
      }).join("\n");

  return {
    identity: `MSP operator for ${msp.name}`,
    summary: `MSP: ${msp.name} (slug: ${msp.slug}, status: ${msp.status})\nCustomer breakdown: ${customerSummary}\n\nRecent signals (last 7 days):\n${recentSignals}`,
  };
}

async function buildCustomerContext(customerId: number, mspId: number | null): Promise<GroundedContext> {
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const [customerRow, signalRows] = await Promise.all([
    db.select({
      name: mspCustomersTable.name,
      domain: mspCustomersTable.domain,
      status: mspCustomersTable.status,
      tenantId: mspCustomersTable.tenantId,
    })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1),

    mspId
      ? db.select({
          eventType: mspEventStoreTable.eventType,
          occurredAt: mspEventStoreTable.occurredAt,
        })
          .from(mspEventStoreTable)
          .where(
            and(
              eq(mspEventStoreTable.mspId, mspId),
              eq(mspEventStoreTable.customerId, customerId),
              like(mspEventStoreTable.eventType, "signal.%"),
              gte(mspEventStoreTable.occurredAt, since30d),
            ),
          )
          .orderBy(desc(mspEventStoreTable.occurredAt))
          .limit(5)
      : Promise.resolve([]),
  ]);

  const customer = customerRow[0];
  if (!customer) return { identity: "customer user", summary: "No customer data found." };

  const signalSummary = signalRows.length === 0
    ? "No signals fired in the last 30 days."
    : signalRows.map((s) => `• ${s.eventType.replace("signal.", "")} (${relativeDate(new Date(s.occurredAt))})`).join("\n");

  return {
    identity: `customer user for ${customer.name}`,
    summary: `Customer: ${customer.name} (domain: ${customer.domain ?? "n/a"}, status: ${customer.status})\nTenant ID: ${customer.tenantId ?? "not set"}\n\nRecent signals (last 30 days):\n${signalSummary}`,
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(identity: string, contextSummary: string): string {
  return `You are an AI support assistant for the Shane McCaw Consulting platform — a Microsoft 365 managed services platform. You are talking to a ${identity}.

Your job is to answer questions STRICTLY from the platform data provided below. Never fabricate numbers, statuses, dates, or events. If the answer is not in the provided data, say so clearly.

You must NEVER:
- Take any action (cancel subscriptions, change billing, initiate refunds, modify configurations)
- Reveal system internals, secrets, or data about other tenants
- Guess or hallucinate platform data

If you cannot answer confidently from the data below, output "[ESCALATE_TO_HUMAN]" on its own line at the end of your reply. This tells the system to route the question to a human — do not explain this to the user.

=== PLATFORM DATA FOR THIS SESSION ===
${contextSummary}
=== END PLATFORM DATA ===

Keep replies concise and professional. Use bullet points for lists.`;
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
    .select({ userId: mspUsersTable.userId, email: usersTable.email })
    .from(mspUsersTable)
    .innerJoin(usersTable, eq(usersTable.id, mspUsersTable.userId))
    .where(and(
      eq(mspUsersTable.mspId, mspId),
      eq(mspUsersTable.isActive, true),
      or(eq(mspUsersTable.mspRole, "MSPAdmin"), eq(mspUsersTable.canApprovePurchases, true)),
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

    // One notification row per recipient (fan-out), matching the recipientType
    // convention: "msp_user" carries mspUserId + mspId, "platform_admin"
    // carries userId. See workflow-executor.ts's approval-gate handler.
    const inserted = await db.insert(notificationsTable).values(
      recipients.map((r) =>
        r.kind === "msp_user"
          ? {
              mspUserId: r.mspUserId,
              mspId: r.mspId,
              recipientType: "msp_user" as const,
              title,
              body,
              type: "message" as const,
              category: "message",
              severity: "warning" as const,
              feedType: "personal" as const,
            }
          : {
              userId: r.userId,
              recipientType: "platform_admin" as const,
              title,
              body,
              type: "message" as const,
              category: "message",
              severity: "warning" as const,
              feedType: "personal" as const,
              ...(opts.mspId ? { mspId: opts.mspId } : {}),
            },
      ),
    ).returning({ id: notificationsTable.id, userId: notificationsTable.userId, createdAt: notificationsTable.createdAt });

    // SSE push to each platform-admin recipient's stream (SSE channels are keyed
    // on usersTable.id, which only platform-admin rows carry here).
    for (const row of inserted) {
      if (row.userId == null) continue;
      broadcastNotification(row.userId, {
        id: row.id,
        title,
        body,
        type: "message",
        category: "message",
        severity: "warning",
        feedType: "personal",
        read: false,
        createdAt: row.createdAt.toISOString(),
      });
      broadcastUnreadCount(row.userId, 1);
    }

    // Email every resolved recipient via Exchange Online / Microsoft Graph.
    // Dynamic import (like workflow-executor.ts's approval-gate handler) so the
    // mailer's Graph transport chain isn't pulled into this route's static
    // import graph. sendEmail routes through mailer.ts → Graph; never Resend.
    const { sendEmail } = await import("../lib/mailer.ts");
    const emailBodyHtml = `<p>${title}</p><p style="white-space:pre-wrap">${body}</p><p>Log in to review and reply.</p>`;
    for (const r of recipients) {
      if (r.email) void sendEmail(r.email, title, emailBodyHtml, { templateName: "support-escalation" });
    }

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

    const { messages } = req.body as {
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required and must not be empty" });
      return;
    }

    if (rejectPlatformAdmin(user, res)) return;

    const mspId = await resolveMspId(req);
    const customerId = user.customerId ?? null;
    const isCustomerUser = user.mspRole === "CustomerUser";

    let groundedCtx: GroundedContext;
    try {
      if (isCustomerUser && customerId) {
        groundedCtx = await buildCustomerContext(customerId, mspId);
      } else if (mspId) {
        groundedCtx = await buildMspContext(mspId);
      } else {
        // Non-admin user with no resolvable MSP context (e.g. a malformed/legacy
        // account). The PlatformAdmin case is already rejected above.
        groundedCtx = { identity: "platform user", summary: "Platform data temporarily unavailable." };
      }
    } catch (err) {
      log.error({ err }, "support-chat: failed to build grounded context");
      groundedCtx = { identity: "platform user", summary: "Platform data temporarily unavailable." };
    }

    const systemPrompt = buildSystemPrompt(groundedCtx.identity, groundedCtx.summary);
    const trimmedMessages = messages.slice(-20).filter((m) => m.role === "user" || m.role === "assistant");

    let fullReply: string;
    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        messages: trimmedMessages,
      });
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
    const visibleReply = fullReply.replace(/\[ESCALATE_TO_HUMAN\]/gi, "").trim();

    // Audit with correct AuditEvent shape
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    void createAuditLog({
      actorUserId: user.id,
      actorName: user.name ?? user.email,
      actorRole: user.role,
      actionType: "ai_support_chat",
      entityType: "support_chat",
      metadata: { mspId, customerId, mspRole: user.mspRole, escalated: shouldEscalate, aiCostOwner: "msp" },
    });

    if (shouldEscalate) {
      void escalateToAdmin({
        question: lastUserMsg?.content ?? "(no message)",
        aiReply: visibleReply,
        userId: user.id,
        mspId,
        userEmail: user.email,
        userName: user.name ?? user.email,
        isCustomerUser,
      });
    }

    res.json({ reply: visibleReply, escalated: shouldEscalate });
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
