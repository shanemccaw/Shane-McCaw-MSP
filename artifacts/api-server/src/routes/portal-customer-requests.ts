/**
 * portal-customer-requests.ts  (Git #1158, part of #1045)
 *
 * Real customer-facing support-request ("Open a Request") submission + an
 * in-portal ticket thread view, backed by Zoho Desk.
 *
 * Answers the Service Levels gap: a customer had no way to actually OPEN a
 * request — the "Open Requests" pill counted MSP-side SLA timers only, with no
 * customer entry point. These routes give the customer one, reusing the exact
 * Zoho Desk plumbing the ShaneBot `[ESCALATE_TO_HUMAN]` flow already uses
 * (`enqueueEscalationTicket`), plus new customer-scoped reads so they can watch
 * status and replies without leaving the portal.
 *
 * Ownership: every read/reply is scoped to the caller's OWN Zoho Desk Contact,
 * resolved from their authenticated email. A customer can never see or reply to
 * a ticket whose Contact isn't theirs — foreign/unknown ids both 404.
 *
 * Auth: requireRole("CustomerUser") on every route — same tier as its sibling
 * portal-customer-engines.ts routes. The customer's own id is read from the JWT
 * (req.user.customerId === tenants.id).
 *
 * Scope note (Git #1158): this deliberately does NOT wire customer requests
 * into sla-engine's `runningTimers` (the "Open Requests" pill) — those feed the
 * SLA compliance engine and coupling unvetted customer-submitted requests into
 * it would distort compliance metrics. Left as a separate decision (scope "C").
 *
 * Reads hit Zoho live per-request (a customer needs current state now); the
 * create + reply writes go through the same queued drain (~every 5 min) as the
 * escalation path, so a freshly-submitted request appears in the list on the
 * next drain, not instantly.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { db, tenantsTable, usersTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { ZohoNotConnectedError, ZohoApiError } from "../lib/zoho-client.ts";
import {
  enqueueEscalationTicket,
  enqueueZohoDeskWrite,
  resolveDeskContactIdForEmail,
  listDeskTicketsForContact,
  getDeskTicketForContact,
  getDeskTicketThread,
} from "../lib/zoho-desk.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "comms.support" });

const MAX_SUBJECT = 200;
const MAX_BODY = 5000;
const ALLOWED_PRIORITIES = new Set(["Low", "Medium", "High", "Urgent"]);

/**
 * The MSP whose Zoho Desk connection this customer's tickets live under.
 * Resolved from the customer's own tenant row (tenants.mspId); falls back to
 * the JWT's mspId, then to undefined (which zoho-desk defaults to
 * ZOHO_DEFAULT_MSP_ID). Kept consistent between create and read so a ticket a
 * customer opens is the ticket they can then see.
 */
async function resolveCustomerMspId(customerId: number, fallback?: number | null): Promise<number | undefined> {
  const [row] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  return row?.mspId ?? fallback ?? undefined;
}

/**
 * The MSP admins to notify when a customer opens a request — same resolution
 * support-chat's escalation path uses (active MSPAdmins or purchase-approvers).
 * Empty array is fine: the ticket is still created, just not emailed.
 */
async function resolveMspAdminEmails(mspId: number | undefined): Promise<string[]> {
  if (!mspId) return [];
  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.mspId, mspId),
        eq(usersTable.isActive, true),
        or(eq(usersTable.mspRole, "MSPAdmin"), eq(usersTable.canApprovePurchases, true)),
      ),
    );
  return admins.map((a) => a.email).filter((e): e is string => Boolean(e));
}

/** Maps a Zoho "not connected" failure to a friendly, non-error portal state. */
function isZohoUnavailable(err: unknown): boolean {
  return err instanceof ZohoNotConnectedError;
}

// ── POST /api/portal/customer/requests ────────────────────────────────────────
// Open a new request. Reuses enqueueEscalationTicket — identical Zoho Desk write
// path as ShaneBot's escalation, so no new Zoho integration surface.
router.post("/portal/customer/requests", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const user = req.user!;
  const customerId = user.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }

  const bodyIn = (req.body ?? {}) as Record<string, unknown>;
  const subject = typeof bodyIn.subject === "string" ? bodyIn.subject.trim() : "";
  const description = typeof bodyIn.description === "string" ? bodyIn.description.trim() : "";
  const category = typeof bodyIn.category === "string" ? bodyIn.category.trim() : "";
  const priorityRaw = typeof bodyIn.priority === "string" ? bodyIn.priority.trim() : "";
  const priority = ALLOWED_PRIORITIES.has(priorityRaw) ? priorityRaw : "";

  if (!subject) {
    res.status(400).json({ error: "A subject is required." });
    return;
  }
  if (!description) {
    res.status(400).json({ error: "Please describe your request." });
    return;
  }

  const displayName = user.name || user.email;
  // category/priority are folded into the description rather than extending the
  // Zoho ticket schema — keeps the create path a 1:1 reuse of enqueueEscalationTicket.
  const metaLines = [priority ? `Priority: ${priority}` : "", category ? `Category: ${category}` : ""]
    .filter(Boolean)
    .join("\n");
  const fullDescription = `${metaLines ? metaLines + "\n\n" : ""}${description.slice(0, MAX_BODY)}`;

  try {
    const mspId = await resolveCustomerMspId(customerId, user.mspId ?? null);
    const notifyEmails = await resolveMspAdminEmails(mspId);
    const notifySubject = `New customer request from ${displayName}`;

    const result = await enqueueEscalationTicket(
      {
        subject: subject.slice(0, MAX_SUBJECT),
        description: fullDescription,
        contactEmail: user.email,
        contactName: displayName,
        localUserId: user.id,
        notifyEmails,
        notifySubject,
      },
      { mspId, customerId },
    );

    log.info({ customerId, mspId, jobId: result.jobId }, "portal-customer-requests: request queued as Zoho Desk ticket");
    res.status(202).json({
      queued: true,
      message: "Your request has been submitted. Our team has been notified and will be in touch.",
    });
  } catch (err) {
    log.error({ err, customerId }, "portal-customer-requests: create failed");
    res.status(500).json({ error: "We couldn't submit your request right now. Please try again shortly." });
  }
});

