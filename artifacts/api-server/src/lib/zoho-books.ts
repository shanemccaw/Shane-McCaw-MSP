// Zoho Books — invisible outbound revenue + AI-cost-expense sync (#87).
//
// Builds strictly on the #82 Foundation (`zoho-client.ts`, `zoho-batch-drain.ts`)
// same as CRM (#83) and Projects (#85). Nothing here reimplements a read; there
// ARE no read nodes in this phase — per the issue's explicit scope this is
// one-way outbound sync of financial facts, never read back into the platform,
// and there is no in-platform UI anywhere for it.
//
// Every write node enqueues an msp_job_queue row and returns
// { queued: true, jobId } — the actual Zoho Books write happens on the next
// zoho_batch_drain (5 minutes), same as CRM/Projects. No delete, no
// update-after-creation nodes: Zoho Books is the accounting system of record,
// corrections happen manually in Zoho.
//
// Zoho Books puts organization_id on the query string of every call
// (including writes), unlike Zoho Projects' path-prefixed portal id — so
// writes below go through zohoFetch directly rather than zohoPost, which only
// carries a body.
//
// Endpoints NOT live-verified — no ZOHO credentials in this environment, same
// caveat #83/#85 shipped under.

import { db, zohoConnectionTable, usersTable, invoicesTable, aiUsageEventsTable } from "@workspace/db";
import { eq, and, isNull, gte, lt } from "drizzle-orm";
import { zohoGet, zohoFetch, ZohoApiError, ZOHO_DEFAULT_MSP_ID, getZohoConnection } from "./zoho-client.ts";
import { registerZohoJobHandler } from "./zoho-batch-drain.ts";
import { enqueueJob } from "./msp-jobs.ts";
import { logger } from "./logger";
import { bucketStartMs, nextBucketStartMs, bucketKeyOf, bucketTimeSeries } from "./ai-billing-analytics.ts";
import {
  ZOHO_BOOKS_NODE_TYPES,
  isZohoBooksNodeType,
  getZohoBooksNodeSpec,
  type ZohoBooksEntity,
  type ZohoBooksNodeSpec,
} from "./zoho-books-nodes.ts";

const log = logger.child({ channel: "integration.zoho" });

export {
  ZOHO_BOOKS_NODE_TYPES,
  isZohoBooksNodeType,
  getZohoBooksNodeSpec,
  type ZohoBooksEntity,
  type ZohoBooksNodeSpec,
};

const ZOHO_BOOKS_API_BASE_PATH = "/books/v3";

// ── Organization id resolution ──────────────────────────────────────────────

interface ZohoBooksOrganizationsResponse {
  organizations?: Array<{ organization_id?: string; name?: string }>;
}

/**
 * Returns the cached zoho_connection.zohoBooksOrgId, or resolves it via
 * GET /books/v3/organizations (the account's accessible orgs) and caches the
 * first one — single-org-per-MSP by construction, same single-tenant shape
 * zohoPortalId already assumes for Zoho Projects.
 */
export async function resolveZohoBooksOrgId(mspId: number = ZOHO_DEFAULT_MSP_ID): Promise<string> {
  const connection = await getZohoConnection(mspId);
  if (connection?.zohoBooksOrgId) return connection.zohoBooksOrgId;

  const body = (await zohoGet(`${ZOHO_BOOKS_API_BASE_PATH}/organizations`, undefined, mspId)) as ZohoBooksOrganizationsResponse;
  const first = Array.isArray(body.organizations) ? body.organizations[0] : undefined;
  if (!first?.organization_id) {
    throw new Error("Zoho Books: no organization found for this connection — confirm Zoho Books is enabled for the account");
  }
  const orgId = first.organization_id;

  await db
    .update(zohoConnectionTable)
    .set({ zohoBooksOrgId: orgId, updatedAt: new Date() })
    .where(eq(zohoConnectionTable.mspId, mspId));

  log.info({ mspId, orgId, orgName: first.name }, "zoho-books: resolved and cached organization id");
  return orgId;
}

// ── Contact ──────────────────────────────────────────────────────────────────

interface ZohoBooksContactsResponse {
  contacts?: Array<{ contact_id?: string | number }>;
}

