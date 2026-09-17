/**
 * ca-policy-impact.test.ts — Git #4522.
 *
 * The pure impact arithmetic behind the CA promotion gate. Sign-in rows are shaped
 * like Microsoft Graph v1.0 `signIn` resources (appliedConditionalAccessPolicies[]
 * with the documented report-only `result` values); no live tenant is involved.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_IMPACT_EVENTS,
  SIGN_IN_RETENTION_DAYS,
  computeImpactWindow,
  impactFingerprint,
  promotionReadiness,
  summarizeReportOnlyImpact,
  type GraphConditionalAccessPolicy,
  type GraphSignInForImpact,
} from "./ca-policy-impact.ts";

const POLICY = "6f2a1b0e-2c1d-4d8e-9a55-0b7f1c3e9d21";
const OTHER = "11111111-2222-3333-4444-555555555555";
const NOW = new Date("2026-09-17T12:00:00Z");

const policy = (over: Partial<GraphConditionalAccessPolicy> = {}): GraphConditionalAccessPolicy => ({
  id: POLICY,
  displayName: "Baseline: Require MFA for All Users (report-only)",
  state: "enabledForReportingButNotEnforced",
  createdDateTime: "2026-09-01T09:00:00Z",
  modifiedDateTime: "2026-09-03T09:00:00Z",
  ...over,
});

let seq = 0;
const signIn = (user: string, result: string, at: string, policyId = POLICY, extra: Partial<GraphSignInForImpact> = {}): GraphSignInForImpact => ({
  id: `si-${++seq}`,
  createdDateTime: at,
  userId: `uid-${user}`,
  userPrincipalName: `${user}@contoso.com`,
  userDisplayName: user,
  appDisplayName: "Office 365 Exchange Online",
  ipAddress: "203.0.113.7",
  clientAppUsed: "Browser",
  appliedConditionalAccessPolicies: [
    { id: OTHER, displayName: "Other", result: "reportOnlyFailure", enforcedGrantControls: ["block"] },
    { id: policyId, displayName: "Baseline", result, enforcedGrantControls: result === "reportOnlyInterrupted" ? ["mfa"] : [] },
  ],
  ...extra,
});

describe("computeImpactWindow", () => {
  it("reads from the policy's last modification when it is inside log retention", () => {
    const w = computeImpactWindow(policy(), NOW);
    expect(w).toMatchObject({ from: "2026-09-03T09:00:00.000Z", reportOnlySince: "2026-09-03T09:00:00.000Z", reportOnlyDays: 14, clampedToRetention: false });
  });

  it("clamps to the retention start for an older policy and says so", () => {
    const w = computeImpactWindow(policy({ modifiedDateTime: "2026-06-01T00:00:00Z" }), NOW);
    expect(w.clampedToRetention).toBe(true);
    expect(new Date(w.from).getTime()).toBe(NOW.getTime() - SIGN_IN_RETENTION_DAYS * 86_400_000);
    expect(w.reportOnlyDays).toBe(108);
  });

  it("falls back to createdDateTime, then to retention when the policy carries no timestamp", () => {
    expect(computeImpactWindow(policy({ modifiedDateTime: null }), NOW).reportOnlySince).toBe("2026-09-01T09:00:00.000Z");
    const none = computeImpactWindow(policy({ modifiedDateTime: null, createdDateTime: null }), NOW);
    expect(none).toMatchObject({ reportOnlySince: null, reportOnlyDays: null, clampedToRetention: true });
  });
});

describe("summarizeReportOnlyImpact", () => {
  const rows = [
    signIn("alice", "reportOnlyFailure", "2026-09-10T08:00:00Z"),
    signIn("alice", "reportOnlyInterrupted", "2026-09-12T08:00:00Z"),
    signIn("bob", "reportOnlyInterrupted", "2026-09-11T08:00:00Z"),
    signIn("carol", "reportOnlySuccess", "2026-09-11T09:00:00Z"),
    signIn("dave", "reportOnlyNotApplied", "2026-09-11T10:00:00Z"),
    signIn("erin", "reportOnlyFailure", "2026-09-13T10:00:00Z", OTHER),
    { id: "no-ca", createdDateTime: "2026-09-14T10:00:00Z", userPrincipalName: "frank@contoso.com", appliedConditionalAccessPolicies: [] },
  ];

  it("counts only this policy's results, and only the report-only ones", () => {
    const s = summarizeReportOnlyImpact(rows, POLICY.toUpperCase());
    expect(s).toMatchObject({ signInsScanned: 7, evaluated: 5, wouldBlock: 1, wouldInterrupt: 2, wouldSatisfy: 1, notApplied: 1, affectedUserCount: 2 });
  });

  it("names the affected users, most impacted first, with their latest impact", () => {
    const s = summarizeReportOnlyImpact(rows, POLICY);
    expect(s.affectedUsers.map((u) => [u.userPrincipalName, u.wouldBlock, u.wouldInterrupt, u.lastImpactAt])).toEqual([
      ["alice@contoso.com", 1, 1, "2026-09-12T08:00:00Z"],
      ["bob@contoso.com", 0, 1, "2026-09-11T08:00:00Z"],
    ]);
  });

  it("lists the impacting sign-ins newest first with the grant controls they would have needed", () => {
    const s = summarizeReportOnlyImpact(rows, POLICY);
    expect(s.impactEvents.map((e) => [e.userPrincipalName, e.outcome, e.enforcedGrantControls])).toEqual([
      ["alice@contoso.com", "would_interrupt", ["mfa"]],
      ["bob@contoso.com", "would_interrupt", ["mfa"]],
      ["alice@contoso.com", "would_block", []],
    ]);
  });

  it("caps the event list", () => {
    const many = Array.from({ length: MAX_IMPACT_EVENTS + 10 }, (_, i) =>
      signIn(`u${i}`, "reportOnlyFailure", `2026-09-10T${String(i % 24).padStart(2, "0")}:00:00Z`));
    const s = summarizeReportOnlyImpact(many, POLICY);
    expect(s.wouldBlock).toBe(MAX_IMPACT_EVENTS + 10);
    expect(s.impactEvents).toHaveLength(MAX_IMPACT_EVENTS);
    expect(s.affectedUserCount).toBe(MAX_IMPACT_EVENTS + 10);
  });
});

describe("impactFingerprint", () => {
  const base = [signIn("alice", "reportOnlyFailure", "2026-09-10T08:00:00Z"), signIn("carol", "reportOnlySuccess", "2026-09-11T09:00:00Z")];
  const fp = (rows: GraphSignInForImpact[], complete = true, p = policy()) =>
    impactFingerprint({ policy: p, summary: summarizeReportOnlyImpact(rows, POLICY), complete });

  it("is stable when only harmless sign-ins are added", () => {
    expect(fp([...base, signIn("dave", "reportOnlySuccess", "2026-09-15T09:00:00Z")])).toBe(fp(base));
    expect(fp([...base, signIn("dave", "reportOnlyNotApplied", "2026-09-15T09:00:00Z")])).toBe(fp(base));
  });

  it("changes on a new blocked or interrupted sign-in, a policy edit, or a change in read completeness", () => {
    expect(fp([...base, signIn("alice", "reportOnlyInterrupted", "2026-09-15T09:00:00Z")])).not.toBe(fp(base));
    expect(fp(base, true, policy({ modifiedDateTime: "2026-09-16T09:00:00Z" }))).not.toBe(fp(base));
    expect(fp(base, false)).not.toBe(fp(base));
  });
});

describe("promotionReadiness", () => {
  const ready = (rows: GraphSignInForImpact[], over: Partial<GraphConditionalAccessPolicy> = {}, complete = true) => {
    const p = policy(over);
    return promotionReadiness({ policy: p, summary: summarizeReportOnlyImpact(rows, POLICY), complete, window: computeImpactWindow(p, NOW) });
  };

  it("is ineligible unless the policy is report-only", () => {
    expect(ready([], { state: "enabled" })).toMatchObject({ eligible: false, requiresAcknowledgement: false });
    expect(ready([], { state: "disabled" }).ineligibleReason).toContain("'disabled'");
  });

  it("needs no acknowledgement when sign-ins were evaluated and none would have been blocked or interrupted", () => {
    expect(ready([signIn("carol", "reportOnlySuccess", "2026-09-11T09:00:00Z")])).toEqual({
      eligible: true, ineligibleReason: null, requiresAcknowledgement: false, acknowledgementReasons: [],
    });
  });

  it("requires acknowledgement for real impact, no evidence, an incomplete read, or a period older than retention", () => {
    const impacted = ready([signIn("alice", "reportOnlyFailure", "2026-09-10T08:00:00Z")]);
    expect(impacted.requiresAcknowledgement).toBe(true);
    expect(impacted.acknowledgementReasons).toEqual(["1 sign-in would have been blocked.", "1 user would be affected."]);
    expect(ready([]).acknowledgementReasons[0]).toContain("No sign-in in the report-only period was evaluated");
    expect(ready([signIn("carol", "reportOnlySuccess", "2026-09-11T09:00:00Z")], {}, false).acknowledgementReasons[0]).toContain("lower bound");
    expect(ready([signIn("carol", "reportOnlySuccess", "2026-09-11T09:00:00Z")], { modifiedDateTime: "2026-06-01T00:00:00Z" })
      .acknowledgementReasons[0]).toContain("no longer retained");
  });
});
