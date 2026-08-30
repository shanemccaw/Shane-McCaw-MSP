/**
 * policy-engine-evaluator.ts — pure, DB-free decision logic for the Policy
 * Engine's continuous-evaluation reconciliation loop (#1549).
 *
 * #1549 SETTLED: "the policy engine evaluates continuously," on two triggers —
 * EVENT (something just changed for one tenant) and DIVERGENCE (a periodic
 * sweep that catches drift introduced by hand). Kept DB-free, same convention
 * standing-policies.ts and active-directory.ts already use, so the decision
 * table can be unit-tested against plain values, without a database.
 *
 * WHY THIS NEVER RETURNS A REAL "compliant"/"divergent" VERDICT TODAY:
 * a standing policy attaches to an OU (#1547), and "membership determines
 * what applies" — but `active_directory_ous` has no object-to-OU membership
 * model (deliberately reserved; see that table's own schema note). There is
 * no "who belongs to this OU" to read live Microsoft Graph state for and
 * compare against `target_state`. Reporting `not_evaluable` here is the
 * honest answer, not a workaround — inventing a pass/fail verdict with no
 * real data behind it would be worse than reporting nothing. See
 * build-journal/1549.md and the finding filed against #1490 for the tracked
 * gap this leaves for whichever issue builds real OU membership next.
 */

import type { StandingPolicyTargetKind, PolicyEvaluationOutcome } from "@workspace/db";

export interface EvaluationDecisionInput {
  /** The tenant this policy's OU resolved to, or null if the OU carries none. */
  tenantId: number | null;
  /** Whether that tenant has opted in to the Policy Engine (default off). */
  policyEngineOptIn: boolean;
  targetKind: StandingPolicyTargetKind;
}

export interface EvaluationDecision {
  outcome: PolicyEvaluationOutcome;
  detail: Record<string, unknown>;
}

/**
 * Decides the outcome for ONE standing policy on ONE evaluation pass. Never
 * touches Microsoft Graph and never fabricates a compliant/divergent verdict
 * — every real target kind returns `not_evaluable` today, honestly, because
 * no OU-membership model exists yet to read a "current state" from.
 */
export function decideEvaluationOutcome(input: EvaluationDecisionInput): EvaluationDecision {
  if (input.tenantId === null) {
    return {
      outcome: "not_evaluable",
      detail: { reason: "standing policy's OU has no tenant attached — nothing to evaluate against" },
    };
  }

  if (!input.policyEngineOptIn) {
    return {
      outcome: "skipped_not_opted_in",
      detail: { reason: "tenant has not opted in to the Policy Engine" },
    };
  }

  return {
    outcome: "not_evaluable",
    detail: {
      reason: `no comparator implemented yet for target kind '${input.targetKind}' — active_directory_ous has no object-to-OU membership model to read live state from`,
      targetKind: input.targetKind,
    },
  };
}
