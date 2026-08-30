/**
 * standing-policies.ts — pure, DB-free shaping + validation for the Policy
 * Engine's declarative object (#1547).
 *
 * A standing policy is DECLARATIVE and operationally live: it states a target
 * state; it cites no obligation, follows no finding, and requires no signature.
 * It is a SECOND object, distinct from the msp_risk_decisions register — see
 * `standingPoliciesTable`'s own schema note. Nothing here touches money or a
 * signature, because the object carries neither.
 *
 * Kept DB-free so the wire contract and the target-kind vocabulary can be
 * unit-tested against plain rows, the same pattern active-directory.ts uses.
 */

import {
  STANDING_POLICY_TARGET_KIND,
  type StandingPolicy,
  type StandingPolicyTargetKind,
} from "@workspace/db";

/** The wire contract for a standing policy. Ends at the wire — no portal page (#1547 scope stop). */
export interface WireStandingPolicy {
  readonly id: number;
  readonly ouId: number;
  readonly title: string;
  readonly description: string;
  readonly targetKind: StandingPolicyTargetKind;
  /** The forward/backward declaration map — served verbatim, never invented. */
  readonly targetState: unknown;
  /** #1550: the pre-approved catalog item a forward enactment would raise its CR from; null until bound. */
  readonly catalogItemId: number | null;
  /** #1548: the `msp_sops.sop_id` that enacts this policy's target state; null until named. */
  readonly sopId: string | null;
  readonly isActive: boolean;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Human labels for the target-kind vocabulary. Display copy only — the raw value is the contract. */
export const STANDING_POLICY_TARGET_KIND_LABELS: Record<StandingPolicyTargetKind, string> = {
  mailbox_attribute: "Mailbox attribute",
  group_membership: "Group membership",
  service_policy: "Service policy",
};

/** Narrows an arbitrary value to a real target kind — no fallback, no invented member. */
export function isStandingPolicyTargetKind(value: unknown): value is StandingPolicyTargetKind {
  return typeof value === "string" && (STANDING_POLICY_TARGET_KIND as readonly string[]).includes(value);
}

/**
 * Maps a real `standing_policies` row to its wire shape. Nulls are served as
 * nulls; the target-state declaration is served exactly as stored.
 */
export function toWireStandingPolicy(row: StandingPolicy): WireStandingPolicy {
  return {
    id: row.id,
    ouId: row.ouId,
    title: row.title,
    description: row.description,
    targetKind: row.targetKind,
    targetState: row.targetState,
    catalogItemId: row.catalogItemId,
    sopId: row.sopId,
    isActive: row.isActive,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── #1550: the enactment gate, as a pure rule ────────────────────────────────
//
// "A policy IS a standard change catalog item." The verdict of whether ONE
// enactment may proceed as an auto-approved standard change never depends on
// anything but these two live facts — the policy's own `isActive` flag and its
// bound catalog item's CURRENT `status` — so it is extracted as a pure rule the
// same way `change-control-write-gate.ts`'s `evaluateChangeRequestAuthorization`
// is: unit-testable in isolation, and the one place `lib/policy-enactment.ts`
// (the actual CR raise, invoked from `sop-execution.ts`'s policy-enactment
// path) reads the verdict from.

/** The verdict of the pure enactment-gate rule. */
export type PolicyEnactmentGateVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The live facts the gate reasons over — nothing from a request, nothing cached. */
export interface PolicyEnactmentGateFacts {
  readonly isActive: boolean;
  readonly catalogItemId: number | null;
  /** The bound catalog item's CURRENT status, or null when it could not be loaded (e.g. deleted). */
  readonly catalogItemStatus: string | null;
}

/**
 * PURE — may a standing policy currently produce an auto-approved enactment?
 * Fail-closed: every branch that is not an unambiguous yes returns a specific
 * reason. Never reads a database; unit-tested in isolation.
 */
export function evaluatePolicyEnactmentGate(facts: PolicyEnactmentGateFacts): PolicyEnactmentGateVerdict {
  if (!facts.isActive) {
    return { ok: false, reason: "standing policy is not active" };
  }
  if (facts.catalogItemId === null) {
    return { ok: false, reason: "standing policy has no bound catalog item" };
  }
  if (facts.catalogItemStatus === null) {
    return { ok: false, reason: "the catalog item bound to this policy no longer exists" };
  }
  if (facts.catalogItemStatus !== "approved") {
    return { ok: false, reason: `the catalog item bound to this policy is '${facts.catalogItemStatus}', not 'approved'` };
  }
  return { ok: true };
}
