/**
 * accountSecurityModel.test.ts — pins the posture/method/session colour maps and
 * the delete-confirmation gate against the prototype's own rules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SEC_MFA, SEC_POSTURE, SEC_SESSIONS } from "./accountSecurityData";
import {
  mfaAccent,
  mfaIsActive,
  secDeleteReady,
  secDotColor,
  sessionCompliantColor,
  sessionDotColor,
  sessionIsUnmanaged,
} from "./accountSecurityModel";

describe("fixture shape", () => {
  it("has 6 posture rows, 3 methods and 3 sessions", () => {
    assert.equal(SEC_POSTURE.length, 6);
    assert.equal(SEC_MFA.length, 3);
    assert.equal(SEC_SESSIONS.length, 3);
  });

  it("flags exactly the passkey gap in the posture", () => {
    const amber = SEC_POSTURE.filter((p) => p.tone === "amber");
    assert.deepEqual(amber.map((p) => p.k), ["Passkey"]);
  });
});

describe("posture dot colour", () => {
  it("maps the three tones", () => {
    assert.equal(secDotColor("green"), "#34d399");
    assert.equal(secDotColor("amber"), "#c2a63d");
    assert.equal(secDotColor("red"), "#f87171");
  });
});

describe("multifactor methods", () => {
  it("accents strongest green, app blue, sms amber", () => {
    assert.equal(mfaAccent("green"), "#34d399");
    assert.equal(mfaAccent("blue"), "#60a5fa");
    assert.equal(mfaAccent("amber"), "#c2a63d");
  });

  it("reads only the Authenticator app as active", () => {
    const active = SEC_MFA.filter((m) => mfaIsActive(m.state));
    assert.deepEqual(active.map((m) => m.name), ["Authenticator app"]);
  });

  it("recommends exactly the passkey", () => {
    assert.deepEqual(SEC_MFA.filter((m) => m.recommended).map((m) => m.name), ["Passkey"]);
  });
});

describe("sessions", () => {
  it("marks only the Leeds session unmanaged, and colours it amber", () => {
    const unmanaged = SEC_SESSIONS.filter((s) => sessionIsUnmanaged(s.compliant));
    assert.equal(unmanaged.length, 1);
    assert.ok(unmanaged[0].where.startsWith("Leeds"));
    assert.equal(sessionCompliantColor(unmanaged[0].compliant), "#c2a63d");
    assert.equal(sessionCompliantColor("Compliant device · hybrid joined"), "#64748b");
  });

  it("lets you revoke every session except the current one, and dots current green", () => {
    const current = SEC_SESSIONS.filter((s) => s.current);
    assert.equal(current.length, 1);
    assert.equal(sessionDotColor(true), "#34d399");
    assert.equal(sessionDotColor(false), "#64748b");
  });
});

describe("delete confirmation gate", () => {
  it("enables only on the exact phrase, tolerating case and surrounding space", () => {
    assert.equal(secDeleteReady("DELETE MY ACCOUNT"), true);
    assert.equal(secDeleteReady("  delete my account  "), true);
    assert.equal(secDeleteReady("delete account"), false);
    assert.equal(secDeleteReady(""), false);
  });
});
