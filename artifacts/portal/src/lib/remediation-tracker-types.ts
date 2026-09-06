/**
 * Wire types for the customer-facing Remediation Tracker's s1-s30 core
 * surface (#3037, Feature #1489). Mirrored verbatim from the real route's own
 * interfaces — see `docs/remediation-tracking-contract-pack.md` §1a and
 * `artifacts/api-server/src/routes/portal-remediation-tracker.ts` /
 * `artifacts/api-server/src/lib/remediation-tracker-pricing.ts`. No shared
 * wire-types package to import from (each `artifacts/*` app is its own
 * independent Vite/Node app), so this is a local copy, not a redeclaration of
 * a different shape.
 *
 * Deliberately does NOT cover §1b-1e (checklist / fix-routes / reveal /
 * bypass-resolutions — #3038) or the pillar-scores response (§1f, #3039).
 */

/**
 * REMEDIATION_TRACKER_STEP_STATUS, `lib/db/src/schema/msp.ts:7194-7202`.
 * `accepted_risk` is SIGNED, never settable by a bare PUT — see
 * `RemediationTrackerStepStatusWritable` below.
 */
export const REMEDIATION_TRACKER_STEP_STATUS = [
  "not_started",
  "completed",
  "already_handled",
  "not_applicable",
  "deferred",
  "shane_handles",
  "accepted_risk",
] as const;
export type RemediationTrackerStepStatus = (typeof REMEDIATION_TRACKER_STEP_STATUS)[number];

/** Every status a plain PUT may set — everything except the signed `accepted_risk` exit. */
export const REMEDIATION_TRACKER_STEP_STATUS_WRITABLE = REMEDIATION_TRACKER_STEP_STATUS.filter(
  (s): s is Exclude<RemediationTrackerStepStatus, "accepted_risk"> => s !== "accepted_risk",
);

export const REMEDIATION_TRACKER_STEP_STATUS_LABELS: Readonly<Record<RemediationTrackerStepStatus, string>> = {
  not_started: "Not started",
  completed: "Completed",
  already_handled: "Already handled another way",
  not_applicable: "Not applicable to this tenant",
  deferred: "Deferring to a later phase",
  shane_handles: "Have Shane do this one",
  accepted_risk: "Accepted as a risk — signed",
};

/** REMEDIATION_TRACKER_VERIFICATION_STATE, `lib/db/src/schema/msp.ts:7230`. */
export type RemediationTrackerVerificationState = "unverified" | "verified" | "drift";

/** #1542's derived three-way read model — `remediationTerminalState()`. */
export type RemediationTerminalState = "verified" | "accepted" | "outstanding";

/** One stored step, exactly as `GET /portal/remediation-tracker` serves it. */
export interface WireTrackerStep {
  readonly stepId: string;
  readonly status: RemediationTrackerStepStatus;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  readonly verificationState: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
  readonly terminalState: RemediationTerminalState;
}

export type RemediationTrackerPillar = "governance" | "security" | "compliance" | "licensing" | "adoption" | "health";
export type RemediationTrackerPhaseNumber = 1 | 2 | 3;

export interface RemediationTrackerPhasePricing {
  readonly phase: RemediationTrackerPhaseNumber;
  readonly pillars: readonly RemediationTrackerPillar[];
  readonly ready: boolean;
  readonly fee: number;
  readonly feeDisplay: string;
}

export interface RemediationTrackerHirePricing {
  readonly price: string;
  readonly was: string;
  readonly wasShow: boolean;
  readonly saved: string;
  readonly savedShow: boolean;
  readonly cta: string;
  readonly note: string;
}

export interface RemediationTrackerPricing {
  readonly phases: readonly RemediationTrackerPhasePricing[];
  readonly hire: RemediationTrackerHirePricing;
}

export interface RemediationTrackerPayload {
  readonly steps: readonly WireTrackerStep[];
  readonly pricing: RemediationTrackerPricing;
}

/** `POST .../steps/:stepId/verify` — 202 body. */
export interface RemediationVerifyResponse {
  readonly message: string;
  readonly stepId: string;
  readonly checkKeys: readonly string[];
}

/** `GET .../steps/:stepId/verification-guide` — one mapped check's guidance. */
export interface RemediationVerificationGuideItem {
  readonly checkKey: string;
  readonly validationStep: string | null;
  readonly validationCommand: string | null;
  readonly expectedOutcome: string | null;
}

export interface RemediationVerificationGuideResponse {
  readonly stepId: string;
  readonly checkKeys: readonly string[];
  readonly guidance: readonly RemediationVerificationGuideItem[];
}

/** `POST .../steps/:stepId/decline-to-risk` — request body. */
export interface DeclineToRiskRequest {
  readonly fullName: string;
  readonly confirmed: true;
  readonly statement: string;
}

/** `POST .../steps/:stepId/decline-to-risk` — 201 body. */
export interface DeclineToRiskResponse {
  readonly step: WireTrackerStep;
  readonly rbdId: string;
  readonly accepted: {
    readonly by: string;
    readonly on: string;
    readonly statement: string;
  };
}

/**
 * The route file mixes two error shapes: most of §1a's handlers reply
 * `{ error: "plain string" }`, while decline-to-risk uses the newer
 * `apiError()` helper's `{ error: { code, message } }`. Both are real, so the
 * client has to accept either rather than assuming the newer shape everywhere.
 */
export interface ApiErrorBody {
  readonly error?: string | { readonly message?: string };
}
