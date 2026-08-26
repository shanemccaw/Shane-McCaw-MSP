import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { requiredEnv } from "./env.ts";
import { auditLogger } from "./logger.ts";
import { resolveOperatorIdentity } from "./auth.ts";

/**
 * Mandatory audit trail for MCP tool calls — Phase 6 of #1319 (Git #1325).
 *
 * Every tool call this server executes lands as a real row in the platform's
 * own msp_audit_logs table — the same trail the api-server's routes insert
 * into (mspAuditLogsTable) and the same one GET /api/msp/audit
 * (routes/msp-audit-log.ts) reads. Nothing parallel: MCP entries are
 * queryable through the exact same surface, filterable with
 * actionType=mcp.tool.
 *
 * Write tools are why this exists: they operate on REAL production tenants
 * with no testbed gate (Shane's explicit direction on #1319), so this trail
 * is the primary safety net and is WRITE-AHEAD + FAIL-CLOSED for them:
 *
 *  - before a write tool's handler runs, an attempt row (outcome 'partial',
 *    metadata.phase 'attempt') is durably inserted; if that insert fails the
 *    tool is refused — no audit, no write;
 *  - after the handler settles, the same row (by event_id) is finalized to
 *    outcome 'success'/'failure' with the real result or error, duration,
 *    and the actual API calls made. A row left at 'partial'/'attempt' means
 *    the process died mid-call — an honest record that the write was
 *    attempted with completion unknown;
 *  - api-client.ts calls guardApiMutation() before every request, refusing
 *    any mutating HTTP method from a tool that did not declare
 *    audit: { access: "write" } — a tool that forgets the declaration is
 *    blocked at runtime, never silently under-audited.
 *
 * Read tools get one best-effort row after the call; an audit failure there
 * is logged loudly (channel `audit`) but never breaks a read.
 *
 * The write goes DIRECT to Postgres, not through the api-server, on purpose:
 * the trail must capture attempts and failures even when the api-server is
 * down or dies mid-call (exactly the moments a safety net is for), and an
 * HTTP "write my audit log" endpoint would be a spoofable surface the
 * platform doesn't need. This and the startup identity lookup (auth.ts) are
 * the only direct-DB touches in the package.
 */

const USER_AGENT = "shane-msp-mcp/0.1.0";
const RESULT_JSON_CAP = 16_000;

export interface ToolAuditSpec {
  /**
   * "write": the tool mutates real tenant/platform state. Audit is mandatory
   * and write-ahead — the handler does not run (and apiFetch refuses
   * mutating methods) unless the attempt row is durably persisted first.
   * "read": query-only; one best-effort row after the call (the default for
   * tools that declare nothing).
   */
  access: "read" | "write";
  /** Tool arg holding the target tenants.id → msp_audit_logs.customer_id.
   *  Defaults to `customerId` / `tenantId` when present and numeric. */
  tenantArg?: string;
  /** msp_audit_logs.entity_type; defaults to "mcp_tool". */
  entityType?: string;
  /** Tool arg holding the acted-on entity's id → msp_audit_logs.entity_id. */
  entityIdArg?: string;
  /**
   * Tool args named here are masked to "[redacted]" in the audit row's
   * metadata.params — and only there; the handler still receives the real
   * value. For secrets the platform's own routes refuse to persist anywhere
   * (a buyer's password, a verification code — Git #1310's doctrine, applied
   * to create_account in Git #1321). The call itself stays fully audited;
   * only the secret's value is withheld from the durable trail.
   */
  redactParams?: string[];
}

export interface ApiCallNote {
  method: string;
  path: string;
  status?: number;
}

interface AuditCallContext {
  tool: string;
  access: "read" | "write";
  correlationId: string;
  /** true once the write-ahead attempt row is durably in msp_audit_logs. */
  attemptPersisted: boolean;
  apiCalls: ApiCallNote[];
}

const callContext = new AsyncLocalStorage<AuditCallContext>();

let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requiredEnv("DATABASE_URL"),
      max: 2,
      allowExitOnIdle: true,
    });
  }
  return pool;
}

/** Thrown when a WRITE tool is refused because its attempt row could not be
 *  persisted. The registry surfaces the message verbatim as an MCP isError. */
export class AuditUnavailableError extends Error {
  constructor(tool: string, cause: unknown) {
    super(
      `AUDIT REFUSAL: write tool '${tool}' not executed — could not persist the audit attempt row ` +
        `to msp_audit_logs (${cause instanceof Error ? cause.message : String(cause)}). ` +
        `Mandatory audit logging (Git #1325) fails closed: no audit, no write.`,
    );
    this.name = "AuditUnavailableError";
  }
}

