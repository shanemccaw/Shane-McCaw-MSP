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
// #1162 (2026-08-18): live-tested by Shane for the first time end-to-end and
// found every call 404ing. Root cause: this file assumed Desk sat on the same
// www.zohoapis.com/desk/v1 gateway CRM/Books/Projects use. It doesn't — Desk's
// real API root is desk.zoho.com/api/v1 (see ZOHO_DESK_API_HOST below).

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

// Unlike CRM/Books/Projects, Zoho Desk does NOT route through the unified
// www.zohoapis.com gateway — its real API root is desk.zoho.com/api/v1 (or a
// regional variant, e.g. desk.zoho.eu for EU-based orgs). Confirmed against
// Zoho's own Desk API docs after #1162's live 404s traced back to this file
// having assumed the zohoapis.com/desk/v1 shape every other product uses.
const ZOHO_DESK_API_HOST = process.env.ZOHO_DESK_API_BASE_URL ?? "https://desk.zoho.com";
const ZOHO_DESK_API_BASE_PATH = "/api/v1";

// ── Organization id resolution ──────────────────────────────────────────────

interface ZohoDeskOrganizationsResponse {
  data?: Array<{ id?: string | number; companyName?: string }>;
}

/**
 * Returns the cached zoho_connection.zohoDeskOrgId, or resolves it via
 * GET /api/v1/organizations and caches the first one — single-org-per-MSP by
 * construction, same single-tenant shape zohoBooksOrgId/zohoPortalId assume.
 * Unlike those two, every subsequent Desk call needs this id as an `orgId`
 * HEADER, not a query param — see orgHeader() below.
 */
export async function resolveZohoDeskOrgId(mspId: number = ZOHO_DEFAULT_MSP_ID): Promise<string> {
  const connection = await getZohoConnection(mspId);
  if (connection?.zohoDeskOrgId) return connection.zohoDeskOrgId;

  const body = (await zohoGet(`${ZOHO_DESK_API_BASE_PATH}/organizations`, undefined, mspId, undefined, ZOHO_DESK_API_HOST)) as ZohoDeskOrganizationsResponse;
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
    baseUrl: ZOHO_DESK_API_HOST,
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
      baseUrl: ZOHO_DESK_API_HOST,
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
    baseUrl: ZOHO_DESK_API_HOST,
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

// ── Sign-in Help ticket (Git #1349) ───────────────────────────────────────────
// ShaneBot on the public /login/help page raises a real Zoho Desk ticket for a
// customer who is locked out. Unlike every other write in this file (which is
// queued and applied by the 5-minute drain — see enqueueZohoDeskWrite's docblock
// calling that "the ONLY way a Zoho Desk write happens"), this one is
// DELIBERATELY synchronous: ShaneBot must hand the user a real ticket reference
// on the spot, and a job that lands minutes later can't do that. It reuses the
// same upsertDeskContact + createDeskTicket primitives every other path uses —
// it is not a parallel Zoho client, just the one synchronous exception, so the
// reference the user sees is a real Zoho ticket number, never fabricated.

export interface SignInHelpTicketInput {
  /** The email the customer typed — the account they're locked out of. */
  email: string;
  /** The picked issue's exact human label (from the fixed 4-issue catalog). */
  issueLabel: string;
  /** Priority tag for the picked issue, e.g. "P2". */
  priority: string;
  /** Routing/SLA note for the picked issue. */
  routingNote: string;
  /**
   * Pre-composed, real sign-in context to attach to the ticket body — the
   * caller (portal-sign-in-help.ts) builds this from the account's genuine
   * recent successful sign-ins and current lockout state, or an honest note
   * that no matching account/history exists. Never fabricated here.
   */
  signInContext: string;
}

export interface SignInHelpTicketResult {
  /** The real Zoho Desk ticket number (e.g. "SM-41234"), or the zoho id if Zoho returned no number. */
  reference: string;
  zohoId: string;
  priority: string;
  routingNote: string;
  email: string;
  webUrl: string | null;
}

export async function raiseSignInHelpTicket(
  input: SignInHelpTicketInput,
  mspId?: number,
): Promise<SignInHelpTicketResult> {
  const departmentId = process.env.ZOHO_DESK_DEFAULT_DEPARTMENT_ID;
  if (!departmentId) {
    throw new Error(
      "Sign-in help ticket requires ZOHO_DESK_DEFAULT_DEPARTMENT_ID to be configured — confirm Shane has a Department set up in Zoho Desk",
    );
  }

  const email = input.email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) {
    throw new Error("Sign-in help ticket requires a valid account email");
  }

  // Upsert the Desk contact for this email so the ticket threads under the real
  // person, same as the queued escalation path (handleCreateTicketJob) does.
  const contact = await upsertDeskContact(email, undefined, undefined, mspId);

  const description = [
    "A customer raised a sign-in help request through ShaneBot on the /login/help page.",
    "",
    `Issue: ${input.issueLabel}`,
    `Priority: ${input.priority}`,
    `Routing note: ${input.routingNote}`,
    `Account email: ${email}`,
    "",
    input.signInContext,
  ].join("\n");

  const ticket = await createDeskTicket(
    {
      subject: `Sign-in help: ${input.issueLabel}`,
      description,
      departmentId,
      contactId: contact.zohoId,
    },
    mspId,
  );

  log.info(
    { zohoId: ticket.zohoId, ticketNumber: ticket.ticketNumber, priority: input.priority },
    "zoho-desk: sign-in help ticket raised synchronously (Git #1349)",
  );

  return {
    reference: ticket.ticketNumber ?? ticket.zohoId,
    zohoId: ticket.zohoId,
    priority: input.priority,
    routingNote: input.routingNote,
    email,
    webUrl: ticket.webUrl,
  };
}

