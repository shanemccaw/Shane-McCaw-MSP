import { describe, it, expect } from "vitest";
import { decideEvaluationGate } from "./policy-engine-evaluator";

describe("decideEvaluationGate", () => {
  it("returns not_evaluable when the policy's OU has no tenant attached", () => {
    const decision = decideEvaluationGate({ tenantId: null, policyEngineOptIn: true });
    expect(decision.proceed).toBe(false);
    if (!decision.proceed) {
      expect(decision.outcome).toBe("not_evaluable");
      expect(decision.detail.reason).toMatch(/no tenant attached/);
    }
  });

  it("returns skipped_not_opted_in when the resolved tenant has not opted in", () => {
    const decision = decideEvaluationGate({ tenantId: 42, policyEngineOptIn: false });
    expect(decision.proceed).toBe(false);
    if (!decision.proceed) {
      expect(decision.outcome).toBe("skipped_not_opted_in");
    }
  });

  it("never proceeds ahead of opt-in, even when a tenant is resolved", () => {
    const decision = decideEvaluationGate({ tenantId: 7, policyEngineOptIn: false });
    expect(decision.proceed).toBe(false);
  });

  it("proceeds only once a tenant is resolved AND that tenant has opted in", () => {
    const decision = decideEvaluationGate({ tenantId: 5, policyEngineOptIn: true });
    expect(decision).toEqual({ proceed: true });
  });

  it("checks tenant resolution before opt-in — a tenant-less OU is not_evaluable even if opt-in were somehow true", () => {
    const decision = decideEvaluationGate({ tenantId: null, policyEngineOptIn: true });
    expect(decision.proceed).toBe(false);
    if (!decision.proceed) {
      expect(decision.outcome).toBe("not_evaluable");
    }
  });
});
