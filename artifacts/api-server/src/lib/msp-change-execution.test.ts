/**
 * msp-change-execution.test.ts — the pure derivations behind the Change Control
 * EXECUTION record (Git #1499). No database: every function under test is a
 * total function over stored values, the same discipline the sibling
 * portal-change-* pure modules follow.
 */

import { describe, it, expect } from "vitest";
import {
  actualStepsFromRunNodes,
  canRaiseRollback,
  deriveExecutionOutcomeFromRunStatus,
  diffPlannedVsActual,
  isExecutionConfirmed,
  planStepsFromDryRun,
  type ActualStep,
  type PlanStep,
} from "./msp-change-execution.ts";

describe("deriveExecutionOutcomeFromRunStatus", () => {
  it("maps a completed run to succeeded", () => {
    expect(deriveExecutionOutcomeFromRunStatus("completed")).toBe("succeeded");
  });
  it("maps failed and cancelled runs to failed", () => {
    expect(deriveExecutionOutcomeFromRunStatus("failed")).toBe("failed");
    expect(deriveExecutionOutcomeFromRunStatus("cancelled")).toBe("failed");
  });
  it("leaves an in-flight run pending", () => {
    expect(deriveExecutionOutcomeFromRunStatus("running")).toBe("pending");
    expect(deriveExecutionOutcomeFromRunStatus("pending")).toBe("pending");
    expect(deriveExecutionOutcomeFromRunStatus("awaiting_approval")).toBe("pending");
  });
});

describe("isExecutionConfirmed", () => {
  it("confirms a runbook run only once it succeeded", () => {
    expect(isExecutionConfirmed({ executorKind: "runbook_run", outcome: "succeeded", attestedAt: null })).toBe(true);
    expect(isExecutionConfirmed({ executorKind: "runbook_run", outcome: "pending", attestedAt: null })).toBe(false);
    expect(isExecutionConfirmed({ executorKind: "runbook_run", outcome: "failed", attestedAt: null })).toBe(false);
  });
  it("confirms a human action ONLY by attestation, never by outcome alone", () => {
    // No code path observes a human action — outcome is irrelevant without an attestation.
    expect(isExecutionConfirmed({ executorKind: "human_action", outcome: "succeeded", attestedAt: null })).toBe(false);
    expect(isExecutionConfirmed({ executorKind: "human_action", outcome: "pending", attestedAt: new Date() })).toBe(true);
  });
});

describe("canRaiseRollback", () => {
  it("allows a rollback of a completed forward change with a snippet", () => {
    expect(
      canRaiseRollback({ status: "completed", rollbackScriptSnippet: "Undo-Thing", rollbackOfChangeRequestId: null }),
    ).toBe(true);
  });
  it("refuses a change that never landed", () => {
    expect(
      canRaiseRollback({ status: "scheduled", rollbackScriptSnippet: "Undo-Thing", rollbackOfChangeRequestId: null }),
    ).toBe(false);
  });
  it("refuses a change with no defined inverse", () => {
    expect(
      canRaiseRollback({ status: "completed", rollbackScriptSnippet: "   ", rollbackOfChangeRequestId: null }),
    ).toBe(false);
  });
  it("refuses to roll back a change that is itself a rollback", () => {
    expect(
      canRaiseRollback({ status: "completed", rollbackScriptSnippet: "Redo-Thing", rollbackOfChangeRequestId: 7 }),
    ).toBe(false);
  });
});

describe("planStepsFromDryRun", () => {
  it("keys template steps on the workflow node id", () => {
    const plan = {
      packKey: "p",
      actions: [
        { templateId: "ca.block.legacy", checkKey: null, label: "Block legacy auth", method: "PATCH", endpoint: "/x", plannedWrite: { state: "enabled" }, changeKind: "update" },
        { templateId: null, checkKey: "mfa-coverage", label: "MFA coverage", method: null, endpoint: null, plannedWrite: null, changeKind: "check" },
      ],
    };
    const steps = planStepsFromDryRun(plan);
    expect(steps.map((s) => s.key)).toEqual(["tpl-ca-block-legacy", "tpl-mfa-coverage"]);
    expect(steps[0].plannedWrite).toEqual({ state: "enabled" });
  });
  it("yields nothing for a plan that was never captured", () => {
    expect(planStepsFromDryRun(null)).toEqual([]);
    expect(planStepsFromDryRun({})).toEqual([]);
    expect(planStepsFromDryRun({ actions: "nope" })).toEqual([]);
  });
});

