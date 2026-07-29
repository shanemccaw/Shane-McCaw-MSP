// EngageBay node execution layer (EngageBay Webhooks + Workflow Nodes, #105).
// Mirrors zoho-crm.ts's split from its pure catalog (zoho-crm-nodes.ts): the
// catalog lives in the dependency-free engagebay-nodes.ts, this file owns
// everything that pulls in the client, the drain, and msp-jobs.ts (@workspace/db).
//
// ── The sync/queued split ────────────────────────────────────────────────────
// Same split #83 established for Zoho CRM:
//   READ  nodes (engagebay_get_*, engagebay_search_*, engagebay_list_*) call
//         the EngageBay client inline and return real records.
//   WRITE nodes (create/update/add_tag/start_sequence) NEVER call EngageBay on
//         the request path. They enqueue an msp_job_queue row and return
//         { queued: true, jobId } — 202 never 200-with-a-record. The
//         registered handler below is what actually talks to EngageBay, on
//         the next 5-minute drain.
//
// No delete nodes — deliberate. EngageBay is the system of record and
// deletion stays a manual EngageBay-side action.

import {
  createContact,
  updateContact,
  addTag,
  startSequence,
  getContact,
  getContactByEmail,
  searchContacts,
  listTags,
  asRecordArray,
  asRecordOrNull,
  EngageBayApiError,
  type EngageBayContactInput,
} from "./engagebay-client.ts";
import { registerEngageBayJobHandler } from "./engagebay-batch-drain.ts";
import { enqueueJob } from "./msp-jobs.ts";
import { logger } from "./logger";

import {
  ENGAGEBAY_NODES,
  ENGAGEBAY_NODE_TYPES,
  isEngageBayNodeType,
  getEngageBayNodeSpec,
  type EngageBayNodeSpec,
} from "./engagebay-nodes.ts";

export {
  ENGAGEBAY_NODES,
  ENGAGEBAY_NODE_TYPES,
  isEngageBayNodeType,
  getEngageBayNodeSpec,
  type EngageBayNodeSpec,
};

const log = logger.child({ channel: "integration.engagebay" });

const NODE_SPECS = new Map(ENGAGEBAY_NODES.map((n) => [n.nodeType, n]));

// ── Helpers ──────────────────────────────────────────────────────────────────
// asRecordArray/asRecordOrNull now live in engagebay-client.ts (moved there in
// #106 so engagebay-crm.ts can share them instead of duplicating).

/**
 * Only string/number/boolean field values are forwarded to EngageBay.
 * `fields`/`properties` on a node is free-form operator input, so anything
 * else is dropped rather than serialized into a shape EngageBay will reject
 * for the whole record.
 */
function sanitizeProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val === null) { out[key] = null; continue; }
    const t = typeof val;
    if (t === "string" || t === "number" || t === "boolean") out[key] = val;
  }
  return out;
}

