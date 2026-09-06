/**
 * Wire types for the findings-derived Remediation Tracking checklist, its
 * fix-route dimension, the CR-gated script reveal, and the bypass-resolutions
 * read (#1538/#1539/#1541/#1543, Feature #1489).
 *
 * Mirrored from the real routes' own interfaces — see
 * `docs/remediation-tracking-contract-pack.md` §1b-1e and
 * `artifacts/api-server/src/routes/portal-remediation-checklist.ts` /
 * `-fix-routes.ts` / `-reveal.ts` / `-bypass-resolutions.ts`. No shared
 * wire-types package exists between `artifacts/*` apps, so this is a local
 * copy, not a redeclaration of a different shape.
 *
 * NOTE ON `accepted_risk` (#2827/#2869): the s1-s30 world's `PUT
 * .../steps/:stepId` and this checklist's own `PUT .../checklist/:checkKey`
 * both reject a bare write of `accepted_risk` — it is reachable only through
 * a signed `POST .../decline-to-risk` call. The contract pack this file was
 * built against (§1b/§7.1) does not document that decline route at all; it
 * exists in the real route file read for this build. See the filed finding
 * referenced in build-journal/3038.md.
 */

/** REMEDIATION_TRACKER_STEP_STATUS, lib/db/src/schema/msp.ts:7194-7202. */
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

/** Statuses a bare PUT may set directly — everything except the signed exit. */
export const CHECKLIST_WRITABLE_STATUS = REMEDIATION_TRACKER_STEP_STATUS.filter(
  (s) => s !== "accepted_risk",
) as readonly Exclude<RemediationTrackerStepStatus, "accepted_risk">[];

export type RemediationTrackerVerificationState = "unverified" | "verified" | "drift";

/** REMEDIATION_FIX_ROUTE, lib/db/src/schema/msp.ts:7035. */
export type RemediationFixRoute = "we_can_run" | "you_must_run" | "admin_center_only";

export type RemediationAffordance = "execute" | "copy" | "link";

export interface RemediationKbStep {
  readonly text: string;
  readonly code?: string;
  readonly language?: string;
}

/** GET /api/portal/remediation/checklist — one item. */
export interface RemediationChecklistItem {
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

export interface RemediationChecklistResult {
  readonly runId: string | null;
  readonly items: readonly RemediationChecklistItem[];
}

/** PUT /api/portal/remediation/checklist/:checkKey response. */
export interface RemediationChecklistItemWriteResult {
  readonly checkKey: string;
  readonly status: RemediationTrackerStepStatus;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  readonly verificationState: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
}

/** POST /api/portal/remediation/checklist/:checkKey/raise-change response. */
export interface RaiseChangeFromChecklistResult {
  readonly code: string;
  readonly risk: "Low" | "Medium" | "High" | (string & {});
  readonly workload: string;
  readonly freezeException: boolean;
  readonly riskDischarged: boolean;
  readonly checkKey: string;
}

/** POST /api/portal/remediation/checklist/:checkKey/decline-to-risk response. */
export interface DeclineChecklistToRiskResult {
  readonly item: RemediationChecklistItemWriteResult;
  readonly rbdId: string;
  readonly accepted: {
    readonly by: string;
    readonly on: string;
    readonly statement: string;
  };
}

/** GET /api/portal/remediation/fix-routes — one item. */
export interface WireFixRouteItem {
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

export interface RemediationFixRoutesResult {
  readonly tenantWriteCeiling: RemediationFixRoute;
  readonly items: readonly WireFixRouteItem[];
}

/** POST /api/portal/remediation/fix-routes/:checkKey/reveal — 200 payload. */
export interface WireRevealedFix {
  readonly checkKey: string;
  readonly changeRequestCode: string;
  readonly remediationSteps: readonly RemediationKbStep[];
  readonly prerequisites: readonly string[];
  readonly expectedOutcome: string;
  readonly validationStep: string;
  readonly validationCommand: string | null;
}

/**
 * A reveal attempt's real outcome — 403 (no/pending CR), 404 (approved, no
 * content), 409 (no connected tenant) and 200 are all legitimate, expected
 * responses per the contract pack (§1d), not failures to throw past.
 */
export type RevealOutcome =
  | { readonly status: 200; readonly data: WireRevealedFix }
  | { readonly status: 403 | 404 | 409; readonly error: string };

/** GET /api/portal/remediation/bypass-resolutions — one item. */
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

export interface ApiErrorBody {
  readonly error?: { readonly message?: string } | string;
}
