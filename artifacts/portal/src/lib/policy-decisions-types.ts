/**
 * Wire types for the customer-facing Policy Decisions own-table register
 * (#1724, Feature #1490).
 *
 * Mirrored verbatim from the real routes' own interfaces — see
 * `docs/portal/policy-decisions-contract-pack.md` §1/§3 and
 * `artifacts/api-server/src/routes/portal-policy-decisions.ts` /
 * `portal-compliance-obligations.ts`. This app has no shared wire-types
 * package to import from (each `artifacts/*` app is its own independent
 * Vite/Node app), so these are a local copy, not a redeclaration of a
 * different shape.
 *
 * The risk-derived view (`GET /portal/policy-decisions`, `WirePolicyDecision`)
 * is a DIFFERENT object, already wired on Risk Register's own
 * `PolicyDecisionsCard` — its types live in `risk-register-types.ts` and are
 * not repeated here. §9 of the contract pack is answered by the design as
 * pick-one: this page draws only the own-table register below.
 */

/** REVIEW_CADENCES (#2518) — plain `text` column, enforced only at create time. */
export const REVIEW_CADENCES = ["Monthly", "Quarterly", "Semi-Annual", "Annual", "Biennial"] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

/** CLEARANCE_TRIGGER_TYPES — plain `text` column, enforced only at create time. */
export const CLEARANCE_TRIGGER_TYPES = ["license_sku", "manual"] as const;
export type ClearanceTriggerType = (typeof CLEARANCE_TRIGGER_TYPES)[number];

/** One own-table policy decision (`portal-policy-decisions.ts:79-116`). */
export interface WirePolicyRegisterEntry {
  readonly id: string;
  readonly state: string;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string;
  /** `compliance_obligations.id`, stringified. Null when the free-text
   * `obligation` citation above has no catalog match (#1525). */
  readonly obligationId: string | null;
  /** The cited authority's type (AUTHORITY_TYPES). Null unless `obligationId` is set. */
  readonly obligationType: string | null;
  readonly owner: string;
  readonly ownerId: string | null;
  /** NULL for a dependency-based decision (#1526). */
  readonly reviewCadence: string | null;
  readonly reviewDueAt: string | null;
  /** NULL for a dependency-based decision — only resolved/unresolved (`isCleared`) applies. */
  readonly reviewState: string | null;
  readonly compensatingControl: string;
  readonly signedBy: string;
  readonly signedAt: string;
  readonly statement: string;
  /** Non-null is what makes a row dependency-based — the third clock (#1526). */
  readonly clearanceCondition: string | null;
  readonly clearanceTriggerType: string | null;
  readonly clearanceTriggerSkuPartNumber: string | null;
  readonly clearanceResolvedAt: string | null;
  readonly clearanceResolvedNote: string | null;
  readonly isCleared: boolean;
}

/** `POST /api/portal/policy-register` body (`createSchema`, `portal-policy-decisions.ts:217-277`). */
export interface CreatePolicyDecisionBody {
  readonly title: string;
  readonly obligation: string;
  readonly obligationId?: number | null;
  readonly pillar?: string;
  readonly owner: string;
  readonly ownerId?: string;
  readonly reviewCadence?: ReviewCadence;
  readonly clearanceCondition?: string;
  readonly clearanceTriggerType?: ClearanceTriggerType;
  readonly clearanceTriggerSkuPartNumber?: string;
  readonly compensatingControl: string;
  readonly signerName: string;
  readonly confirmed: true;
  readonly statement: string;
}

/** `PATCH /api/portal/policy-register/:id/clearance/resolve` body. */
export interface ResolveClearanceBody {
  readonly note: string;
}

/** One obligation-catalog row (`portal-compliance-obligations.ts`, extended for
 * #1724 to carry `id`/`type` — see that route's own header note). */
export interface WireObligation {
  readonly id: string;
  readonly framework: string;
  readonly scope: "In scope" | "Marked out of scope";
  readonly requires: string;
  readonly state: string;
  readonly tone: "red" | "amber" | "green" | "slate";
  readonly type: string;
}

export interface ApiErrorBody {
  readonly error?: { readonly message?: string } | string;
  readonly code?: string;
}
