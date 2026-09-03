/**
 * msp-change-pir-store.ts — the DB (and drift-engine) side of the
 * Post-Implementation Review record (Git #1502). The pure rules live in
 * `msp-change-pir.ts`; this is where they touch `cr_pirs`, `cr_executions`,
 * `msp_change_requests`, `monitor_checks`, and — for the re-scan itself —
 * `monitor-executor.ts`'s `executeMonitorCheck` (the same real Graph-fetch +
 * drift-collection path a scheduled scan runs, not a second engine).
 */

import {
  db,
  crPirsTable,
  crExecutionsTable,
  mspChangeRequestsTable,
  monitorChecksTable,
  driftCollectionStatusTable,
  driftEventsTable,
  type CrPir,
  type CrPirCloseCode,
} from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { categoryHasDriftRescanPath, PIR_DRIFT_RESCAN_CA_DOMAIN_KEY } from "./msp-change-pir";
import { checkKeyForDriftDomain } from "./drift-check-specs";
import { executeMonitorCheck } from "./monitor-executor";
import { recordCrEvent } from "./portal-change-timeline-store";
import { formatChangeRequestCode } from "./portal-change-control";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

// ── Drift re-scan ─────────────────────────────────────────────────────────────

export interface DriftRescanOutcome {
  readonly applicable: boolean;
  readonly domainKey: string | null;
  readonly checkKey: string | null;
  readonly status: "not_applicable" | "ran" | "error";
  readonly eventsInsertedCount: number | null;
  readonly attributedCount: number | null;
  readonly otherOpenDriftCount: number | null;
  readonly note: string;
  readonly ranAt: Date | null;
}

/**
 * Run the drift re-scan a PIR closes the loop with, for ONE change request.
 *
 * Scoped deliberately narrow: `monitor-executor.ts`'s `buildCaChangeRequestAttribution`
 * only attributes drift to a CR for Conditional Access (#1497's boundary, not
 * widened here). Every other category returns `not_applicable` honestly — no
 * scan is attempted, because the attribution engine has no path to credit it to
 * this CR even if one ran.
 *
 * For Conditional Access: forces a fresh scan (`skipIdempotency: true` — a PIR
 * re-scan must observe the tenant NOW, not a cached same-trigger result) of the
 * check that feeds the `ca-policy` domain, with `persistProfile: false` — this is
 * NOT the scoring scan and must not become the tenant's live per-check signal
 * (see `executeMonitorCheck`'s own doc on that column). The real collector run
 * this triggers (`collectDriftForCompletedCheck` → `maybeCollectDriftForCheck` →
 * `collectDrift`) is the SAME path a scheduled scan uses — this does not
 * reimplement drift detection, it just forces one real pass and reads what it
 * left behind in `drift_collection_status` / `drift_events`.
 *
 * Never throws: a failed re-scan is recorded as `status: "error"` with the real
 * message, matching this codebase's non-fatal drift-bookkeeping discipline —
 * a PIR must still be recordable even when the tenant is unreachable.
 */