export interface AuditEventInput {
  /** Provide to control the row's event_id (auditedToolCall does, so it can
   *  finalize the same row later); defaults to a fresh UUID. */
  eventId?: string;
  actionType: string;
  outcome: "success" | "failure" | "partial";
  customerId?: number | null;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  /** Defaults to the running tool call's correlation id, when inside one. */
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Low-level insert into msp_audit_logs as the resolved operator. The registry
 * audits every tool call automatically — call this directly (Phase 4/5) only
 * for EXTRA per-entity rows inside one tool call (e.g. one row per tenant
 * touched in a batch); such rows inherit the call's correlation id so the
 * trail groups them. Returns the row's event_id.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<string> {
  // Cached from server boot in real operation; a failure here means the
  // audit trail's DB is unreachable, which callers treat as audit-unavailable.
  const op = await resolveOperatorIdentity();
  const eventId = input.eventId ?? randomUUID();
  const correlationId = input.correlationId ?? callContext.getStore()?.correlationId ?? null;
  await getPool().query(
    `INSERT INTO msp_audit_logs
       (event_id, actor_user_id, actor_role, msp_id, customer_id,
        action_type, entity_type, entity_id, entity_label,
        correlation_id, user_agent, outcome, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      eventId,
      op.id,
      op.mspRole ?? op.role,
      op.mspId,
      input.customerId ?? null,
      input.actionType,
      input.entityType ?? "mcp_tool",
      input.entityId ?? null,
      input.entityLabel ?? null,
      correlationId,
      USER_AGENT,
      input.outcome,
      safeJson({ operatorEmail: op.email, ...(input.metadata ?? {}) }),
    ],
  );
  auditLogger.info(
    {
      eventId,
      actionType: input.actionType,
      outcome: input.outcome,
      customerId: input.customerId ?? null,
      correlationId,
    },
    "audit event recorded",
  );
  return eventId;
}

/** Finalizes a previously-inserted row (by event_id) with the real outcome. */
export async function finalizeAuditEvent(
  eventId: string,
  outcome: "success" | "failure" | "partial",
  metadata: Record<string, unknown>,
): Promise<void> {
  const op = await resolveOperatorIdentity();
  await getPool().query(
    `UPDATE msp_audit_logs SET outcome = $2, metadata = $3::jsonb WHERE event_id = $1`,
    [eventId, outcome, safeJson({ operatorEmail: op.email, ...metadata })],
  );
  auditLogger.info({ eventId, outcome }, "audit event finalized");
}

/**
 * Wraps one tool call in the mandatory audit flow described in the module
 * header. Used by the registry for every registered tool; `run` is the
 * tool's own handler, executed inside the call's AsyncLocalStorage context
 * so api-client can enforce the write gate and note real API calls.
 */
export async function auditedToolCall<T>(
  tool: { name: string; audit?: ToolAuditSpec },
  args: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const spec: ToolAuditSpec = tool.audit ?? { access: "read" };
  const eventId = randomUUID();
  const startedAt = Date.now();
  const ctx: AuditCallContext = {
    tool: tool.name,
    access: spec.access,
    correlationId: randomUUID(),
    attemptPersisted: false,
    apiCalls: [],
  };
  const common = {
    actionType: `mcp.tool.${tool.name}`,
    customerId: tenantIdOf(args, spec),
    entityType: spec.entityType ?? "mcp_tool",
    entityId: entityIdOf(args, spec),
    entityLabel: tool.name,
    correlationId: ctx.correlationId,
  };
  // operatorEmail is injected by recordAuditEvent/finalizeAuditEvent (which
  // resolve the boot-cached identity themselves) — deliberately NOT resolved
  // eagerly here, so an unreachable audit DB refuses write tools through the
  // branded AuditUnavailableError below and stays best-effort for reads.
  const baseMetadata: Record<string, unknown> = {
    via: "mcp",
    transport: "stdio",
    tool: tool.name,
    access: spec.access,
    params: redactedParams(args, spec.redactParams),
  };

  if (spec.access === "write") {
    try {
      await recordAuditEvent({
        ...common,
        eventId,
        outcome: "partial",
        metadata: { ...baseMetadata, phase: "attempt" },
      });
      ctx.attemptPersisted = true;
    } catch (err) {
      auditLogger.error(
        {
          tool: tool.name,
          eventId,
          err: err instanceof Error ? (err.stack ?? err.message) : String(err),
        },
        "REFUSING write tool — audit attempt row could not be persisted",
      );
      throw new AuditUnavailableError(tool.name, err);
    }
  }

  try {
    const result = await callContext.run(ctx, run);
    const metadata = {
      ...baseMetadata,
      phase: "completed",
      durationMs: Date.now() - startedAt,
      apiCalls: ctx.apiCalls,
      result: capResult(result),
    };
    try {
      if (spec.access === "write") await finalizeAuditEvent(eventId, "success", metadata);
      else await recordAuditEvent({ ...common, eventId, outcome: "success", metadata });
    } catch (err) {
      // The call itself succeeded. A write tool's attempt row remains at
      // outcome 'partial' — still an honest record that the call happened.
      auditLogger.error(
        {
          eventId,
          tool: tool.name,
          access: spec.access,
          err: err instanceof Error ? (err.stack ?? err.message) : String(err),
        },
        spec.access === "write"
          ? "audit finalize FAILED — attempt row remains outcome=partial"
          : "read-tool audit insert failed (best-effort; result still returned)",
      );
    }
    return result;
  } catch (err) {
    const metadata = {
      ...baseMetadata,
      phase: "completed",
      durationMs: Date.now() - startedAt,
      apiCalls: ctx.apiCalls,
      error: err instanceof Error ? err.message : String(err),
    };
    try {
      if (spec.access === "write") await finalizeAuditEvent(eventId, "failure", metadata);
      else await recordAuditEvent({ ...common, eventId, outcome: "failure", metadata });
    } catch (auditErr) {
      auditLogger.error(
        {
          eventId,
          tool: tool.name,
          err: auditErr instanceof Error ? (auditErr.stack ?? auditErr.message) : String(auditErr),
        },
        "audit of failed tool call could not be persisted",
      );
    }
    throw err;
  }
}

/**
 * Called by api-client.ts before every request. Mutating methods are only
 * allowed inside a tool call whose ToolDef declared audit access "write" AND
 * whose write-ahead attempt row is already durably persisted — the
 * structural teeth of "mandatory": an undeclared write is blocked at
 * runtime, never silently under-audited.
 */
export function guardApiMutation(method: string, path: string): void {
  if (method === "GET") return;
  const ctx = callContext.getStore();
  if (!ctx) {
    throw new Error(
      `BLOCKED: ${method} ${path} attempted outside any MCP tool call — mutating API calls must run inside a registered write tool (Git #1325)`,
    );
  }
  if (ctx.access !== "write" || !ctx.attemptPersisted) {
    throw new Error(
      `BLOCKED: tool '${ctx.tool}' attempted ${method} ${path} without audit: { access: "write" } — ` +
        `write tools require a durably persisted audit entry before any mutating call (Git #1325)`,
    );
  }
}