async function getDeskTicket(ticketId: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const headers = await orgHeader(mspId);
  try {
    const body = await zohoGet(`${ZOHO_DESK_API_BASE_PATH}/tickets/${encodeURIComponent(ticketId)}`, undefined, mspId, headers, ZOHO_DESK_API_HOST);
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
    baseUrl: ZOHO_DESK_API_HOST,
  })) as { id?: string | number };
  if (body.id == null) throw new Error("Zoho Desk: comment create returned no id");
  return { entity: "Comment", zohoId: String(body.id), ticketId };
}

// ── Customer-facing reads (Git #1158) ─────────────────────────────────────────
// Powers the portal's in-portal ticket thread view. Unlike the write side
// (queued + drained every 5 min), these are synchronous per-request GETs: a
// customer opening "My Requests" needs the current ticket state now, not on the
// next drain. Every read here is scoped to the caller's own Zoho Desk Contact
// (resolved from their authenticated email) — the route layer enforces that a
// customer can only ever see a ticket whose `contactId` is their own, so one
// customer can never read another's ticket by guessing an id.

function toStr(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export interface CustomerTicketSummary {
  id: string;
  ticketNumber: string | null;
  subject: string;
  status: string | null; // Zoho's free-text status, e.g. "Open", "Closed"
  statusType: string | null; // Zoho's coarse bucket: Open | On Hold | Escalated | Closed
  createdTime: string | null;
  modifiedTime: string | null;
  webUrl: string | null;
}

export interface CustomerTicketThreadEntry {
  id: string;
  kind: "thread" | "comment";
  // For threads: "in" = from the customer, "out" = a reply from support.
  // Comments have no direction (they are agent-authored notes made public).
  direction: "in" | "out" | null;
  author: string | null;
  isPublic: boolean;
  content: string;
  createdTime: string | null;
}

function mapTicketSummary(raw: Record<string, unknown>): CustomerTicketSummary {
  return {
    id: String(raw.id),
    ticketNumber: toStr(raw.ticketNumber),
    subject: toStr(raw.subject) ?? "(no subject)",
    status: toStr(raw.status),
    statusType: toStr(raw.statusType),
    createdTime: toStr(raw.createdTime),
    modifiedTime: toStr(raw.modifiedTime),
    webUrl: toStr(raw.webUrl),
  };
}

/**
 * Resolves the caller's Zoho Desk Contact id from their email, or null when no
 * Contact exists yet (a customer who has never opened a request). Returns null
 * rather than throwing on "not found" so the list view can render an empty
 * state instead of an error.
 */
export async function resolveDeskContactIdForEmail(email: string, mspId?: number): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const headers = await orgHeader(mspId);
  return findDeskContactByEmail(normalizedEmail, headers, mspId);
}

