/**
 * policy-enactment-route.ts — the enactment-shape resolver (#1551).
 *
 * WHAT THIS RESOLVES
 * ───────────────────
 * A standing policy (#1547) is declarative: it states a target state and,
 * once active, is evaluated continuously against a tenant. #1551 settles that
 * the SAME detected divergence takes a DIFFERENT route depending on the
 * tenant's own consent state — "same policy, same detection, different
 * route":
 *
 *   engine_enacts   — the Policy Engine names the SOP (#1548) and it runs for
 *                      real, through the existing #1497/#1559 Change Control
 *                      gate, raising an auto-approved CR from the policy's
 *                      pre-approved catalog item (#1550). The engine itself
 *                      never executes — see #1548.
 *   checklist_item  — the divergence becomes a checklist item instead: the
 *                      SAME named SOP is surfaced as step-by-step manual
 *                      instructions, and the pointed verification check
 *                      (#1540) is the only thing that can close it. Identical
 *                      to `you_must_run` in the Remediation Tracker's own
 *                      model (#1539) — a write-denied tenant is a FIRST-CLASS
 *                      posture, not a degraded one (the "NASA" posture named
 *                      in this issue's title).
 *   not_evaluated   — no evaluation happens at all, so no divergence is even
 *                      detected. Two independent reasons collapse to this one
 *                      route: the policy itself is not switched on (#1547's
 *                      own opt-in, default-off gate), or the tenant has not
 *                      granted Graph READ consent at all — there is nothing
 *                      to compare the target state against without it.
 *
 * THE RESOLUTION RULE
 * ────────────────────
 * "Tenant state" in the settled architecture is TWO independent, already-real
 * consent keys on `tenants.consent` (graph.ts's own gates, `graphWriteForTenant`
 * and the read-side `graphFetchForTenant` path):
 *
 *   consent.graph.status === "granted"      — the tenant is connected at all;
 *                                              without it there is no read
 *                                              access to detect a divergence.
 *   consent.writeBack.status === "granted"  — the SAME status
 *                                              `resolveTenantWriteCeiling`
 *                                              (#1539, remediation-fix-route.ts)
 *                                              already gates platform-driven
 *                                              writes on. Anything else
 *                                              (pending/declined/revoked/absent)
 *                                              caps at `checklist_item` — never
 *                                              lower, the tenant can always
 *                                              follow the instructions.
 *
 * This mirrors #1539's own model exactly, which is why #1551 depends on
 * #1539/#1540 and not on #1553 (the finding-source build, still separate,
 * still in flight): detection is someone else's job (#1549/#1553); this
 * module resolves only the ROUTE a detected divergence takes for a given
 * (policy, tenant) pair, using per-tenant consent state that already exists.
 */

import type { TenantConsentMap } from "@workspace/db";

/** Every shape a policy enactment can take, in the order the settled table lists them. */
export const POLICY_ENACTMENT_ROUTE = ["engine_enacts", "checklist_item", "not_evaluated"] as const;
export type PolicyEnactmentRoute = (typeof POLICY_ENACTMENT_ROUTE)[number];

/**
 * Why a route resolved the way it did — kept distinct from the route itself so
 * a caller (or the future #1549 evaluation loop) can tell "policy switched
 * off" apart from "tenant not connected" even though both collapse to the same
 * `not_evaluated` route.
 */
export const POLICY_ENACTMENT_REASON = [
  "policy_inactive",
  "tenant_not_connected",
  "write_consent_granted",
  "write_consent_denied",
] as const;
export type PolicyEnactmentReason = (typeof POLICY_ENACTMENT_REASON)[number];

export interface PolicyEnactmentDecision {
  readonly route: PolicyEnactmentRoute;
  readonly reason: PolicyEnactmentReason;
}

/** Human labels for the route vocabulary. Display copy only — the raw value is the contract. */
export const POLICY_ENACTMENT_ROUTE_LABELS: Record<PolicyEnactmentRoute, string> = {
  engine_enacts: "Engine enacts automatically",
  checklist_item: "Manual checklist item",
  not_evaluated: "Not evaluated",
};

/**
 * The affordance a route implies for a downstream surface — same shape as
 * `FIX_ROUTE_AFFORDANCE` (remediation-fix-route.ts), kept independent because
 * the vocabularies themselves are independent (`not_evaluated` has no fix-route
 * analog: nothing is admin-centre-only here, the policy just isn't running).
 *
 *   execute — the engine runs the SOP through a CR (button DOES it).
 *   copy    — the SOP's steps are manual instructions (button COPIES them).
 *   none    — nothing to show; the policy is not being evaluated for this tenant.
 */
export const POLICY_ENACTMENT_AFFORDANCE: Record<PolicyEnactmentRoute, "execute" | "copy" | "none"> = {
  engine_enacts: "execute",
  checklist_item: "copy",
  not_evaluated: "none",
};

/**
 * Resolve the enactment route for one (policy, tenant) pair.
 *
 * `policyActive` is `standing_policies.is_active` (#1547) — a policy authored
 * but never switched on never reaches evaluation, regardless of tenant state.
 * `consent` is the tenant's own `tenants.consent` map, read verbatim — no
 * inferred or invented status.
 */
export function resolvePolicyEnactmentRoute(input: {
  policyActive: boolean;
  consent: TenantConsentMap | null | undefined;
}): PolicyEnactmentDecision {
  if (!input.policyActive) {
    return { route: "not_evaluated", reason: "policy_inactive" };
  }
  if (input.consent?.graph?.status !== "granted") {
    return { route: "not_evaluated", reason: "tenant_not_connected" };
  }
  if (input.consent?.writeBack?.status === "granted") {
    return { route: "engine_enacts", reason: "write_consent_granted" };
  }
  return { route: "checklist_item", reason: "write_consent_denied" };
}
