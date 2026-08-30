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
