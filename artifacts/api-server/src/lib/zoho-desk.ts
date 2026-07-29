// Zoho Desk — connected to Support Chat human-escalation (#89).
//
// Builds strictly on the #82 Foundation (`zoho-client.ts`/`zoho-batch-drain.ts`),
// same as CRM (#83) / Projects (#85) / Books (#87). escalateToAdmin() in
// support-chat.ts is the one real caller: when the AI support chat escalates
// to a human (automatic fallthrough or the explicit /msp/support/escalate
// endpoint — both funnel through escalateToAdmin()), the notificationsTable
// row + SSE broadcast are replaced by one queued zoho_desk_create_ticket job.
// The email to Shane/admins is KEPT but repointed: it is deliberately NOT
// sent from the request path. It is sent by this job's handler, after the
// ticket is actually confirmed created, so it can carry the real ticket
// number rather than a dead-end "log in" link — see enqueueEscalationTicket()
// below and its docblock for the full tradeoff.
//
// Zoho Desk puts its organization id on an `orgId` HTTP header on every call
// (confirmed in #89's spec) — unlike Books' organization_id query param or
// Projects' path-prefixed portal id — so every call here passes `headers`
// through zohoFetch/zohoGet rather than a query param.
//
// Endpoints NOT live-verified — no Zoho Desk credentials or configured
// Department in this environment (manual prerequisite, same category as
// CRM's custom Lead fields).

