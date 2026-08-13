/**
 * remediation-tracker-verification.ts — Git #732, Phase C of epic #647.
 *
 * The real re-verification half of the Remediation Tracker. Phase A (#730)
 * and Phase B (#731) both left an explicit promise in their own schema
 * comments on `remediation_tracker_steps.status`: that a step's CUSTOMER
 * CLAIM ("I did this", "already handled another way", …) and whether a real
 * re-scan has actually CHECKED that claim are two separate facts, and the
 * second one gets its own column rather than growing the status enum. This
 * file is what fills that column in.
 *
 * THE REAL EVENT THIS HOOKS INTO
 * -------------------------------
 * `runDiagnostics()` in `./diagnostics-runner.ts` is the one function every
 * rescan in this platform goes through — manual re-checks, the 5-min Live
 * Activity Monitor, the SOW-expiry sweep, the Assessment flow's first scan —
 * and it already builds `findingRows`, one row per check the run actually
 * executed, with a real `severity` ("ok" through "critical") on every one of
 * them BEFORE they are persisted to `msp_diagnostic_findings`. That in-memory
 * array — not a second query, not a workflow-event listener, not a
 * simulation — is the real evidence this file reconciles the tracker against.
 * `runDiagnostics()` calls `reverifyRemediationTrackerSteps()` once findings
 * are built, the same "best-effort, fire from inside the run, never fail the
 * scan" discipline it already uses for the CIO narrative and the license-
 * waste finding.
 *
 * THE STEP → CHECK MAPPING IS MIRRORED, NOT SHARED
 * --------------------------------------------------
 * `STEP_CHECK_KEYS` is msp-portal's `remediationLiveGuide.ts` — #472's real,
 * confirmed step-to-check table, already used to build `stepEvidence()` for
 * the guide itself. msp-portal carries no `@workspace/db` dependency (it is a
 * Vite app, not a `lib/*` package) so this file cannot import it directly; it
 * keeps its own copy, exactly the precedent `portal-remediation-tracker.ts`
 * already set for the step-id list and `useRemediationTracker.ts` set for the
 * status vocabulary. `remediation-tracker-verification.test.ts` reads
 * `remediationLiveGuide.ts` off disk and asserts byte-for-byte equality, so
 * this mapping cannot silently drift from the one the guide itself renders.
 *
 * THE VERDICT RULE
 * -----------------
 * A step is eligible at all only if the customer has claimed SOMETHING about
 * it (`status !== "not_started"`) — an untouched step has no claim to check.
 * For an eligible step with N mapped check keys:
 *
 *   - Zero of them appear in this run's findings → no evidence this run.
 *     Leave the row exactly as it was; an unscanned check says nothing.
 *   - ANY of them that DID run came back "critical" or "warning" → `drift`.
 *     One real adverse signal is real evidence of a problem, even if a
 *     sibling check on the same step didn't run this time.
 *   - ALL N of them ran AND every one came back "ok" → `verified`. Partial
 *     coverage is deliberately not enough to certify a multi-check step done
 *     — Steps 8, 9, 14, 21, 23 and 29 each map to more than one check, and
 *     "verified" is a real, positive claim, not the absence of a problem.
 *   - Anything else (some ran clean, but not all N) → no verdict this run.
 *
 * Steps with no mapped check at all — the two platform-wide gaps (18, 28) and
 * the two process-only steps (27, 30) — are never eligible: there is no real
 * evidence that could ever verify or drift them, the same absence
 * `STEP_CHECK_GAPS` and `PROCESS_ONLY_STEP_IDS` already state in the guide.
 * (Steps 24 and 25 were process-only too until #757 removed them from the
 * catalogue entirely.)
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, remediationTrackerStepsTable, type RemediationTrackerVerificationState } from "@workspace/db";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

/**
 * #472's real step → `monitor_checks.key` mapping, mirrored from
 * `remediationLiveGuide.ts`'s `STEP_CHECK_KEYS`. Keep byte-identical —
 * `remediation-tracker-verification.test.ts` enforces it.
 */
