/**
 * remediationLive.ts — the seam between the Operate → Remediation Tracker's
 * design catalogue and the customer's REAL tracker rows.
 *
 * The page renders the design's finding catalogue (remediationData.ts: title,
 * evidence, severity, pillar, CR/hold/evidence seeds — none of which the server
 * holds per customer yet). What it must NOT invent is the part the platform
 * genuinely knows: whether a step has been actioned, and whether a real scan has
 * verified that claim. Both come over the wire from
 * `GET /api/portal/remediation-tracker`
 * (`artifacts/api-server/src/routes/portal-remediation-tracker.ts`, scoped to
 * the JWT's `customerId`) through
 * `components/copilot-journey/useRemediationTracker.ts` — the same store the
 * Full Remediation Guide writes to, so the two surfaces cannot disagree.
 *
 * ── ROUND FOUR: THE MAPPING MOVED ONTO THE TASK ────────────────────────────
 * The previous build held a `RT_STEP_ID` map from design task id to platform
 * step id here. Round Four renumbered the catalogue (7 phases, new task ids),
 * so the correspondence now lives on each task's own `stepId` field
 * (remediationData.ts) — same real steps (`s1`…`s30`), re-keyed onto the new
 * task ids. A task with `stepId: null` (the three Discovery reads, the two
 * adoption items #757 removed, the drift re-close) carries no real status and
 * reads as not started rather than guessing one. `rtLiveStep` therefore takes a
 * `stepId` directly.
 *
 * ── STATUS IS A CLAIM, VERIFICATION IS PROOF — NEVER THE SAME FACT ─────────
 * A step's `status` is what the customer has CLAIMED; its `verification` is
 * whether a real scan agreed. Only `reverifyRemediationTrackerSteps()`
 * (api-server, fired from inside a real scan) ever produces `verified` or
 * `drift`, and every write to `status` resets it to `unverified`. Nothing in
 * this module, or anything reading it, may promote a step to verified from a
 * status, a tick, a filter or any other UI state.
 *
 * The status buckets are the same split api-server's
 * `remediation-tracker-pricing.ts` already made: `completed`/`already_handled`
 * resolve a step as FIXED, while `not_applicable`/`deferred` resolve it as a
 * DECISION (the design's "Accepted as-is"). `shane_handles` does not resolve it
 * — a hand-off leaves the work outstanding.
 */

import type {
  RemediationTrackerStepStatus,
  RemediationTrackerVerificationState,
} from "@/components/copilot-journey/useRemediationTracker";

/**
 * One step's live facts. `status` is the customer's claim, `verification` is
 * what a real scan said about it. Deliberately two fields, never one.
 */
export interface RtLiveStep {
  readonly stepId: string | null;
  readonly status: RemediationTrackerStepStatus;
  readonly verification: RemediationTrackerVerificationState;
}

/** Anything carrying a `state` — structurally what the hook's map already holds. */
export interface RtLiveVerificationEntry {
  readonly state: RemediationTrackerVerificationState;
}

/**
 * The wire state this page reads: exactly the shape `useRemediationTracker()`
 * already returns, so the page hands its maps straight through and there is no
 * adapter in between to drift.
 */
export interface RtLiveState {
  readonly statuses: ReadonlyMap<string, RemediationTrackerStepStatus>;
  readonly verification: ReadonlyMap<string, RtLiveVerificationEntry>;
}

/**
 * No rows yet — a customer who has actioned nothing, and also what every step
 * reads as before the first payload lands. Understates rather than over-claims.
 */
export const RT_LIVE_EMPTY: RtLiveState = { statuses: new Map(), verification: new Map() };

/**
 * A step's live facts, resolved for a given platform step id. A null id (the
 * platform has no step for this task) is not_started/unverified — never a guess.
 */
export function rtLiveStep(stepId: string | null, live: RtLiveState = RT_LIVE_EMPTY): RtLiveStep {
  if (stepId === null) return { stepId: null, status: "not_started", verification: "unverified" };
  return {
    stepId,
    status: live.statuses.get(stepId) ?? "not_started",
    verification: live.verification.get(stepId)?.state ?? "unverified",
  };
}

/**
 * The statuses claiming the change is dealt with — the same set
 * `remediation-tracker-pricing.ts` treats as resolved-and-fixed.
 */
export const RT_FIXED_STATUSES: ReadonlySet<RemediationTrackerStepStatus> = new Set([
  "completed",
  "already_handled",
]);

/** Resolved by a decision rather than a fix — the design's "Accepted as-is". */
export const RT_ACCEPTED_STATUSES: ReadonlySet<RemediationTrackerStepStatus> = new Set([
  "not_applicable",
  "deferred",
]);
