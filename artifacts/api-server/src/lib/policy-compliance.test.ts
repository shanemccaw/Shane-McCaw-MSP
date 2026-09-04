import { describe, it, expect } from "vitest";
import {
  evaluateMailboxAttributeCompliance,
  isMailboxAttributeTargetState,
  evaluateGroupMembershipCompliance,
  isGroupMembershipTargetState,
  isEvaluableTargetKind,
  EVALUABLE_TARGET_KINDS,
  type MailboxComplianceObservation,
  type GroupMembershipComplianceObservation,
} from "./policy-compliance";

function observation(overrides: Partial<MailboxComplianceObservation> = {}): MailboxComplianceObservation {
  return {
    userPrincipalName: "vip@customer.onmicrosoft.com",
    displayName: "VIP Person",
    observedSizeMb: 500,
    ...overrides,
  };
}

function groupObservation(
  overrides: Partial<GroupMembershipComplianceObservation> = {},
): GroupMembershipComplianceObservation {
  return {
    userPrincipalName: "vip@customer.onmicrosoft.com",
    displayName: "VIP Person",
    memberGroupIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
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

describe("isGroupMembershipTargetState", () => {
  it("accepts the real shape", () => {
    expect(isGroupMembershipTargetState({ groupIds: ["11111111-1111-1111-1111-111111111111"] })).toBe(true);
  });

  it("rejects everything else — no invented member", () => {
    expect(isGroupMembershipTargetState({})).toBe(false);
    expect(isGroupMembershipTargetState({ groupIds: [] })).toBe(false);
    expect(isGroupMembershipTargetState({ groupIds: [""] })).toBe(false);
    expect(isGroupMembershipTargetState({ groupIds: [123] })).toBe(false);
    expect(isGroupMembershipTargetState({ groupIds: "11111111-1111-1111-1111-111111111111" })).toBe(false);
    expect(isGroupMembershipTargetState(null)).toBe(false);
    expect(isGroupMembershipTargetState("VIP-DL")).toBe(false);
  });
});

describe("evaluateGroupMembershipCompliance", () => {
  const requiredGroupIds = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];

  it("is compliant when the member belongs to every required group", () => {
    const result = evaluateGroupMembershipCompliance({ groupIds: requiredGroupIds }, groupObservation({ memberGroupIds: requiredGroupIds }));
    expect(result.verdict).toBe("compliant");
    expect(result.observedValue).toBe(2);
    expect(result.targetValue).toBe(2);
    expect(result.reason).toContain("2");
  });

  it("is compliant when the member belongs to the required groups plus extras", () => {
    const result = evaluateGroupMembershipCompliance(
      { groupIds: requiredGroupIds },
      groupObservation({ memberGroupIds: [...requiredGroupIds, "33333333-3333-3333-3333-333333333333"] }),
    );
    expect(result.verdict).toBe("compliant");
    expect(result.observedValue).toBe(3);
    expect(result.targetValue).toBe(2);
  });

  it("is non_compliant when missing one of several required groups, and names it", () => {
    const result = evaluateGroupMembershipCompliance(
      { groupIds: requiredGroupIds },
      groupObservation({ memberGroupIds: ["11111111-1111-1111-1111-111111111111"] }),
    );
    expect(result.verdict).toBe("non_compliant");
    expect(result.observedValue).toBe(1);
    expect(result.targetValue).toBe(2);
    expect(result.reason).toContain("22222222-2222-2222-2222-222222222222");
    expect(result.reason).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("is non_compliant when the member belongs to none of the required groups", () => {
    const result = evaluateGroupMembershipCompliance({ groupIds: requiredGroupIds }, groupObservation({ memberGroupIds: [] }));
    expect(result.verdict).toBe("non_compliant");
    expect(result.observedValue).toBe(0);
    expect(result.targetValue).toBe(2);
  });

  it("is not_evaluable for a malformed target_state — never a fabricated verdict", () => {
    const result = evaluateGroupMembershipCompliance({ attribute: "mailboxSizeMb", operator: "max", value: 150 }, groupObservation());
    expect(result.verdict).toBe("not_evaluable");
    expect(result.observedValue).toBeNull();
    expect(result.targetValue).toBeNull();
  });

  it("is not_evaluable for an empty groupIds declaration", () => {
    const result = evaluateGroupMembershipCompliance({ groupIds: [] }, groupObservation());
    expect(result.verdict).toBe("not_evaluable");
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