import { db, zohoConnectionTable, usersTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { zohoGet, zohoFetch, ZohoApiError, ZOHO_DEFAULT_MSP_ID, getZohoConnection } from "./zoho-client.ts";
import { registerZohoJobHandler } from "./zoho-batch-drain.ts";
import { enqueueJob } from "./msp-jobs.ts";
import { logger } from "./logger";
import {
  ZOHO_DESK_NODE_TYPES,
  isZohoDeskNodeType,
  getZohoDeskNodeSpec,
  type ZohoDeskEntity,
  type ZohoDeskNodeSpec,
} from "./zoho-desk-nodes.ts";

const log = logger.child({ channel: "integration.zoho" });

export {
  ZOHO_DESK_NODE_TYPES,
  isZohoDeskNodeType,
  getZohoDeskNodeSpec,
  type ZohoDeskEntity,
  type ZohoDeskNodeSpec,
};

const ZOHO_DESK_API_BASE_PATH = "/desk/v1";

// ── Organization id resolution ──────────────────────────────────────────────

interface ZohoDeskOrganizationsResponse {
  data?: Array<{ id?: string | number; companyName?: string }>;
}

/**
 * Returns the cached zoho_connection.zohoDeskOrgId, or resolves it via
 * GET /desk/v1/organizations and caches the first one — single-org-per-MSP by
 * construction, same single-tenant shape zohoBooksOrgId/zohoPortalId assume.
 * Unlike those two, every subsequent Desk call needs this id as an `orgId`
 * HEADER, not a query param — see orgHeader() below.
 */
export async function resolveZohoDeskOrgId(mspId: number = ZOHO_DEFAULT_MSP_ID): Promise<string> {
  const connection = await getZohoConnection(mspId);
  if (connection?.zohoDeskOrgId) return connection.zohoDeskOrgId;

  const body = (await zohoGet(`${ZOHO_DESK_API_BASE_PATH}/organizations`, undefined, mspId)) as ZohoDeskOrganizationsResponse;
  const first = Array.isArray(body.data) ? body.data[0] : undefined;
  if (first?.id == null) {
    throw new Error("Zoho Desk: no organization found for this connection — confirm Zoho Desk is enabled for the account");
  }
  const orgId = String(first.id);

  await db
    .update(zohoConnectionTable)
    .set({ zohoDeskOrgId: orgId, updatedAt: new Date() })
    .where(eq(zohoConnectionTable.mspId, mspId));

  log.info({ mspId, orgId, orgName: first.companyName }, "zoho-desk: resolved and cached organization id");
  return orgId;
}

async function orgHeader(mspId: number | undefined): Promise<Record<string, string>> {
  const orgId = await resolveZohoDeskOrgId(mspId ?? ZOHO_DEFAULT_MSP_ID);
  return { orgId };
}

// ── Contact ──────────────────────────────────────────────────────────────────

interface ZohoDeskContactsResponse {
  data?: Array<{ id?: string | number }>;
}

async function findDeskContactByEmail(email: string, headers: Record<string, string>, mspId?: number): Promise<string | null> {
  const body = (await zohoFetch("GET", `${ZOHO_DESK_API_BASE_PATH}/contacts/search`, {
    query: { email },
    headers,
    mspId,
  })) as ZohoDeskContactsResponse;
  const first = Array.isArray(body.data) ? body.data[0] : undefined;
  return first?.id != null ? String(first.id) : null;
}

/**
 * Splits a display name into Zoho Desk's required first/last name pair.
 * Zoho Desk rejects a Contact create with no lastName — when the given name
 * has no separable last name (single word, or empty), the whole name (or the
 * email as a final fallback) becomes lastName so the create never fails on a
 * missing required field.
 */
export function splitContactName(name: string | undefined, email: string): { firstName?: string; lastName: string } {
  const trimmed = name?.trim();
  if (!trimmed) return { lastName: email };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/**
 * Finds a Zoho Desk Contact by email, or creates one. Writes back
 * users.zohoDeskContactId when userId is given and not already set — a cache
 * to skip the find call next time, not the source of truth (the find-by-email
 * call above is always what actually decides "exists").
 */
async function upsertDeskContact(
  email: string,
  name: string | undefined,
  userId: number | undefined,
  mspId?: number,
): Promise<{ entity: "Contact"; action: "create" | "match"; zohoId: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("zoho_desk_upsert_contact requires a non-empty email");

  const headers = await orgHeader(mspId);

  const existingId = await findDeskContactByEmail(normalizedEmail, headers, mspId);
  let contactId: string;
  let action: "create" | "match";

  if (existingId) {
    contactId = existingId;
    action = "match";
  } else {
    const { firstName, lastName } = splitContactName(name, normalizedEmail);
    const body = (await zohoFetch("POST", `${ZOHO_DESK_API_BASE_PATH}/contacts`, {
      headers,
      body: { email: normalizedEmail, lastName, ...(firstName ? { firstName } : {}) },
      mspId,
    })) as { id?: string | number };
    if (body.id == null) throw new Error("Zoho Desk: contact create returned no id");
    contactId = String(body.id);
    action = "create";
  }

  if (userId) {
    await db
      .update(usersTable)
      .set({ zohoDeskContactId: contactId })
      .where(and(eq(usersTable.id, userId), isNull(usersTable.zohoDeskContactId)))
      .catch((err: unknown) => {
        log.warn({ err, userId }, "zoho-desk: failed to cache zohoDeskContactId on user row (non-fatal)");
      });
  }

  return { entity: "Contact", action, zohoId: contactId };
}

// ── Ticket ───────────────────────────────────────────────────────────────────

interface ZohoDeskTicketResponse {
  id?: string | number;
  ticketNumber?: string | number;
  webUrl?: string;
}

interface CreateTicketInput {
  subject: string;
  description: string;
  departmentId: string;
  contactId: string;
}

async function createDeskTicket(
  input: CreateTicketInput,
  mspId?: number,
): Promise<{ entity: "Ticket"; zohoId: string; ticketNumber: string | null; webUrl: string | null }> {
  const headers = await orgHeader(mspId);

  const body = (await zohoFetch("POST", `${ZOHO_DESK_API_BASE_PATH}/tickets`, {
    headers,
    body: {
      subject: input.subject.slice(0, 250),
      description: input.description,
      departmentId: input.departmentId,
      contactId: input.contactId,
      channel: "Email",
    },
    mspId,
  })) as ZohoDeskTicketResponse;
  if (body.id == null) throw new Error("Zoho Desk: ticket create returned no id");

  return {
    entity: "Ticket",
    zohoId: String(body.id),
    ticketNumber: body.ticketNumber != null ? String(body.ticketNumber) : null,
    // Only ever a real URL Zoho itself returned — never constructed here, since
    // the portal/domain shape needed to build one by hand isn't confirmed.
    webUrl: typeof body.webUrl === "string" ? body.webUrl : null,
  };
}

async function getDeskTicket(ticketId: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const headers = await orgHeader(mspId);
  try {
    const body = await zohoGet(`${ZOHO_DESK_API_BASE_PATH}/tickets/${encodeURIComponent(ticketId)}`, undefined, mspId, headers);
    return body.id != null ? body : null;
  } catch (err) {
    if (err instanceof ZohoApiError && err.status === 404) return null;
    throw err;
  }
}

// ── Comment ──────────────────────────────────────────────────────────────────

async function addDeskComment(
  ticketId: string,
  content: string,
  isPublic: boolean,
  mspId?: number,
): Promise<{ entity: "Comment"; zohoId: string; ticketId: string }> {
  const headers = await orgHeader(mspId);
  const body = (await zohoFetch("POST", `${ZOHO_DESK_API_BASE_PATH}/tickets/${encodeURIComponent(ticketId)}/comments`, {
    headers,
    body: { content, isPublic },
    mspId,
  })) as { id?: string | number };
  if (body.id == null) throw new Error("Zoho Desk: comment create returned no id");
  return { entity: "Comment", zohoId: String(body.id), ticketId };
}

// ── Job-handler registration ─────────────────────────────────────────────────
// One handler per write node type. jobType string === node type string, same
// discipline #83/#85/#87 established — no mapping table to drift.

type WriteHandler = (payload: Record<string, unknown>, mspId: number | undefined) => Promise<Record<string, unknown>>;

function requireString(payload: Record<string, unknown>, key: string, nodeType: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${nodeType} requires a non-empty "${key}"`);
  }
  return value.trim();
}

/**
 * zoho_desk_create_ticket's handler. Resolves (or upserts) the contact inline
 * rather than depending on a separately queued zoho_desk_upsert_contact job
 * having already run first — job execution order within a drain batch is not
 * guaranteed, so this stays self-sufficient, same discipline
 * handleCreateInvoiceJob (zoho-books.ts) established.
 *
 * When the payload carries `notifyEmails` (set by
 * enqueueEscalationTicket() below for the support-chat escalation path only —
 * a generic workflow-authored zoho_desk_create_ticket node has no reason to
 * carry it), an admin-notification email is sent from HERE, after the ticket
 * is confirmed created, carrying the real ticket number/link. This is the
 * "(a)" approach #89's spec recommended over sending a dead-end email
 * immediately from the request path: the tradeoff it accepts is that if this
 * job exhausts its retries and lands in the DLQ, no notification email is
 * ever sent — visible only via the DLQ / error logs, same as every other
 * Zoho write's failure mode.
 */
async function handleCreateTicketJob(payload: Record<string, unknown>, mspId: number | undefined): Promise<Record<string, unknown>> {
  const departmentId =
    (typeof payload.departmentId === "string" && payload.departmentId.trim()) ||
    process.env.ZOHO_DESK_DEFAULT_DEPARTMENT_ID;
  if (!departmentId) {
    throw new Error("zoho_desk_create_ticket requires a departmentId (or ZOHO_DESK_DEFAULT_DEPARTMENT_ID to be configured) — confirm Shane has a Department set up in Zoho Desk");
  }

  const contactEmail = requireString(payload, "contactEmail", "zoho_desk_create_ticket");
  const contactName = typeof payload.contactName === "string" ? payload.contactName : undefined;
  const localUserId = Number.isFinite(Number(payload.localUserId)) ? Number(payload.localUserId) : undefined;

  const contact = await upsertDeskContact(contactEmail, contactName, localUserId, mspId);

  const ticket = await createDeskTicket(
    {
      subject: requireString(payload, "subject", "zoho_desk_create_ticket"),
      description: requireString(payload, "description", "zoho_desk_create_ticket"),
      departmentId,
      contactId: contact.zohoId,
    },
    mspId,
  );

  const notifyEmails = Array.isArray(payload.notifyEmails)
    ? payload.notifyEmails.filter((e): e is string => typeof e === "string" && e.length > 0)
    : [];

  if (notifyEmails.length > 0) {
    const notifySubject = typeof payload.notifySubject === "string" && payload.notifySubject ? payload.notifySubject : "Support escalation";
    const ticketRef = ticket.ticketNumber ? `ticket #${ticket.ticketNumber}` : `ticket ${ticket.zohoId}`;
    const linkLine = ticket.webUrl
      ? `<p><a href="${ticket.webUrl}">Open ${ticketRef} in Zoho Desk</a></p>`
      : `<p>Open Zoho Desk and look up ${ticketRef} to respond.</p>`;
    const html = `<p>${notifySubject}</p><p>A Zoho Desk ticket was created for this escalation.</p>${linkLine}`;

    const { sendEmail } = await import("./mailer.ts");
    for (const to of notifyEmails) {
      void sendEmail(to, notifySubject, html, { templateName: "support-escalation" });
    }
  }

  return { contact, ticket };
}

const WRITE_HANDLERS: Record<string, WriteHandler> = {
  zoho_desk_upsert_contact: (p, msp) =>
    upsertDeskContact(
      requireString(p, "email", "zoho_desk_upsert_contact"),
      typeof p.name === "string" ? p.name : undefined,
      Number.isFinite(Number(p.localUserId)) ? Number(p.localUserId) : undefined,
      msp,
    ),

  zoho_desk_create_ticket: (p, msp) => handleCreateTicketJob(p, msp),

  zoho_desk_add_comment: (p, msp) =>
    addDeskComment(
      requireString(p, "ticketId", "zoho_desk_add_comment"),
      requireString(p, "content", "zoho_desk_add_comment"),
      Boolean(p.isPublic),
      msp,
    ),
};

let handlersRegistered = false;

/** Registers every write node's handler on the Foundation's drain. Idempotent. */
export function registerZohoDeskJobHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  for (const [jobType, handler] of Object.entries(WRITE_HANDLERS)) {
    registerZohoJobHandler(jobType, async (job) => {
      const mspId = job.mspId ?? undefined;
      try {
        const result = await handler(job.payload, mspId);
        log.info({ jobId: job.jobId, jobType, attempt: job.attemptCount, result }, "zoho-desk: write applied");
        return result;
      } catch (err) {
        if (err instanceof ZohoApiError) {
          throw new Error(`${jobType} failed (HTTP ${err.status}): ${JSON.stringify(err.body)}`);
        }
        throw err;
      }
    });
  }

  log.info({ count: Object.keys(WRITE_HANDLERS).length }, "zoho-desk: registered write job handlers");
}

