/**
 * useChangeControl.test.ts — separation-of-duties identity resolution.
 *
 * Run with: npx tsx --test src/components/portal-v2/useChangeControl.test.ts
 *
 * Pins the fix for Git #1215: the Change Control page's "is the viewer the
 * submitter?" decision used to be `submitter.org.indexOf("Halden") >= 0`, a
 * tenant-name string match that (a) always FAILED for any real tenant — whose
 * live rows carry `submitter.org === "Raised in the customer portal"` — so a
 * portal user could be offered "Sign and schedule" on a change they themselves
 * raised, and (b) hardcoded the design's fictional customer name into live page
 * logic. `viewerIsSubmitter` now resolves it from the real JWT identity on the
 * live path, and preserves the design's worked-example demo only on the fixture
 * fallback path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CC_FIXTURE_CUSTOMER_ORG } from "./ccPageData";
import { viewerIsSubmitter } from "./useChangeControl";

/** A CR shaped only as `viewerIsSubmitter` reads it. */
function cr(submitter: { name: string; org: string }) {
  return { approvals: { submitter } };
}

describe("viewerIsSubmitter — live identity resolution", () => {
  const ctx = (over: Partial<{ viewerEmail: string; viewerName: string }> = {}) => ({
    dataState: "live" as const,
    viewerEmail: "priya.raman@haldenmaterials.com",
    viewerName: "priya raman",
    ...over,
  });

  it("blocks when the live submitter email is the viewer's own account", () => {
    // Live rows record submitter.name = requestedBy = req.user.email.
    const change = cr({ name: "priya.raman@haldenmaterials.com", org: "Raised in the customer portal" });
    assert.equal(viewerIsSubmitter(change, ctx()), true);
  });

  it("is case-insensitive on the email match", () => {
    const change = cr({ name: "Priya.Raman@HaldenMaterials.com", org: "Raised in the customer portal" });
    assert.equal(viewerIsSubmitter(change, ctx()), true);
  });

  it("matches on display name for an older row that stored a name, not an email", () => {
    const change = cr({ name: "Priya Raman", org: "Raised in the customer portal" });
    assert.equal(viewerIsSubmitter(change, ctx()), true);
  });

  it("allows approval when someone ELSE raised the change", () => {
    const change = cr({ name: "dana.whitlock@shanemccaw.com", org: "Raised in the customer portal" });
    assert.equal(viewerIsSubmitter(change, ctx()), false);
  });

  it("does NOT fire on the old Halden org string for a real tenant (the bug)", () => {
    // The exact shape that used to trip the string match: a live-mode row whose
    // org happens to contain the fixture name must NOT be treated as the
    // viewer's own change unless the identity actually matches.
    const change = cr({ name: "someone.else@contoso.com", org: "Halden Materials tenant" });
    assert.equal(viewerIsSubmitter(change, ctx()), false);
  });

  it("returns false (safe default) when the submitter is unattributable", () => {
    const change = cr({ name: "", org: "Raised in the customer portal" });
    assert.equal(viewerIsSubmitter(change, ctx()), false);
  });

  it("returns false when the viewer has no identity on the token", () => {
    const change = cr({ name: "priya.raman@haldenmaterials.com", org: "Raised in the customer portal" });
    assert.equal(viewerIsSubmitter(change, ctx({ viewerEmail: "", viewerName: "" })), false);
  });
});

describe("viewerIsSubmitter — fixture worked-example fallback", () => {
  const ctx = { dataState: "fixture" as const, viewerEmail: "", viewerName: "" };

  it("blocks the change the design's own customer side raised", () => {
    const change = cr({ name: "Priya Raman", org: `${CC_FIXTURE_CUSTOMER_ORG} · IT Director` });
    assert.equal(viewerIsSubmitter(change, ctx), true);
  });

  it("allows the MSP-submitted fixture change through to the customer approver", () => {
    const change = cr({ name: "Shane McCaw", org: "Shane McCaw Consulting · Lead architect" });
    assert.equal(viewerIsSubmitter(change, ctx), false);
  });
});
