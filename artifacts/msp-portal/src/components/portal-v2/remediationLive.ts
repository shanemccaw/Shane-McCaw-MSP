/**
 * remediationLive.ts — the seam between the Operate → Remediation Tracker's
 * design catalogue and the customer's REAL tracker rows.
 *
 * The page renders the design's finding catalogue (remediationData.ts: title,
 * evidence, severity, pillar, owner — none of which the server holds). What it
 * must NOT invent is the part the platform genuinely knows: whether a step has
 * been actioned, and whether a real scan has verified that claim. Both of those
 * come over the wire from `GET /api/portal/remediation-tracker`
 * (`artifacts/api-server/src/routes/portal-remediation-tracker.ts`, scoped to
 * the JWT's `customerId`) through
 * `components/copilot-journey/useRemediationTracker.ts` — the same store the
 * Full Remediation Guide writes to, so the two surfaces cannot disagree.
 *
 * ── TWO ID SPACES, ONE CATALOGUE ───────────────────────────────────────────
 * The design fixture numbers its tasks per phase (`p1a`…`p3h`, 30 of them); the
 * platform numbers the same work `s1`…`s23`, `s26`…`s30` (28 — #757 removed
 * s24/s25 and deliberately did not renumber). They are the same list in the
 * same order: `RT_STEP_ID` below is that 1:1 correspondence, and `p3b`/`p3c`
 * map to `null` precisely because they ARE the removed s24/s25
 * (workflow-per-department and persona training — adoption guidance that moved
 * to White-Glove Copilot Adoption #350/#668). A task with no step id can never
 * carry a real status, and reads as not started rather than guessing one.
 *
 * ── STATUS IS A CLAIM, VERIFICATION IS PROOF — NEVER THE SAME FACT ─────────
 * A step's `status` is what the customer has CLAIMED; its `verification` is
 * whether a real scan agreed. Only `reverifyRemediationTrackerSteps()`
 * (api-server, fired from inside a real scan) ever produces `verified` or
 * `drift`, and every write to `status` resets it to `unverified` — on the
 * server for real, and optimistically in the hook. Nothing in this module, or
 * anything reading it, may promote a step to verified from a status, a tick, a
 * filter or any other UI state. That is why `rtLiveStep()` returns the two
 * facts side by side and never collapses them into one.
 *
 * The status buckets are not invented here either: they are the same split
 * api-server's `remediation-tracker-pricing.ts` already made for
 * `READY_STATUSES` — `completed`/`already_handled`/`not_applicable`/`deferred`
 * resolve a step, while `shane_handles` does not. A hand-off leaves the work
 * outstanding; it only changes who the row says closes it.
 */

import type {
  RemediationTrackerStepStatus,
  RemediationTrackerVerificationState,
} from "../copilot-journey/useRemediationTracker";

/**
 * Design task id → the platform's own step id, or null where the platform no
 * longer carries that step at all. See the header: same list, same order, with
 * the #757 hole at p3b/p3c.
 */
export const RT_STEP_ID: Readonly<Record<string, string | null>> = {
  // Phase 1 — Governance (s1–s6)
  p1a: "s1",
  p1b: "s2",
  p1c: "s3",
  p1d: "s4",
  p1e: "s5",
  p1f: "s6",
  // Phase 1 — Security (s7–s13)
  p1g: "s7",
  p1h: "s8",
  p1i: "s9",
  p1j: "s10",
  p1k: "s11",
  p1l: "s12",
  p1m: "s13",
  // Phase 2 — Compliance (s14–s18)
  p2a: "s14",
  p2b: "s15",
  p2c: "s16",
  p2d: "s17",
  p2e: "s18",
  // Phase 2 — Licensing (s19–s22)
  p2f: "s19",
  p2g: "s20",
  p2h: "s21",
  p2i: "s22",
  // Phase 3 — Adoption (s23, s26)
  p3a: "s23",
  p3b: null, // was s24 — removed from the catalogue in #757
  p3c: null, // was s25 — removed from the catalogue in #757
  p3d: "s26",
  // Phase 3 — Health (s27–s30)
  p3e: "s27",
  p3f: "s28",
  p3g: "s29",
  p3h: "s30",
};

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
 * reads as before the first payload lands. Understates rather than over-claims:
 * the honest default for "we do not know yet" is "not started", never
 * "verified".
 */
export const RT_LIVE_EMPTY: RtLiveState = { statuses: new Map(), verification: new Map() };

/** A step's live facts, resolved through the id map. Absence is not_started/unverified. */
export function rtLiveStep(taskId: string, live: RtLiveState = RT_LIVE_EMPTY): RtLiveStep {
  const stepId = RT_STEP_ID[taskId] ?? null;
  if (stepId === null) return { stepId: null, status: "not_started", verification: "unverified" };
  return {
    stepId,
    status: live.statuses.get(stepId) ?? "not_started",
    verification: live.verification.get(stepId)?.state ?? "unverified",
  };
}

/**
 * The statuses claiming the change is dealt with. Same set
 * `remediation-tracker-pricing.ts` treats as resolved-and-fixed. `deferred` and
 * `not_applicable` are resolved too, but they are DECISIONS rather than fixes,
 * so they belong in the design's "Accepted as-is" bucket instead.
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
