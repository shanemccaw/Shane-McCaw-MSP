/**
 * retainer-work-logger.ts — the BYPRODUCT hook.
 *
 * Git #1293's primary path: when Shane closes/resolves a tracked item (a change
 * request reaching `completed`, or a remediation step reaching `completed`), a
 * retainer_work_log entry is created automatically — no double entry into a
 * separate form. The entry lands with its item / finding / pillar pre-filled
 * from the tracked item, and its hours defaulted to 0 for Shane to set in the
 * AdminV2 Retainer screen (hours are the one thing nothing can detect — the
 * BYPRODUCT is the entry seam, not a fabricated duration).
 *
 * Idempotent: the (source, source_ref_id) unique index means closing the same
 * item twice never double-logs. We insert with ON CONFLICT DO NOTHING so a
 * re-close is a silent no-op rather than an error.
 *
 * Git #4098 (follow-up to #4026): this hook fires outside any route, so it was
 * never wired into `retainer-ledger-lock.ts`'s period-close lock at all — every
 * other writer into `retainer_work_log` (AdminV2, MSP Console) answers 409 once
 * a period is closed; this one wrote straight past it. Shane's decision
 * (2026-09-14): no silent write past the lock, and no silent skip either — when
 * the target period is closed, the entry is queued into
 * `retainer_pending_entries` instead, for an MSP Console operator/admin to
 * approve (writes the real ledger row + a `retainer_adjustment_notes` reason,
 * same mechanism #4026 built) or reject (never touches the ledger). See
 * `routes/msp-retainer.ts`'s `/retainer/pending` routes for the review surface.
 */

import { db, retainerWorkLogTable, retainerPendingEntriesTable, type RetainerWorkSource } from "@workspace/db";
import { logger } from "./logger.ts";
import { periodKeyOf, isoWeekLabel } from "./retainer-hours.ts";
import { resolveRetainerAnchorDay } from "./retainer-period-anchor.ts";
import { withLedgerLock, findClose } from "./retainer-ledger-lock.ts";

const log = logger.child({ channel: "billing" });

/**
 * A loose category → pillar STARTING DEFAULT for change requests. The customer
 * page groups work by the five health pillars, but a CR's `category` is an M365
 * workload, not a pillar — there is no true 1:1. This maps to the most likely
 * pillar so the entry is usefully pre-filled; Shane can re-assign it in the peek.
 * A category with no sensible mapping stays null rather than guessing.
 */
const CATEGORY_PILLAR_HINT: Record<string, string> = {
  ConditionalAccess: "Security",
  Identity: "Security",
  Defender: "Security",
  Exchange: "Compliance",
  Purview: "Compliance",
  SharePoint: "Governance",
  Teams: "Governance",
  Intune: "Health",
};

export interface LogRetainerWorkInput {
  readonly customerId: number;
  readonly mspId: number;
  readonly source: Exclude<RetainerWorkSource, "unscoped">;
  readonly sourceRefId: number;
  readonly item: string;
  readonly pillar?: string | null;
  readonly finding?: string | null;
  readonly outcome?: string | null;
  /** Who closed the item; stamped on the ledger row. NULL for automation. */
  readonly loggedByUserId?: number | null;
  /** When the item was closed. Drives the period/week the hours count against. */
  readonly occurredAt?: Date;
}

/**
 * Insert a tracker-derived ledger entry, idempotently — unless the target
 * period is already closed, in which case the entry is queued into
 * `retainer_pending_entries` for human review instead (Git #4098). Returns
 * true when a NEW row was written (to either table), false when one already
 * existed (a re-close, in either state). Never throws to its caller — a
 * retainer-logging failure must not break the underlying close/resolve
 * action, so any error is logged and swallowed.
 */
export async function logRetainerWorkFromTracker(input: LogRetainerWorkInput): Promise<boolean> {
  try {
    const occurredAt = input.occurredAt ?? new Date();
    const anchorDay = await resolveRetainerAnchorDay(input.customerId);
    const periodKey = periodKeyOf(anchorDay, occurredAt);
    const weekLabel = isoWeekLabel(occurredAt);

    const result = await withLedgerLock(input.customerId, async (tx) => {
      const close = await findClose(tx, input.customerId, periodKey);
      if (close) {
        const queued = await tx
          .insert(retainerPendingEntriesTable)
          .values({
            customerId: input.customerId,
            mspId: input.mspId,
            periodKey,
            weekLabel,
            item: input.item,
            minutes: 0,
            pillar: input.pillar ?? null,
            finding: input.finding ?? null,
            outcome: input.outcome ?? null,
            source: input.source,
            sourceRefId: input.sourceRefId,
            loggedByUserId: input.loggedByUserId ?? null,
            occurredAt,
          })
          .onConflictDoNothing({
            target: [retainerPendingEntriesTable.source, retainerPendingEntriesTable.sourceRefId],
          })
          .returning({ id: retainerPendingEntriesTable.id });
        return { queued: true as const, created: queued.length > 0 };
      }

      const inserted = await tx
        .insert(retainerWorkLogTable)
        .values({
          customerId: input.customerId,
          mspId: input.mspId,
          periodMonth: periodKey,
          weekLabel,
          item: input.item,
          minutes: 0,
          pillar: input.pillar ?? null,
          finding: input.finding ?? null,
          outcome: input.outcome ?? null,
          // A tracked item only reaches this hook by being closed/resolved, so
          // the ledger entry starts in the "closed" state — Shane can reopen
          // it if he logs follow-up hours against the same finding.
          state: "closed",
          source: input.source,
          sourceRefId: input.sourceRefId,
          loggedByUserId: input.loggedByUserId ?? null,
          occurredAt,
        })
        .onConflictDoNothing({
          target: [retainerWorkLogTable.source, retainerWorkLogTable.sourceRefId],
        })
        .returning({ id: retainerWorkLogTable.id });
      return { queued: false as const, created: inserted.length > 0 };
    });

    log.info(
      { customerId: input.customerId, source: input.source, sourceRefId: input.sourceRefId, created: result.created, queued: result.queued },
      result.queued
        ? result.created
          ? "retainer work queued for approval — target period is closed"
          : "retainer work already queued for approval (re-close, no-op)"
        : result.created
          ? "retainer work logged from tracker"
          : "retainer work already logged (re-close, no-op)",
    );
    return result.created;
  } catch (err) {
    log.warn(
      { err, customerId: input.customerId, source: input.source, sourceRefId: input.sourceRefId },
      "retainer byproduct logging failed — swallowed so it can't break the close action",
    );
    return false;
  }
}

/** Category → pillar starting default for a change request. May be null. */
export function pillarHintForCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  return CATEGORY_PILLAR_HINT[category] ?? null;
}
