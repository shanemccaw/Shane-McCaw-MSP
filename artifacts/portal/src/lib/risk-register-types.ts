/**
 * Wire types for the customer-facing Risk Register (#2993, Feature #1487).
 *
 * Mirrored verbatim from the real route's own interfaces — see
 * `docs/risk-register-contract-pack.md` and
 * `artifacts/api-server/src/routes/portal-risk-register.ts` /
 * `portal-rbd-document.ts`. This module has no shared wire-types package to
 * import from (each `artifacts/*` app is its own independent Vite/Node app),
 * so these are a local copy, not a redeclaration of a different shape.
 */

export interface WireRiskAuthorityHolder {
  readonly personId: string;
  readonly name: string;
}

export interface WireRiskAuthority {
  readonly workloadId: string;
  readonly workloadLabel: string;
  readonly holders: readonly WireRiskAuthorityHolder[];
}

/** RISK_ACCEPTANCE_STATUSES: pending_signature | active | revoked. */
export type RiskAcceptanceStatus = "pending_signature" | "active" | "revoked" | (string & {});

/** RISK_REVIEW_STATES: on_track | due | overdue. */
export type RiskReviewState = "on_track" | "due" | "overdue" | (string & {});

/** The risk's own state — comment-only vocabulary, not DB-enforced. */
export type RiskStatus = "Open" | "Mitigating" | "Accepted" | "Closed" | "Expired" | (string & {});

export interface WireAcceptance {
  readonly status: RiskAcceptanceStatus;
  readonly by: string;
  readonly on: string;
  readonly register: string | null;
  readonly why: string | null;
  readonly compensating: string | null;
  readonly statement: string | null;
  readonly authorizedBy: WireRiskAuthority | null;
}

export interface WireRisk {
  readonly id: string;
  readonly title: string;
  readonly pillar: string | null;
  readonly inherent: string | null;
  readonly residual: string | null;
  readonly status: RiskStatus | null;
  readonly owner: string | null;
  readonly review: string | null;
  readonly reviewDueAt: string | null;
  readonly reviewState: RiskReviewState | null;
  readonly weight: number | null;
  readonly likelihood: number | null;
  readonly impact: number | null;
  readonly what: string;
  readonly outcome: string | null;
  readonly evidence: string | null;
  readonly controls: readonly string[];
  readonly plan: string | null;
  readonly accepted?: WireAcceptance;
  readonly isAccepted: boolean;
  readonly liabilityValueUsd: number;
  readonly framework: string;
  readonly controlViolated: string;
  readonly obligation: string | null;
  readonly obligationId: string | null;
  readonly obligationType: string | null;
  readonly spawnedByChangeRequestCode: string | null;
  readonly dischargedByChangeRequestCode: string | null;
  readonly authority: WireRiskAuthority | null;
}

export interface WirePolicyDecision {
  readonly id: string;
  readonly state: string | null;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string | null;
  readonly owner: string | null;
  readonly ownerId: string | null;
  readonly approved: string | null;
  readonly review: string | null;
  readonly reviewDueAt: string | null;
  readonly reviewState: RiskReviewState | null;
  readonly register: string | null;
  readonly rationale: string | null;
  readonly compensating: string | null;
  readonly check: string | null;
  readonly obligationId: string | null;
  readonly obligationType: string | null;
}

export interface WireRbdVersionSummary {
  readonly versionUid: string;
  readonly rbdId: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;
  readonly requiresSignature: boolean;
  readonly signatureInherited: boolean;
}

export interface AcceptRiskRequest {
  readonly fullName: string;
  readonly confirmed: true;
  readonly statement: string;
}

export interface AcceptRiskResponse {
  readonly rbdId: string;
  readonly accepted: WireAcceptance;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly traceId?: string;
  };
}
