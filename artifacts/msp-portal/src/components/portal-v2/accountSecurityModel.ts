/**
 * accountSecurityModel.ts — the Account security derivations (Part 12).
 *
 * Transcribes the prototype's `secPostureRows` / `secMfaRows` / `secSessionRows`
 * colour maps and the delete-confirmation gate (Customer Portal Shell.dc.html
 * 15786-15849). Named and tested here so the "unmanaged device" amber and the
 * type-to-confirm gate can't silently invert.
 */

import { SEC_DELETE_PHRASE, type SecMfaTone, type SecTone } from "./accountSecurityData";

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
