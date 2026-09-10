/**
 * REINSTATEMENT → ZOHO DESK TICKET (Git #2999).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The decision this implements
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #2936 built the durable record of a gated customer asking to be let back in and
 * deliberately left open the question its own dispatch asked: who, if anyone, is told
 * about an open request while the portal is still closed. #2999 laid out five real
 * options; Shane settled it on 2026-09-07 as **1 + 3**:
 *
 *   1. Auto-resume — already built and unchanged. #2765's reconciliation reopens the
 *      customer the moment the predicate that closed them flips back, and
 *      `resolveOpenReinstatementRequests()` closes the request in the same breath with
 *      `resolution = 'portal_reopened'`. That remains the ONE mechanism that decides a
 *      request is resolved. Nothing in this file writes `status`.
 *   3. A real Zoho Desk ticket, raised the moment the row lands, reusing
 *      `enqueueEscalationTicket()` — the exact path `POST /api/portal/customer/requests`
 *      already uses. No new Zoho surface, no new operator dashboard.
 *
 * Not built, explicitly: option 2 (notify the customer's own MSP), option 4 (a
 * platform-side operator queue), option 5 (conversion to direct billing).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Which Desk the ticket lands in, and why that is the platform's
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #2999's own analysis raises the real objection to option 3: a ticket "lands in the
 * MSP's Desk, so it inherits option 2's problem" — in a cascade the MSP is the delinquent
 * party, and a request routed to them is a message into a void.
 *
 * That objection is answered by where the ticket is actually addressed, not by dropping
 * the option. This ticket is raised against `ZOHO_DEFAULT_MSP_ID` — the platform's own
 * Desk — never against the customer's MSP, and it is the one escalation path on this
 * platform that deliberately does so:
 *
 *   - In the cascade case the customer's MSP is precisely who must NOT be the only party
 *     told. The platform is the only remaining party that can act.
 *   - In the customer's-own-lapse case the platform is still the right recipient: it is
 *     the platform's subscription gate that closed the portal, and reopening it is a
 *     platform action.
 *   - It is also the only Desk that exists. Confirmed against live Postgres, 2026-09-07:
 *     exactly one `zoho_connection` row, `msp_id = 1`, status `connected`. Addressing a
 *     ticket to any other MSP would raise `ZohoNotConnectedError` at drain time and land
 *     the notification in the DLQ.
 *
 * The Desk CONTACT is still the customer who asked, so the ticket is a real thread with
 * the person affected rather than an internal memo about them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why the ticket is recorded on the request row
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `retention_reinstatement_requests`' own docblock rules out building any of these
 * options "on a notification that was fired once and stored nowhere". Queuing a job and
 * forgetting it would be exactly that. So the request row carries its ticket: the job id
 * at request time, the real ticket id/number/url when the drain confirms it exists, and
 * `ticket_error` when no ticket could be raised at all — the last of which is what keeps
 * a silently-failed notification distinguishable from one that is merely still queued.
 *
 * Nothing here ever throws. A gated customer's request must be recorded even when Zoho is
 * unreachable; losing the record because the notification stumbled would invert the whole
 * point of #2936.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { purchaseApproverUserIds } from "../../middlewares/rbac-capability.ts";
import {
  db,
  mspsTable,
  retentionReinstatementRequestsTable,
  tenantsTable,
  usersTable,
  type RetentionReinstatementRequest,
} from "@workspace/db";
import { logger } from "../logger";
import { ZOHO_DEFAULT_MSP_ID } from "../zoho-client.ts";
import { enqueueEscalationTicket } from "../zoho-desk.ts";

const log = logger.child({ channel: "comms.support" });

/**
 * The payload key `handleCreateTicketJob()` reads to know this ticket belongs to a
 * reinstatement request and should be written back onto it. Exported so the handler and
 * this module cannot drift apart on a string literal.
 */
export const REINSTATEMENT_TICKET_PAYLOAD_KEY = "reinstatementRequestId";

/** Zoho Desk's subject limit is generous; this matches portal-customer-requests.ts. */
const MAX_SUBJECT = 200;

interface TicketContext {
  tenantId: number;
  customerName: string;
  mspId: number;
  mspName: string;
  requesterEmail: string | null;
  requesterName: string | null;
}

/**
 * Everything the ticket needs about who is asking, in one read.
 *
 * The requester is resolved from `requested_by_user_id` when there is one. There is no
 * fallback to "some other user at this customer": a ticket that names the wrong person as
 * its contact is worse than one that says the requester could not be identified.
 */
async function readTicketContext(
  request: RetentionReinstatementRequest,
): Promise<TicketContext | null> {
  const [tenant] = await db
    .select({
      tenantId: tenantsTable.id,
      customerName: tenantsTable.customerName,
      mspId: mspsTable.id,
      mspName: mspsTable.name,
    })
    .from(tenantsTable)
    .innerJoin(mspsTable, eq(mspsTable.id, tenantsTable.mspId))
    .where(eq(tenantsTable.id, request.tenantId))
    .limit(1);

  if (!tenant) return null;

  let requesterEmail: string | null = null;
  let requesterName: string | null = null;
  if (request.requestedByUserId !== null) {
    const [user] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, request.requestedByUserId))
      .limit(1);
    requesterEmail = user?.email ?? null;
    requesterName = user?.name ?? null;
  }

  return { ...tenant, requesterEmail, requesterName };
}

