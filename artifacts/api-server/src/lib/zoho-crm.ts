// Zoho CRM nodes — Leads / Deals / Contacts / Accounts (#83).
//
// Builds strictly on the #82 Foundation: `zoho-client.ts` owns auth and the raw
// HTTP calls, `zoho-read.ts` owns paginated list/search for the Admin Panel
// tables, and `zoho-batch-drain.ts` owns the queue drain. Nothing here
// reimplements any of that.
//
// ── The sync/queued split ────────────────────────────────────────────────────
// Audited against how the executor actually dispatches non-AI nodes today:
// every existing CRM-ish node (`create_lead`, `convert_to_opportunity`, …) runs
// INLINE and writes straight to Postgres — there is currently no node anywhere
// in the codebase that enqueues onto msp_job_queue (`enqueueJob` had zero real
// callers before this file). So this phase establishes that split rather than
// following one:
//
//   READ  nodes (zoho_get_*, zoho_find_*, zoho_search_*) call zohoGet inline
//         and return real records — a workflow (or a page load) waiting on a
//         Zoho GET is fine.
//   WRITE nodes (create/update/upsert/convert/note/attach) NEVER call Zoho on
//         the request path. They enqueue an msp_job_queue row and return
//         { queued: true, jobId }. The registered handler below is what
//         actually talks to Zoho, on the next 5-minute drain.
//
// Every write handler is registered with registerZohoJobHandler() at module
// load, which is the plug point the Foundation exposed for exactly this.
//
// No delete nodes — deliberate. Zoho is the system of record and deletion
// stays a manual Zoho-side action.

import { zohoGet, zohoPost, zohoPut, ZohoApiError } from "./zoho-client.ts";
import { registerZohoJobHandler } from "./zoho-batch-drain.ts";
import { enqueueJob } from "./msp-jobs.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.zoho" });

// ── Node catalog ─────────────────────────────────────────────────────────────
// The catalog itself lives in the dependency-free zoho-crm-nodes.ts so
// node-type-registry.ts can derive its entries from the same list without
// importing this module's DB/queue dependencies. Re-exported here so callers
// have one import site.

import {
  ZOHO_CRM_NODES,
  ZOHO_CRM_NODE_TYPES,
  isZohoCrmNodeType,
  getZohoCrmNodeSpec,
  type ZohoCrmModule,
  type ZohoCrmNodeSpec,
} from "./zoho-crm-nodes.ts";

export {
  ZOHO_CRM_NODES,
  ZOHO_CRM_NODE_TYPES,
  isZohoCrmNodeType,
  getZohoCrmNodeSpec,
  type ZohoCrmModule,
  type ZohoCrmNodeSpec,
};

const NODE_SPECS = new Map(ZOHO_CRM_NODES.map((n) => [n.nodeType, n]));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * First record out of a Zoho `{ data: [...] }` envelope, or null. Zoho answers
 * 204 (mapped to `{}` by zohoFetch) for an empty search, so `data` is often
 * absent entirely rather than an empty array.
 */
export function firstRecord(body: Record<string, unknown>): Record<string, unknown> | null {
  const data = body.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  return (data[0] ?? null) as Record<string, unknown> | null;
}

/**
 * Zoho write responses nest the real per-record outcome one level down:
 * `{ data: [ { code, status, details: { id } } ] }`. A record can fail while
 * the HTTP status is still 200, so this treats a non-"success" status as an
 * error rather than reporting a write that did not happen.
 */
export function extractWriteResult(body: Record<string, unknown>): { id: string | null; code: string; status: string; message: string } {
  const rec = firstRecord(body) ?? {};
  const details = (rec.details ?? {}) as Record<string, unknown>;
  return {
    id: details.id === undefined || details.id === null ? null : String(details.id),
    code: String(rec.code ?? ""),
    status: String(rec.status ?? ""),
    message: String(rec.message ?? ""),
  };
}

function assertWriteSucceeded(body: Record<string, unknown>, what: string): { id: string | null; code: string; status: string; message: string } {
  const result = extractWriteResult(body);
  if (result.status && result.status !== "success") {
    throw new Error(`Zoho ${what} failed: ${result.code || "unknown"} — ${result.message || "no message"}`);
  }
  return result;
}

/** Escapes a value for Zoho's `criteria=` search grammar. */
function escapeCriteriaValue(value: string): string {
  return value.replace(/[()]/g, "").trim();
}

