/**
 * portal-settings-change-control.ts — wire shapes and pure normalisation for
 * the Settings page's "Change control policy" section (Git #1592).
 *
 * Pure functions, no Express/DB, so they are unit-tested directly — the same
 * split `portal-ownership.ts` (lib) / `routes/portal-ownership.ts` uses. The
 * router lives at `routes/portal-settings-change-control.ts`.
 *
 * ── The default policy, and why it names no one ─────────────────────────────
 * The design fixture (`CC_POLICY_SEED` in the retired `settingsData.ts`) seeds
 * a master switch already ON with two named approvers per band. Reusing that
 * here would mean inventing a real tenant's opt-in and printing two of the
 * design's fictional people ("Dan Whitlock", "Priya Raman") as if a real
 * customer had picked them. `DEFAULT_POLICY` below is the honest default for a
 * tenant that has never configured this: gated on nothing yet, no approvers
 * named, no notification recipients — a customer must actually set it before
 * this page claims anyone signs anything.
 */

import { CC_GATE_KEYS, CC_NOTIF_EVENT_KEYS, type CcGateKey, type CcNotifEventKey } from "@workspace/db";

export interface CcPolicyRow {
  readonly enabled: boolean;
  readonly gated: Record<string, boolean>;
  readonly requiredSignatures: number;
  readonly requireSeparateApprover: boolean;
  readonly enforceFreezeCalendar: boolean;
  readonly allowEmergencyPath: boolean;
}

export const DEFAULT_CC_POLICY: CcPolicyRow = {
  enabled: false,
  gated: Object.fromEntries(CC_GATE_KEYS.map((k) => [k, false])),
  requiredSignatures: 1,
  requireSeparateApprover: true,
  enforceFreezeCalendar: false,
  allowEmergencyPath: false,
};

/** Merge a stored policy row's `gated` jsonb with the real gate catalogue, so
 *  a gate added to `CC_GATE_KEYS` after a tenant last saved reads as `false`
 *  instead of `undefined`. */
export function normalizeGated(raw: unknown): Record<CcGateKey, boolean> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(CC_GATE_KEYS.map((k) => [k, source[k] === true])) as Record<CcGateKey, boolean>;
}

export function isCcNotifEventKey(v: unknown): v is CcNotifEventKey {
  return (CC_NOTIF_EVENT_KEYS as readonly string[]).includes(v as string);
}

export interface CcNotifRuleRow {
  readonly eventKey: CcNotifEventKey;
  readonly channel: string;
  readonly to: string;
  readonly lead: string;
  readonly on: boolean;
}

/**
 * The default notification rule per event — carries the design's own
 * lead-time policy (that IS product knowledge: "thirty days is a change, one
 * day is an incident") but none of its fictional named recipients. `to` is
 * either "" (a real tenant has not named anyone) or a role description the
 * design itself treats as generic ("The named approver"), never a person.
 */
export const DEFAULT_CC_NOTIFICATIONS: readonly CcNotifRuleRow[] = [
  { eventKey: "ms_enforcement_approaching", channel: "Email", to: "", lead: "30 days ahead, then 7, then 1", on: true },
  { eventKey: "message_center_impact", channel: "Email", to: "", lead: "Within 4 hours of publication", on: true },
  { eventKey: "cr_raised", channel: "Email", to: "", lead: "Immediately", on: true },
  { eventKey: "cr_awaiting_signature", channel: "Email", to: "The named approver", lead: "Immediately, then daily until signed", on: true },
  { eventKey: "cr_window_opening", channel: "Teams", to: "IT team, service desk", lead: "24 hours ahead, then 1 hour", on: true },
  { eventKey: "cr_deployed_or_rolled_back", channel: "Email", to: "Service desk", lead: "Within 15 minutes", on: true },
  { eventKey: "freeze_declared_or_lifted", channel: "Email · Teams", to: "Everyone with an open change", lead: "Immediately", on: false },
];

export function defaultNotifFor(eventKey: CcNotifEventKey): CcNotifRuleRow {
  return DEFAULT_CC_NOTIFICATIONS.find((n) => n.eventKey === eventKey)!;
}
