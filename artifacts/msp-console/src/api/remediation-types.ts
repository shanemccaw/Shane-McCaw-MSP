/**
 * Wire types for the MSP Console's Remediation module (Git #2588, Feature
 * #1684). Mirrored from the real routes' own interfaces — see
 * `artifacts/api-server/src/routes/msp-remediation-tracker.ts`,
 * `-checklist.ts`, `-fix-routes.ts`, `-reveal.ts`, `-bypass-resolutions.ts`,
 * `-tracker-scores.ts` and `lib/db/src/schema/msp.ts`'s
 * `REMEDIATION_TRACKER_STEP_STATUS` / `REMEDIATION_FIX_ROUTE`. Each
 * `artifacts/*` app is its own independent Vite/Node app with no shared
 * wire-types package, so this is a local copy of the same real shape the
 * customer-facing portal already carries in
 * `artifacts/portal/src/lib/remediation-tracker-types.ts` /
 * `remediation-checklist-types.ts` — not a redeclaration of a different one.
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

/** Statuses this console's PUTs may set directly — `accepted_risk` is the customer's own signed fact. */
export const REMEDIATION_TRACKER_STEP_STATUS_WRITABLE = REMEDIATION_TRACKER_STEP_STATUS.filter(
  (s): s is Exclude<RemediationTrackerStepStatus, "accepted_risk"> => s !== "accepted_risk",
);

export type RemediationTrackerVerificationState = "unverified" | "verified" | "drift";
export type RemediationTerminalState = "verified" | "accepted" | "outstanding";
export type RemediationFixRoute = "we_can_run" | "you_must_run" | "admin_center_only";
export type RemediationAffordance = "execute" | "copy" | "link";

export interface RemediationKbStep {
  readonly text: string;
  readonly code?: string;
  readonly language?: string;
}

// ── Tracker catalogue (s1-s30) ───────────────────────────────────────────────

export interface CatalogueStep {
  readonly stepId: string;
  readonly stepLabel: string;
  readonly title: string;
  readonly pillar: string;
  readonly status: RemediationTrackerStepStatus;
  readonly statusLabel: string;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  readonly verificationState: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
  readonly terminalState: RemediationTerminalState;
  readonly note: string | null;
}

export interface CatalogueResponse {
  readonly steps: readonly CatalogueStep[];
  readonly statusLabels: Readonly<Record<string, string>>;
  readonly assignableStatuses: readonly { readonly status: RemediationTrackerStepStatus; readonly label: string }[];
}

export interface StepWriteResult {
  readonly stepId: string;
  readonly status: RemediationTrackerStepStatus;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  readonly verificationState: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
  readonly terminalState: RemediationTerminalState;
  readonly note?: string | null;
}

export interface VerifyResponse {
  readonly message: string;
  readonly stepId: string;
  readonly checkKeys: readonly string[];
}

export interface VerificationGuideItem {
  readonly checkKey: string;
  readonly validationStep: string | null;
  readonly validationCommand: string | null;
  readonly expectedOutcome: string | null;
}

export interface VerificationGuideResponse {
  readonly stepId: string;
  readonly checkKeys: readonly string[];
  readonly guidance: readonly VerificationGuideItem[];
}

// ── Findings-derived checklist ────────────────────────────────────────────────

export interface ChecklistItem {
  readonly checkKey: string;
  readonly findingId: string;
  readonly severity: "critical" | "warning";
  readonly title: string;
  readonly description: string | null;
  readonly fixRoute: RemediationFixRoute;
  readonly affordance: RemediationAffordance;
  readonly hasVerifiedContent: boolean;
  readonly summary: string | null;
  readonly remediationSteps: readonly RemediationKbStep[];
  readonly adminCenterPath: string | null;
  readonly adminCenterUrl: string | null;
  readonly validationCommand: string | null;
  readonly status: RemediationTrackerStepStatus;
  readonly completedAt: string | null;
  readonly verificationState: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
}

