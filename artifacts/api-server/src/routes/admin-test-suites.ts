import { Router, type IRouter, type Request, type Response } from "express";
import { db, testSuitesTable, testSuiteRunsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAuth";
import { runTestSuite, TestSuiteRunError } from "../lib/test-suite-runner";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "test-suite" });

const router: IRouter = Router();

const stepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sql"), scriptId: z.number().int().positive() }),
  z.object({ type: z.literal("scenario"), eventId: z.string().min(1) }),
  z.object({ type: z.literal("exception_trigger"), marker: z.string().min(1).optional() }),
  z.object({
    type: z.literal("orchestrated_pipeline"),
    testbedCustomerId: z.number().int().positive().optional(),
    engineKeys: z.array(z.string().min(1)).optional(),
  }),
]);

const createSuiteSchema = z.object({
  name: z.string().min(1),
  steps: z.array(stepSchema),
});

const updateSuiteSchema = z.object({
  name: z.string().min(1).optional(),
  steps: z.array(stepSchema).optional(),
});

const runBodySchema = z.object({
  testbedCustomerId: z.number().int().positive().optional(),
});

router.get("/admin/test-suites", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const suites = await db.select().from(testSuitesTable).orderBy(testSuitesTable.name);
    res.json({ suites });
  } catch (err) {
    log.error({ err }, "test-suite: list suites failed");
    res.status(500).json({ error: "Failed to list test suites" });
  }
});

router.post("/admin/test-suites", requireAdmin, async (req: Request, res: Response) => {
  const body = createSuiteSchema.safeParse(req.body);
  if (!body.success) {
    return void res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
  }
  try {
    const [suite] = await db
      .insert(testSuitesTable)
      .values({ name: body.data.name, steps: body.data.steps })
      .returning();
    res.status(201).json({ suite });
  } catch (err) {
    log.error({ err }, "test-suite: create suite failed");
    res.status(500).json({ error: "Failed to create test suite" });
  }
});

// Registered before the :id routes so "runs" is never captured as a suite id.
router.get("/admin/test-suites/runs/:runId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isInteger(runId)) {
      return void res.status(400).json({ error: "A valid run id is required" });
    }
    const [run] = await db
      .select()
      .from(testSuiteRunsTable)
      .where(eq(testSuiteRunsTable.id, runId))
      .limit(1);
    if (!run) return void res.status(404).json({ error: "Test suite run not found" });
    res.json({ run });
  } catch (err) {
    log.error({ err }, "test-suite: get run failed");
    res.status(500).json({ error: "Failed to load test suite run" });
  }
});

router.post("/admin/test-suites/:id/run", requireAdmin, async (req: Request, res: Response) => {
  const suiteId = Number(req.params.id);
  if (!Number.isInteger(suiteId)) {
    return void res.status(400).json({ error: "A valid suite id is required" });
  }
  const body = runBodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    return void res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
  }
  try {
    const runId = await runTestSuite(suiteId, body.data.testbedCustomerId);
    res.status(202).json({ runId });
  } catch (err) {
    if (err instanceof TestSuiteRunError) {
      return void res.status(err.code === "suite_not_found" ? 404 : 400).json({ error: err.message });
    }
    log.error({ err, suiteId }, "test-suite: start run failed");
    res.status(500).json({ error: "Failed to start test suite run" });
  }
});

router.get("/admin/test-suites/:id/runs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const suiteId = Number(req.params.id);
    if (!Number.isInteger(suiteId)) {
      return void res.status(400).json({ error: "A valid suite id is required" });
    }
    const runs = await db
      .select()
      .from(testSuiteRunsTable)
      .where(eq(testSuiteRunsTable.suiteId, suiteId))
      .orderBy(desc(testSuiteRunsTable.startedAt))
      .limit(20);
    res.json({ runs });
  } catch (err) {
    log.error({ err }, "test-suite: list runs failed");
    res.status(500).json({ error: "Failed to list test suite runs" });
  }
});

router.put("/admin/test-suites/:id", requireAdmin, async (req: Request, res: Response) => {
  const suiteId = Number(req.params.id);
  if (!Number.isInteger(suiteId)) {
    return void res.status(400).json({ error: "A valid suite id is required" });
  }
  const body = updateSuiteSchema.safeParse(req.body);
  if (!body.success) {
    return void res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
  }
  if (body.data.name === undefined && body.data.steps === undefined) {
    return void res.status(400).json({ error: "Provide name and/or steps to update" });
  }
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.steps !== undefined) updates.steps = body.data.steps;
    const [suite] = await db
      .update(testSuitesTable)
      .set(updates)
      .where(eq(testSuitesTable.id, suiteId))
      .returning();
    if (!suite) return void res.status(404).json({ error: "Test suite not found" });
    res.json({ suite });
  } catch (err) {
    log.error({ err, suiteId }, "test-suite: update suite failed");
    res.status(500).json({ error: "Failed to update test suite" });
  }
});

router.delete("/admin/test-suites/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const suiteId = Number(req.params.id);
    if (!Number.isInteger(suiteId)) {
      return void res.status(400).json({ error: "A valid suite id is required" });
    }
    const [deleted] = await db
      .delete(testSuitesTable)
      .where(eq(testSuitesTable.id, suiteId))
      .returning();
    if (!deleted) return void res.status(404).json({ error: "Test suite not found" });
    res.json({ deleted: true, suite: deleted });
  } catch (err) {
    log.error({ err }, "test-suite: delete suite failed");
    res.status(500).json({ error: "Failed to delete test suite" });
  }
});

export default router;
