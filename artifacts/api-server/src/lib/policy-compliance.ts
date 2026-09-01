/**
 * policy-compliance.ts — pure, DB-free comparison logic for the Policy
 * Engine's finding source (#1553).
 *
 * WHAT THIS FILE IS
 * ──────────────────
 * A standing policy's `target_state` is what a check compares against
 * (#1547's own wording). This is that check: given a policy's declared
 * target and a real observed value for one member, decide compliant vs.
 * non-compliant. Kept DB-free and Graph-free — same pattern
 * `standing-policies.ts` and `remediation-fix-route.ts` use — so the
 * comparison rule itself can be unit-tested against plain fixtures.
 *
 * TARGET-KIND COVERAGE (honest, not full)
 * ────────────────────────────────────────
 * `mailbox_attribute` was the issue's own worked example ("policy says
 * 150MB, mailbox is 500MB"). `group_membership` (#1953) is now real too —
 * "VIP -> membership of these groups" compared against a real Graph
 * `checkMemberGroups` read (`policy-compliance-graph.ts`). `service_policy`
 * still has no reader wired — it likely needs Exchange Online PowerShell
 * (ps-execution) rather than a pure Graph read, and that model hasn't been
 * scoped for this config surface yet. Callers get an honest `not_evaluable`
 * verdict for it, never a fabricated compliant/non-compliant call.
 */

import type { StandingPolicyTargetKind } from "@workspace/db";

/** The `mailbox_attribute` target-state shape this evaluator understands. */
export interface MailboxAttributeTargetState {
  /** The one mailbox attribute this policy governs. Real vocabulary, no invented members. */
  readonly attribute: "mailboxSizeMb";
  /** `max`: compliant when observed <= value. This is the only operator #1553 needed. */
  readonly operator: "max";
  readonly value: number;
}

export function isMailboxAttributeTargetState(value: unknown): value is MailboxAttributeTargetState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.attribute === "mailboxSizeMb" && v.operator === "max" && typeof v.value === "number" && Number.isFinite(v.value) && v.value > 0;
}

export type PolicyComplianceVerdict = "compliant" | "non_compliant" | "not_evaluable";

export interface MailboxComplianceObservation {
  readonly userPrincipalName: string;
  readonly displayName: string | null;
  readonly observedSizeMb: number;
}

export interface PolicyComplianceResult {
  readonly verdict: PolicyComplianceVerdict;
  /** Human-readable reason — always set on `not_evaluable`, and describes the delta on `non_compliant`. */
  readonly reason: string;
  readonly observedValue: number | null;
  readonly targetValue: number | null;
}

/**
 * Compares one real observed mailbox size against a policy's `mailbox_attribute`
 * target state. Never invents an observation — the caller supplies the real
 * value (`policy-compliance-graph.ts`'s Graph read); this function only judges it.
 */
export function evaluateMailboxAttributeCompliance(
  targetState: unknown,
  observation: MailboxComplianceObservation,
): PolicyComplianceResult {
  if (!isMailboxAttributeTargetState(targetState)) {
    return {
      verdict: "not_evaluable",
      reason: `Policy target_state is not a recognized mailbox_attribute declaration: ${JSON.stringify(targetState)}`,
      observedValue: observation.observedSizeMb,
      targetValue: null,
    };
  }

  const { value: maxMb } = targetState;
  if (observation.observedSizeMb <= maxMb) {
    return {
      verdict: "compliant",
      reason: `${observation.observedSizeMb}MB is within the ${maxMb}MB policy cap`,
      observedValue: observation.observedSizeMb,
      targetValue: maxMb,
    };
  }

  return {
    verdict: "non_compliant",
    reason: `${observation.observedSizeMb}MB exceeds the ${maxMb}MB policy cap`,
    observedValue: observation.observedSizeMb,
    targetValue: maxMb,
  };
}

/** The `group_membership` target-state shape this evaluator understands. */
export interface GroupMembershipTargetState {
  /** Real Entra group object ids the member must belong to. Compliant only when ALL are present. */
  readonly groupIds: readonly string[];
}

export function isGroupMembershipTargetState(value: unknown): value is GroupMembershipTargetState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.groupIds) && v.groupIds.length > 0 && v.groupIds.every((id) => typeof id === "string" && id.length > 0);
}

export interface GroupMembershipComplianceObservation {
  readonly userPrincipalName: string;
  readonly displayName: string | null;
  /** Real group object ids `checkMemberGroups` confirmed this member actually belongs to, out of the policy's declared set. */
  readonly memberGroupIds: readonly string[];
}

/**
 * Compares one real observed group-membership set against a policy's
 * `group_membership` target state. Never invents membership — the caller
 * supplies the real value (`policy-compliance-graph.ts`'s `checkMemberGroups`
 * read); this function only judges it.
 */
export function evaluateGroupMembershipCompliance(
  targetState: unknown,
  observation: GroupMembershipComplianceObservation,
): PolicyComplianceResult {
  if (!isGroupMembershipTargetState(targetState)) {
    return {
      verdict: "not_evaluable",
      reason: `Policy target_state is not a recognized group_membership declaration: ${JSON.stringify(targetState)}`,
      observedValue: null,
      targetValue: null,
    };
  }

  const missing = targetState.groupIds.filter((id) => !observation.memberGroupIds.includes(id));
  if (missing.length === 0) {
    return {
      verdict: "compliant",
      reason: `Member of all ${targetState.groupIds.length} required group(s)`,
      observedValue: observation.memberGroupIds.length,
      targetValue: targetState.groupIds.length,
    };
  }

  return {
    verdict: "non_compliant",
    reason: `Missing membership in ${missing.length} of ${targetState.groupIds.length} required group(s): ${missing.join(", ")}`,
    observedValue: observation.memberGroupIds.length,
    targetValue: targetState.groupIds.length,
  };
}

/** Which target kinds this module can actually evaluate today. Honest, not aspirational. */
export const EVALUABLE_TARGET_KINDS: readonly StandingPolicyTargetKind[] = ["mailbox_attribute", "group_membership"];

export function isEvaluableTargetKind(kind: StandingPolicyTargetKind): boolean {
  return (EVALUABLE_TARGET_KINDS as readonly string[]).includes(kind);
}
