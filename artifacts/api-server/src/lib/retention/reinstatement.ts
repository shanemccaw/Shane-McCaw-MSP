/**
 * REINSTATEMENT REQUESTS — the gated customer's fourth action (Git #2936).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What #2936 actually settled, and what it did not
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Settled (Shane, 2026-09-05): a lapse is *"not a hard lockout — the customer retains
 * real limited access: they can still log in, download their data, delete their own data,
 * and request reinstatement."* Export and deletion already existed as real endpoints
 * (`/portal/data-export`, `/portal/deletion-request`) and only needed adding to the
 * gate's allowlist. Requesting reinstatement did not exist at all; this module is it.
 *
 * Left open by #2936, and SETTLED by #2999 (Shane, 2026-09-07): what happens to a
 * request once it is made. #2936's dispatch asked it explicitly — *"does it notify the
 * MSP? A real support ticket? A real self-service resume-if-MSP-resumes check?"* — and
 * instructed that if it were genuinely ambiguous, the options be reported rather than
 * guessed. It was ambiguous, structurally: in the cascade case the party who would
 * normally act on the request is the MSP, and the MSP is the one who stopped paying.
 *
 * #2999's answer is **options 1 + 3**, the combination its own analysis identified as the
 * one that survives the cascade case:
 *
 *   1. **Auto-resume** — the mechanic described below, already built and unchanged.
 *   3. **A real Zoho Desk ticket**, raised the moment the row lands, addressed to the
 *      PLATFORM's own Desk rather than the customer's MSP — which is what defuses the
 *      objection #2999 raised against option 3. See `reinstatement-ticket.ts`.
 *
 * Options 2 (notify the customer's own MSP), 4 (a platform-side operator queue) and 5
 * (conversion to direct billing) were explicitly not chosen and are not built.
 *
 * So this module holds the part that is common to both and cannot be skipped by either —
 * a durable, honest record that the customer asked, with a snapshot of what they were
 * gated by when they asked. The ticket reads this row and is recorded back onto it,
 * because a notification that was fired once and stored nowhere is exactly what this
 * table exists to avoid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The one mechanic that IS unambiguous, and is wired
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * *"A real self-service resume-if-MSP-resumes check"* needs nothing built: #2765's
 * reconciliation already reopens a customer the moment the predicate that closed them
 * flips back, whether that was their own subscription or — after #2936 — their MSP's.
 * What this module adds is the bookkeeping that goes with it: when the portal genuinely
 * reopens, `resolveOpenReinstatementRequests()` closes the customer's open request with
 * the real reason, so a queue of open requests never accumulates rows for customers who
 * are already back in.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  retentionReinstatementRequestsTable,
  tenantsTable,
  type RetentionReinstatementRequest,
} from "@workspace/db";
import { logger } from "../logger";

const log = logger.child({ channel: "system.core" });
const auditLog = logger.child({ channel: "audit" });

/** The customer's note is a real field, capped rather than silently truncated elsewhere. */
export const REINSTATEMENT_NOTE_MAX = 2000;

/** Written when the portal reopened on its own and the request no longer has a subject. */
export const REINSTATEMENT_RESOLUTION_PORTAL_REOPENED = "portal_reopened";

export interface SubmitReinstatementRequestInput {
  tenantId: number;
  requestedByUserId: number | null;
  note: string | null;
  /** The resolved `billingSource` at request time — `"msp_subscription"` for a cascade. */
  lapseSource: string | null;
  lapseWasMspCascade: boolean;
  /** `tenants.subscription_lapsed_at` as it stood. Null when no lapse instant is stamped yet. */
  lapsedAt: Date | null;
}

export type SubmitReinstatementRequestResult =
  | { outcome: "created"; request: RetentionReinstatementRequest }
  /** One was already open. Returned rather than erroring — asking twice is not a fault. */
  | { outcome: "already_open"; request: RetentionReinstatementRequest }
  | { outcome: "tenant_missing" };

/**
 * Record a reinstatement request for one customer.
 *
 * Idempotent per customer while a request is open, enforced by the partial unique index
 * rather than by a read-then-write: two clicks a millisecond apart are a real thing a
 * wall does, and the second one must return the first request instead of raising an
 * error the customer would read as "your request failed".
 */