export async function runDriftRescanForChange(cr: {
  readonly id: number;
  readonly category: string;
  readonly tenantId: string;
}): Promise<DriftRescanOutcome> {
  if (!categoryHasDriftRescanPath(cr.category)) {
    return {
      applicable: false,
      domainKey: null,
      checkKey: null,
      status: "not_applicable",
      eventsInsertedCount: null,
      attributedCount: null,
      otherOpenDriftCount: null,
      note:
        `Drift re-scan is only wired for Conditional Access changes today ` +
        `(monitor-executor.ts attributes drift to a CR only for that category, within a ` +
        `30-day window — see buildCaChangeRequestAttribution). This change's category is ` +
        `"${cr.category}", so no re-scan was attempted.`,
      ranAt: null,
    };
  }

  const domainKey = PIR_DRIFT_RESCAN_CA_DOMAIN_KEY;
  const checkKey = checkKeyForDriftDomain(domainKey);
  if (!checkKey) {
    return {
      applicable: true,
      domainKey,
      checkKey: null,
      status: "error",
      eventsInsertedCount: null,
      attributedCount: null,
      otherOpenDriftCount: null,
      note: `No monitor check is registered for drift domain "${domainKey}" (drift-check-specs.ts) — the re-scan could not be run.`,
      ranAt: new Date(),
    };
  }

  try {
    const [check] = await db.select().from(monitorChecksTable).where(eq(monitorChecksTable.key, checkKey)).limit(1);
    if (!check) {
      return {
        applicable: true,
        domainKey,
        checkKey,
        status: "error",
        eventsInsertedCount: null,
        attributedCount: null,
        otherOpenDriftCount: null,
        note: `monitor_checks has no row for key "${checkKey}" — the re-scan could not be run.`,
        ranAt: new Date(),
      };
    }

    await executeMonitorCheck({
      check,
      tenantId: cr.tenantId,
      triggerId: `pir-rescan:${randomUUID()}`,
      skipIdempotency: true,
      persistProfile: false,
    });

    const [statusRow] = await db
      .select({
        status: driftCollectionStatusTable.status,
        reason: driftCollectionStatusTable.reason,
        eventsInserted: driftCollectionStatusTable.eventsInserted,
      })
      .from(driftCollectionStatusTable)
      .where(and(eq(driftCollectionStatusTable.tenantId, cr.tenantId), eq(driftCollectionStatusTable.domainKey, domainKey)))
      .limit(1);

    // Of this tenant/domain's CURRENTLY open/reopened drift, how much carries
    // THIS CR's id as its attributing change vs. how much doesn't. Both counts
    // are a snapshot at re-scan time, not "changes this run caused" — the same
    // honesty `drift_collection_status` itself keeps (a status record, not a
    // diff-of-diffs).
    const openRows = await db
      .select({ id: driftEventsTable.id, changeRequestId: driftEventsTable.changeRequestId })
      .from(driftEventsTable)
      .where(
        and(
          eq(driftEventsTable.tenantId, cr.tenantId),
          eq(driftEventsTable.domainKey, domainKey),
          or(eq(driftEventsTable.status, "open"), eq(driftEventsTable.status, "reopened")),
        ),
      );
    const attributedCount = openRows.filter((r) => r.changeRequestId === cr.id).length;
    const otherOpenDriftCount = openRows.length - attributedCount;

    const eventsInsertedCount = statusRow?.eventsInserted ?? 0;
    const collectionStatus = statusRow?.status ?? null;

    let note: string;
    if (collectionStatus === "not_comparable") {
      note =
        `Re-scan ran but the check's fresh output was not comparable to the baseline ` +
        `(${statusRow?.reason ?? "no reason recorded"}) — no drift events could be written this run. ` +
        `This does NOT confirm the change landed; it confirms the scan attempted and could not compare.`;
    } else if (collectionStatus === "baseline_captured") {
      note =
        `Re-scan ran and captured a fresh Conditional Access baseline (none existed before). ` +
        `A first-run baseline reports zero drift by construction — there was nothing to diff yet, ` +
        `so this does not by itself confirm the change landed as intended.`;
    } else {
      note =
        `Re-scanned Conditional Access via a fresh Graph fetch, diffed against the current baseline. ` +
        `${eventsInsertedCount} setting change(s) persisted this run. Of this tenant's currently open/reopened ` +
        `Conditional Access drift, ${attributedCount} carry ${formatChangeRequestCode(cr.id)} as their attributing ` +
        `change (verdict "approved"), and ${otherOpenDriftCount} do not (pre-existing or unrelated drift, not caused ` +
        `or resolved by this review). A change request describes an intended change, not a JSON path, so this ` +
        `confirms the tenant's live CA configuration was re-observed and diffed against baseline — it does not prove ` +
        `every individual setting this CR intended to change, specifically (monitor-executor.ts's own limitation).`;
    }

    return {
      applicable: true,
      domainKey,
      checkKey,
      status: "ran",
      eventsInsertedCount,
      attributedCount,
      otherOpenDriftCount,
      note,
      ranAt: new Date(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, crId: cr.id, tenantId: cr.tenantId, domainKey }, "pir: drift re-scan failed (non-fatal to the PIR)");
    return {
      applicable: true,
      domainKey,
      checkKey,
      status: "error",
      eventsInsertedCount: null,
      attributedCount: null,
      otherOpenDriftCount: null,
      note: `Drift re-scan failed: ${message}`,
      ranAt: new Date(),
    };
  }
}

// ── Recording a PIR ──────────────────────────────────────────────────────────

export interface RecordPirInput {
  readonly executionId: number;
  readonly mspId: number;
  readonly closeCode: CrPirCloseCode;
  readonly summary: string;
  readonly issuesNoted?: string | null;
  readonly reviewedBy: string;
  readonly reviewedByPersonId: string | null;
}

