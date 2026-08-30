/**
 * remediation-bypass-resolutions.ts — the CR-bypass-but-resolved dual state (#1543).
 *
 * THE STATE THIS SURFACES
 * ────────────────────────
 * A fix can complete without ever going through its Change Request — the
 * customer changed the tenant themselves in the admin centre:
 *
 *   - The pointed check passes on re-scan. `reverifyRemediationTrackerSteps()`
 *     (./remediation-tracker-verification.ts) correctly moves the tracker step
 *     to `verified` — it reasons ONLY from re-scan severity, never from drift
 *     attribution, so a fixed thing is never treated as broken.
 *   - The same re-scan's drift collection (./drift-collector.ts) sees the
 *     tenant's config deviate from its baseline with no linked CR, so
 *     `deriveVerdict()` correctly records `attributed_unapproved` (actor known)
 *     or `unattributed` (actor unknown) — never `approved`. The drift register
 *     never forgives the bypass because the outcome was good.
 *
 * Both facts are correct in isolation, and neither engine reads the other's
 * table — which is exactly why nothing today tells an MSP the two happened
 * TOGETHER. That correlation is "the most interesting state in the system"
 * per #1543: it is what tells an MSP the customer is working around change
 * control, even though the fix genuinely stuck.
 *
 * WHY A RUN-WINDOW JOIN, NOT A NEW COLUMN
 * ─────────────────────────────────────────
 * `reverifyRemediationTrackerSteps()` and `maybeCollectDriftForCheck()` are
 * both fired from inside the SAME `runDiagnostics()` invocation for the same
 * tenant (diagnostics-runner.ts calls the drift hook per completed check, then
 * calls the tracker reverify once all findings are built) — a tenant only has
 * one run in flight at a time. `msp_diagnostic_runs` already carries both
 * `customerId` and `tenantId` (the bridge between the tracker's numeric
 * customer id-space and the drift engine's M365 tenant-id text id-space) plus
 * `startedAt`/`completedAt`. So a drift event that was newly inserted or
 * reopened (its `detectedAt` refreshes on both) inside that exact run's window
 * is a precise, non-heuristic match — no new schema needed, and nothing is
 * inferred that the two engines didn't already independently record.
 *
 * NEUTRALITY (the issue's own requirement)
 * ──────────────────────────────────────────
 * This module states WHAT changed, WHEN, and that it fell outside change
 * control. It never labels the person, never escalates on a schedule, never
 * scores or accumulates a case against anyone, and this file adds no
 * enforcement, blocking, or policy machinery — observation and surfacing only.
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  driftEventsTable,
  mspDiagnosticRunsTable,
  remediationTrackerStepsTable,
  type DriftEventVerdict,
} from "@workspace/db";
import { driftSpecForCheck } from "./drift-check-specs";
import { REMEDIATION_TRACKER_STEP_CHECK_KEYS } from "./remediation-tracker-verification";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

/** The two verdicts that mean "this change fell outside change control" — never `approved`. */
const BYPASS_VERDICTS: readonly DriftEventVerdict[] = ["attributed_unapproved", "unattributed"];

/** One verified tracker step, the shape this module needs from the tracker table. */
export interface VerifiedTrackerStep {
  readonly stepId: string;
  readonly verifiedAt: Date;
  readonly verifiedByRunId: string;
}

