/**
 * secMfaModel.ts — pure derivations behind the MFA drill-down.
 *
 * Mirrors the prototype's `mfaControlRows` (18177), `mfaPartialUsers` (18043),
 * the `mfaStepIsGraph|Grace|Deadline|Legacy|Enforce` flags (21118-21122) and the
 * per-state pill selection (21115-21117 with the headers at 4832 / 4898 / 4926 /
 * 4946). Kept out of the page so the wizard's step→input mapping and the row
 * derivations are unit-testable.
 */

import {
  MFA_CONTROLS,
  MFA_PARTIAL_USERS,
  MFA_STATUS_META,
  type MfaState,
} from "./secMfaData";
import type { LiveMfaUser } from "./useMfaRegistrationLive";

export interface MfaControlRow {
  label: string;
  detail: string;
  statusLabel: string;
  statusColor: string;
  fixKey: string;
}

export interface MfaPartialUserRow {
  name: string;
  registered: boolean;
  badgeLabel: string;
  badgeColor: string;
}

/** `mfaControlRows` (18177). */
export function mfaControlRows(): MfaControlRow[] {
  return MFA_CONTROLS.map((c) => {
    const m = MFA_STATUS_META[c.status];
    return {
      label: c.label,
      detail: c.detail,
      statusLabel: m.label,
      statusColor: m.c,
      fixKey: "mfa-" + c.key,
    };
  });
}

/** `mfaPartialUsers` (18043). */
export function mfaPartialUserRows(): MfaPartialUserRow[] {
  return MFA_PARTIAL_USERS.map((u) => ({
    name: u.name,
    registered: u.registered,
    badgeLabel: u.registered ? "Registered" : "Not registered",
    badgeColor: u.registered ? "#34d399" : "#f87171",
  }));
}

/**
 * The "gaps" state's accounts-without-MFA list, from real `identity:mfa-
 * registration` item rows (`useMfaRegistrationLive`, Git #1234) rather than
 * `MFA_GAP_USERS`. Admins are annotated the same way the fixture does
 * ("(admin)"), off the check's real `isAdmin` field.
 */
export function mfaGapUserRowsLive(users: readonly LiveMfaUser[]): string[] {
  return users.filter((u) => !u.isMfaRegistered).map((u) => (u.isAdmin ? `${u.name} (admin)` : u.name));
}

/**
 * The "partial" state's enrollment roster, from the same real item rows —
 * `isMfaRegistered` stands in for the fixture's `registered` flag.
 */
export function mfaPartialUserRowsLive(users: readonly LiveMfaUser[]): MfaPartialUserRow[] {
  return users.map((u) => ({
    name: u.name,
    registered: u.isMfaRegistered,
    badgeLabel: u.isMfaRegistered ? "Registered" : "Not registered",
    badgeColor: u.isMfaRegistered ? "#34d399" : "#f87171",
  }));
}

export interface MfaWizardStepFlags {
  isGraph: boolean;
  isGrace: boolean;
  isDeadline: boolean;
  isLegacy: boolean;
  isEnforce: boolean;
}

/** `mfaStepIsGraph|Grace|Deadline|Legacy|Enforce` (21118-21122). Zero-based step. */
export function mfaWizardStepFlags(step: number): MfaWizardStepFlags {
  return {
    isGraph: step === 0,
    isGrace: step === 2,
    isDeadline: step === 3,
    isLegacy: step === 4,
    isEnforce: step === 5,
  };
}

/** The state header pill — colour + label per state (4832 / 4898 / 4926 / 4946). */
export function mfaStatePill(state: MfaState): { color: string; label: string } {
  switch (state) {
    case "unconfigured":
      return { color: "#f87171", label: "Not configured" };
    case "partial":
      return { color: "#c2a63d", label: "Configured, not enrolled" };
    case "gaps":
      return { color: "#f87171", label: "A few gaps" };
    case "healthy":
      return { color: "#34d399", label: "Healthy" };
  }
}