/** Notes an API call the running tool makes; lands in metadata.apiCalls.
 *  Returns the note so api-client can fill in the status afterwards. */
export function noteApiCall(method: string, path: string): ApiCallNote | undefined {
  const ctx = callContext.getStore();
  if (!ctx) return undefined;
  const note: ApiCallNote = { method, path };
  ctx.apiCalls.push(note);
  return note;
}

/** Full params are stored verbatim except args the spec names in redactParams
 *  — those are masked so a secret never persists in the trail. */
function redactedParams(
  args: Record<string, unknown>,
  redact: string[] | undefined,
): Record<string, unknown> {
  if (!redact?.length) return args;
  const masked: Record<string, unknown> = { ...args };
  for (const key of redact) {
    if (masked[key] !== undefined) masked[key] = "[redacted]";
  }
  return masked;
}

function tenantIdOf(args: Record<string, unknown>, spec: ToolAuditSpec): number | null {
  const key =
    spec.tenantArg ??
    (typeof args["customerId"] === "number"
      ? "customerId"
      : typeof args["tenantId"] === "number"
        ? "tenantId"
        : undefined);
  if (!key) return null;
  const raw = args[key];
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

function entityIdOf(args: Record<string, unknown>, spec: ToolAuditSpec): string | null {
  if (!spec.entityIdArg) return null;
  const raw = args[spec.entityIdArg];
  return raw === undefined || raw === null ? null : String(raw);
}

/** Full params are stored verbatim; results are size-capped so a bulky query
 *  answer can't bloat the trail — capped entries keep a preview + real size. */
function capResult(result: unknown): unknown {
  let json: string | undefined;
  try {
    json = JSON.stringify(result);
  } catch {
    return { unserializableResult: true };
  }
  if (json === undefined) return null;
  if (json.length <= RESULT_JSON_CAP) return result;
  return { resultTruncated: true, fullLength: json.length, preview: json.slice(0, RESULT_JSON_CAP) };
}

function safeJson(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return JSON.stringify({
      unserializableMetadata: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