// ── Enqueue side (what routes call — the ONLY way a Zoho Desk write happens) ─

export interface EnqueueZohoDeskWriteOptions {
  mspId?: number;
  customerId?: number;
  correlationId?: string;
}

export async function enqueueZohoDeskWrite(
  nodeType: string,
  payload: Record<string, unknown>,
  opts: EnqueueZohoDeskWriteOptions = {},
): Promise<{ queued: true; jobId: string; jobType: string }> {
  if (!WRITE_HANDLERS[nodeType]) {
    throw new Error(`Unknown Zoho Desk write node type: ${nodeType}`);
  }
  const jobId = await enqueueJob(nodeType, payload, {
    mspId: opts.mspId,
    customerId: opts.customerId,
    correlationId: opts.correlationId,
  });
  log.info({ jobId, jobType: nodeType }, "zoho-desk: write queued for next drain");
  return { queued: true, jobId, jobType: nodeType };
}

/**
 * Support Chat escalation's sole entry point (support-chat.ts's
 * escalateToAdmin()). Queues one zoho_desk_create_ticket job carrying
 * `notifyEmails`/`notifySubject`, which handleCreateTicketJob above reads to
 * send the admin-notification email itself once the ticket is confirmed
 * created — see that function's docblock for why the email is sent from the
 * job, not from this request-path call.
 */
