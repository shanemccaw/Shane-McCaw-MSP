// EngageBay CRM Admin Panel routes (#106).
//
//   GET  /api/engagebay/crm/:entity            — paginated list/search (SYNCHRONOUS)
//   GET  /api/engagebay/crm/:entity/:id        — single record detail (SYNCHRONOUS)
//   POST /api/engagebay/crm/:entity            — create        (QUEUED)
//   PATCH/api/engagebay/crm/:entity/:id        — update        (QUEUED)
//   POST /api/engagebay/crm/:entity/:id/tags   — add tag       (QUEUED)
//   GET  /api/engagebay/jobs/:jobId            — queued-write status for the UI
//
// Mirrors zoho-crm.ts's read/write split: reads call EngageBay inline on the
// request path (listAllContacts by default, searchContacts when ?search= is
// present — /dev/api/search is not confirmed to return all contacts on an
// empty query, see engagebay-client.ts). Writes NEVER call EngageBay on the
// request path — they go through the already-exported enqueueEngageBayWrite
// (engagebay-nodes-exec.ts) and answer 202 with a jobId, applied by the seeded
// 5-minute "EngageBay Queue Drain".
//
// ENTITIES is contacts-only this phase, kept as a table (not a single hardcoded
// route set) so Tags (#107) and Sequences (#108) can extend it later without a
// route-shape change.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspJobQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import {
  listAllContacts,
  searchContacts,
  getContact,
  asRecordArray,
  asRecordOrNull,
  EngageBayNotConnectedError,
  EngageBayApiError,
  ENGAGEBAY_DEFAULT_MSP_ID,
  type EngageBayContactListResult,
} from "../lib/engagebay-client.ts";
import { enqueueEngageBayWrite } from "../lib/engagebay-nodes-exec.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.engagebay" });

const router: IRouter = Router();

// ── Entity routing table ─────────────────────────────────────────────────────

interface EntityListParams {
  cursor?: string;
  pageSize?: number;
  search?: string;
}

interface EntityConfig {
  list: (params: EntityListParams) => Promise<EngageBayContactListResult>;
  getRecord: (id: string) => Promise<Record<string, unknown> | null>;
  createNode: string;
  updateNode: string;
  addTagNode: string | null;
  /** Payload key the write handlers expect the record id under. */
  idKey: string;
}

async function listContactsForRoute(params: EntityListParams): Promise<EngageBayContactListResult> {
  const search = params.search?.trim();
  if (search) {
    const body = await searchContacts(search);
    const records = asRecordArray(body);
    return { records, cursor: null, more: false };
  }
  return listAllContacts(params.cursor, params.pageSize);
}

const ENTITIES: Record<string, EntityConfig> = {
  contacts: {
    list: listContactsForRoute,
    getRecord: async (id) => asRecordOrNull(await getContact(id)),
    createNode: "engagebay_create_contact",
    updateNode: "engagebay_update_contact",
    addTagNode: "engagebay_add_tag",
    idKey: "contactId",
  },
};

function resolveEntity(req: Request, res: Response): EntityConfig | null {
  const config = ENTITIES[String(req.params.entity ?? "").toLowerCase()];
  if (!config) {
    res.status(404).json({ error: `Unknown EngageBay CRM entity — expected one of: ${Object.keys(ENTITIES).join(", ")}` });
    return null;
  }
  return config;
}

/**
 * Maps EngageBay/connection failures onto honest HTTP status codes, mirroring
 * zoho-crm.ts's handleZohoError. A missing API key is a 503 with an
 * actionable message, not a 500 — the Admin Panel renders it as "connect
 * EngageBay" rather than as a crash.
 */
function handleEngageBayError(err: unknown, res: Response, context: string): void {
  if (err instanceof EngageBayNotConnectedError) {
    log.warn({ context }, "engagebay-crm route: EngageBay not connected");
    res.status(503).json({ error: err.message, code: "engagebay_not_connected" });
    return;
  }
  if (err instanceof EngageBayApiError) {
    log.warn({ context, status: err.status }, "engagebay-crm route: EngageBay API error");
    res.status(err.status >= 400 && err.status < 500 ? err.status : 502).json({
      error: `EngageBay API error (${err.status})`,
      code: "engagebay_api_error",
      details: err.body,
    });
    return;
  }
  log.error({ err, context }, "engagebay-crm route: unexpected failure");
  res.status(500).json({ error: "Unexpected failure talking to EngageBay" });
}