export async function submitReinstatementRequest(
  input: SubmitReinstatementRequestInput,
): Promise<SubmitReinstatementRequestResult> {
  const [tenant] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, input.tenantId))
    .limit(1);

  if (!tenant) return { outcome: "tenant_missing" };

  const note = input.note?.trim() ? input.note.trim().slice(0, REINSTATEMENT_NOTE_MAX) : null;

  const inserted = await db
    .insert(retentionReinstatementRequestsTable)
    .values({
      tenantId: tenant.id,
      mspId: tenant.mspId,
      requestedByUserId: input.requestedByUserId,
      note,
      lapseSource: input.lapseSource,
      lapseWasMspCascade: input.lapseWasMspCascade,
      lapsedAt: input.lapsedAt,
    })
    // The conflict target is the partial unique index on `(tenant_id) WHERE status =
    // 'open'`, so its predicate has to be repeated here for the planner to match it —
    // the same 42P10 trap `recordTenantSubscription()` documents. On
    // `onConflictDoNothing` drizzle names that predicate `where` (it is `targetWhere`
    // only on `onConflictDoUpdate`, where a second `setWhere` also exists).
    .onConflictDoNothing({
      target: retentionReinstatementRequestsTable.tenantId,
      where: eq(retentionReinstatementRequestsTable.status, "open"),
    })
    .returning();

  if (inserted[0]) {
    auditLog.info(
      {
        actionType: "retention.reinstatement.requested",
        tenantId: tenant.id,
        mspId: tenant.mspId,
        requestId: inserted[0].id,
        lapseSource: input.lapseSource,
        lapseWasMspCascade: input.lapseWasMspCascade,
        lapsedAt: input.lapsedAt?.toISOString() ?? null,
        occurredAt: new Date().toISOString(),
      },
      "audit: gated customer requested reinstatement",
    );
    await notifyOnCreated(inserted[0]);
    return { outcome: "created", request: inserted[0] };
  }

  const existing = await readOpenReinstatementRequest(tenant.id);
  if (existing) return { outcome: "already_open", request: existing };

  // The insert conflicted and yet nothing is open — the only way that happens is a
  // concurrent resolve landing between the two statements. Retry once; a second failure
  // is a real fault and should surface rather than be swallowed into a silent no-op.
  const retried = await db
    .insert(retentionReinstatementRequestsTable)
    .values({
      tenantId: tenant.id,
      mspId: tenant.mspId,
      requestedByUserId: input.requestedByUserId,
      note,
      lapseSource: input.lapseSource,
      lapseWasMspCascade: input.lapseWasMspCascade,
      lapsedAt: input.lapsedAt,
    })
    .returning();

  await notifyOnCreated(retried[0]!);
  return { outcome: "created", request: retried[0]! };
}

/**
 * #2999's notification, fired on every path that genuinely creates a row and on no other.
 *
 * Shane settled #2999 on 2026-09-07 as options 1 + 3: auto-resume (already built —
 * `resolveOpenReinstatementRequests()` below) plus ONE real Zoho Desk ticket raised the
 * moment the request lands, reusing `enqueueEscalationTicket()`. Options 2, 4 and 5
 * (notify the customer's own MSP, a platform operator queue, conversion to direct
 * billing) were explicitly not chosen and are not built.
 *
 * It hangs off the insert rather than off the route so that "the moment a row lands" is
 * literally true — a second caller of `submitReinstatementRequest()` cannot accidentally
 * create a silent request. It fires on `created` only: `already_open` is the wall
 * double-submitting, and that must not raise a second ticket for the same ask.
 *
 * Dynamically imported so this module keeps a clean dependency shape — the retention core
 * does not statically pull in the Zoho integration, matching the way zoho-desk.ts itself
 * reaches for `mailer.ts`/`web-push.ts`. Never throws: a gated customer's request must be
 * recorded even when Zoho is unreachable, and `raiseReinstatementTicket()` records the
 * reason on the row instead (see `ticket_error`).
 */