export interface EnqueueEscalationTicketInput {
  subject: string;
  description: string;
  contactEmail: string;
  contactName?: string;
  localUserId?: number;
  notifyEmails: string[];
  notifySubject: string;
}

export async function enqueueEscalationTicket(
  input: EnqueueEscalationTicketInput,
  opts: EnqueueZohoDeskWriteOptions = {},
): Promise<{ queued: true; jobId: string; jobType: string }> {
  return enqueueZohoDeskWrite("zoho_desk_create_ticket", { ...input }, opts);
}

// ── Executor entry point ─────────────────────────────────────────────────────

export async function executeZohoDeskNode(
  nodeType: string,
  data: Record<string, unknown>,
  resolve: (value: unknown) => string | undefined,
): Promise<Record<string, unknown>> {
  const spec = getZohoDeskNodeSpec(nodeType);
  if (!spec) throw new Error(`Not a Zoho Desk node type: ${nodeType}`);

  const mspIdRaw = Number(resolve(data.mspId) ?? data.mspId);
  const mspId = Number.isFinite(mspIdRaw) && mspIdRaw > 0 ? mspIdRaw : undefined;

  if (spec.mode === "read") {
    // Only zoho_desk_get_ticket today.
    const ticketId = resolve(data.ticketId ?? data.zohoTicketId);
    if (!ticketId) return { error: `${nodeType} requires ticketId`, found: false };
    const record = await getDeskTicket(ticketId, mspId);
    return { found: Boolean(record), record: record ?? null, entity: "Ticket" };
  }

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      payload[key] = resolve(value) ?? value;
    } else {
      payload[key] = value;
    }
  }

  const queued = await enqueueZohoDeskWrite(nodeType, payload, { mspId });
  return { ...queued, entity: spec.entity, note: "queued — applied by the next Zoho Queue Drain (runs every 5 minutes)" };
}

// Register on import so the drain has handlers regardless of which entry
// point pulls this module in first — same discipline #83/#85/#87 use.
registerZohoDeskJobHandlers();
