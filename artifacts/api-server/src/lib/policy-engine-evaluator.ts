/**
 * policy-engine-evaluator.ts — pure, DB-free GATE logic for the Policy
 * Engine's continuous-evaluation reconciliation loop (#1549).
 *
 * #1549 SETTLED: "the policy engine evaluates continuously," on two triggers —
 * EVENT (something just changed for one tenant) and DIVERGENCE (a periodic
 * sweep that catches drift introduced by hand). Kept DB-free, same convention
 * standing-policies.ts / active-directory.ts / policy-compliance.ts already
 * use, so the gate can be unit-tested against plain values, without a
 * database.
 *
 * WHY THIS IS ONLY A GATE, NOT THE COMPARISON ITSELF:
 * #1553 already built the real comparison (`policy-compliance-evaluator.ts`'s
 * `evaluateStandingPolicyForCustomer` — real Graph reads via
 * `observeOuMailboxSizes`, real `msp_diagnostic_findings` rows for real
 * non-compliance). That function does NOT check the per-customer opt-in
 * checkbox this issue adds (`tenants.policy_engine_opt_in`) — it's an
 * on-demand, human-supplied-customerId route, so there is always a human in
 * the loop authorizing that one call. THIS loop is automatic and unattended,
 * so it is the one place that opt-in gate has to be enforced before the real
 * evaluator (or any Graph read) is ever reached. Decide the gate here, call
 * the real evaluator in policy-engine-nodes.ts only when it says `proceed`.
 */

export interface EvaluationGateInput {
  /** The tenant this policy's OU resolved to, or null if the OU carries none. */
  tenantId: number | null;
  /** Whether that tenant has opted in to the Policy Engine (default off). */
  policyEngineOptIn: boolean;
}

export type EvaluationGateDecision =
  | { proceed: true }
  | { proceed: false; outcome: "not_evaluable"; detail: Record<string, unknown> }
  | { proceed: false; outcome: "skipped_not_opted_in"; detail: Record<string, unknown> };

/**
 * Decides whether ONE standing policy is even allowed to be evaluated on THIS
 * pass. Never touches Microsoft Graph and never itself renders a compliant/
 * divergent verdict — that is #1553's real evaluator's job once this gate
 * says `proceed`.
 */
export function decideEvaluationGate(input: EvaluationGateInput): EvaluationGateDecision {
  if (input.tenantId === null) {
    return {
      proceed: false,
      outcome: "not_evaluable",
      detail: { reason: "standing policy's OU has no tenant attached — nothing to evaluate against" },
    };
  }

  if (!input.policyEngineOptIn) {
    return {
      proceed: false,
      outcome: "skipped_not_opted_in",
      detail: { reason: "tenant has not opted in to the Policy Engine" },
    };
  }

  return { proceed: true };
}