// ── Reads (synchronous — these DO call EngageBay on the request path) ────────

router.get("/engagebay/jobs/:jobId", requireAdmin, async (req: Request, res: Response) => {
  // Lets the UI turn "queued" into "synced"/"failed" without inventing a
  // second source of truth: it reports the real msp_job_queue row the
  // EngageBay Queue Drain updates.
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
    log.error({ err }, "engagebay-crm route: job status lookup failed");
    res.status(500).json({ error: "Failed to read job status" });
  }
});

router.get("/engagebay/crm/:entity", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
  const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;

  try {
    const result = await config.list({ cursor, pageSize, search });
    res.json({ entity: req.params.entity, ...result });
  } catch (err) {
    handleEngageBayError(err, res, `list ${req.params.entity}`);
  }
});

router.get("/engagebay/crm/:entity/:id", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  try {
    const record = await config.getRecord(String(req.params.id));
    if (!record) {
      res.status(404).json({ error: `${req.params.entity} record not found in EngageBay` });
      return;
    }
    res.json({ entity: req.params.entity, record });
  } catch (err) {
    handleEngageBayError(err, res, `get ${req.params.entity}`);
  }
});

// ── Writes (queued — these never call EngageBay on the request path) ─────────

/**
 * 202 + jobId is the contract for every write below. Returning 200 with a
 * record would be a lie: at this point the job row exists and EngageBay has
 * not been contacted at all.
 */
async function queueWrite(
  res: Response,
  nodeType: string,
  payload: Record<string, unknown>,
  action: string,
): Promise<void> {
  try {
    const queued = await enqueueEngageBayWrite(nodeType, payload, { mspId: ENGAGEBAY_DEFAULT_MSP_ID });
    res.status(202).json({
      ...queued,
      action,
      status: "queued",
      message: "Queued — the EngageBay Queue Drain applies this within 5 minutes.",
    });
  } catch (err) {
    log.error({ err, nodeType }, "engagebay-crm route: failed to queue write");
    res.status(500).json({ error: "Failed to queue the EngageBay write" });
  }
}

/** Only string/name/properties/tags survive onto the queued payload. */
function sanitizeContactPayload(body: unknown): Record<string, unknown> {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof src.email === "string" && src.email.trim()) out.email = src.email.trim();
  if (typeof src.name === "string" && src.name.trim()) out.name = src.name.trim();
  if (src.properties && typeof src.properties === "object" && !Array.isArray(src.properties)) {
    out.properties = src.properties;
  }
  if (Array.isArray(src.tags)) {
    const tags = src.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    if (tags.length > 0) out.tags = tags;
  }
  return out;
}

router.post("/engagebay/crm/:entity", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  const payload = sanitizeContactPayload(req.body);
  if (typeof payload.email !== "string" || !payload.email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  await queueWrite(res, config.createNode, payload, `create ${req.params.entity}`);
});

router.patch("/engagebay/crm/:entity/:id", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;

  const payload = sanitizeContactPayload(req.body);
  if (Object.keys(payload).length === 0) {
    res.status(400).json({ error: "No writable fields supplied" });
    return;
  }

  await queueWrite(
    res,
    config.updateNode,
    { [config.idKey]: String(req.params.id), ...payload },
    `update ${req.params.entity}`,
  );
});

router.post("/engagebay/crm/:entity/:id/tags", requireAdmin, async (req: Request, res: Response) => {
  const config = resolveEntity(req, res);
  if (!config) return;
  if (!config.addTagNode) {
    res.status(400).json({ error: `Tags are not supported for ${req.params.entity} in this phase` });
    return;
  }

  const tag = typeof req.body?.tag === "string" ? req.body.tag.trim() : "";
  if (!tag) {
    res.status(400).json({ error: "tag is required" });
    return;
  }

  await queueWrite(
    res,
    config.addTagNode,
    { [config.idKey]: String(req.params.id), tag },
    `add tag to ${req.params.entity}`,
  );
});

export default router;