async function notifyOnCreated(request: RetentionReinstatementRequest): Promise<void> {
  try {
    const { raiseReinstatementTicket } = await import("./reinstatement-ticket.ts");
    await raiseReinstatementTicket(request);
  } catch (err) {
    log.error(
      { err, requestId: request.id, tenantId: request.tenantId },
      "retention: reinstatement ticket notification failed to load (non-fatal — the request itself is recorded)",
    );
  }
}

/** This customer's currently-open request, or null. */
export async function readOpenReinstatementRequest(
  tenantId: number,
): Promise<RetentionReinstatementRequest | null> {
  const [row] = await db
    .select()
    .from(retentionReinstatementRequestsTable)
    .where(
      and(
        eq(retentionReinstatementRequestsTable.tenantId, tenantId),
        eq(retentionReinstatementRequestsTable.status, "open"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** This customer's requests, newest first. What the wall renders as "you asked on …". */
export async function listReinstatementRequests(
  tenantId: number,
  limit = 20,
): Promise<RetentionReinstatementRequest[]> {
  return db
    .select()
    .from(retentionReinstatementRequestsTable)
    .where(eq(retentionReinstatementRequestsTable.tenantId, tenantId))
    .orderBy(desc(retentionReinstatementRequestsTable.requestedAt))
    .limit(limit);
}

/**
 * Close any open request for a customer whose portal has genuinely reopened.
 *
 * Called from the reconciliation's *"JUST RETURNED"* branch, which is the only place in
 * the platform that knows a customer is actually back in — and which does not care
 * whether it was the customer's own subscription or their MSP's that resumed, exactly as
 * #2936 intends.
 *
 * **This is the ONE mechanism that resolves a reinstatement request** (#2999 point 3).
 * The Desk ticket #2999 adds is a notification surface, not a second source of truth: a
 * ticket being closed in Zoho does not reopen anybody's portal, and nothing in
 * `reinstatement-ticket.ts` writes `status` or `resolution`. If an operator wants a
 * request closed, they restore the billing and the record follows — deliberately, so
 * there is never a row claiming to be resolved while the customer is still locked out.
 * The only other writer of `status` is `withdrawReinstatementRequest()`, which is the
 * customer retracting their own ask, not a resolution.
 *
 * Never throws. A request left open after the portal reopened is untidy; a resumption
 * that failed because the bookkeeping stumbled would be a customer locked out.
 */
export async function resolveOpenReinstatementRequests(
  tenantId: number,
  resolution: string = REINSTATEMENT_RESOLUTION_PORTAL_REOPENED,
): Promise<number> {
  try {
    const now = new Date();
    const closed = await db
      .update(retentionReinstatementRequestsTable)
      .set({ status: "resolved", resolvedAt: now, resolution, updatedAt: now })
      .where(
        and(
          eq(retentionReinstatementRequestsTable.tenantId, tenantId),
          eq(retentionReinstatementRequestsTable.status, "open"),
        ),
      )
      .returning({ id: retentionReinstatementRequestsTable.id });

    if (closed.length > 0) {
      auditLog.info(
        {
          actionType: "retention.reinstatement.resolved",
          tenantId,
          requestIds: closed.map((r) => r.id),
          resolution,
          occurredAt: now.toISOString(),
        },
        "audit: reinstatement request resolved — the customer's portal reopened",
      );
    }
    return closed.length;
  } catch (err) {
    log.error({ err, tenantId }, "retention: could not resolve open reinstatement request (non-fatal)");
    return 0;
  }
}

/** The customer changing their mind. Same partial-unique semantics, in reverse. */
export async function withdrawReinstatementRequest(tenantId: number): Promise<boolean> {
  const now = new Date();
  const withdrawn = await db
    .update(retentionReinstatementRequestsTable)
    .set({ status: "withdrawn", resolvedAt: now, resolution: "withdrawn_by_customer", updatedAt: now })
    .where(
      and(
        eq(retentionReinstatementRequestsTable.tenantId, tenantId),
        eq(retentionReinstatementRequestsTable.status, "open"),
      ),
    )
    .returning({ id: retentionReinstatementRequestsTable.id });
  return withdrawn.length > 0;
}
