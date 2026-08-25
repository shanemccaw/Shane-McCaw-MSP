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
 */

import { db, retainerWorkLogTable, type RetainerWorkSource } from "@workspace/db";
import { logger } from "./logger.ts";
import { periodMonthOf, isoWeekLabel } from "./retainer-hours.ts";

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
 * Insert a tracker-derived ledger entry, idempotently. Returns true when a NEW
 * row was written, false when it already existed (a re-close). Never throws to
 * its caller — a retainer-logging failure must not break the underlying
 * close/resolve action, so any error is logged and swallowed.
 */
export async function logRetainerWorkFromTracker(input: LogRetainerWorkInput): Promise<boolean> {
  try {
    const occurredAt = input.occurredAt ?? new Date();
    const inserted = await db
      .insert(retainerWorkLogTable)
      .values({
        customerId: input.customerId,
        mspId: input.mspId,
        periodMonth: periodMonthOf(occurredAt),
        weekLabel: isoWeekLabel(occurredAt),
        item: input.item,
        minutes: 0,
        pillar: input.pillar ?? null,
        finding: input.finding ?? null,
        outcome: input.outcome ?? null,
        // A tracked item only reaches this hook by being closed/resolved, so the
        // ledger entry starts in the "closed" state — Shane can reopen it if he
        // logs follow-up hours against the same finding.
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

    const created = inserted.length > 0;
    log.info(
      { customerId: input.customerId, source: input.source, sourceRefId: input.sourceRefId, created },
      created ? "retainer work logged from tracker" : "retainer work already logged (re-close, no-op)",
    );
    return created;
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
