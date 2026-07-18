import {
  db,
  savedSqlScripts,
  mspCustomersTable,
  testSuitesTable,
  testSuiteRunsTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { SIMULATOR_MANIFEST, simulatorStorage } from "./simulator-events";
import { runEngineManifestForTenant } from "./engine-registry";

const log = logger.child({ channel: "test-suite" });
// Exception-trigger steps log through the same channel as the existing
// POST /admin/exceptions/_test/trigger route so synthetic exceptions land in
// the same place in Exception Tracking.
const exceptionLog = logger.child({ channel: "admin.exceptions" });

export type TestSuiteStep =
  | { type: "sql"; scriptId: number }
  | { type: "scenario"; eventId: string }
  | { type: "exception_trigger"; marker?: string }
  | { type: "orchestrated_pipeline"; testbedCustomerId?: number; engineKeys?: string[] };

export interface TestSuiteStepResult {
  stepIndex: number;
  type: TestSuiteStep["type"];
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
  durationMs: number;
}

// Same guard as the SQL console's POST /simulator/sql/execute (admin-engines.ts)
// — suite sql steps must not widen what an admin can execute through raw SQL.
// Reset scripts use DELETE FROM, which passes.
const DESTRUCTIVE_KEYWORDS = /\b(drop|truncate|alter|rename)\b/i;

export class TestSuiteRunError extends Error {
  constructor(
    public code: "suite_not_found" | "no_steps",
    message: string,
  ) {
    super(message);
    this.name = "TestSuiteRunError";
  }
}

async function requireTestbedCustomer(customerId: number): Promise<{ id: number; mspId: number }> {
  const [customer] = await db
    .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
    .from(mspCustomersTable)
    .where(and(eq(mspCustomersTable.id, customerId), eq(mspCustomersTable.isTestbed, true)))
    .limit(1);
  if (!customer) {
    throw new Error(`Testbed customer ${customerId} not found or is not flagged is_testbed`);
  }
  return customer;
}

/**
 * Reset-script convention: any "sql" step whose saved script is flagged
 * isResetScript runs before everything else, regardless of stored order
 * (relative order among reset steps is preserved). stepIndex in results always
 * refers to the step's position in the suite as stored.
 */
async function orderSteps(
  steps: TestSuiteStep[],
): Promise<Array<{ step: TestSuiteStep; stepIndex: number }>> {
  const indexed = steps.map((step, stepIndex) => ({ step, stepIndex }));
  const scriptIds = steps.flatMap(s => (s.type === "sql" ? [s.scriptId] : []));
  if (scriptIds.length === 0) return indexed;

  const flags = await db
    .select({ id: savedSqlScripts.id, isResetScript: savedSqlScripts.isResetScript })
    .from(savedSqlScripts)
    .where(inArray(savedSqlScripts.id, scriptIds));
  const resetIds = new Set(flags.filter(f => f.isResetScript).map(f => f.id));

  const isReset = (s: TestSuiteStep) => s.type === "sql" && resetIds.has(s.scriptId);
  return [
    ...indexed.filter(e => isReset(e.step)),
    ...indexed.filter(e => !isReset(e.step)),
  ];
}

/**
 * Executes one step by dispatching to the same internals its standalone
 * endpoint uses (SQL console execute, simulator fire-event, exception test
 * trigger, engine manifest runner). Throwing marks the step failed; returning
 * an `error` marks it failed while preserving partial output.
 */
async function executeStep(
  step: TestSuiteStep,
  runLevelCustomerId: number | undefined,
): Promise<{ output?: unknown; error?: string }> {
  switch (step.type) {
    case "sql": {
      const [script] = await db
        .select()
        .from(savedSqlScripts)
        .where(eq(savedSqlScripts.id, step.scriptId))
        .limit(1);
      if (!script) throw new Error(`Saved SQL script ${step.scriptId} not found`);
      if (DESTRUCTIVE_KEYWORDS.test(script.query)) {
        return { error: "Destructive SQL commands (DROP, TRUNCATE, ALTER, RENAME) are prohibited." };
      }
      const startTime = Date.now();
      const result = await db.execute(sql.raw(script.query));
      const executionMs = Date.now() - startTime;
      return {
        output: {
          scriptId: script.id,
          scriptName: script.name,
          rowCount: result.rowCount ?? (result.rows ? result.rows.length : 0),
          executionMs,
        },
      };
    }

    case "scenario": {
      if (runLevelCustomerId == null) {
        throw new Error("Scenario steps require a testbedCustomerId on the run");
      }
      const customer = await requireTestbedCustomer(runLevelCustomerId);
      const eventDef = SIMULATOR_MANIFEST.find(e => e.id === step.eventId);
      if (!eventDef) {
        throw new Error(`Event '${step.eventId}' not found in simulator manifest`);
      }
      const context = { isTestbed: true, testbedMspId: customer.mspId, testbedCustomerId: customer.id };
      const result = await simulatorStorage.run(context, async () => {
        return await eventDef.execute(customer.id, {});
      });
      if (!result.success) {
        return { output: result, error: result.message || `Scenario '${step.eventId}' reported failure` };
      }
      return { output: result };
    }

    case "exception_trigger": {
      const marker = step.marker || "test-suite";
      const testErr = new Error(`[TEST] Synthetic exception trigger (marker=${marker})`);
      exceptionLog.error({ err: testErr }, "Synthetic test exception triggered via test suite");
      return { output: { marker } };
    }

    case "orchestrated_pipeline": {
      const customerId = step.testbedCustomerId ?? runLevelCustomerId;
      if (customerId == null) {
        throw new Error("Orchestrated pipeline steps require a testbedCustomerId on the step or the run");
      }
      const customer = await requireTestbedCustomer(customerId);
      const startTime = Date.now();
      const results = await runEngineManifestForTenant(
        customer.id,
        { evaluationTimestamp: new Date() },
        step.engineKeys?.length ? step.engineKeys : undefined,
      );
      const executionMs = Date.now() - startTime;
      const engines: Record<string, { ok: boolean }> = {};
      for (const [key, value] of Object.entries(results)) {
        engines[key] = { ok: value !== null };
      }
      const failedKeys = Object.keys(engines).filter(k => !engines[k]!.ok);
      const output = { engines, executionMs };
      // runEngineManifestForTenant silently filters unknown keys out of the
      // manifest order — surface them instead of reporting an empty success.
      const unknownKeys = (step.engineKeys ?? []).filter(k => !(k in results));
      if (unknownKeys.length > 0) {
        return { output, error: `Unknown engine keys: ${unknownKeys.join(", ")}` };
      }
      if (failedKeys.length > 0) {
        return { output, error: `Engines failed: ${failedKeys.join(", ")}` };
      }
      return { output };
    }

    default:
      // steps come from opaque jsonb — a row edited outside the API can carry
      // a type the union doesn't know; fail the step, not the whole run.
      return { error: `Unknown step type '${String((step as { type?: unknown }).type)}'` };
  }
}

async function executeSuiteRun(
  runId: number,
  suiteId: number,
  suiteName: string,
  steps: TestSuiteStep[],
  testbedCustomerId: number | undefined,
): Promise<void> {
  const ordered = await orderSteps(steps);
  const reordered = ordered.some((e, i) => e.stepIndex !== i);
  log.info(
    { runId, suiteId, stepCount: steps.length, testbedCustomerId: testbedCustomerId ?? null },
    `test-suite: run #${runId} of suite "${suiteName}" started (${steps.length} steps)`,
  );
  if (reordered) {
    log.info(
      { runId, suiteId, order: ordered.map(e => e.stepIndex) },
      "test-suite: reset scripts hoisted to the front of the run",
    );
  }

  const results: TestSuiteStepResult[] = [];
  for (const { step, stepIndex } of ordered) {
    log.info(
      { runId, suiteId, stepIndex, stepType: step.type },
      `test-suite: step ${stepIndex + 1}/${steps.length} (${step.type}) started`,
    );
    const startedAt = Date.now();
    let outcome: { output?: unknown; error?: string };
    try {
      outcome = await executeStep(step, testbedCustomerId);
    } catch (err) {
      outcome = { error: err instanceof Error ? err.message : String(err) };
    }
    const durationMs = Date.now() - startedAt;
    const status = outcome.error ? "failed" : "succeeded";
    results.push({ stepIndex, type: step.type, status, output: outcome.output, error: outcome.error, durationMs });

    if (status === "failed") {
      // Deliberately no `err` field: a failing test step is a test outcome, not
      // a platform exception (the logger hook would auto-capture Error values).
      log.warn(
        { runId, suiteId, stepIndex, stepType: step.type, error: outcome.error, durationMs },
        `test-suite: step ${stepIndex + 1}/${steps.length} (${step.type}) failed — continuing with remaining steps: ${outcome.error}`,
      );
    } else {
      log.info(
        { runId, suiteId, stepIndex, stepType: step.type, output: outcome.output, durationMs },
        `test-suite: step ${stepIndex + 1}/${steps.length} (${step.type}) succeeded in ${durationMs}ms`,
      );
    }

    try {
      await db
        .update(testSuiteRunsTable)
        .set({ stepResults: results })
        .where(eq(testSuiteRunsTable.id, runId));
    } catch (err) {
      log.warn({ err, runId, suiteId, stepIndex }, "test-suite: failed to persist interim step results (non-fatal)");
    }
  }

  const failedCount = results.filter(r => r.status === "failed").length;
  const finalStatus = failedCount > 0 ? "failed" : "completed";
  await db
    .update(testSuiteRunsTable)
    .set({ status: finalStatus, stepResults: results, completedAt: new Date() })
    .where(eq(testSuiteRunsTable.id, runId));
  log[failedCount > 0 ? "warn" : "info"](
    { runId, suiteId, failedCount, stepCount: steps.length },
    `test-suite: run #${runId} ${finalStatus} — ${results.length - failedCount}/${steps.length} steps succeeded`,
  );
}

/**
 * Marks runs left in "running" by a previous process (crash or restart
 * mid-run) as failed. Called once at server boot — a run can only
 * legitimately be "running" while its in-process executor promise is alive.
 */
export async function failOrphanedTestSuiteRuns(): Promise<void> {
  try {
    const orphaned = await db
      .update(testSuiteRunsTable)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(testSuiteRunsTable.status, "running"))
      .returning({ id: testSuiteRunsTable.id });
    if (orphaned.length > 0) {
      log.warn(
        { runIds: orphaned.map(r => r.id) },
        `test-suite: marked ${orphaned.length} orphaned running run(s) as failed after restart`,
      );
    }
  } catch (err) {
    log.warn({ err }, "test-suite: orphaned-run sweep failed (non-fatal)");
  }
}

