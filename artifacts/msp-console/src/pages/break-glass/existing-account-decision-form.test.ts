/**
 * existing-account-decision-form.test.ts — Git #4532
 *
 * The decision button must never be armed for a request the server would refuse:
 * no choice, no customer answer, no reason, or (for a reset) an unusable recipient list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDecisionReady, parseEmails, MAX_INVITES } from "./existing-account-decision-form";

const ANSWER = "Customer IT lead confirmed by email";
const REASON = "Re-run of quickstart-v1";

test("parseEmails splits on commas, semicolons and whitespace, lowercases and de-duplicates", () => {
  assert.deepEqual(parseEmails("A@x.com, b@x.com;a@X.com  c@x.com").emails, ["a@x.com", "b@x.com", "c@x.com"]);
  assert.equal(parseEmails("a@x.com, b@x.com").valid, true);
});

test("parseEmails treats an empty box as valid (invites are optional)", () => {
  assert.deepEqual(parseEmails("   "), { emails: [], valid: true });
});

test("parseEmails rejects a malformed address and more than the maximum", () => {
  assert.equal(parseEmails("not-an-email").valid, false);
  assert.equal(parseEmails("a@x.com, bad").valid, false);
  const tooMany = Array.from({ length: MAX_INVITES + 1 }, (_, i) => `u${i}@x.com`).join(",");
  assert.equal(parseEmails(tooMany).valid, false);
  const exactly = Array.from({ length: MAX_INVITES }, (_, i) => `u${i}@x.com`).join(",");
  assert.equal(parseEmails(exactly).valid, true);
});

test("nothing is armed without a choice", () => {
  assert.equal(isDecisionReady({ choice: null, customerAnswer: ANSWER, reason: REASON, emailsValid: true }), false);
});

test("both paths need the customer's answer and the reason, not just whitespace", () => {
  for (const choice of ["reset_and_redeliver", "resume_without_delivery"] as const) {
    assert.equal(isDecisionReady({ choice, customerAnswer: ANSWER, reason: REASON, emailsValid: true }), true);
    assert.equal(isDecisionReady({ choice, customerAnswer: "   ", reason: REASON, emailsValid: true }), false);
    assert.equal(isDecisionReady({ choice, customerAnswer: ANSWER, reason: "", emailsValid: true }), false);
  }
});

test("an unusable recipient list blocks a reset but not a resume", () => {
  assert.equal(isDecisionReady({ choice: "reset_and_redeliver", customerAnswer: ANSWER, reason: REASON, emailsValid: false }), false);
  assert.equal(isDecisionReady({ choice: "resume_without_delivery", customerAnswer: ANSWER, reason: REASON, emailsValid: false }), true);
});
