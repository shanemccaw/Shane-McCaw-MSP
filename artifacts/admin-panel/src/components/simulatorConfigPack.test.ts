import { describe, expect, it } from "vitest";
import {
  deriveStepStatuses,
  isRunSettled,
  packProgress,
  resolveStepWriteAction,
  runPhase,
  templateNodeId,
  type WfRunSnapshot,
} from "./simulatorConfigPack";
import type { WriteActionNode } from "./SimulatorLeftTree";

const run = (over: Partial<WfRunSnapshot>): WfRunSnapshot => ({
  status: "running",
  activeNodeId: null,
  nodeResultMap: {},
  ...over,
});

// The real dependency order the server returns (topologically sorted) — the
// dependent 'assign-admin' MUST run after 'user-create'.
const ORDER = ["user-create", "assign-admin", "ca-baseline"];

describe("deriveStepStatuses — maps run state onto the server's dependency order", () => {
  it("renders statuses onto templateOrder verbatim, never reordering", () => {
    const snapshot = run({
      status: "running",
      activeNodeId: templateNodeId("assign-admin"),
      nodeResultMap: {
        [templateNodeId("user-create")]: { status: "ok", errorMessage: null },
      },
    });
    const states = deriveStepStatuses(ORDER, snapshot);
    // Order is preserved exactly.
    expect(states.map((s) => s.templateId)).toEqual(ORDER);
    // Step 1 done, step 2 running, step 3 still pending — i.e. the dependency
    // ran before its dependent, as the executor guarantees.
    expect(states.map((s) => s.status)).toEqual(["success", "running", "pending"]);
  });

  it("surfaces a failed step with its error message and leaves later steps not_run on a terminal run", () => {
    const snapshot = run({
      status: "failed",
      activeNodeId: null,
      nodeResultMap: {
        [templateNodeId("user-create")]: { status: "ok", errorMessage: null },
        [templateNodeId("assign-admin")]: { status: "error", errorMessage: "403 Forbidden" },
      },
    });
    const states = deriveStepStatuses(ORDER, snapshot);
    expect(states.map((s) => s.status)).toEqual(["success", "failed", "not_run"]);
    expect(states[1]!.errorMessage).toBe("403 Forbidden");
    // The step AFTER the failed dependency was never executed — not falsely "ok".
    expect(states[2]!.status).toBe("not_run");
  });

  it("treats a skipped node as skipped, not failed", () => {
    const snapshot = run({
      status: "completed",
      nodeResultMap: {
        [templateNodeId("user-create")]: { status: "ok", errorMessage: null },
        [templateNodeId("assign-admin")]: { status: "skipped", errorMessage: null },
        [templateNodeId("ca-baseline")]: { status: "ok", errorMessage: null },
      },
    });
    const states = deriveStepStatuses(ORDER, snapshot);
    expect(states.map((s) => s.status)).toEqual(["success", "skipped", "success"]);
  });

  it("is all-pending before a run exists", () => {
    const states = deriveStepStatuses(ORDER, null);
    expect(states.every((s) => s.status === "pending")).toBe(true);
  });
});

describe("packProgress", () => {
  it("counts reached steps and the active index", () => {
    const states = deriveStepStatuses(
      ORDER,
      run({
        status: "running",
        activeNodeId: templateNodeId("assign-admin"),
        nodeResultMap: { [templateNodeId("user-create")]: { status: "ok", errorMessage: null } },
      }),
    );
    const p = packProgress(states);
    expect(p).toMatchObject({ total: 3, succeeded: 1, running: 1, reached: 1, activeIndex: 1, anyFailed: false });
    expect(p.pct).toBe(Math.round((1 / 3) * 100));
  });

  it("flags anyFailed and reaches 100% when every step is terminal", () => {
    const states = deriveStepStatuses(
      ORDER,
      run({
        status: "failed",
        nodeResultMap: {
          [templateNodeId("user-create")]: { status: "ok", errorMessage: null },
          [templateNodeId("assign-admin")]: { status: "error", errorMessage: "boom" },
          [templateNodeId("ca-baseline")]: { status: "skipped", errorMessage: null },
        },
      }),
    );
    const p = packProgress(states);
    expect(p.anyFailed).toBe(true);
    expect(p.reached).toBe(3);
    expect(p.pct).toBe(100);
  });
});

describe("runPhase / isRunSettled", () => {
  it("maps raw statuses to phases", () => {
    expect(runPhase(null)).toBe("queued");
    expect(runPhase(run({ status: "running" }))).toBe("running");
    expect(runPhase(run({ status: "paused" }))).toBe("paused");
    expect(runPhase(run({ status: "completed" }))).toBe("succeeded");
    expect(runPhase(run({ status: "failed" }))).toBe("failed");
    expect(runPhase(run({ status: "cancelled" }))).toBe("cancelled");
  });

  it("settles on terminal AND paused (a gated pack halts at the gate)", () => {
    expect(isRunSettled(run({ status: "running" }))).toBe(false);
    expect(isRunSettled(run({ status: "paused" }))).toBe(true);
    expect(isRunSettled(run({ status: "completed" }))).toBe(true);
    expect(isRunSettled(null)).toBe(false);
  });
});

describe("resolveStepWriteAction — single-step reuses the real write action", () => {
  const wa = (templateId: string): WriteActionNode => ({
    templateId,
    label: templateId,
    description: null,
    category: "Users",
    endpoint: `/x/${templateId}`,
    method: "POST",
    requiredVariables: [],
    dependsOn: [],
    requiresVerificationGate: false,
    reversible: false,
    reverseTemplateId: null,
    reverseTemplateLabel: null,
    status: "active",
    catalogLinked: false,
    catalog: null,
  });

  it("resolves a pack step back to its actual write-action template (the reuse handoff)", () => {
    const actions = [wa("user-create"), wa("assign-admin")];
    const resolved = resolveStepWriteAction("assign-admin", actions);
    expect(resolved).toBe(actions[1]);
  });

  it("returns null rather than fabricating an execution when the template is absent", () => {
    expect(resolveStepWriteAction("ghost", [wa("user-create")])).toBeNull();
  });
});