const STEP_CHECK_KEYS: Readonly<Record<string, readonly string[]>> = {
  s1: ["sharepoint:orgwide-links"],
  s2: ["sharepoint:orgwide-links"],
  s3: ["sharepoint:anonymous-links"],
  s4: ["sharepoint:anonymous-links"],
  s5: ["governance:group-expiration-policy"],
  s6: ["teams:inventory-count"],
  s7: ["identity:mfa-registration"],
  s8: ["identity:ca-policy-count", "identity:ca-mfa-coverage"],
  s9: ["identity:ca-policy-count", "identity:ca-report-only"],
  s10: ["identity:legacy-auth-usage"],
  s11: ["identity:global-admin-count"],
  s12: ["security:safe-links-coverage"],
  s13: ["identity:ca-device-compliance"],
  s14: ["compliance:missing-labels", "governance:sensitivity-label-adoption"],
  s15: ["governance:auto-labeling-coverage"],
  s16: ["compliance:weak-dlp-policies"],
  s17: ["governance:retention-policy-coverage"],
  s19: ["copilot:licensed-but-inactive"],
  s20: ["copilot:licensed-but-inactive"],
  s21: ["cost:entra-license-tier-distribution", "license:sku-utilization"],
  s22: ["cost:group-based-licensing-adoption"],
  s23: ["adoption:teams-activity-trend", "adoption:sharepoint-onedrive-trend"],
  s26: ["sharepoint:tenant-sharing-capability"],
  s29: ["sharepoint:inactive-sites", "teams:ownerless-teams", "governance:ownerless-groups"],
};

/** Exported for the drift-guard test only — not meant as a second source of truth anywhere else. */
export { STEP_CHECK_KEYS as REMEDIATION_TRACKER_STEP_CHECK_KEYS };

/** The wire shape `runDiagnostics()` already builds `findingRows` in — only the two fields this needs. */
export interface RescanFindingForVerification {
  readonly checkKey: string;
  readonly severity: string;
}

function verdictFor(mappedKeys: readonly string[], findings: readonly RescanFindingForVerification[]): "verified" | "drift" | null {
  const relevant = findings.filter((f) => mappedKeys.includes(f.checkKey));
  if (relevant.length === 0) return null;

  const hasAdverse = relevant.some((f) => f.severity === "critical" || f.severity === "warning");
  if (hasAdverse) return "drift";

  const allKeysRan = mappedKeys.every((key) => relevant.some((f) => f.checkKey === key));
  const allClean = relevant.every((f) => f.severity === "ok");
  if (allKeysRan && allClean) return "verified";

  return null;
}

/**
 * Reconciles one customer's claimed remediation-tracker rows against ONE
 * rescan's real findings. Fired from `runDiagnostics()`; best-effort, and a
 * failure here must never fail the scan itself.
 */
export async function reverifyRemediationTrackerSteps(opts: {
  readonly customerId: number;
  readonly runId: string;
  readonly findings: readonly RescanFindingForVerification[];
}): Promise<void> {
  const { customerId, runId, findings } = opts;

  try {
    // Only steps the customer has actually made a claim about — an untouched
    // `not_started` row has nothing for a rescan to confirm or contradict.
    const rows = await db
      .select({ stepId: remediationTrackerStepsTable.stepId, status: remediationTrackerStepsTable.status })
      .from(remediationTrackerStepsTable)
      .where(
        and(
          eq(remediationTrackerStepsTable.customerId, customerId),
          inArray(remediationTrackerStepsTable.status, [
            "completed",
            "already_handled",
            "not_applicable",
            "deferred",
            "shane_handles",
          ]),
        ),
      );

    if (rows.length === 0) return;

    const now = new Date();
    let verifiedCount = 0;
    let driftCount = 0;

    for (const row of rows) {
      const mappedKeys = STEP_CHECK_KEYS[row.stepId];
      if (!mappedKeys || mappedKeys.length === 0) continue; // gap or process-only step — never eligible

      const verdict = verdictFor(mappedKeys, findings);
      if (verdict === null) continue; // no usable evidence this run — leave the row as it was

      const nextState: RemediationTrackerVerificationState = verdict;
      await db
        .update(remediationTrackerStepsTable)
        .set({ verificationState: nextState, verifiedAt: now, verifiedByRunId: runId, updatedAt: now })
        .where(
          and(
            eq(remediationTrackerStepsTable.customerId, customerId),
            eq(remediationTrackerStepsTable.stepId, row.stepId),
          ),
        );

      if (verdict === "verified") verifiedCount++;
      else driftCount++;
    }

    if (verifiedCount > 0 || driftCount > 0) {
      log.info(
        { customerId, runId, verifiedCount, driftCount, claimedCount: rows.length },
        "remediation tracker re-verified against a real rescan",
      );
    }
  } catch (err) {
    log.warn({ err, customerId, runId }, "remediation-tracker-verification: reverify failed (non-fatal)");
  }
}
