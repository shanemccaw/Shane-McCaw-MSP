/**
 * Wire types for the customer-facing Scope and SLA page (#4000, Feature #1661).
 *
 * Mirrored verbatim from the two real routes' own response shapes — see
 * `Design/portal/design_handoff_full_site/docs/scope-and-sla-contract-pack.md`
 * §1/§2 and `artifacts/api-server/src/routes/portal-customer-engines.ts`. This
 * app has no shared wire-types package to import from (each `artifacts/*` app
 * is its own independent Vite/Node app), so these are a local copy, not a
 * redeclaration of a different shape.
 */

export type OverallStatus = "on_track" | "attention_needed" | "action_required";
export type ResponsePerformance = "well_within" | "approaching_limit" | "overdue";
export type ScopeAreaStatus = "ok" | "notice" | "alert";
export type ScopeAreaKey = "deliverables" | "scope" | "timeline";

export interface SlaStatus {
  readonly overall: OverallStatus;
  readonly headline: string;
  readonly subtext: string;
  readonly complianceLabel: string;
  readonly activeWarnings: number;
  readonly activeIssues: number;
  readonly openRequests: number;
  readonly responsePerformance: ResponsePerformance;
  readonly responsePerformanceLabel: string;
  readonly updatedAt: string;
}

export interface ScopeArea {
  readonly key: ScopeAreaKey;
  readonly label: string;
  readonly status: ScopeAreaStatus;
  readonly message: string;
}

export interface ScopeStatus {
  readonly overall: OverallStatus;
  readonly headline: string;
  readonly subtext: string;
  readonly openItems: number;
  readonly areas: readonly ScopeArea[];
  readonly updatedAt: string;
}

/** Both routes' only error shape (contract pack §1/§2): `{ error: string }`. */
export interface ScopeSlaApiErrorBody {
  readonly error: string;
}