/**
 * Lists the tickets belonging to one Zoho Desk Contact, newest-modified first.
 * `GET /api/v1/contacts/{contactId}/tickets`. Returns [] when the contact has
 * no tickets. Caller is responsible for having resolved contactId from the
 * authenticated customer's own email — this function trusts the contactId it
 * is given.
 */
export async function listDeskTicketsForContact(contactId: string, mspId?: number): Promise<CustomerTicketSummary[]> {
  const headers = await orgHeader(mspId);
  const body = (await zohoGet(
    `${ZOHO_DESK_API_BASE_PATH}/contacts/${encodeURIComponent(contactId)}/tickets`,
    { limit: 100, sortBy: "-modifiedTime" },
    mspId,
    headers,
    ZOHO_DESK_API_HOST,
  )) as { data?: Array<Record<string, unknown>> };
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.filter((r) => r.id != null).map(mapTicketSummary);
}

// ── MSP-operator reads (Git #2672, part of #2570) ───────────────────────────
// Powers the MSP Console's operator-side view of the exact same tickets the
// portal-customer-requests.ts routes above serve to customers, plus every
// escalateToAdmin()-queued chat escalation (support-chat.ts) — both write
// through the identical zoho_desk_create_ticket job into the SAME department,
// so there is no separate "escalations" store to query; the operator's
// request list IS the escalation queue. Unlike the customer-scoped reads
// above, these are NOT scoped to one Contact — they read every ticket under
// the caller's MSP's own Zoho Desk org (the org/department the caller's
// mspId resolves to via orgHeader()), which is the real ownership boundary
// here: a ticket id from a different MSP's Zoho org simply doesn't exist when
// queried through this MSP's own org header, so cross-MSP access 404s
// naturally rather than needing a separate ownership column check.

export interface ListDeskTicketsForOrgResult {
  tickets: CustomerTicketSummary[];
  count: number;
}

/**
 * Lists every ticket under the caller's MSP's Zoho Desk org (optionally
 * scoped to `ZOHO_DESK_DEFAULT_DEPARTMENT_ID` when one is configured, same
 * department every write in this file targets), newest-modified first.
 * `GET /api/v1/tickets`.
 */
