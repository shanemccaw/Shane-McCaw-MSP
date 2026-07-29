// Zoho CRM Admin Panel routes (#83).
//
//   GET  /api/zoho/crm/:entity            — paginated list/search (SYNCHRONOUS)
//   GET  /api/zoho/crm/:entity/:id        — single record detail (SYNCHRONOUS)
//   POST /api/zoho/crm/:entity            — create        (QUEUED)
//   PATCH/api/zoho/crm/:entity/:id        — update        (QUEUED)
//   POST /api/zoho/crm/leads/:id/convert  — Zoho convert  (QUEUED)
//   POST /api/zoho/crm/:entity/:id/notes  — add note      (QUEUED)
//   GET  /api/zoho/crm/jobs/:jobId        — queued-write status for the UI
//
// The read/write split is the whole point and is enforced here, not merely
// documented: reads go through zoho-read.ts / zoho-crm.ts's inline helpers, and
// writes NEVER call Zoho on the request path — they enqueue an msp_job_queue
// row that the seeded 5-minute "Zoho Queue Drain" applies. Every write route
// therefore answers 202 Accepted with a jobId, never 200/201 with a record,
// because the record does not exist yet when the response is written.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspJobQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { listLeads, listDeals, listContacts, listAccounts, type ZohoListResult } from "../lib/zoho-read.ts";
import {
  enqueueZohoWrite,
  getRecord,
  findByEmail,
  findOpenDealForContact,
  sanitizeFields,
  type ZohoCrmModule,
} from "../lib/zoho-crm.ts";
import { ZohoNotConnectedError, ZohoApiError, ZOHO_DEFAULT_MSP_ID } from "../lib/zoho-client.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.zoho" });

const router: IRouter = Router();

// ── Entity routing table ─────────────────────────────────────────────────────
// URL segment → Zoho module + the node types that write it. Keeping this as
// data means a route can never enqueue a jobType that has no handler.

interface EntityConfig {
  module: ZohoCrmModule;
  list: (params: { page?: number; perPage?: number; search?: string }) => Promise<ZohoListResult>;
  createNode: string;
  updateNode: string;
  noteNode: string | null;
  /** Payload key the write handlers expect the record id under. */
  idKey: string;
}

const ENTITIES: Record<string, EntityConfig> = {
  leads: { module: "Leads", list: listLeads, createNode: "zoho_create_lead", updateNode: "zoho_update_lead", noteNode: "zoho_add_lead_note", idKey: "zohoLeadId" },
  deals: { module: "Deals", list: listDeals, createNode: "zoho_create_deal", updateNode: "zoho_update_deal", noteNode: "zoho_add_deal_note", idKey: "zohoDealId" },
  contacts: { module: "Contacts", list: listContacts, createNode: "zoho_create_contact", updateNode: "zoho_update_contact", noteNode: null, idKey: "zohoContactId" },
  accounts: { module: "Accounts", list: listAccounts, createNode: "zoho_create_account", updateNode: "zoho_update_account", noteNode: null, idKey: "zohoAccountId" },
};

function resolveEntity(req: Request, res: Response): EntityConfig | null {
  const config = ENTITIES[String(req.params.entity ?? "").toLowerCase()];
  if (!config) {
    res.status(404).json({ error: `Unknown CRM entity — expected one of: ${Object.keys(ENTITIES).join(", ")}` });
    return null;
  }
  return config;
}

/**
 * Maps Zoho/connection failures onto honest HTTP status codes. A missing OAuth
 * connection is a 503 with an actionable message, not a 500 — the Admin Panel
 * renders it as "connect Zoho" rather than as a crash.
 */
function handleZohoError(err: unknown, res: Response, context: string): void {
  if (err instanceof ZohoNotConnectedError) {
    log.warn({ context }, "zoho-crm route: Zoho not connected");
    res.status(503).json({ error: err.message, code: "zoho_not_connected" });
    return;
  }
  if (err instanceof ZohoApiError) {
    log.warn({ context, status: err.status }, "zoho-crm route: Zoho API error");
    res.status(err.status >= 400 && err.status < 500 ? err.status : 502).json({
      error: `Zoho API error (${err.status})`,
      code: "zoho_api_error",
      details: err.body,
    });
    return;
  }
  log.error({ err, context }, "zoho-crm route: unexpected failure");
  res.status(500).json({ error: "Unexpected failure talking to Zoho" });
}

// ── Reads (synchronous — these DO call Zoho on the request path) ─────────────

router.get("/zoho/crm/jobs/:jobId", requireAdmin, async (req: Request, res: Response) => {
  // Lets the UI turn "queued" into "synced"/"failed" without inventing a second
  // source of truth: it reports the real msp_job_queue row the drain updates.
  try {
    const [job] = await db
      .select({
        jobId: mspJobQueueTable.jobId,
        jobType: mspJobQueueTable.jobType,
        status: mspJobQueueTable.status,
        attemptCount: mspJobQueueTable.attemptCount,
        maxAttempts: mspJobQueueTable.maxAttempts,
        errorMessage: mspJobQueueTable.errorMessage,
        result: mspJobQueueTable.result,
        scheduledAt: mspJobQueueTable.scheduledAt,
        completedAt: mspJobQueueTable.completedAt,
      })
      .from(mspJobQueueTable)
      .where(eq(mspJobQueueTable.jobId, String(req.params.jobId)))
      .limit(1);

    if (!job) {
      res.status(404).json({ error: "No such queued write" });
      return;
    }
    res.json(job);
  } catch (err) {
    log.error({ err }, "zoho-crm route: job status lookup failed");
    res.status(500).json({ error: "Failed to read job status" });
  }
});

