/**
 * secMfaModel.test.ts — pins the MFA control rows, partial badges, and the
 * wizard's step→input mapping.
 *
 * The wizard shows a different input under a shared step list depending on the
 * current step; a wrong flag shows the grace-period box on the enforce step. The
 * partial-user badge colour is the only signal of who still has to enrol.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MFA_CONTROLS } from "./secMfaData";
import { isAdminGapUser, mfaControlRows, mfaGapUserRowsLive, mfaPartialUserRows, mfaPartialUserRowsLive, mfaStatePill, mfaUnregisteredCount, mfaWizardStepFlags } from "./secMfaModel";
import type { LiveMfaUser } from "./useMfaRegistrationLive";

describe("mfaControlRows", () => {
  it("carries one row per control with an mfa- fix key", () => {
    const rows = mfaControlRows();
    assert.equal(rows.length, MFA_CONTROLS.length);
    assert.equal(rows[0].fixKey, "mfa-methods-policy");
    assert.equal(rows[1].statusLabel, "Missing");
  });
});

describe("mfaPartialUserRows", () => {
  it("badges registered vs not-registered by colour", () => {
    const rows = mfaPartialUserRows();
    const ferris = rows.find((r) => r.name === "B. Ferris");
    assert.equal(ferris?.badgeLabel, "Not registered");
    assert.equal(ferris?.badgeColor, "#f87171");
    const mercer = rows.find((r) => r.name === "L. Mercer");
    assert.equal(mercer?.badgeLabel, "Registered");
    assert.equal(mercer?.badgeColor, "#34d399");
  });
});

describe("mfaGapUserRowsLive", () => {
  it("lists only unregistered users, annotating admins", () => {
    const users: LiveMfaUser[] = [
      { name: "Shane McCaw", isAdmin: true, isMfaRegistered: true },
      { name: "R. Delgado", isAdmin: false, isMfaRegistered: false },
      { name: "D. Cho", isAdmin: true, isMfaRegistered: false },
    ];
    assert.deepEqual(mfaGapUserRowsLive(users), ["R. Delgado", "D. Cho (admin)"]);
  });
});

describe("mfaPartialUserRowsLive", () => {
  it("badges every user by their real isMfaRegistered flag", () => {
    const users: LiveMfaUser[] = [
      { name: "L. Mercer", isAdmin: false, isMfaRegistered: true },
      { name: "B. Ferris", isAdmin: false, isMfaRegistered: false },
    ];
    const rows = mfaPartialUserRowsLive(users);
    assert.deepEqual(rows, [
      { name: "L. Mercer", registered: true, badgeLabel: "Registered", badgeColor: "#34d399" },
      { name: "B. Ferris", registered: false, badgeLabel: "Not registered", badgeColor: "#f87171" },
    ]);
  });
});

describe("isAdminGapUser", () => {
  it("matches the trailing (admin) suffix both MFA_GAP_USERS and mfaGapUserRowsLive bake in", () => {
    assert.equal(isAdminGapUser("D. Cho (admin)"), true);
    assert.equal(isAdminGapUser("R. Delgado"), false);
  });
});

describe("mfaUnregisteredCount", () => {
  it("counts only the not-registered rows, live or fixture", () => {
    // MFA_PARTIAL_USERS has 3 unregistered (B. Ferris, C. Obi, D. Cho) of 5 —
    // the hardcoded "2 of 5" copy this replaces (Git #1431) didn't even match
    // its own fixture, let alone a real tenant's live count.
    const rows = mfaPartialUserRows();
    assert.equal(mfaUnregisteredCount(rows), 3);
    assert.equal(mfaUnregisteredCount([]), 0);
    assert.equal(
      mfaUnregisteredCount(mfaPartialUserRowsLive([{ name: "A", isAdmin: false, isMfaRegistered: false }])),
      1,
    );
  });
});

describe("mfaWizardStepFlags", () => {
  it("maps each step to exactly its own input block", () => {
    assert.deepEqual(mfaWizardStepFlags(0), { isGraph: true, isGrace: false, isDeadline: false, isLegacy: false, isEnforce: false });
    assert.deepEqual(mfaWizardStepFlags(2), { isGraph: false, isGrace: true, isDeadline: false, isLegacy: false, isEnforce: false });
    assert.deepEqual(mfaWizardStepFlags(5), { isGraph: false, isGrace: false, isDeadline: false, isLegacy: false, isEnforce: true });
    // Step 1 shows no input block below the shared step list — the prototype's shape.
    assert.deepEqual(mfaWizardStepFlags(1), { isGraph: false, isGrace: false, isDeadline: false, isLegacy: false, isEnforce: false });
  });
});

describe("mfaStatePill", () => {
  it("colours the four state headers", () => {
    assert.equal(mfaStatePill("unconfigured").label, "Not configured");
    assert.equal(mfaStatePill("partial").color, "#c2a63d");
    assert.equal(mfaStatePill("gaps").label, "A few gaps");
    assert.equal(mfaStatePill("healthy").color, "#34d399");
  });
});