async function findBooksContactByEmail(email: string, orgId: string, mspId?: number): Promise<string | null> {
  const body = (await zohoGet(`${ZOHO_BOOKS_API_BASE_PATH}/contacts`, { email, organization_id: orgId }, mspId)) as ZohoBooksContactsResponse;
  const first = Array.isArray(body.contacts) ? body.contacts[0] : undefined;
  return first?.contact_id != null ? String(first.contact_id) : null;
}

/**
 * Finds a Zoho Books Contact by email, or creates one. Writes back
 * users.zohoBooksContactId when userId is given and not already set — a cache
 * to skip the find call next time, not the source of truth (the find-by-email
 * call above is always what actually decides "exists").
 */
async function upsertBooksContact(
  email: string,
  name: string | undefined,
  userId: number | undefined,
  mspId?: number,
): Promise<{ entity: "Contact"; action: "create" | "match"; zohoId: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("zoho_books_upsert_contact requires a non-empty email");

  const orgId = await resolveZohoBooksOrgId(mspId);

  const existingId = await findBooksContactByEmail(normalizedEmail, orgId, mspId);
  let contactId: string;
  let action: "create" | "match";

  if (existingId) {
    contactId = existingId;
    action = "match";
  } else {
    const body = (await zohoFetch("POST", `${ZOHO_BOOKS_API_BASE_PATH}/contacts`, {
      query: { organization_id: orgId },
      body: { contact_name: name?.trim() || normalizedEmail, email: normalizedEmail },
      mspId,
    })) as { contact?: { contact_id?: string | number } };
    if (!body.contact?.contact_id) throw new Error("Zoho Books: contact create returned no contact_id");
    contactId = String(body.contact.contact_id);
    action = "create";
  }

  if (userId) {
    await db
      .update(usersTable)
      .set({ zohoBooksContactId: contactId })
      .where(and(eq(usersTable.id, userId), isNull(usersTable.zohoBooksContactId)))
      .catch((err: unknown) => {
        log.warn({ err, userId }, "zoho-books: failed to cache zohoBooksContactId on user row (non-fatal)");
      });
  }

  return { entity: "Contact", action, zohoId: contactId };
}

// ── Invoice ──────────────────────────────────────────────────────────────────

interface ZohoBooksInvoicesResponse {
  invoices?: Array<{ invoice_id?: string | number }>;
}

/** True idempotency guard: Zoho itself is asked whether this reference_number already has an invoice. */
async function findBooksInvoiceByReference(referenceNumber: string, orgId: string, mspId?: number): Promise<string | null> {
  const body = (await zohoGet(
    `${ZOHO_BOOKS_API_BASE_PATH}/invoices`,
    { reference_number: referenceNumber, organization_id: orgId },
    mspId,
  )) as ZohoBooksInvoicesResponse;
  const first = Array.isArray(body.invoices) ? body.invoices[0] : undefined;
  return first?.invoice_id != null ? String(first.invoice_id) : null;
}

/**
 * Read-side lookup of an invoice by its reference number, resolving the org id
 * first. Deliberately reuses the exact same findBooksInvoiceByReference query
 * that createBooksInvoice's idempotency guard already relies on rather than
 * duplicating it — Git #881's zohoTests invoice-lookup admin route
 * (GET /zoho/books/invoices/lookup/by-reference) is the only reader, and it
 * must ask Zoho the identical question the write path asks. Returns the Zoho
 * invoice_id when one exists for this reference, or null when none does.
 */
export async function lookupBooksInvoiceByReference(
  referenceNumber: string,
  mspId: number = ZOHO_DEFAULT_MSP_ID,
): Promise<string | null> {
  const orgId = await resolveZohoBooksOrgId(mspId);
  return findBooksInvoiceByReference(referenceNumber, orgId, mspId);
}

interface CreateInvoiceInput {
  referenceNumber: string;
  contactId: string;
  amount: number;
  description: string;
  invoiceDate: string;
}

