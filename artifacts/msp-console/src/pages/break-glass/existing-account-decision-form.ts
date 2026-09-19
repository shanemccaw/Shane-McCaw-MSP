/**
 * existing-account-decision-form.ts — the pure rules behind the "existing
 * break-glass account" decision form (#4532), kept out of the component so they can
 * be tested without a DOM.
 *
 * The route refuses to act without the customer's answer and the operator's reason
 * (msp-break-glass.ts), and `emails` only applies to a reset. The form mirrors that so
 * the button is never armed for a request the server would reject.
 */
import type { ExistingAccountChoice } from "@/api/break-glass-api";

export const MAX_INVITES = 5;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a free-text recipient box into distinct lowercase addresses and say whether they are all usable. */
export function parseEmails(raw: string): { emails: string[]; valid: boolean } {
  const emails = Array.from(new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)));
  return { emails, valid: emails.length <= MAX_INVITES && emails.every((e) => EMAIL_SHAPE.test(e)) };
}

/** Whether the operator has given the server everything it requires for the chosen path. */
export function isDecisionReady(input: {
  choice: ExistingAccountChoice | null;
  customerAnswer: string;
  reason: string;
  emailsValid: boolean;
}): boolean {
  if (input.choice === null) return false;
  if (input.customerAnswer.trim().length === 0 || input.reason.trim().length === 0) return false;
  // Recipients only matter for a reset; an unusable list must not arm it.
  return input.choice !== "reset_and_redeliver" || input.emailsValid;
}