describe("actualStepsFromRunNodes", () => {
  it("drops synthetic start and map nodes", () => {
    const rows = [
      { nodeId: "start", status: "ok", output: {}, errorMessage: null },
      { nodeId: "tpl-ca-block-legacy", status: "ok", output: { id: "1" }, errorMessage: null },
      { nodeId: "map-ca-block-legacy-outputs", status: "ok", output: {}, errorMessage: null },
    ];
    const steps = actualStepsFromRunNodes(rows);
    expect(steps.map((s) => s.key)).toEqual(["tpl-ca-block-legacy"]);
  });
});

describe("diffPlannedVsActual", () => {
  const planned: PlanStep[] = [
    { key: "tpl-a", label: "A", method: "PATCH", endpoint: "/a", plannedWrite: { x: 1 }, changeKind: "update" },
    { key: "tpl-b", label: "B", method: "POST", endpoint: "/b", plannedWrite: { y: 2 }, changeKind: "create" },
  ];

  it("matches when every planned step ran clean", () => {
    const actual: ActualStep[] = [
      { key: "tpl-a", label: "A", status: "ok", output: {}, errorMessage: null },
      { key: "tpl-b", label: "B", status: "ok", output: {}, errorMessage: null },
    ];
    const diff = diffPlannedVsActual(planned, actual);
    expect(diff.matched).toBe(true);
    expect(diff.steps.every((s) => !s.changed)).toBe(true);
  });

  it("flags a planned step that never executed", () => {
    const actual: ActualStep[] = [{ key: "tpl-a", label: "A", status: "ok", output: {}, errorMessage: null }];
    const diff = diffPlannedVsActual(planned, actual);
    expect(diff.matched).toBe(false);
    const b = diff.steps.find((s) => s.key === "tpl-b");
    expect(b?.presence).toBe("planned_only");
    expect(b?.changed).toBe(true);
  });

  it("flags a planned step that errored", () => {
    const actual: ActualStep[] = [
      { key: "tpl-a", label: "A", status: "ok", output: {}, errorMessage: null },
      { key: "tpl-b", label: "B", status: "error", output: null, errorMessage: "403 forbidden" },
    ];
    const diff = diffPlannedVsActual(planned, actual);
    expect(diff.matched).toBe(false);
    const b = diff.steps.find((s) => s.key === "tpl-b");
    expect(b?.changed).toBe(true);
    expect(b?.note).toBe("403 forbidden");
  });

  it("flags an unplanned step that ran", () => {
    const actual: ActualStep[] = [
      { key: "tpl-a", label: "A", status: "ok", output: {}, errorMessage: null },
      { key: "tpl-b", label: "B", status: "ok", output: {}, errorMessage: null },
      { key: "tpl-rogue", label: "rogue", status: "ok", output: {}, errorMessage: null },
    ];
    const diff = diffPlannedVsActual(planned, actual);
    expect(diff.matched).toBe(false);
    const rogue = diff.steps.find((s) => s.key === "tpl-rogue");
    expect(rogue?.presence).toBe("actual_only");
    expect(rogue?.changed).toBe(true);
  });

  it("treats a skipped step as non-deviating", () => {
    const actual: ActualStep[] = [
      { key: "tpl-a", label: "A", status: "ok", output: {}, errorMessage: null },
      { key: "tpl-b", label: "B", status: "skipped", output: null, errorMessage: null },
    ];
    const diff = diffPlannedVsActual(planned, actual);
    expect(diff.matched).toBe(true);
  });
});