async function createBooksInvoice(
  input: CreateInvoiceInput,
  mspId?: number,
): Promise<{ entity: "Invoice"; action: "create" | "match"; zohoId: string }> {
  const orgId = await resolveZohoBooksOrgId(mspId);

  const existingId = await findBooksInvoiceByReference(input.referenceNumber, orgId, mspId);
  if (existingId) {
    log.info({ referenceNumber: input.referenceNumber, zohoId: existingId }, "zoho-books: invoice already synced for this reference — skipping create");
    return { entity: "Invoice", action: "match", zohoId: existingId };
  }

  const body = (await zohoFetch("POST", `${ZOHO_BOOKS_API_BASE_PATH}/invoices`, {
    query: { organization_id: orgId },
    body: {
      customer_id: input.contactId,
      reference_number: input.referenceNumber,
      date: input.invoiceDate,
      line_items: [{ name: input.description.slice(0, 200), rate: input.amount, quantity: 1 }],
    },
    mspId,
  })) as { invoice?: { invoice_id?: string | number } };
  if (!body.invoice?.invoice_id) throw new Error("Zoho Books: invoice create returned no invoice_id");

  return { entity: "Invoice", action: "create", zohoId: String(body.invoice.invoice_id) };
}

// ── Payment ──────────────────────────────────────────────────────────────────

interface ZohoBooksPaymentsResponse {
  customerpayments?: Array<{ payment_id?: string | number }>;
}

async function findBooksPaymentByReference(referenceNumber: string, orgId: string, mspId?: number): Promise<string | null> {
  const body = (await zohoGet(
    `${ZOHO_BOOKS_API_BASE_PATH}/customerpayments`,
    { reference_number: referenceNumber, organization_id: orgId },
    mspId,
  )) as ZohoBooksPaymentsResponse;
  const first = Array.isArray(body.customerpayments) ? body.customerpayments[0] : undefined;
  return first?.payment_id != null ? String(first.payment_id) : null;
}

interface RecordPaymentInput {
  referenceNumber: string;
  contactId: string;
  invoiceId: string;
  amount: number;
  paymentDate: string;
}

async function recordBooksPayment(
  input: RecordPaymentInput,
  mspId?: number,
): Promise<{ entity: "Payment"; action: "create" | "match"; zohoId: string }> {
  const orgId = await resolveZohoBooksOrgId(mspId);

  const existingId = await findBooksPaymentByReference(input.referenceNumber, orgId, mspId);
  if (existingId) {
    log.info({ referenceNumber: input.referenceNumber, zohoId: existingId }, "zoho-books: payment already synced for this reference — skipping create");
    return { entity: "Payment", action: "match", zohoId: existingId };
  }

  const body = (await zohoFetch("POST", `${ZOHO_BOOKS_API_BASE_PATH}/customerpayments`, {
    query: { organization_id: orgId },
    body: {
      customer_id: input.contactId,
      payment_mode: "stripe",
      amount: input.amount,
      date: input.paymentDate,
      reference_number: input.referenceNumber,
      invoices: [{ invoice_id: input.invoiceId, amount_applied: input.amount }],
    },
    mspId,
  })) as { payment?: { payment_id?: string | number } };
  if (!body.payment?.payment_id) throw new Error("Zoho Books: payment create returned no payment_id");

  return { entity: "Payment", action: "create", zohoId: String(body.payment.payment_id) };
}

// ── Expense (AI/Anthropic daily cost rollup) ──────────────────────────────────

interface ZohoBooksExpensesResponse {
  expenses?: Array<{ expense_id?: string | number }>;
}

async function findBooksExpenseByReference(referenceNumber: string, orgId: string, mspId?: number): Promise<string | null> {
  const body = (await zohoGet(
    `${ZOHO_BOOKS_API_BASE_PATH}/expenses`,
    { reference_number: referenceNumber, organization_id: orgId },
    mspId,
  )) as ZohoBooksExpensesResponse;
  const first = Array.isArray(body.expenses) ? body.expenses[0] : undefined;
  return first?.expense_id != null ? String(first.expense_id) : null;
}

interface CreateExpenseInput {
  referenceNumber: string;
  amount: number;
  expenseDate: string;
  description: string;
}

/**
 * account_id is the Zoho Books chart-of-accounts expense account to post
 * against (e.g. "Software & AI Tools"). Zoho requires a real account id and
 * there is no local concept of one to derive it from, so it is read from an
 * env var, configured once in Zoho's own chart of accounts. Failing loudly
 * (rather than guessing an account) is deliberate — a misfiled expense is
 * worse than a DLQ'd job Shane can see and fix.
 */