/**
 * Loads the suite, records a "running" test_suite_runs row, then walks the
 * steps sequentially in the background (each step dispatches to its existing
 * execution path; failures are recorded and the run continues). Resolves with
 * the new run's id as soon as the run row exists.
 */
export async function runTestSuite(suiteId: number, testbedCustomerId?: number): Promise<number> {
  const [suite] = await db
    .select()
    .from(testSuitesTable)
    .where(eq(testSuitesTable.id, suiteId))
    .limit(1);
  if (!suite) throw new TestSuiteRunError("suite_not_found", `Test suite ${suiteId} not found`);

  const steps = (Array.isArray(suite.steps) ? suite.steps : []) as TestSuiteStep[];
  if (steps.length === 0) {
    throw new TestSuiteRunError("no_steps", `Test suite ${suiteId} has no steps`);
  }

  const [run] = await db
    .insert(testSuiteRunsTable)
    .values({ suiteId, status: "running", stepResults: [], testbedCustomerId: testbedCustomerId ?? null })
    .returning({ id: testSuiteRunsTable.id });
  const runId = run!.id;

  void executeSuiteRun(runId, suiteId, suite.name, steps, testbedCustomerId).catch(async err => {
    log.error({ err, runId, suiteId }, "test-suite: run crashed unexpectedly");
    try {
      await db
        .update(testSuiteRunsTable)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(testSuiteRunsTable.id, runId));
    } catch {
      // run row left "running"; the crash is already logged above
    }
  });

  return runId;
}
