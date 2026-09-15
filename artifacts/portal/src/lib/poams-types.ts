/**
 * Wire types for the customer-facing POA&Ms module (#4037, Feature #1935).
 *
 * Mirrored verbatim from the real route's own interfaces — see
 * `docs/portal/poams-contract-pack.md` and
 * `artifacts/api-server/src/routes/portal-poams.ts`. This module has no
 * shared wire-types package to import from (each `artifacts/*` app is its own
 * independent Vite/Node app), so these are a local copy, not a redeclaration
 * of a different shape.
 */

export interface WirePoamAuthorityHolder {
  readonly personId: string;
  readonly name: string;
}

export interface WirePoamAuthority {
  readonly workloadId: string;
  readonly workloadLabel: string;
  readonly holders: readonly WirePoamAuthorityHolder[];
}

/** The server's own six status words. `completed` is real in the enum but
 * never written by any route today — see the page's own known-limits ledger. */
export type PoamStatus =
  | "draft"
  | "pending_signature"
  | "active"
  | "completed"
  | "cancelled"
  | "converted_to_risk_acceptance"
  | (string & {});

export interface WirePoamMilestone {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly isOverdue: boolean;
}

export interface WirePoamSignature {
  readonly by: string;
  readonly on: string;
  readonly statement: string | null;
  readonly authorizedBy: WirePoamAuthority | null;
}

export interface WirePoam {
  readonly id: string;
  readonly title: string;
  readonly weakness: string;
  readonly checkKey: string | null;
  readonly status: PoamStatus;
  readonly isOverdue: boolean;
  readonly scheduledCompletionDate: string;
  readonly originalScheduledCompletionDate: string;
  readonly interimCompensatingControl: string;
  readonly resourcesRequired: string;
  readonly sowId: string | null;
  readonly authority: WirePoamAuthority | null;
  readonly signed?: WirePoamSignature;
  readonly isSigned: boolean;
  readonly milestones: readonly WirePoamMilestone[];
}

/** One candidate check a customer's own plan can point at (#4050). */
export interface WireAvailableCheck {
  readonly checkKey: string;
  readonly checkLabel: string;
  readonly severity: string;
  readonly title: string;
}

export interface CreatePoamRequest {
  readonly title: string;
  readonly weaknessDescription: string;
  readonly checkKey?: string | null;
  readonly scheduledCompletionDate: string;
  readonly interimCompensatingControl: string;
  readonly resourcesRequired: string;
  readonly sowId?: string | null;
}

export interface CreatePoamResponse {
  readonly id: string;
  readonly message: string;
}

export interface SignPoamRequest {
  readonly fullName: string;
  readonly confirmed: true;
  readonly statement: string;
}

export interface SignPoamResponse {
  readonly poamId: string;
  readonly signed: WirePoamSignature;
}

export interface DeletePoamRequest {
  readonly reason: string;
}

export interface PoamDeletion {
  readonly id: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly accelerationState: string;
  readonly [key: string]: unknown;
}

export interface DeletePoamResponse {
  readonly poamId: string;
  readonly deletion: PoamDeletion;
  readonly message: string;
}

export type AccelerationReasonKind = "superseded_by" | "no_longer_needed";

export interface RequestAccelerationRequest {
  readonly reasonKind: AccelerationReasonKind;
  readonly reason: string;
  readonly supersededByRecordType?: string;
  readonly supersededByRecordId?: string;
}

export interface RequestAccelerationResponse {
  readonly poamId: string;
  readonly deletion: PoamDeletion;
  readonly message: string;
}

export interface ApiErrorBody {
  readonly error:
    | {
        readonly code: string;
        readonly message: string;
        readonly details?: unknown;
        readonly traceId?: string;
      }
    | string;
}
