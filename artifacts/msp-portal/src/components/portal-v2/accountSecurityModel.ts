/**
 * accountSecurityModel.ts — the Account security derivations (Part 12).
 *
 * Transcribes the prototype's `secPostureRows` / `secMfaRows` / `secSessionRows`
 * colour maps and the delete-confirmation gate (Customer Portal Shell.dc.html
 * 15786-15849). Named and tested here so the "unmanaged device" amber and the
 * type-to-confirm gate can't silently invert.
 */

import { SEC_DELETE_PHRASE, type SecMfaMethod, type SecMfaTone, type SecTone } from "./accountSecurityData";
import type { ChangePasswordOutcome, LiveMfaEnrollments } from "./useAccountSecurityLive";

/** Posture dot colour — prototype 15787. */
export function secDotColor(tone: SecTone): string {
  return { green: "#34d399", amber: "#c2a63d", red: "#f87171" }[tone];
}

/** Multifactor method accent — prototype 15808. */
export function mfaAccent(tone: SecMfaTone): string {
  return { green: "#34d399", blue: "#60a5fa", amber: "#c2a63d" }[tone];
}

/** A method is active when its state starts with "Active" — prototype 15809. */
export function mfaIsActive(state: string): boolean {
  return state.startsWith("Active");
}

/** A session on an unmanaged device — prototype 15830 (`compliant.startsWith`). */
export function sessionIsUnmanaged(compliant: string): boolean {
  return compliant.startsWith("Unmanaged");
}

/** Session dot colour — prototype 15829: current is green, the rest slate. */
export function sessionDotColor(current: boolean): string {
  return current ? "#34d399" : "#64748b";
}

/** Session compliance-line colour — prototype 15830: amber if unmanaged. */
export function sessionCompliantColor(compliant: string): string {
  return sessionIsUnmanaged(compliant) ? "#c2a63d" : "#64748b";
}

/**
 * Whether the delete button is enabled — prototype `secDeleteReady` (15849):
 * the typed phrase, trimmed and upper-cased, must equal DELETE MY ACCOUNT.
 */
export function secDeleteReady(text: string): boolean {
  return text.trim().toUpperCase() === SEC_DELETE_PHRASE;
}

/**
 * Overlays real `GET /api/auth/mfa/enrollments` state onto the fixture's
 * how/why/tradeoff copy for one method (Git #1235) — the design copy stays
 * design copy, only "is it actually enrolled" changes.
 */
export function mfaMethodWithLive(m: SecMfaMethod, live: LiveMfaEnrollments | null): SecMfaMethod {
  if (!live) return m;
  if (m.key === "passkey") {
    return live.passkey
      ? { ...m, state: `Active · ${live.passkeyCount} registered` }
      : { ...m, state: "Not set up" };
  }
  if (m.key === "app") {
    return live.totp ? { ...m, state: "Active · authenticator app" } : { ...m, state: "Not set up" };
  }
  if (m.key === "sms") {
    return live.sms
      ? { ...m, state: `Active${live.smsPhone ? ` · ${live.smsPhone}` : ""}` }
      : { ...m, state: "Not set up" };
  }
  return m;
}

/** The posture card's "Multifactor" row summary, from real enrollment state. */
export function mfaPostureSummary(live: LiveMfaEnrollments): string {
  const active: string[] = [];
  if (live.passkey) active.push("passkey");
  if (live.totp) active.push("authenticator app");
  if (live.sms) active.push("SMS");
  if (active.length === 0) return "No method registered";
  return `Registered · ${active.join(", ")}`;
}

/** The posture card's "Multifactor" row tone — green once any method is active. */
export function mfaPostureTone(live: LiveMfaEnrollments): SecTone {
  return live.passkey || live.totp || live.sms ? "green" : "red";
}

/** The posture card's "Sessions" row summary, from the real active-session list. */
export function sessionsPostureSummary(count: number): string {
  if (count === 0) return "No active sessions";
  return `${count} active`;
}

/**
 * The change-password form's error line for a failed `ChangePasswordOutcome`
 * — the route's own literal `error` text (Git #1601, `auth.ts:826/831/838/843`),
 * never a paraphrase, so the UI can't drift from what the server actually
 * said. Returns `null` for the two outcomes ("success" is not an error, and
 * "unknown" carries its own message on the outcome itself).
 */
export function changePasswordErrorText(outcome: ChangePasswordOutcome): string | null {
  switch (outcome.kind) {
    case "missing-fields":
      return "currentPassword and newPassword are required";
    case "too-short":
      return "Password must be at least 8 characters";
    case "no-password-set":
      return "No password set for this account.";
    case "incorrect-password":
      return "Current password is incorrect";
    case "unknown":
      return outcome.message;
    case "success":
      return null;
  }
}