export interface ChecklistResult {
  readonly runId: string | null;
  readonly items: readonly ChecklistItem[];
}

export interface ChecklistItemWriteResult {
  readonly checkKey: string;
  readonly status: RemediationTrackerStepStatus;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  readonly verificationState: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
}

export interface RaiseChangeResult {
  readonly code: string;
  readonly risk: "Low" | "Medium" | "High" | (string & {});
  readonly workload: string;
  readonly freezeException: boolean;
  readonly riskDischarged: boolean;
  readonly checkKey: string;
}

// ── Fix routes + reveal ───────────────────────────────────────────────────────

export interface FixRouteItem {
  readonly checkKey: string;
  readonly title: string;
  readonly fixRoute: RemediationFixRoute;
  readonly findingCapability: RemediationFixRoute | null;
  readonly affordance: RemediationAffordance;
  readonly hasWritePack: boolean;
  readonly adminCenterPath: string | null;
  readonly adminCenterUrl: string | null;
  readonly validationCommand: string | null;
}

export interface FixRoutesResult {
  readonly tenantWriteCeiling: RemediationFixRoute;
  readonly items: readonly FixRouteItem[];
}

export interface RevealedFix {
  readonly checkKey: string;
  readonly changeRequestCode: string;
  readonly remediationSteps: readonly RemediationKbStep[];
  readonly prerequisites: readonly string[];
  readonly expectedOutcome: string;
  readonly validationStep: string;
  readonly validationCommand: string | null;
}

/** 403 (no/pending CR), 404 (approved, no content) and 409 (no connected tenant) are real, expected outcomes — not exceptions. */
export type RevealOutcome =
  | { readonly status: 200; readonly data: RevealedFix }
  | { readonly status: 403 | 404 | 409; readonly error: string };

// ── Bypass resolutions (observational) ───────────────────────────────────────

export interface BypassResolution {
  readonly stepId: string;
  readonly verifiedAt: string;
  readonly verifiedByRunId: string;
  readonly domainKey: string;
  readonly driftEvent: {
    readonly eventId: string;
    readonly setting: string;
    readonly op: string;
    readonly verdict: "approved" | "attributed_unapproved" | "unattributed" | "informational";
    readonly changedBy: string | null;
    readonly detectedAt: string;
    readonly status: "open" | "resolved" | "reopened";
  };
}

// ── Pillar scores ─────────────────────────────────────────────────────────────

export type PillarScoreStatus = "scored" | "insufficient_history" | "never_scanned" | (string & {});

export interface PillarScore {
  readonly before: number | null;
  readonly now: number | null;
  readonly dayOne: number | null;
  readonly delta: number | null;
  readonly status: PillarScoreStatus;
  readonly capturedAt: string | null;
  readonly scanCount: number;
}

export interface CopilotGateResult {
  readonly score: number | null;
  readonly threshold: number;
  readonly status: string | null;
  readonly source: "health_engine:copilot";
  readonly eligible?: boolean;
}

export interface TaskPoint {
  readonly severity: string;
  readonly weight: number;
}

export interface PillarScoresResponse {
  readonly pillars: Readonly<Record<string, PillarScore>>;
  readonly copilotGate: CopilotGateResult;
  readonly taskPoints: Readonly<Record<string, TaskPoint>>;
  readonly meta: {
    readonly hasAnyHistory: boolean;
    readonly latestRunId: string | null;
  };
}

// ── Evidence attachments (#3503) ─────────────────────────────────────────────

export interface WireEvidenceAttachment {
  readonly id: number;
  readonly source: "remediation_tracker" | "change_control";
  readonly sourceRefId: number;
  readonly url: string;
  readonly originalFilename: string | null;
  readonly contentType: string | null;
  readonly fileSizeBytes: number | null;
  readonly caption: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly capturedAt: string;
  readonly uploadedByPersonId: string | null;
  readonly createdAt: string;
}

export interface ApiErrorBody {
  readonly error?: string | { readonly message?: string };
}