export type RecordPirResult =
  | { readonly ok: true; readonly pir: CrPir }
  | { readonly ok: false; readonly reason: "execution_not_found" | "already_reviewed" };

/**
 * Record a PIR against an execution, running the drift re-scan and appending
 * the `pir_recorded` `cr_events` row in the same call. A `cr_pirs` row with no
 * execution to attach to cannot be created (real FK); a second PIR against an
 * ALREADY-reviewed execution is rejected — that state renders "already
 * reviewed", not overwritable (`cr_pirs` is append-only, one row per
 * execution, same discipline `cr_events` itself follows).
 */
export async function recordPir(input: RecordPirInput): Promise<RecordPirResult> {
  const [exec] = await db
    .select({ id: crExecutionsTable.id, changeRequestId: crExecutionsTable.changeRequestId, tenantId: crExecutionsTable.tenantId })
    .from(crExecutionsTable)
    .where(and(eq(crExecutionsTable.id, input.executionId), eq(crExecutionsTable.mspId, input.mspId)))
    .limit(1);
  if (!exec) return { ok: false, reason: "execution_not_found" };

  const [existingPir] = await db.select({ id: crPirsTable.id }).from(crPirsTable).where(eq(crPirsTable.executionId, input.executionId)).limit(1);
  if (existingPir) return { ok: false, reason: "already_reviewed" };

  const [cr] = await db
    .select({ id: mspChangeRequestsTable.id, category: mspChangeRequestsTable.category, tenantId: mspChangeRequestsTable.tenantId })
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.id, exec.changeRequestId), eq(mspChangeRequestsTable.mspId, input.mspId)))
    .limit(1);
  if (!cr) return { ok: false, reason: "execution_not_found" };

  const rescan = await runDriftRescanForChange(cr);

  const [row] = await db
    .insert(crPirsTable)
    .values({
      executionId: exec.id,
      changeRequestId: exec.changeRequestId,
      mspId: input.mspId,
      tenantId: exec.tenantId,
      closeCode: input.closeCode,
      summary: input.summary,
      issuesNoted: input.issuesNoted ?? null,
      reviewedBy: input.reviewedBy,
      reviewedByPersonId: input.reviewedByPersonId,
      driftRescanApplicable: rescan.applicable,
      driftRescanDomainKey: rescan.domainKey,
      driftRescanCheckKey: rescan.checkKey,
      driftRescanStatus: rescan.status,
      driftRescanEventsInsertedCount: rescan.eventsInsertedCount,
      driftRescanAttributedCount: rescan.attributedCount,
      driftRescanOtherOpenDriftCount: rescan.otherOpenDriftCount,
      driftRescanNote: rescan.note,
      driftRescanRanAt: rescan.ranAt,
    })
    .returning();

  await recordCrEvent({
    changeRequestId: exec.changeRequestId,
    mspId: input.mspId,
    tenantId: exec.tenantId,
    eventType: "pir_recorded",
    fromValue: null,
    toValue: input.closeCode,
    actorRole: "msp",
    actorPersonId: input.reviewedByPersonId,
    actorName: input.reviewedBy,
    reason: input.summary,
  });

  log.info(
    { mspId: input.mspId, executionId: exec.id, changeRequestId: exec.changeRequestId, pirId: row.id, closeCode: input.closeCode, driftRescanStatus: rescan.status },
    "pir: recorded",
  );
  return { ok: true, pir: row };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getPirForExecution(mspId: number, executionId: number): Promise<CrPir | null> {
  const [row] = await db
    .select()
    .from(crPirsTable)
    .where(and(eq(crPirsTable.executionId, executionId), eq(crPirsTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

export async function listPirsForChange(mspId: number, changeRequestId: number): Promise<CrPir[]> {
  return db
    .select()
    .from(crPirsTable)
    .where(and(eq(crPirsTable.mspId, mspId), eq(crPirsTable.changeRequestId, changeRequestId)))
    .orderBy(desc(crPirsTable.createdAt));
}

export async function listPirsForMsp(mspId: number, limit = 100): Promise<CrPir[]> {
  return db.select().from(crPirsTable).where(eq(crPirsTable.mspId, mspId)).orderBy(desc(crPirsTable.createdAt)).limit(limit);
}