/** The shape this module needs from the run that produced a verification. */
export interface RunWindow {
  readonly runId: string;
  readonly tenantId: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

/** One drift event, the shape this module needs from `drift_events`. */
export interface BypassCandidateEvent {
  readonly eventId: string;
  readonly domainKey: string;
  readonly setting: string;
  readonly op: string;
  readonly verdict: DriftEventVerdict;
  readonly changedBy: string | null;
  readonly detectedAt: Date;
  readonly status: "open" | "resolved" | "reopened";
}

/** One correlated bypass resolution — both facts, side by side, neither one edited. */
export interface BypassResolution {
  readonly stepId: string;
  readonly verifiedAt: string;
  readonly verifiedByRunId: string;
  readonly domainKey: string;
  readonly driftEvent: {
    readonly eventId: string;
    readonly setting: string;
    readonly op: string;
    readonly verdict: DriftEventVerdict;
    readonly changedBy: string | null;
    readonly detectedAt: string;
    readonly status: "open" | "resolved" | "reopened";
  };
}

/** The domain keys drift-tracked for a step's mapped check keys, deduped. Empty when none are drift-tracked. */
export function domainsForStep(stepId: string): string[] {
  const checkKeys = REMEDIATION_TRACKER_STEP_CHECK_KEYS[stepId];
  if (!checkKeys || checkKeys.length === 0) return [];
  const domains = new Set<string>();
  for (const key of checkKeys) {
    const spec = driftSpecForCheck(key);
    if (spec) domains.add(spec.domainKey);
  }
  return [...domains];
}

/**
 * Pure: given one verified step, the run that verified it, and the candidate
 * drift events already scoped to that run's tenant + the step's drift domains,
 * return the bypass resolutions for this step. A candidate only counts if its
 * `detectedAt` falls inside the run's own window (or, when the run has no
 * `completedAt` yet — a still-running/failed run — anything from its start
 * onward) — the whole point is a precise same-run join, not a wide guess.
 */
export function correlateStepBypasses(
  step: VerifiedTrackerStep,
  run: RunWindow,
  candidates: readonly BypassCandidateEvent[],
): BypassResolution[] {
  if (!run.startedAt) return [];
  const windowEnd = run.completedAt ?? null;

  return candidates
    .filter((c) => {
      if (c.detectedAt < run.startedAt!) return false;
      if (windowEnd && c.detectedAt > windowEnd) return false;
      return true;
    })
    .map((c) => ({
      stepId: step.stepId,
      verifiedAt: step.verifiedAt.toISOString(),
      verifiedByRunId: step.verifiedByRunId,
      domainKey: c.domainKey,
      driftEvent: {
        eventId: c.eventId,
        setting: c.setting,
        op: c.op,
        verdict: c.verdict,
        changedBy: c.changedBy,
        detectedAt: c.detectedAt.toISOString(),
        status: c.status,
      },
    }));
}

/**
 * The real, impure orchestrator: for one customer, find every verified tracker
 * step whose verifying run also recorded a same-run, out-of-change-control
 * drift event on a domain that step's checks drift-track.
 *
 * Best-effort and read-only — this never writes to either table. An empty
 * tenant, or one with no drift-tracked steps, returns an empty list; nothing
 * fabricated.
 */
export async function resolveBypassResolutionsForCustomer(customerId: number): Promise<BypassResolution[]> {
  const steps = await db
    .select({
      stepId: remediationTrackerStepsTable.stepId,
      verifiedAt: remediationTrackerStepsTable.verifiedAt,
      verifiedByRunId: remediationTrackerStepsTable.verifiedByRunId,
    })
    .from(remediationTrackerStepsTable)
    .where(
      and(
        eq(remediationTrackerStepsTable.customerId, customerId),
        eq(remediationTrackerStepsTable.verificationState, "verified"),
      ),
    );

  const verifiedSteps = steps.filter(
    (s): s is { stepId: string; verifiedAt: Date; verifiedByRunId: string } =>
      s.verifiedAt !== null && s.verifiedByRunId !== null,
  );
  if (verifiedSteps.length === 0) return [];

  // Steps with no drift-tracked domain at all need no run/event lookup.
  const stepsWithDomains = verifiedSteps
    .map((s) => ({ step: s, domains: domainsForStep(s.stepId) }))
    .filter((s) => s.domains.length > 0);
  if (stepsWithDomains.length === 0) return [];

  const runIds = [...new Set(stepsWithDomains.map((s) => s.step.verifiedByRunId))];
  const runs = await db
    .select({
      runId: mspDiagnosticRunsTable.runId,
      tenantId: mspDiagnosticRunsTable.tenantId,
      startedAt: mspDiagnosticRunsTable.startedAt,
      completedAt: mspDiagnosticRunsTable.completedAt,
    })
    .from(mspDiagnosticRunsTable)
    .where(and(eq(mspDiagnosticRunsTable.customerId, customerId), inArray(mspDiagnosticRunsTable.runId, runIds)));
  const runById = new Map(runs.map((r) => [r.runId, r]));

  const allDomains = [...new Set(stepsWithDomains.flatMap((s) => s.domains))];
  const tenantIds = [...new Set(runs.map((r) => r.tenantId).filter((t): t is string => !!t))];
  if (tenantIds.length === 0) return [];

  // Widest possible time bound across the runs involved — the per-step
  // correlation below still filters to that step's OWN run window.
  const earliestStart = runs.reduce<Date | null>((min, r) => {
    if (!r.startedAt) return min;
    return !min || r.startedAt < min ? r.startedAt : min;
  }, null);
  if (!earliestStart) return [];

  const events = await db
    .select({
      eventId: driftEventsTable.eventId,
      tenantId: driftEventsTable.tenantId,
      domainKey: driftEventsTable.domainKey,
      setting: driftEventsTable.setting,
      op: driftEventsTable.op,
      verdict: driftEventsTable.verdict,
      changedBy: driftEventsTable.changedBy,
      detectedAt: driftEventsTable.detectedAt,
      status: driftEventsTable.status,
    })
    .from(driftEventsTable)
    .where(
      and(
        inArray(driftEventsTable.tenantId, tenantIds),
        inArray(driftEventsTable.domainKey, allDomains),
        inArray(driftEventsTable.verdict, BYPASS_VERDICTS),
        gte(driftEventsTable.detectedAt, earliestStart),
      ),
    );

  const results: BypassResolution[] = [];
  for (const { step, domains } of stepsWithDomains) {
    const run = runById.get(step.verifiedByRunId);
    if (!run || !run.tenantId) continue;
    const candidates: BypassCandidateEvent[] = events.filter(
      (e) => e.tenantId === run.tenantId && domains.includes(e.domainKey),
    );
    results.push(...correlateStepBypasses(step, run, candidates));
  }

  if (results.length > 0) {
    log.info(
      { customerId, count: results.length, steps: [...new Set(results.map((r) => r.stepId))] },
      "remediation-bypass-resolutions: found step(s) verified alongside a same-run out-of-change-control drift event",
    );
  }

  return results;
}
