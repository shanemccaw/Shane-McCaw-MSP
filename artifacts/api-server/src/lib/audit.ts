import {
  db,
  auditLogsTable,
  type AuditActorRole,
  type AuditActionCategory,
} from "@workspace/db";
import { LEGACY_ROLE, effectiveLegacyRole } from "@workspace/db/rbac/legacy-ladder";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "audit" });

export interface AuditEvent {
  actorUserId?: number | null;
  actorName: string;
  /**
   * Real principal that performed the action (#4044 / #1946). Widened from the old
   * two-value `admin | client` to the real closed set — MSP operators, service accounts,
   * platform admins, and agents (#1931) can now be named honestly. `system` is only for a
   * genuinely unattended action with no real principal; never a catch-all where a real
   * actor exists.
   */
  actorRole: AuditActorRole;
  /** The specific action verb (open detail string, e.g. "generate_document", "user.mfa.reset"). */
  actionType: string;
  /**
   * Coarse, filterable operation class (#4044 / #1946) — the enumerable audit catalogue
   * dimension. Optional at the call site: when omitted it is derived from `actionType`
   * on a best-effort basis by {@link deriveAuditActionCategory}, so a not-yet-updated call
   * site still produces a categorised row rather than a NULL. Pass it explicitly whenever
   * the derivation would be wrong for a given action.
   */
  actionCategory?: AuditActionCategory;
  entityType: string;
  entityId?: string | number | null;
  entityLabel?: string | null;
  /**
   * Person-scoped subject (references users.id). Retained for backward compatibility;
   * prefer `tenantId` for real tenant scoping.
   */
  clientId?: number | null;
  /**
   * Real tenant scope (#4044 / #1946) — references tenants.id. A customer-facing audit
   * log scopes to the customer's tenant, not to a single person. Optional: platform-wide
   * actions have no tenant.
   */
  tenantId?: number | null;
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

/**
 * Best-effort mapping from the open `actionType` verb to the coarse, enumerable
 * {@link AuditActionCategory} (#4044 / #1946). Used only as a fallback when a caller does
 * not supply `actionCategory` — it categorises NEW writes; it never reinterprets stored
 * rows (existing rows keep a NULL category — #1946 F). Ordering matters: the more specific
 * classes (delete/auth/security/access) are tested before the generic create/update, so
 * e.g. `user.sessions.revoke_all` lands under `auth`, not `action`.
 */
export function deriveAuditActionCategory(actionType: string): AuditActionCategory | null {
  const a = actionType.toLowerCase();

  // Authentication & session lifecycle.
  if (/(^|[._-])(login|logout|sign_?in|sign_?out|password|mfa|session|token|impersonat|bypass|emergency_bypass)/.test(a)) {
    return "auth";
  }
  // Privileged / cross-boundary access events (break-glass, operator reads, export/download).
  if (/(break[._-]?glass|export|download|reveal)/.test(a)) {
    return "access";
  }
  // Security-consequential grants/revocations (consent, credentials, role grants).
  if (/(consent|credential|grant|revoke|\brbac\b|role[._-](grant|create|delete|update)|permission)/.test(a)) {
    return "security";
  }
  // Deletes (soft or hard) and removals.
  if (/(^|[._-])(delete|hard_delete|soft_delete|remove|purge|erase|destroy)/.test(a)) {
    return "delete";
  }
  // Configuration / preference / policy changes.
  if (/(setting|preference|config|opt[._-]?in|opt[._-]?out|enrollment|policy|toggle|enable|disable)/.test(a)) {
    return "settings";
  }
  // Creations.
  if (/(^|[._-])(create|created|new|add|invite|issue|generate|submit|raise)/.test(a)) {
    return "create";
  }
  // Updates / edits / state transitions.
  if (/(^|[._-])(update|updated|edit|set|change|changed|switch|switched|assign|move|rename|approve|reject|resolve|cancel|cancelled|canceled)/.test(a)) {
    return "update";
  }
  // Everything else that is a real operation but not a single-target CRUD verb.
  return "action";
}

export async function createAuditLog(event: AuditEvent): Promise<AuditLogResult> {
  try {
    await db.insert(auditLogsTable).values({
      actorUserId: event.actorUserId ?? null,
      actorName: event.actorName,
      actorRole: event.actorRole,
      actionType: event.actionType,
      actionCategory: event.actionCategory ?? deriveAuditActionCategory(event.actionType),
      entityType: event.entityType,
      entityId: event.entityId != null ? String(event.entityId) : null,
      entityLabel: event.entityLabel ?? null,
      clientId: event.clientId ?? null,
      tenantId: event.tenantId ?? null,
      projectId: event.projectId ?? null,
      metadata: event.metadata ?? null,
    });
    return { ok: true };
  } catch (err) {
    // Fail open, log LOUDLY (#1946 question C, decided 2026-09-14): an audit write failure
    // never blocks the real action, but it must not pass silently either. Serialize the
    // error explicitly — `log.error({ err }, ...)` alone can flatten a non-Error to `{}` in
    // this repo's log stream — so the alerting-visible line carries the real cause. The one
    // failure class NOT covered here is a genuine crash in the caller (out of a DB-write
    // catch's reach); that stays a distinct failure class by design.
    log.error(
      {
        err,
        errMessage: err instanceof Error ? err.message : String(err),
        errStack: err instanceof Error ? err.stack : undefined,
        actionType: event.actionType,
        actionCategory: event.actionCategory ?? null,
        actorRole: event.actorRole,
        entityType: event.entityType,
        entityId: event.entityId != null ? String(event.entityId) : null,
        tenantId: event.tenantId ?? null,
      },
      "AUDIT WRITE FAILED — action proceeded but produced no audit row",
    );
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

/**
 * Maps an authenticated caller's effective rung (#4044's real actor model) onto the
 * `AuditActorRole` an audit row should carry. Used by the privileged/cross-boundary read
 * auditing added for #4046 — every one of those call sites needs "who is this, really"
 * rather than the raw two-value `user.role`.
 */
export function resolveAuditActorRole(user: { role: "admin" | "client"; mspRole?: string | null }): AuditActorRole {
  const effective = effectiveLegacyRole({ role: user.role, mspRole: user.mspRole ?? null });
  switch (effective) {
    case LEGACY_ROLE.platformAdmin:
      return "platform_admin";
    case LEGACY_ROLE.mspAdmin:
    case LEGACY_ROLE.mspOperator:
      return "msp";
    case LEGACY_ROLE.serviceAccount:
      return "service_account";
    case LEGACY_ROLE.customer:
    case LEGACY_ROLE.free:
    case LEGACY_ROLE.monitoringPending:
    case LEGACY_ROLE.monitoringConsented:
    case LEGACY_ROLE.packPending:
    case LEGACY_ROLE.packConsented:
    case LEGACY_ROLE.retainerPending:
    case LEGACY_ROLE.retainerConsented:
      return "customer";
    default:
      // A real authenticated principal reached this call site (requireAuth already ran) but
      // its rung isn't one of the above — never silently claim a specific role we didn't
      // verify. `system` is the one value reserved for "no real principal" elsewhere in this
      // file's contract, but here there IS a principal; log it plainly rather than guessing.
      return "system";
  }
}

/**
 * A privileged / cross-boundary READ (#4046, part of #1946's settled read boundary,
 * 2026-08-30 + 2026-09-14): break-glass secret reveal, an MSP operator reading a specific
 * customer's data, data export/download, or any other read that crosses a tenant boundary.
 * Ordinary same-tenant list/detail reads are deliberately NOT covered — see #1946.
 *
 * Always categorised `access` (the read-boundary catalogue value) and always fail-open via
 * the same `createAuditLog` every write-path call site uses.
 */
export interface PrivilegedReadEvent {
  actorUserId?: number | null;
  actorName: string;
  actorRole: AuditActorRole;
  actionType: string;
  entityType: string;
  entityId?: string | number | null;
  entityLabel?: string | null;
  tenantId?: number | null;
  clientId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export async function auditPrivilegedRead(event: PrivilegedReadEvent): Promise<AuditLogResult> {
  return createAuditLog({ ...event, actionCategory: "access" });
}