async function createBooksExpense(
  input: CreateExpenseInput,
  mspId?: number,
): Promise<{ entity: "Expense"; action: "create" | "match"; zohoId: string }> {
  const accountId = process.env.ZOHO_BOOKS_AI_EXPENSE_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("ZOHO_BOOKS_AI_EXPENSE_ACCOUNT_ID is not configured — set it to the Zoho Books expense account id to post AI/Anthropic costs against");
  }

  const orgId = await resolveZohoBooksOrgId(mspId);

  const existingId = await findBooksExpenseByReference(input.referenceNumber, orgId, mspId);
  if (existingId) {
    log.info({ referenceNumber: input.referenceNumber, zohoId: existingId }, "zoho-books: expense already synced for this reference — skipping create");
    return { entity: "Expense", action: "match", zohoId: existingId };
  }

  const body = (await zohoFetch("POST", `${ZOHO_BOOKS_API_BASE_PATH}/expenses`, {
    query: { organization_id: orgId },
    body: {
      account_id: accountId,
      date: input.expenseDate,
      amount: input.amount,
      reference_number: input.referenceNumber,
      description: input.description.slice(0, 500),
    },
    mspId,
  })) as { expense?: { expense_id?: string | number } };
  if (!body.expense?.expense_id) throw new Error("Zoho Books: expense create returned no expense_id");

  return { entity: "Expense", action: "create", zohoId: String(body.expense.expense_id) };
}

// ── Job-handler registration ─────────────────────────────────────────────────
// One handler per write node type. jobType string === node type string, same
// discipline #83/#85 established — no mapping table to drift.

type WriteHandler = (payload: Record<string, unknown>, mspId: number | undefined) => Promise<Record<string, unknown>>;