/**
 * The platform's own admins — who the drain emails once the ticket is confirmed created.
 *
 * Same resolution `portal-customer-requests.ts` uses (active MSPAdmins or
 * purchase-approvers), but pinned to `ZOHO_DEFAULT_MSP_ID` rather than the customer's MSP,
 * for the reason in this module's docblock: in a cascade the customer's MSP is the
 * delinquent party. An empty result is not a failure — the ticket is still created, it
 * just isn't emailed on top.
 */
async function resolvePlatformNotifyEmails(): Promise<string[]> {
  // #2460 — was `mspRole = 'MSPAdmin' OR can_approve_purchases`. Both columns of that
  // predicate are gone; the recipients are now whoever the model says holds
  // `msp:purchases.approve`, so a re-grant changes who is notified without a deploy.
  // A null answer means the model could not be read, which is not the same as nobody
  // qualifying — an empty notify list is already a non-failure here (see the docblock
  // above), so both end up not emailing, but only one of them is normal.
  const approverIds = await purchaseApproverUserIds(ZOHO_DEFAULT_MSP_ID);
  if (approverIds === null || approverIds.length === 0) return [];

  const admins = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.mspId, ZOHO_DEFAULT_MSP_ID),
        eq(usersTable.isActive, true),
        inArray(usersTable.id, approverIds),
      ),
    );
  return admins.map((a) => a.email).filter((e): e is string => Boolean(e));
}

/**
 * The ticket body.
 *
 * #2999's second requirement is that the ticket carries enough to act on **without
 * opening the portal** — so every fact a responder needs is written into the description
 * rather than left behind a link: who asked, for which customer, under which MSP, what
 * actually gated them (their own lapse vs. an MSP cascade), when the lapse happened, when
 * they asked, and the customer's own words if they left any.
 *
 * Every value comes from the request row's snapshot, which is what the customer was
 * genuinely looking at when they asked — by the time a human reads this the live billing
 * state may well have moved, and that is precisely the case where the snapshot matters.
 *
 * The closing line is not decoration: it is what stops a responder from marking the
 * request resolved by hand somewhere else. Resolution has exactly one mechanism.
 */
export function composeReinstatementTicketBody(
  request: RetentionReinstatementRequest,
  ctx: TicketContext,
): { subject: string; description: string } {
  const cause = request.lapseWasMspCascade
    ? `MSP cascade — ${ctx.mspName}'s own platform subscription lapsed, which closed this customer's portal. The customer is not the delinquent party.`
    : `The customer's own subscription lapsed (billing source: ${request.lapseSource ?? "unknown"}).`;

  const lines = [
    `${ctx.customerName} has asked to be reinstated after their portal was closed by the subscription gate.`,
    "",
    `Customer:       ${ctx.customerName} (tenant #${ctx.tenantId})`,
    `MSP:            ${ctx.mspName} (msp #${ctx.mspId})`,
    `Requested by:   ${ctx.requesterName ?? "unknown"}${ctx.requesterEmail ? ` <${ctx.requesterEmail}>` : ""}`,
    `Requested at:   ${request.requestedAt.toISOString()}`,
    `Lapsed at:      ${request.lapsedAt ? request.lapsedAt.toISOString() : "not stamped"}`,
    `Lapse source:   ${request.lapseSource ?? "unknown"}`,
    `MSP cascade:    ${request.lapseWasMspCascade ? "yes" : "no"}`,
    "",
    `What gated them: ${cause}`,
    "",
    "Their message:",
    request.note ? request.note : "(none — they submitted the request without a message)",
    "",
    "─────────────────────────────────────────────────────────────",
    `Request #${request.id} in retention_reinstatement_requests.`,
    "This request closes ITSELF when the portal genuinely reopens — the subscription",
    "reconciliation resolves it with resolution = 'portal_reopened' the moment billing",
    "resumes, whether that is this customer's own subscription or their MSP's. Do not",
    "mark it resolved by hand; restore the billing and the record follows.",
  ];

  return {
    subject: `Reinstatement request — ${ctx.customerName}${request.lapseWasMspCascade ? ` (MSP cascade: ${ctx.mspName})` : ""}`.slice(0, MAX_SUBJECT),
    description: lines.join("\n"),
  };
}

/** Records why no ticket exists, so a failed notification is never silent. */
async function recordTicketError(requestId: number, message: string): Promise<void> {
  try {
    await db
      .update(retentionReinstatementRequestsTable)
      .set({ ticketError: message.slice(0, 2000), updatedAt: new Date() })
      .where(eq(retentionReinstatementRequestsTable.id, requestId));
  } catch (err) {
    log.error({ err, requestId }, "retention: could not record reinstatement ticket error (non-fatal)");
  }
}

