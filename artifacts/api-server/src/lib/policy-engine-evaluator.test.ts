import { describe, it, expect } from "vitest";
import { decideEvaluationOutcome } from "./policy-engine-evaluator";

describe("decideEvaluationOutcome", () => {
  it("returns not_evaluable when the policy's OU has no tenant attached", () => {
    const decision = decideEvaluationOutcome({
      tenantId: null,
      policyEngineOptIn: true,
      targetKind: "group_membership",
    });
    expect(decision.outcome).toBe("not_evaluable");
    expect(decision.detail.reason).toMatch(/no tenant attached/);
  });

  it("returns skipped_not_opted_in when the resolved tenant has not opted in", () => {
    const decision = decideEvaluationOutcome({
      tenantId: 42,
      policyEngineOptIn: false,
      targetKind: "mailbox_attribute",
    });
    expect(decision.outcome).toBe("skipped_not_opted_in");
  });

  it("never evaluates ahead of opt-in, even when a tenant is resolved", () => {
    const decision = decideEvaluationOutcome({
      tenantId: 7,
      policyEngineOptIn: false,
      targetKind: "service_policy",
    });
    expect(decision.outcome).not.toBe("compliant");
    expect(decision.outcome).not.toBe("divergent");
  });

  it("returns not_evaluable — never a fabricated compliant/divergent verdict — for an opted-in tenant with a resolved OU", () => {
    for (const targetKind of ["mailbox_attribute", "group_membership", "service_policy"] as const) {
      const decision = decideEvaluationOutcome({
        tenantId: 5,
        policyEngineOptIn: true,
        targetKind,
      });
      expect(decision.outcome).toBe("not_evaluable");
      expect(decision.detail.targetKind).toBe(targetKind);
    }
  });
});
