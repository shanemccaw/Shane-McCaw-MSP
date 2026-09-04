import { describe, it, expect } from "vitest";
import {
  evaluateMailboxAttributeCompliance,
  isMailboxAttributeTargetState,
  isEvaluableTargetKind,
  EVALUABLE_TARGET_KINDS,
  type MailboxComplianceObservation,
} from "./policy-compliance";

function observation(overrides: Partial<MailboxComplianceObservation> = {}): MailboxComplianceObservation {
  return {
    userPrincipalName: "vip@customer.onmicrosoft.com",
    displayName: "VIP Person",
    observedSizeMb: 500,
    ...overrides,
  };
}

describe("isMailboxAttributeTargetState", () => {
  it("accepts the real shape", () => {
    expect(isMailboxAttributeTargetState({ attribute: "mailboxSizeMb", operator: "max", value: 150 })).toBe(true);
  });

  it("rejects everything else — no invented member", () => {
    expect(isMailboxAttributeTargetState({})).toBe(false);
    expect(isMailboxAttributeTargetState({ attribute: "mailboxSizeMb", operator: "max", value: 0 })).toBe(false);
    expect(isMailboxAttributeTargetState({ attribute: "mailboxSizeMb", operator: "min", value: 150 })).toBe(false);
    expect(isMailboxAttributeTargetState({ attribute: "groups", operator: "max", value: 150 })).toBe(false);
    expect(isMailboxAttributeTargetState(null)).toBe(false);
    expect(isMailboxAttributeTargetState("150MB")).toBe(false);
  });
});

describe("evaluateMailboxAttributeCompliance", () => {
  it("is the issue's own worked example: policy says 150MB, mailbox is 500MB -> non_compliant", () => {
    const result = evaluateMailboxAttributeCompliance(
      { attribute: "mailboxSizeMb", operator: "max", value: 150 },
      observation({ observedSizeMb: 500 }),
    );
    expect(result.verdict).toBe("non_compliant");
    expect(result.observedValue).toBe(500);
    expect(result.targetValue).toBe(150);
    expect(result.reason).toContain("500");
    expect(result.reason).toContain("150");
  });

  it("is compliant when the observed value is within the cap", () => {
    const result = evaluateMailboxAttributeCompliance(
      { attribute: "mailboxSizeMb", operator: "max", value: 150 },
      observation({ observedSizeMb: 100 }),
    );
    expect(result.verdict).toBe("compliant");
  });

  it("is compliant exactly at the cap — max means <=", () => {
    const result = evaluateMailboxAttributeCompliance(
      { attribute: "mailboxSizeMb", operator: "max", value: 150 },
      observation({ observedSizeMb: 150 }),
    );
    expect(result.verdict).toBe("compliant");
  });

  it("is not_evaluable for a malformed target_state — never a fabricated verdict", () => {
    const result = evaluateMailboxAttributeCompliance({ groups: ["VIP-DL"] }, observation());
    expect(result.verdict).toBe("not_evaluable");
    expect(result.targetValue).toBeNull();
  });
});

describe("isEvaluableTargetKind", () => {
  it("mailbox_attribute and group_membership (#1953) are the real evaluators today", () => {
    expect(EVALUABLE_TARGET_KINDS).toEqual(["mailbox_attribute", "group_membership"]);
    expect(isEvaluableTargetKind("mailbox_attribute")).toBe(true);
    expect(isEvaluableTargetKind("group_membership")).toBe(true);
    expect(isEvaluableTargetKind("service_policy")).toBe(false);
  });
});