export async function listDeskTicketsForOrg(
  mspId: number | undefined,
  opts: { limit?: number; offset?: number } = {},
): Promise<ListDeskTicketsForOrgResult> {
  const headers = await orgHeader(mspId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const query: Record<string, string | number> = { limit, from: offset, sortBy: "-modifiedTime" };
  const departmentId = process.env.ZOHO_DESK_DEFAULT_DEPARTMENT_ID;
  if (departmentId) query.departmentId = departmentId;

  const body = (await zohoGet(`${ZOHO_DESK_API_BASE_PATH}/tickets`, query, mspId, headers, ZOHO_DESK_API_HOST)) as {
    data?: Array<Record<string, unknown>>;
    count?: number;
  };
  const rows = Array.isArray(body.data) ? body.data : [];
  return {
    tickets: rows.filter((r) => r.id != null).map(mapTicketSummary),
    count: typeof body.count === "number" ? body.count : rows.length,
  };
}

/**
 * Fetches one ticket by id, scoped to the caller's MSP's own Zoho org — no
 * Contact ownership check (operators can see every ticket in their org).
 * Returns null when the ticket doesn't exist in this org (also naturally
 * covers "exists in a different MSP's org").
 */
export async function getDeskTicketById(ticketId: string, mspId?: number): Promise<CustomerTicketSummary | null> {
  const record = await getDeskTicket(ticketId, mspId);
  return record ? mapTicketSummary(record) : null;
}

/**
 * Same conversation timeline as getDeskTicketThread(), but WITHOUT filtering
 * out private agent notes — an operator is allowed to see the internal notes
 * a customer never should. Ownership (this MSP's own org) is enforced the
 * same way as getDeskTicketById() above: call that first and 404 on null.
 */
export async function getDeskTicketThreadForOperator(ticketId: string, mspId?: number): Promise<CustomerTicketThreadEntry[]> {
  const headers = await orgHeader(mspId);
  const body = (await zohoGet(
    `${ZOHO_DESK_API_BASE_PATH}/tickets/${encodeURIComponent(ticketId)}/conversations`,
    undefined,
    mspId,
    headers,
    ZOHO_DESK_API_HOST,
  )) as { data?: Array<Record<string, unknown>> };
  const rows = Array.isArray(body.data) ? body.data : [];

  const entries: CustomerTicketThreadEntry[] = [];
  for (const raw of rows) {
    if (raw.id == null) continue;
    const isComment = raw.type === "comment" || raw.commenter != null || raw.commentType != null;
    const directionRaw = toStr(raw.direction)?.toLowerCase();
    const direction = directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
    const isPublic = isComment ? raw.isPublic === true : true;
    const content = toStr(raw.summary) ?? toStr(raw.content) ?? toStr(raw.plainText) ?? "";
    const author =
      toStr((raw.author as Record<string, unknown> | undefined)?.name) ??
      toStr((raw.commenter as Record<string, unknown> | undefined)?.name) ??
      toStr(raw.fromEmailAddress) ??
      null;
    entries.push({
      id: String(raw.id),
      kind: isComment ? "comment" : "thread",
      direction,
      author,
      isPublic,
      content,
      createdTime: toStr(raw.createdTime) ?? toStr(raw.commentedTime),
    });
  }
  entries.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));
  return entries;
}

/**
 * Fetches one ticket ONLY if it belongs to the given contact. Returns:
 *   - the summary when the ticket exists and its contactId matches,
 *   - "foreign" when the ticket exists but belongs to a different contact,
 *   - "missing" when the ticket doesn't exist.
 * The route maps both "foreign" and "missing" to a 404 so ownership can't be
 * probed by id.
 */
export async function getDeskTicketForContact(
  ticketId: string,
  contactId: string,
  mspId?: number,
): Promise<{ ownership: "owned"; ticket: CustomerTicketSummary } | { ownership: "foreign" | "missing" }> {
  const record = await getDeskTicket(ticketId, mspId);
  if (!record) return { ownership: "missing" };
  const ticketContactId = toStr(record.contactId);
  if (!ticketContactId || ticketContactId !== contactId) return { ownership: "foreign" };
  return { ownership: "owned", ticket: mapTicketSummary(record) };
}

/**
 * Returns a ticket's conversation timeline (threads + public comments) oldest
 * first. `GET /api/v1/tickets/{id}/conversations`. Ownership is NOT checked
 * here — call getDeskTicketForContact() first and only call this once ownership
 * is confirmed.
 */