function requireString(payload: Record<string, unknown>, key: string, nodeType: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${nodeType} requires a non-empty "${key}"`);
  }
  return value.trim();
}

function requireNumber(payload: Record<string, unknown>, key: string, nodeType: string): number {
  const value = Number(payload[key]);
  if (!Number.isFinite(value)) {
    throw new Error(`${nodeType} requires a numeric "${key}"`);
  }
  return value;
}

/**
 * zoho_books_create_invoice's handler. Resolves (or upserts) the contact
 * inline rather than depending on a separately queued zoho_books_upsert_contact
 * job having already run first — job execution order within a drain batch is
 * not guaranteed, so each write node stays self-sufficient. When the payload
 * also carries recordPayment=true (the common "invoice was already paid when
 * we found out about it" case from a Stripe webhook), the payment is recorded
 * in the same handler invocation rather than as a second queued job, so there
 * is never a window where an invoice job succeeded but its paired payment job
 * is still pending on a separate retry schedule.
 */
async function handleCreateInvoiceJob(payload: Record<string, unknown>, mspId: number | undefined): Promise<Record<string, unknown>> {
  const contactEmail = requireString(payload, "contactEmail", "zoho_books_create_invoice");
  const contactName = typeof payload.contactName === "string" ? payload.contactName : undefined;
  const localUserId = Number.isFinite(Number(payload.localUserId)) ? Number(payload.localUserId) : undefined;

  const contact = await upsertBooksContact(contactEmail, contactName, localUserId, mspId);

  const invoice = await createBooksInvoice(
    {
      referenceNumber: requireString(payload, "referenceNumber", "zoho_books_create_invoice"),
      contactId: contact.zohoId,
      amount: requireNumber(payload, "amount", "zoho_books_create_invoice"),
      description: requireString(payload, "description", "zoho_books_create_invoice"),
      invoiceDate: requireString(payload, "invoiceDate", "zoho_books_create_invoice"),
    },
    mspId,
  );

  const localInvoiceId = Number.isFinite(Number(payload.localInvoiceId)) ? Number(payload.localInvoiceId) : undefined;
  if (localInvoiceId) {
    await db
      .update(invoicesTable)
      .set({ zohoBooksInvoiceId: invoice.zohoId, updatedAt: new Date() })
      .where(and(eq(invoicesTable.id, localInvoiceId), isNull(invoicesTable.zohoBooksInvoiceId)))
      .catch((err: unknown) => {
        log.warn({ err, localInvoiceId }, "zoho-books: failed to cache zohoBooksInvoiceId on invoice row (non-fatal)");
      });
  }

  let payment: Record<string, unknown> | null = null;
  if (payload.recordPayment) {
    payment = await recordBooksPayment(
      {
        referenceNumber: typeof payload.paymentReferenceNumber === "string" && payload.paymentReferenceNumber
          ? payload.paymentReferenceNumber
          : `${invoice.zohoId}-payment`,
        contactId: contact.zohoId,
        invoiceId: invoice.zohoId,
        amount: requireNumber(payload, "amount", "zoho_books_create_invoice"),
        paymentDate: typeof payload.paymentDate === "string" && payload.paymentDate ? payload.paymentDate : requireString(payload, "invoiceDate", "zoho_books_create_invoice"),
      },
      mspId,
    );
  }

  return { contact, invoice, payment };
}

const WRITE_HANDLERS: Record<string, WriteHandler> = {
  zoho_books_upsert_contact: (p, msp) =>
    upsertBooksContact(
      requireString(p, "email", "zoho_books_upsert_contact"),
      typeof p.name === "string" ? p.name : undefined,
      Number.isFinite(Number(p.localUserId)) ? Number(p.localUserId) : undefined,
      msp,
    ),

  zoho_books_create_invoice: (p, msp) => handleCreateInvoiceJob(p, msp),

  zoho_books_record_payment: (p, msp) =>
    recordBooksPayment(
      {
        referenceNumber: requireString(p, "referenceNumber", "zoho_books_record_payment"),
        contactId: requireString(p, "contactId", "zoho_books_record_payment"),
        invoiceId: requireString(p, "invoiceId", "zoho_books_record_payment"),
        amount: requireNumber(p, "amount", "zoho_books_record_payment"),
        paymentDate: requireString(p, "paymentDate", "zoho_books_record_payment"),
      },
      msp,
    ),

  zoho_books_create_expense: (p, msp) =>
    createBooksExpense(
      {
        referenceNumber: requireString(p, "referenceNumber", "zoho_books_create_expense"),
        amount: requireNumber(p, "amount", "zoho_books_create_expense"),
        expenseDate: requireString(p, "expenseDate", "zoho_books_create_expense"),
        description: requireString(p, "description", "zoho_books_create_expense"),
      },
      msp,
    ),
};

let handlersRegistered = false;

/** Registers every write node's handler on the Foundation's drain. Idempotent. */
export function registerZohoBooksJobHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  for (const [jobType, handler] of Object.entries(WRITE_HANDLERS)) {
    registerZohoJobHandler(jobType, async (job) => {
      const mspId = job.mspId ?? undefined;
      try {
        const result = await handler(job.payload, mspId);
        log.info({ jobId: job.jobId, jobType, attempt: job.attemptCount, result }, "zoho-books: write applied");
        return result;
      } catch (err) {
        if (err instanceof ZohoApiError) {
          throw new Error(`${jobType} failed (HTTP ${err.status}): ${JSON.stringify(err.body)}`);
        }
        throw err;
      }
    });
  }

  log.info({ count: Object.keys(WRITE_HANDLERS).length }, "zoho-books: registered write job handlers");
}

// ── Enqueue side (what routes call — the ONLY way a Zoho Books write happens) ─

export interface EnqueueZohoBooksWriteOptions {
  mspId?: number;
  customerId?: number;
  correlationId?: string;
}

export async function enqueueZohoBooksWrite(
  nodeType: string,
  payload: Record<string, unknown>,
  opts: EnqueueZohoBooksWriteOptions = {},
): Promise<{ queued: true; jobId: string; jobType: string }> {
  if (!WRITE_HANDLERS[nodeType]) {
    throw new Error(`Unknown Zoho Books write node type: ${nodeType}`);
  }
  const jobId = await enqueueJob(nodeType, payload, {
    mspId: opts.mspId,
    customerId: opts.customerId,
    correlationId: opts.correlationId,
  });
  log.info({ jobId, jobType: nodeType }, "zoho-books: write queued for next drain");
  return { queued: true, jobId, jobType: nodeType };
}

/**
 * Convenience entry point for the two Stripe webhooks (msp-billing-webhook.ts,
 * portal.ts) — a paid invoice becomes one queued zoho_books_create_invoice job
 * that internally upserts the contact and (when recordPayment is set) records
 * the payment too, per handleCreateInvoiceJob's contract above.
 */
export interface SyncPaidInvoiceInput {
  referenceNumber: string;
  contactEmail: string;
  contactName?: string;
  amount: number;
  description: string;
  invoiceDate: string;
  recordPayment?: boolean;
  paymentDate?: string;
  paymentReferenceNumber?: string;
  localInvoiceId?: number;
  localUserId?: number;
}

export async function enqueueZohoBooksInvoiceSync(
  input: SyncPaidInvoiceInput,
  opts: EnqueueZohoBooksWriteOptions = {},
): Promise<{ queued: true; jobId: string; jobType: string }> {
  return enqueueZohoBooksWrite("zoho_books_create_invoice", { ...input }, opts);
}

// ── Executor entry point ─────────────────────────────────────────────────────
// All Zoho Books nodes are write-only (no admin-facing read/list needed since
// there is no UI), so unlike CRM/Projects there is no read branch here.

export async function executeZohoBooksNode(
  nodeType: string,
  data: Record<string, unknown>,
  resolve: (value: unknown) => string | undefined,
): Promise<Record<string, unknown>> {
  const spec = getZohoBooksNodeSpec(nodeType);
  if (!spec) throw new Error(`Not a Zoho Books node type: ${nodeType}`);

  const mspIdRaw = Number(resolve(data.mspId) ?? data.mspId);
  const mspId = Number.isFinite(mspIdRaw) && mspIdRaw > 0 ? mspIdRaw : undefined;

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      payload[key] = resolve(value) ?? value;
    } else {
      payload[key] = value;
    }
  }

  const queued = await enqueueZohoBooksWrite(nodeType, payload, { mspId });
  return { ...queued, entity: spec.entity, note: "queued — applied by the next Zoho Queue Drain (runs every 5 minutes)" };
}

// ── Daily AI/Anthropic cost rollup trigger ────────────────────────────────────
//
// Not a Zoho Books node itself (like zoho_batch_drain, this is a schedule-
// trigger mechanism, not a product write) — computes the prior UTC day's
// ai_usage_events.costCents sum by reusing bucketTimeSeries/bucketStartMs from
// ai-billing-analytics.ts (Phase 4's day-bucketing logic) rather than
// rewriting the aggregation, then posts ONE zoho_books_create_expense job for
// that day. A $0 day is skipped (not real money leaving the account) rather
// than posting a $0 expense.

export async function handleZohoBooksDailyAiRollup(
  _data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const now = new Date();
    const todayStartMs = bucketStartMs(now.getTime(), "day", 0);
    const yesterdayStartMs = bucketStartMs(todayStartMs - 1, "day", 0);
    const yesterdayEndMs = nextBucketStartMs(yesterdayStartMs, "day", 0);
    const dateKey = bucketKeyOf(yesterdayStartMs, "day", 0);

    const rows = await db
      .select({ occurredAt: aiUsageEventsTable.occurredAt, costCents: aiUsageEventsTable.costCents })
      .from(aiUsageEventsTable)
      .where(and(gte(aiUsageEventsTable.occurredAt, new Date(yesterdayStartMs)), lt(aiUsageEventsTable.occurredAt, new Date(yesterdayEndMs))));

    const [point] = bucketTimeSeries(rows, {
      bucket: "day",
      window: { start: new Date(yesterdayStartMs), end: new Date(yesterdayEndMs) },
      tzOffsetMinutes: 0,
      now,
    });
    const costCents = point?.costCents ?? 0;

    if (costCents <= 0) {
      log.info({ dateKey, eventCount: rows.length }, "zoho-books: daily AI cost rollup — $0 for the day, skipping expense post");
      return { dateKey, costCents: 0, eventCount: rows.length, posted: false };
    }

    const queued = await enqueueZohoBooksWrite("zoho_books_create_expense", {
      referenceNumber: dateKey,
      amount: costCents / 100,
      expenseDate: dateKey,
      description: `AI/Anthropic usage — ${dateKey} (${rows.length} event${rows.length === 1 ? "" : "s"})`,
    });

    log.info({ dateKey, costCents, eventCount: rows.length, jobId: queued.jobId }, "zoho-books: daily AI cost rollup — expense queued");
    return { dateKey, costCents, eventCount: rows.length, posted: true, jobId: queued.jobId };
  } catch (err) {
    // Schedule nodes report, never throw — the run stays visible and green
    // with the error surfaced in the node output + logs, same contract
    // zoho_batch_drain uses.
    log.error({ err }, "zoho-books: daily AI cost rollup failed");
    return { posted: false, error: String(err) };
  }
}

// Register on import so the drain has handlers regardless of which entry
// point pulls this module in first — same discipline zoho-crm.ts/zoho-projects.ts use.
registerZohoBooksJobHandlers();