/**
 * Raise the ticket for one newly-created reinstatement request.
 *
 * Called only on the `created` outcome — never on `already_open`. A wall that
 * double-submits is a real thing (`submitReinstatementRequest()` is idempotent for
 * exactly that reason) and it must not produce a second ticket for the same ask.
 *
 * Never throws, and never touches `status`/`resolution`.
 */
export async function raiseReinstatementTicket(
  request: RetentionReinstatementRequest,
): Promise<{ queued: boolean; jobId?: string; reason?: string }> {
  try {
    const ctx = await readTicketContext(request);
    if (!ctx) {
      const reason = "customer or MSP row not found when raising the reinstatement ticket";
      await recordTicketError(request.id, reason);
      log.error({ requestId: request.id, tenantId: request.tenantId }, `retention: ${reason}`);
      return { queued: false, reason };
    }

    // Zoho Desk requires a real contact. Without a resolvable email the drain would fail
    // the job on `requireString(payload, "contactEmail", …)` and retry it to the DLQ —
    // failing here instead keeps the reason on the row where someone will see it.
    if (!ctx.requesterEmail) {
      const reason = "no resolvable contact email for the requesting user — no Desk ticket raised";
      await recordTicketError(request.id, reason);
      log.warn(
        { requestId: request.id, tenantId: request.tenantId, requestedByUserId: request.requestedByUserId },
        `retention: ${reason}`,
      );
      return { queued: false, reason };
    }

    const { subject, description } = composeReinstatementTicketBody(request, ctx);
    const notifyEmails = await resolvePlatformNotifyEmails();

    const result = await enqueueEscalationTicket(
      {
        subject,
        description,
        contactEmail: ctx.requesterEmail,
        contactName: ctx.requesterName ?? ctx.requesterEmail,
        localUserId: request.requestedByUserId ?? undefined,
        notifyEmails,
        notifySubject: `Reinstatement request — ${ctx.customerName}`,
        // The write-back marker. `handleCreateTicketJob()` reads this and stamps the real
        // ticket back onto the request row once Zoho confirms it.
        [REINSTATEMENT_TICKET_PAYLOAD_KEY]: request.id,
      },
      // The platform's Desk, deliberately — NOT `ctx.mspId`. See this module's docblock.
      // `customerId` still carries the real tenant so the job is attributable.
      { mspId: ZOHO_DEFAULT_MSP_ID, customerId: request.tenantId },
    );

    await db
      .update(retentionReinstatementRequestsTable)
      .set({
        ticketJobId: result.jobId,
        ticketEnqueuedAt: new Date(),
        // A previous attempt's error is no longer true once a job is queued.
        ticketError: null,
        updatedAt: new Date(),
      })
      .where(eq(retentionReinstatementRequestsTable.id, request.id));

    log.info(
      {
        requestId: request.id,
        tenantId: request.tenantId,
        mspId: ctx.mspId,
        deskMspId: ZOHO_DEFAULT_MSP_ID,
        jobId: result.jobId,
        notifyEmailCount: notifyEmails.length,
        lapseWasMspCascade: request.lapseWasMspCascade,
      },
      "retention: reinstatement request queued as a Zoho Desk ticket on the platform's own Desk (#2999)",
    );

    return { queued: true, jobId: result.jobId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordTicketError(request.id, reason);
    log.error(
      { err, requestId: request.id, tenantId: request.tenantId },
      "retention: could not queue the reinstatement Desk ticket (non-fatal — the request itself is recorded)",
    );
    return { queued: false, reason };
  }
}

/**
 * The drain's write-back, called from `handleCreateTicketJob()` once Zoho has genuinely
 * created the ticket.
 *
 * Deliberately writes only the ticket identifiers. `status` and `resolution` belong to
 * `resolveOpenReinstatementRequests()` and to nothing else — #2999 point 3: the ticket is
 * a notification surface, not a second source of truth for whether the request is
 * resolved. A ticket being closed in Zoho does not reopen anybody's portal.
 */
export async function recordReinstatementTicketCreated(
  requestId: number,
  ticket: { zohoId?: string | null; ticketNumber?: string | null; webUrl?: string | null },
): Promise<void> {
  try {
    const now = new Date();
    await db
      .update(retentionReinstatementRequestsTable)
      .set({
        ticketZohoId: ticket.zohoId ?? null,
        ticketNumber: ticket.ticketNumber ?? null,
        ticketUrl: ticket.webUrl ?? null,
        ticketCreatedAt: now,
        ticketError: null,
        updatedAt: now,
      })
      .where(eq(retentionReinstatementRequestsTable.id, requestId));

    log.info(
      { requestId, ticketZohoId: ticket.zohoId ?? null, ticketNumber: ticket.ticketNumber ?? null },
      "retention: reinstatement Desk ticket confirmed created and recorded on the request (#2999)",
    );
  } catch (err) {
    log.error(
      { err, requestId },
      "retention: could not record the created reinstatement ticket (non-fatal — the ticket exists in Zoho)",
    );
  }
}