router.get("/zoho/crm/:entity", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
  const perPage = req.query.perPage ? parseInt(String(req.query.perPage), 10) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;

  try {
    const result = await config.list({ page, perPage, search });
    res.json({ module: config.module, ...result });
  } catch (err) {
    handleZohoError(err, res, `list ${config.module}`);
  }
});

router.get("/zoho/crm/:entity/:id", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  try {
    const record = await getRecord(config.module, String(req.params.id));
    if (!record) {
      res.status(404).json({ error: `${config.module} record not found in Zoho` });
      return;
    }
    res.json({ module: config.module, record });
  } catch (err) {
    handleZohoError(err, res, `get ${config.module}`);
  }
});

/** Email lookup backing the duplicate warning on the Lead/Contact create forms. */
router.get("/zoho/crm/:entity/lookup/by-email", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;
  if (config.module !== "Leads" && config.module !== "Contacts") {
    res.status(400).json({ error: "Email lookup is only supported for leads and contacts" });
    return;
  }
  const email = String(req.query.email ?? "").trim();
  if (!email) {
    res.status(400).json({ error: "email query parameter is required" });
    return;
  }

  try {
    const record = await findByEmail(config.module, email);
    res.json({ found: Boolean(record), record: record ?? null, module: config.module });
  } catch (err) {
    handleZohoError(err, res, `find ${config.module} by email`);
  }
});

/** Open-deal guard so the Deal create form can warn before duplicating. */
router.get("/zoho/crm/deals/open-for-contact/:contactId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const record = await findOpenDealForContact(String(req.params.contactId));
    res.json({ found: Boolean(record), record: record ?? null });
  } catch (err) {
    handleZohoError(err, res, "find open deal for contact");
  }
});

// ── Writes (queued — these never call Zoho on the request path) ──────────────

/**
 * 202 + jobId is the contract for every write below. Returning 200 with a
 * record would be a lie: at this point the job row exists and Zoho has not been
 * contacted at all.
 */
async function queueWrite(
  res: Response,
  nodeType: string,
  payload: Record<string, unknown>,
  action: string,
): Promise<void> {
  try {
    const queued = await enqueueZohoWrite(nodeType, payload, { mspId: ZOHO_DEFAULT_MSP_ID });
    res.status(202).json({
      ...queued,
      action,
      status: "queued",
      message: "Queued — the Zoho Queue Drain applies this within 5 minutes.",
    });
  } catch (err) {
    log.error({ err, nodeType }, "zoho-crm route: failed to queue write");
    res.status(500).json({ error: "Failed to queue the Zoho write" });
  }
}

router.post("/zoho/crm/:entity", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) {
    res.status(400).json({ error: "No writable fields supplied" });
    return;
  }

  const payload: Record<string, unknown> = { fields };
  // Carry the duplicate guard through to the handler for deals.
  if (config.module === "Deals" && typeof req.body?.contactId === "string") {
    payload.contactId = req.body.contactId;
  }

  await queueWrite(res, config.createNode, payload, `create ${config.module}`);
});

router.patch("/zoho/crm/:entity/:id", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) {
    res.status(400).json({ error: "No writable fields supplied" });
    return;
  }

  await queueWrite(
    res,
    config.updateNode,
    { [config.idKey]: String(req.params.id), fields },
    `update ${config.module}`,
  );
});

/** Dedicated stage/amount routes — the Deals board's two most common edits. */
router.post("/zoho/crm/deals/:id/stage", requireAdmin, async (req: Request, res: Response) => {
  const stage = typeof req.body?.stage === "string" ? req.body.stage.trim() : "";
  if (!stage) {
    res.status(400).json({ error: "stage is required" });
    return;
  }
  await queueWrite(res, "zoho_update_deal_stage", { zohoDealId: String(req.params.id), stage }, "update Deal stage");
});

router.post("/zoho/crm/deals/:id/amount", requireAdmin, async (req: Request, res: Response) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount)) {
    res.status(400).json({ error: "amount must be a number" });
    return;
  }
  await queueWrite(res, "zoho_update_deal_amount", { zohoDealId: String(req.params.id), amount }, "update Deal amount");
});

/** The funnel-transition point: Lead → Contact + Account + Deal, atomically. */
router.post("/zoho/crm/leads/:id/convert", requireAdmin, async (req: Request, res: Response) => {
  const payload: Record<string, unknown> = {
    zohoLeadId: String(req.params.id),
    overwrite: req.body?.overwrite === true,
    notifyLeadOwner: req.body?.notifyLeadOwner === true,
    notifyNewEntityOwner: req.body?.notifyNewEntityOwner === true,
  };
  if (req.body?.assignTo) payload.assignTo = String(req.body.assignTo);
  if (req.body?.deal && typeof req.body.deal === "object") payload.deal = req.body.deal;

  await queueWrite(res, "zoho_convert_lead", payload, "convert Lead");
});

router.post("/zoho/crm/:entity/:id/notes", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;
  if (!config.noteNode) {
    res.status(400).json({ error: `Notes are not supported for ${config.module} in this phase` });
    return;
  }

  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  await queueWrite(
    res,
    config.noteNode,
    { [config.idKey]: String(req.params.id), title: String(req.body?.title ?? "Note"), content },
    `add note to ${config.module}`,
  );
});

export default router;