export async function getDeskTicketThread(ticketId: string, mspId?: number): Promise<CustomerTicketThreadEntry[]> {
  const headers = await orgHeader(mspId);
  const body = (await zohoGet(
    `${ZOHO_DESK_API_BASE_PATH}/tickets/${encodeURIComponent(ticketId)}/conversations`,
    undefined,
    mspId,
    headers,
    ZOHO_DESK_API_HOST,
  )) as { data?: Array<Record<string, unknown>> };
  const rows = Array.isArray(body.data) ? body.data : [];

  const entries: CustomerTicketThreadEntry[] = [];
  for (const raw of rows) {
    if (raw.id == null) continue;
    const isComment = raw.type === "comment" || raw.commenter != null || raw.commentType != null;
    const directionRaw = toStr(raw.direction)?.toLowerCase();
    const direction = directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
    // Only surface public comments to the customer — private agent notes stay hidden.
    const isPublic = isComment ? raw.isPublic === true : true;
    if (isComment && !isPublic) continue;
    const content =
      toStr(raw.summary) ?? toStr(raw.content) ?? toStr(raw.plainText) ?? "";
    const author =
      toStr((raw.author as Record<string, unknown> | undefined)?.name) ??
      toStr((raw.commenter as Record<string, unknown> | undefined)?.name) ??
      toStr(raw.fromEmailAddress) ??
      null;
    entries.push({
      id: String(raw.id),
      kind: isComment ? "comment" : "thread",
      direction,
      author,
      isPublic,
      content,
      createdTime: toStr(raw.createdTime) ?? toStr(raw.commentedTime),
    });
  }
  entries.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));
  return entries;
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
 * Push-only signal for the public-chat escalation path (#726, part of #719).
 * admin-public-chat.ts has no per-conversation deep-link route — its review
 * queue (admin-panel's `ChatQueue.tsx`, mounted at `/pipeline/chat-queue` via
 * PipelineWorkspace) is list-only, same as every other pipeline workspace
 * page since the old per-id detail pages (e.g. `/crm/leads/:id`) were
 * deleted. This is the closest existing admin route, not a per-conversation
 * link — Shane finds the specific flagged conversation from the queue list.
 */
const PUBLIC_CHAT_REVIEW_LINK_PATH = "/pipeline/chat-queue";

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
 *
 * `pushNotify: true` (set by enqueueEscalationTicket() for the public-chat
 * escalation path only, #726/#719 — support-chat's call never sets it) fires
 * a web-push notification instead, from this same "after the ticket is
 * confirmed created" point, for the same reason: a real ticket reference
 * beats a dead-end pointer. Public chat is deliberately push-only, never
 * emailed — see public-chat.ts's own docblock.
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
  const pushNotify = payload.pushNotify === true;

  if (notifyEmails.length > 0 || pushNotify) {
    const notifySubject = typeof payload.notifySubject === "string" && payload.notifySubject ? payload.notifySubject : "Support escalation";
    const ticketRef = ticket.ticketNumber ? `ticket #${ticket.ticketNumber}` : `ticket ${ticket.zohoId}`;

    if (notifyEmails.length > 0) {
      const linkLine = ticket.webUrl
        ? `<p><a href="${ticket.webUrl}">Open ${ticketRef} in Zoho Desk</a></p>`
        : `<p>Open Zoho Desk and look up ${ticketRef} to respond.</p>`;
      const html = `<p>${notifySubject}</p><p>A Zoho Desk ticket was created for this escalation.</p>${linkLine}`;

      const { sendEmail } = await import("./mailer.ts");
      for (const to of notifyEmails) {
        void sendEmail(to, notifySubject, html, { templateName: "support-escalation" });
      }
    }

    if (pushNotify) {
      const { sendWebPushToAdmins } = await import("./web-push.ts");
      void sendWebPushToAdmins({
        title: "New chat escalation",
        body: `${notifySubject} — ${ticketRef}`,
        linkPath: PUBLIC_CHAT_REVIEW_LINK_PATH,
      });
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
 * Support Chat escalation's entry point (support-chat.ts's
 * escalateToAdmin()) AND Public Chat escalation's entry point
 * (public-chat.ts, #726/#719). Queues one zoho_desk_create_ticket job
 * carrying `notifyEmails`/`notifySubject`, which handleCreateTicketJob above
 * reads to send the admin-notification email itself once the ticket is
 * confirmed created — see that function's docblock for why the email is sent
 * from the job, not from this request-path call. `pushNotify` is the same
 * pattern for a web-push instead of an email — support-chat.ts never sets it
 * (it stays email-only); public-chat.ts sets it with an empty `notifyEmails`
 * (push-only, never emailed).
 */
export interface EnqueueEscalationTicketInput {
  subject: string;
  description: string;
  contactEmail: string;
  contactName?: string;
  localUserId?: number;
  notifyEmails: string[];
  notifySubject: string;
  pushNotify?: boolean;
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
