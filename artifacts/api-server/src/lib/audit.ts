import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "audit" });

export interface AuditEvent {
  actorUserId?: number | null;
  actorName: string;
  actorRole: "admin" | "client";
  actionType: string;
  entityType: string;
  entityId?: string | number | null;
  entityLabel?: string | null;
  clientId?: number | null;
  projectId?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Real result of the write, not just a fire-and-forget signal (Git #3935). A caller
 * that ignores this — `await createAuditLog(...)` with the result discarded — behaves
 * exactly as before: the failure is still logged and nothing throws. A caller for whom
 * a missing audit trail is itself unacceptable (a compliance-sensitive action, per
 * #1944's retention lifecycle) can check `ok` and act on it, or use
 * `createAuditLogOrThrow` below.
 */
export interface AuditLogResult {
  ok: boolean;
  /** Set only when `ok` is false — the real error `db.insert` threw. */
  error?: unknown;
}

export async function createAuditLog(event: AuditEvent): Promise<AuditLogResult> {
  try {
    await db.insert(auditLogsTable).values({
      actorUserId: event.actorUserId ?? null,
      actorName: event.actorName,
      actorRole: event.actorRole,
      actionType: event.actionType,
      entityType: event.entityType,
      entityId: event.entityId != null ? String(event.entityId) : null,
      entityLabel: event.entityLabel ?? null,
      clientId: event.clientId ?? null,
      projectId: event.projectId ?? null,
      metadata: event.metadata ?? null,
    });
    return { ok: true };
  } catch (err) {
    log.error({ err, event }, "createAuditLog: failed to write audit entry");
    return { ok: false, error: err };
  }
}

/** Thrown by `createAuditLogOrThrow` — carries the original event and cause for the catch site. */
export class AuditWriteFailedError extends Error {
  readonly event: AuditEvent;
  readonly cause: unknown;
  constructor(event: AuditEvent, cause: unknown) {
    super(`createAuditLog: failed to write audit entry for action "${event.actionType}"`);
    this.name = "AuditWriteFailedError";
    this.event = event;
    this.cause = cause;
  }
}

/**
 * Same write, but for a call site where a missing audit trail must not pass silently
 * (Git #3935) — throws `AuditWriteFailedError` instead of swallowing. The write itself
 * has already been attempted and logged by `createAuditLog`; this only decides whether
 * the failure propagates.
 */
export async function createAuditLogOrThrow(event: AuditEvent): Promise<void> {
  const result = await createAuditLog(event);
  if (!result.ok) {
    throw new AuditWriteFailedError(event, result.error);
  }
}