/**
 * Only string/number/boolean field values are forwarded to Zoho. `fields` on a
 * node is free-form operator input, so anything else is dropped rather than
 * serialized into a shape Zoho will reject for the whole record.
 */
export function sanitizeFields(fields: unknown): Record<string, unknown> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === null) { out[key] = null; continue; }
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") out[key] = value;
  }
  return out;
}

// ── Read operations (inline, never queued) ───────────────────────────────────

export async function getRecord(module: ZohoCrmModule, id: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const body = await zohoGet(`/crm/v8/${module}/${encodeURIComponent(id)}`, undefined, mspId);
  return firstRecord(body);
}

export async function findByEmail(module: "Leads" | "Contacts", email: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const body = await zohoGet(`/crm/v8/${module}/search`, { email: normalized }, mspId);
  return firstRecord(body);
}

export async function searchAccounts(word: string, mspId?: number): Promise<Array<Record<string, unknown>>> {
  const term = word.trim();
  if (!term) return [];
  const body = await zohoGet(`/crm/v8/Accounts/search`, { word: term }, mspId);
  const data = body.data;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/**
 * The duplicate guard the spec calls for before zoho_create_deal fires from a
 * retried job. "Open" means not one of Zoho's two terminal stages, matched
 * server-side so a large closed-deal history doesn't have to be paged through.
 */
export async function findOpenDealForContact(contactId: string, mspId?: number): Promise<Record<string, unknown> | null> {
  const id = escapeCriteriaValue(contactId);
  if (!id) return null;
  const criteria = `((Contact_Name:equals:${id})and(Stage:not_equal:Closed Won)and(Stage:not_equal:Closed Lost))`;
  const body = await zohoGet(`/crm/v8/Deals/search`, { criteria }, mspId);
  return firstRecord(body);
}

// ── Write operations (drain handlers — these are what actually call Zoho) ────

async function createRecord(module: ZohoCrmModule, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const body = await zohoPost(`/crm/v8/${module}`, { data: [fields] }, mspId);
  const result = assertWriteSucceeded(body, `${module} create`);
  return { module, action: "create", zohoId: result.id, code: result.code };
}

async function updateRecord(module: ZohoCrmModule, id: string, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const body = await zohoPut(`/crm/v8/${module}/${encodeURIComponent(id)}`, { data: [fields] }, mspId);
  const result = assertWriteSucceeded(body, `${module} update`);
  return { module, action: "update", zohoId: result.id ?? id, code: result.code };
}

/**
 * Find-by-email then create-or-update. Atomic from the caller's side (one node,
 * one job), which is what makes a retried batch job safe: a redelivery updates
 * the record the first attempt created instead of duplicating it.
 */
async function upsertByEmail(module: "Leads" | "Contacts", fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const email = typeof fields.Email === "string" ? fields.Email : "";
  if (!email) throw new Error(`zoho upsert ${module} requires an Email field`);

  const existing = await findByEmail(module, email, mspId);
  if (existing && existing.id) {
    const out = await updateRecord(module, String(existing.id), fields, mspId);
    return { ...out, action: "update", matchedExisting: true };
  }
  const out = await createRecord(module, fields, mspId);
  return { ...out, action: "create", matchedExisting: false };
}

async function addNote(module: ZohoCrmModule, parentId: string, title: string, content: string, mspId?: number): Promise<Record<string, unknown>> {
  const body = await zohoPost(`/crm/v8/Notes`, {
    data: [{
      Note_Title: title || "Note",
      Note_Content: content,
      Parent_Id: parentId,
      se_module: module,
    }],
  }, mspId);
  const result = assertWriteSucceeded(body, `${module} note`);
  return { module, action: "add_note", parentId, noteId: result.id };
}

/**
 * Attaches by URL rather than multipart upload: the Foundation's client is a
 * JSON client, and Zoho's attachmentUrl form is a first-class API that avoids
 * pushing a multipart encoder into it for this phase.
 */
async function attachFileByUrl(module: ZohoCrmModule, parentId: string, attachmentUrl: string, mspId?: number): Promise<Record<string, unknown>> {
  if (!attachmentUrl) throw new Error(`zoho attach ${module} requires attachmentUrl`);
  const body = await zohoPost(
    `/crm/v8/${module}/${encodeURIComponent(parentId)}/Attachments?attachmentUrl=${encodeURIComponent(attachmentUrl)}`,
    undefined,
    mspId,
  );
  const result = assertWriteSucceeded(body, `${module} attachment`);
  return { module, action: "attach_file", parentId, attachmentId: result.id, attachmentUrl };
}

/**
 * Zoho's native Convert API: Lead → Contact + Account + Deal in one atomic
 * server-side operation. Costs 5 API credits vs 1 for a normal call, so it is
 * logged explicitly — this is the funnel-transition point once the Lead
 * Scoring/Qualification Engine marks a lead qualified.
 */
async function convertLead(leadId: string, options: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const entry: Record<string, unknown> = {
    overwrite: options.overwrite === true,
    notify_lead_owner: options.notifyLeadOwner === true,
    notify_new_entity_owner: options.notifyNewEntityOwner === true,
  };
  if (options.assignTo) entry.assign_to = String(options.assignTo);

  const dealFields = sanitizeFields(options.deal);
  if (Object.keys(dealFields).length > 0) entry.Deals = dealFields;

  log.info({ leadId, creatingDeal: Object.keys(dealFields).length > 0, apiCreditCost: 5 }, "zoho-crm: converting lead (5 API credits)");

  const body = await zohoPost(`/crm/v8/Leads/${encodeURIComponent(leadId)}/actions/convert`, { data: [entry] }, mspId);

  const rec = firstRecord(body) ?? {};
  // The convert response returns the three created/linked ids directly, not
  // under `details` like an ordinary write.
  const contactId = rec.Contacts === undefined || rec.Contacts === null ? null : String(rec.Contacts);
  const accountId = rec.Accounts === undefined || rec.Accounts === null ? null : String(rec.Accounts);
  const dealId = rec.Deals === undefined || rec.Deals === null ? null : String(rec.Deals);

  if (!contactId && !accountId && !dealId) {
    throw new Error(`Zoho lead convert returned no linked records for lead ${leadId}`);
  }

  return { module: "Leads", action: "convert", leadId, contactId, accountId, dealId };
}

// ── Job-handler registration ─────────────────────────────────────────────────
// One handler per write node type. jobType string === node type string, so
// there is no mapping table to drift.

type WriteHandler = (payload: Record<string, unknown>, mspId: number | undefined) => Promise<Record<string, unknown>>;

function requireString(payload: Record<string, unknown>, key: string, nodeType: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${nodeType} requires a non-empty "${key}"`);
  }
  return value.trim();
}

const WRITE_HANDLERS: Record<string, WriteHandler> = {
  // ── Leads ──
  zoho_create_lead: (p, msp) => createRecord("Leads", sanitizeFields(p.fields), msp),
  zoho_update_lead: (p, msp) => updateRecord("Leads", requireString(p, "zohoLeadId", "zoho_update_lead"), sanitizeFields(p.fields), msp),
  zoho_upsert_lead: (p, msp) => upsertByEmail("Leads", sanitizeFields(p.fields), msp),
  zoho_add_lead_note: (p, msp) => addNote("Leads", requireString(p, "zohoLeadId", "zoho_add_lead_note"), String(p.title ?? "Note"), String(p.content ?? ""), msp),
  zoho_attach_file_to_lead: (p, msp) => attachFileByUrl("Leads", requireString(p, "zohoLeadId", "zoho_attach_file_to_lead"), String(p.attachmentUrl ?? ""), msp),
  zoho_convert_lead: (p, msp) => convertLead(requireString(p, "zohoLeadId", "zoho_convert_lead"), p, msp),

  // ── Deals ──
  zoho_create_deal: async (p, msp) => {
    // Idempotency guard the spec calls for: a redelivered job must not create a
    // second deal for a contact that already has an open one.
    const contactId = typeof p.contactId === "string" ? p.contactId.trim() : "";
    if (contactId && p.skipDuplicateCheck !== true) {
      const open = await findOpenDealForContact(contactId, msp);
      if (open && open.id) {
        log.info({ contactId, existingDealId: open.id }, "zoho-crm: open deal already exists — skipping create");
        return { module: "Deals", action: "create", zohoId: String(open.id), skipped: true, reason: "open_deal_exists" };
      }
    }
    return createRecord("Deals", sanitizeFields(p.fields), msp);
  },
  zoho_update_deal: (p, msp) => updateRecord("Deals", requireString(p, "zohoDealId", "zoho_update_deal"), sanitizeFields(p.fields), msp),
  zoho_update_deal_stage: (p, msp) => updateRecord("Deals", requireString(p, "zohoDealId", "zoho_update_deal_stage"), { Stage: requireString(p, "stage", "zoho_update_deal_stage") }, msp),
  zoho_update_deal_amount: (p, msp) => {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount)) throw new Error("zoho_update_deal_amount requires a numeric \"amount\"");
    return updateRecord("Deals", requireString(p, "zohoDealId", "zoho_update_deal_amount"), { Amount: amount }, msp);
  },
  zoho_add_deal_note: (p, msp) => addNote("Deals", requireString(p, "zohoDealId", "zoho_add_deal_note"), String(p.title ?? "Note"), String(p.content ?? ""), msp),
  zoho_attach_file_to_deal: (p, msp) => attachFileByUrl("Deals", requireString(p, "zohoDealId", "zoho_attach_file_to_deal"), String(p.attachmentUrl ?? ""), msp),

  // ── Contacts ──
  zoho_create_contact: (p, msp) => createRecord("Contacts", sanitizeFields(p.fields), msp),
  zoho_update_contact: (p, msp) => updateRecord("Contacts", requireString(p, "zohoContactId", "zoho_update_contact"), sanitizeFields(p.fields), msp),
  zoho_upsert_contact: (p, msp) => upsertByEmail("Contacts", sanitizeFields(p.fields), msp),

  // ── Accounts ──
  zoho_create_account: (p, msp) => createRecord("Accounts", sanitizeFields(p.fields), msp),
  zoho_update_account: (p, msp) => updateRecord("Accounts", requireString(p, "zohoAccountId", "zoho_update_account"), sanitizeFields(p.fields), msp),
  zoho_attach_file_to_account: (p, msp) => attachFileByUrl("Accounts", requireString(p, "zohoAccountId", "zoho_attach_file_to_account"), String(p.attachmentUrl ?? ""), msp),
};

/**
 * Stamps the outcome of a queued write back onto the originating lead_staging
 * row, when the job carries a `leadStagingId`.
 *
 * This is what closes the loop the queued design opens: the route that enqueued
 * the write answered 202 with no Zoho id (none existed yet), so without this
 * the row would sit at "queued" forever and nothing would ever learn the real
 * zohoLeadId. Bookkeeping only — a failure here must not fail the job, or a
 * successful Zoho write would be retried and duplicated.
 */
async function recordSyncOutcome(
  payload: Record<string, unknown>,
  result: Record<string, unknown> | null,
  error: unknown,
): Promise<void> {
  const stagingId = Number(payload.leadStagingId);
  if (!Number.isFinite(stagingId) || stagingId <= 0) return;

  try {
    const { db, leadStagingTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    if (error) {
      await db
        .update(leadStagingTable)
        .set({ zohoSyncState: "error", zohoSyncError: String(error).slice(0, 2000), updatedAt: new Date() })
        .where(eq(leadStagingTable.id, stagingId));
      return;
    }

    const zohoId = result && result.zohoId !== null && result.zohoId !== undefined ? String(result.zohoId) : null;
    await db
      .update(leadStagingTable)
      .set({
        zohoSyncState: "synced",
        zohoSyncError: null,
        zohoSyncedAt: new Date(),
        ...(zohoId ? { zohoLeadId: zohoId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leadStagingTable.id, stagingId));
  } catch (err) {
    log.warn({ err, stagingId }, "zoho-crm: could not record sync outcome (non-fatal)");
  }
}

let handlersRegistered = false;

/**
 * Registers every write node's handler on the Foundation's drain. Idempotent —
 * safe to call from more than one entry point (route mounting, executor import,
 * tests) without double-registering.
 */
export function registerZohoCrmJobHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  for (const [jobType, handler] of Object.entries(WRITE_HANDLERS)) {
    registerZohoJobHandler(jobType, async (job) => {
      const mspId = job.mspId ?? undefined;
      try {
        const result = await handler(job.payload, mspId);
        log.info({ jobId: job.jobId, jobType, attempt: job.attemptCount, result }, "zoho-crm: write applied");
        await recordSyncOutcome(job.payload, result, null);
        return result;
      } catch (err) {
        await recordSyncOutcome(job.payload, null, err);
        // Surface Zoho's own body on an API error — the drain records the
        // message on the job row and in the DLQ, and "Zoho API responded 400"
        // alone is not diagnosable.
        if (err instanceof ZohoApiError) {
          throw new Error(`${jobType} failed (HTTP ${err.status}): ${JSON.stringify(err.body)}`);
        }
        throw err;
      }
    });
  }

  log.info({ count: Object.keys(WRITE_HANDLERS).length }, "zoho-crm: registered write job handlers");
}

// ── Enqueue side (what routes and write nodes actually call) ─────────────────

export interface EnqueueZohoWriteOptions {
  mspId?: number;
  customerId?: number;
  correlationId?: string;
}

/**
 * Queues a Zoho write. This is the ONLY way a route or a workflow node causes a
 * Zoho write — nothing on a request path blocks on a live Zoho call. The job is
 * applied by the seeded 5-minute "Zoho Queue Drain" workflow, so callers must
 * present the result as "queued / syncing", never as a completed write.
 */
export async function enqueueZohoWrite(
  nodeType: string,
  payload: Record<string, unknown>,
  opts: EnqueueZohoWriteOptions = {},
): Promise<{ queued: true; jobId: string; jobType: string }> {
  if (!WRITE_HANDLERS[nodeType]) {
    throw new Error(`Unknown Zoho write node type: ${nodeType}`);
  }
  const jobId = await enqueueJob(nodeType, payload, {
    mspId: opts.mspId,
    customerId: opts.customerId,
    correlationId: opts.correlationId,
  });
  log.info({ jobId, jobType: nodeType }, "zoho-crm: write queued for next drain");
  return { queued: true, jobId, jobType: nodeType };
}

// ── Executor entry point ─────────────────────────────────────────────────────

/**
 * Executes one Zoho CRM node. `resolve` is the executor's own placeholder
 * interpolation, passed in so this module stays independent of the executor.
 *
 * Reads return records inline. Writes return `{ queued: true, jobId }` — the
 * node has NOT written to Zoho when it returns, by design.
 */
export async function executeZohoCrmNode(
  nodeType: string,
  data: Record<string, unknown>,
  resolve: (value: unknown) => string | undefined,
): Promise<Record<string, unknown>> {
  const spec = NODE_SPECS.get(nodeType);
  if (!spec) throw new Error(`Not a Zoho CRM node type: ${nodeType}`);

  const mspIdRaw = Number(resolve(data.mspId) ?? data.mspId);
  const mspId = Number.isFinite(mspIdRaw) && mspIdRaw > 0 ? mspIdRaw : undefined;

  if (spec.mode === "read") {
    switch (nodeType) {
      case "zoho_get_lead":
      case "zoho_get_deal":
      case "zoho_get_contact":
      case "zoho_get_account": {
        const idKey = { Leads: "zohoLeadId", Deals: "zohoDealId", Contacts: "zohoContactId", Accounts: "zohoAccountId" }[spec.module];
        const id = resolve(data[idKey]);
        if (!id) return { error: `${nodeType} requires ${idKey}`, found: false };
        const record = await getRecord(spec.module, id, mspId);
        return { found: Boolean(record), record: record ?? null, module: spec.module };
      }
      case "zoho_find_lead_by_email":
      case "zoho_find_contact_by_email": {
        const email = resolve(data.email);
        if (!email) return { error: `${nodeType} requires email`, found: false };
        const module = nodeType === "zoho_find_lead_by_email" ? "Leads" : "Contacts";
        const record = await findByEmail(module, email, mspId);
        return { found: Boolean(record), record: record ?? null, zohoId: record?.id ? String(record.id) : null, module };
      }
      case "zoho_search_accounts": {
        const word = resolve(data.search) ?? resolve(data.word) ?? resolve(data.accountName);
        if (!word) return { error: "zoho_search_accounts requires a search term", records: [], count: 0 };
        const records = await searchAccounts(word, mspId);
        return { records, count: records.length, module: "Accounts" };
      }
      case "zoho_find_open_deal_for_contact": {
        const contactId = resolve(data.contactId) ?? resolve(data.zohoContactId);
        if (!contactId) return { error: "zoho_find_open_deal_for_contact requires contactId", found: false };
        const record = await findOpenDealForContact(contactId, mspId);
        return { found: Boolean(record), record: record ?? null, zohoDealId: record?.id ? String(record.id) : null, module: "Deals" };
      }
      default:
        throw new Error(`Unhandled Zoho CRM read node: ${nodeType}`);
    }
  }

  // Write: resolve placeholders in the node's own data, then queue it. The
  // whole resolved data object becomes the job payload so the handler sees
  // exactly what the node was configured with.
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      payload[key] = resolve(value) ?? value;
    } else {
      payload[key] = value;
    }
  }

  const queued = await enqueueZohoWrite(nodeType, payload, { mspId });
  return { ...queued, module: spec.module, note: "queued — applied by the next Zoho Queue Drain (runs every 5 minutes)" };
}

// Register on import so the drain has handlers regardless of which entry point
// pulls this module in first.
registerZohoCrmJobHandlers();