// ── GET /api/portal/customer/requests ─────────────────────────────────────────
// List the caller's own requests. Empty (never opened one, or ticketing not yet
// configured) is a normal state, not an error.
router.get("/portal/customer/requests", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const user = req.user!;
  const customerId = user.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }

  try {
    const mspId = await resolveCustomerMspId(customerId, user.mspId ?? null);
    const contactId = await resolveDeskContactIdForEmail(user.email, mspId);
    if (!contactId) {
      res.json({ configured: true, requests: [] });
      return;
    }
    const requests = await listDeskTicketsForContact(contactId, mspId);
    res.json({ configured: true, requests });
  } catch (err) {
    if (isZohoUnavailable(err)) {
      log.warn({ customerId }, "portal-customer-requests: Zoho Desk not connected — returning unconfigured state");
      res.json({ configured: false, requests: [] });
      return;
    }
    log.error({ err, customerId }, "portal-customer-requests: list failed");
    res.status(500).json({ error: "We couldn't load your requests right now. Please try again shortly." });
  }
});

// ── GET /api/portal/customer/requests/:ticketId ───────────────────────────────
// One request's detail + conversation thread. Ownership-enforced: a foreign or
// unknown ticket id both 404 so ownership can't be probed.
router.get("/portal/customer/requests/:ticketId", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const user = req.user!;
  const customerId = user.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }
  const ticketId = String(req.params.ticketId ?? "").trim();
  if (!ticketId) {
    res.status(400).json({ error: "Missing request id" });
    return;
  }

  try {
    const mspId = await resolveCustomerMspId(customerId, user.mspId ?? null);
    const contactId = await resolveDeskContactIdForEmail(user.email, mspId);
    if (!contactId) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const owned = await getDeskTicketForContact(ticketId, contactId, mspId);
    if (owned.ownership !== "owned") {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const thread = await getDeskTicketThread(ticketId, mspId);
    res.json({ configured: true, request: owned.ticket, thread });
  } catch (err) {
    if (isZohoUnavailable(err)) {
      log.warn({ customerId, ticketId }, "portal-customer-requests: Zoho Desk not connected — returning unconfigured state");
      res.json({ configured: false, request: null, thread: [] });
      return;
    }
    log.error({ err, customerId, ticketId }, "portal-customer-requests: detail failed");
    res.status(500).json({ error: "We couldn't load this request right now. Please try again shortly." });
  }
});

// ── POST /api/portal/customer/requests/:ticketId/reply ────────────────────────
// Add the customer's reply to their own request. Ownership-enforced first.
// Posts as a PUBLIC comment via the existing queued zoho_desk_add_comment write.
// NOTE: Zoho attributes an API-authored public comment to the connected agent,
// not the contact, so the customer's name is prefixed into the body to keep
// authorship legible in the thread.
router.post("/portal/customer/requests/:ticketId/reply", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const user = req.user!;
  const customerId = user.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }
  const ticketId = String(req.params.ticketId ?? "").trim();
  const bodyIn = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof bodyIn.message === "string" ? bodyIn.message.trim() : "";
  if (!ticketId) {
    res.status(400).json({ error: "Missing request id" });
    return;
  }
  if (!message) {
    res.status(400).json({ error: "Please enter a message." });
    return;
  }

  try {
    const mspId = await resolveCustomerMspId(customerId, user.mspId ?? null);
    const contactId = await resolveDeskContactIdForEmail(user.email, mspId);
    if (!contactId) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const owned = await getDeskTicketForContact(ticketId, contactId, mspId);
    if (owned.ownership !== "owned") {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const displayName = user.name || user.email;
    const content = `${displayName} (customer) replied:\n\n${message.slice(0, MAX_BODY)}`;
    const result = await enqueueZohoDeskWrite(
      "zoho_desk_add_comment",
      { ticketId, content, isPublic: true },
      { mspId, customerId },
    );

    log.info({ customerId, mspId, ticketId, jobId: result.jobId }, "portal-customer-requests: reply queued");
    res.status(202).json({ configured: true, queued: true, message: "Your reply has been added to the request." });
  } catch (err) {
    if (isZohoUnavailable(err)) {
      log.warn({ customerId, ticketId }, "portal-customer-requests: Zoho Desk not connected — returning unconfigured state");
      res.json({ configured: false, queued: false, message: "Ticketing is not available right now." });
      return;
    }
    if (err instanceof ZohoApiError) {
      log.error({ err: err.body, status: err.status, ticketId }, "portal-customer-requests: reply Zoho error");
      res.status(502).json({ error: "We couldn't add your reply right now. Please try again shortly." });
      return;
    }
    log.error({ err, customerId, ticketId }, "portal-customer-requests: reply failed");
    res.status(500).json({ error: "We couldn't add your reply right now. Please try again shortly." });
  }
});

export default router;