function requireString(payload: Record<string, unknown>, key: string, nodeType: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${nodeType} requires a non-empty "${key}"`);
  }
  return value.trim();
}

// ── Write operations (drain handlers — these are what actually call EngageBay) ─

type WriteHandler = (payload: Record<string, unknown>, mspId: number | undefined) => Promise<Record<string, unknown>>;

function buildContactInput(payload: Record<string, unknown>): EngageBayContactInput {
  const input: EngageBayContactInput = { email: requireString(payload, "email", "engagebay contact") };
  if (typeof payload.name === "string") input.name = payload.name;
  const properties = sanitizeProperties(payload.properties);
  if (Object.keys(properties).length > 0) input.properties = properties;
  if (Array.isArray(payload.tags)) {
    input.tags = (payload.tags as unknown[])
      .filter((t): t is string => typeof t === "string")
      .map((tag) => ({ tag }));
  }
  return input;
}

const WRITE_HANDLERS: Record<string, WriteHandler> = {
  engagebay_create_contact: async (p, msp) => {
    const result = await createContact(buildContactInput(p), msp);
    return { action: "create_contact", result };
  },
  engagebay_update_contact: async (p, msp) => {
    const contactId = requireString(p, "contactId", "engagebay_update_contact");
    const result = await updateContact({ ...buildContactInput(p), id: contactId }, msp);
    return { action: "update_contact", contactId, result };
  },
  engagebay_add_tag: async (p, msp) => {
    const contactId = requireString(p, "contactId", "engagebay_add_tag");
    const tag = requireString(p, "tag", "engagebay_add_tag");
    const result = await addTag(contactId, tag, msp);
    return { action: "add_tag", contactId, tag, result };
  },
  engagebay_start_sequence: async (p, msp) => {
    const email = requireString(p, "email", "engagebay_start_sequence");
    const sequenceId = requireString(p, "sequenceId", "engagebay_start_sequence");
    const result = await startSequence(email, sequenceId, msp);
    return { action: "start_sequence", email, sequenceId, result };
  },
};

let handlersRegistered = false;

/**
 * Registers every write node's handler on the drain. Idempotent — safe to
 * call from more than one entry point (route mounting, executor import,
 * tests) without double-registering.
 */
export function registerEngageBayNodeJobHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  for (const [jobType, handler] of Object.entries(WRITE_HANDLERS)) {
    registerEngageBayJobHandler(jobType, async (job) => {
      const mspId = job.mspId ?? undefined;
      try {
        const result = await handler(job.payload, mspId);
        log.info({ jobId: job.jobId, jobType, attempt: job.attemptCount, result }, "engagebay-nodes: write applied");
        return result;
      } catch (err) {
        // Surface EngageBay's own body on an API error — the drain records
        // the message on the job row and in the DLQ, and
        // "EngageBay API responded 400" alone is not diagnosable.
        if (err instanceof EngageBayApiError) {
          throw new Error(`${jobType} failed (HTTP ${err.status}): ${JSON.stringify(err.body)}`);
        }
        throw err;
      }
    });
  }

  log.info({ count: Object.keys(WRITE_HANDLERS).length }, "engagebay-nodes: registered write job handlers");
}

// ── Enqueue side (what write nodes actually call) ────────────────────────────

export interface EnqueueEngageBayWriteOptions {
  mspId?: number;
  customerId?: number;
  correlationId?: string;
}

/**
 * Queues an EngageBay write. This is the ONLY way a workflow node causes an
 * EngageBay write — nothing on a request path blocks on a live EngageBay
 * call. The job is applied by the seeded 5-minute "EngageBay Queue Drain"
 * workflow, so callers must present the result as "queued / syncing", never
 * as a completed write.
 */
export async function enqueueEngageBayWrite(
  nodeType: string,
  payload: Record<string, unknown>,
  opts: EnqueueEngageBayWriteOptions = {},
): Promise<{ queued: true; jobId: string; jobType: string }> {
  if (!WRITE_HANDLERS[nodeType]) {
    throw new Error(`Unknown EngageBay write node type: ${nodeType}`);
  }
  const jobId = await enqueueJob(nodeType, payload, {
    mspId: opts.mspId,
    customerId: opts.customerId,
    correlationId: opts.correlationId,
  });
  log.info({ jobId, jobType: nodeType }, "engagebay-nodes: write queued for next drain");
  return { queued: true, jobId, jobType: nodeType };
}

// ── Executor entry point ─────────────────────────────────────────────────────

/**
 * Executes one EngageBay node. `resolve` is the executor's own placeholder
 * interpolation, passed in so this module stays independent of the executor.
 *
 * Reads return records inline. Writes return `{ queued: true, jobId }` — the
 * node has NOT written to EngageBay when it returns, by design.
 */
export async function executeEngageBayNode(
  nodeType: string,
  data: Record<string, unknown>,
  resolve: (value: unknown) => string | undefined,
): Promise<Record<string, unknown>> {
  const spec = NODE_SPECS.get(nodeType);
  if (!spec) throw new Error(`Not an EngageBay node type: ${nodeType}`);

  const mspIdRaw = Number(resolve(data.mspId) ?? data.mspId);
  const mspId = Number.isFinite(mspIdRaw) && mspIdRaw > 0 ? mspIdRaw : undefined;

  if (spec.mode === "read") {
    switch (nodeType) {
      case "engagebay_get_contact": {
        const contactId = resolve(data.contactId);
        if (!contactId) return { error: "engagebay_get_contact requires contactId", found: false };
        const body = await getContact(contactId, mspId);
        const record = asRecordOrNull(body);
        return { found: Boolean(record), record };
      }
      case "engagebay_get_contact_by_email": {
        const email = resolve(data.email);
        if (!email) return { error: "engagebay_get_contact_by_email requires email", found: false };
        const body = await getContactByEmail(email, mspId);
        const record = asRecordOrNull(body);
        return { found: Boolean(record), record };
      }
      case "engagebay_search_contacts": {
        const query = resolve(data.query) ?? resolve(data.search);
        if (!query) return { error: "engagebay_search_contacts requires a search query", records: [], count: 0 };
        const body = await searchContacts(query, mspId);
        const records = asRecordArray(body);
        return { records, count: records.length };
      }
      case "engagebay_list_tags": {
        const body = await listTags(mspId);
        const tags = asRecordArray(body);
        return { tags, count: tags.length };
      }
      default:
        throw new Error(`Unhandled EngageBay read node: ${nodeType}`);
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

  const queued = await enqueueEngageBayWrite(nodeType, payload, { mspId });
  return { ...queued, note: "queued — applied by the next EngageBay Queue Drain (runs every 5 minutes)" };
}

// Register on import so the drain has handlers regardless of which entry point
// pulls this module in first.
registerEngageBayNodeJobHandlers();
