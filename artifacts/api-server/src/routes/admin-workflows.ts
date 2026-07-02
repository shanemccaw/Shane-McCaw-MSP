/**
 * admin-workflows.ts
 *
 * Workflow Engine API — admin-only endpoints for definitions, versions,
 * triggers, runs, and run detail.
 *
 * GET    /api/admin/workflows/definitions
 * POST   /api/admin/workflows/definitions
 * GET    /api/admin/workflows/definitions/:id
 * PUT    /api/admin/workflows/definitions/:id
 * DELETE /api/admin/workflows/definitions/:id
 * GET    /api/admin/workflows/definitions/:id/versions
 * POST   /api/admin/workflows/definitions/:id/versions
 * GET    /api/admin/workflows/definitions/:id/versions/:vid
 * PUT    /api/admin/workflows/definitions/:id/versions/:vid
 * POST   /api/admin/workflows/definitions/:id/versions/:vid/publish
 * GET    /api/admin/workflows/definitions/:id/triggers
 * POST   /api/admin/workflows/definitions/:id/triggers
 * DELETE /api/admin/workflows/definitions/:id/triggers/:tid
 * PATCH  /api/admin/workflows/definitions/:id/triggers/:tid
 * POST   /api/admin/workflows/definitions/:id/run   (manual trigger)
 * GET    /api/admin/workflows/runs
 * GET    /api/admin/workflows/runs/:id
 * POST   /api/admin/workflows/runs/:id/cancel
 * GET    /api/admin/workflows/runs/:id/nodes
 * POST   /api/webhooks/workflow/:token              (webhook trigger)
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db, pool } from "@workspace/db";
import {
  wfDefinitionsTable,
  wfVersionsTable,
  wfRunsTable,
  wfRunNodeLogsTable,
  wfRunNodeOutputsTable,
  wfTriggersTable,
  type WfGraph,
} from "@workspace/db";
import { eq, and, desc, asc, count, sql, gte, lte } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { fireWorkflowForDefinition, computeNextCronRun, executeWorkflowRun } from "../lib/workflow-executor";
import crypto from "crypto";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// ── Definitions ───────────────────────────────────────────────────────────────

router.get("/admin/workflows/definitions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const defs = await db
      .select()
      .from(wfDefinitionsTable)
      .orderBy(desc(wfDefinitionsTable.createdAt));

    const enriched = await Promise.all(defs.map(async def => {
      const [published] = await db
        .select({ label: wfVersionsTable.label, versionNumber: wfVersionsTable.versionNumber })
        .from(wfVersionsTable)
        .where(and(eq(wfVersionsTable.definitionId, def.id), eq(wfVersionsTable.status, "published")))
        .orderBy(desc(wfVersionsTable.versionNumber))
        .limit(1);

      const [trigCount] = await db
        .select({ cnt: count() })
        .from(wfTriggersTable)
        .where(eq(wfTriggersTable.definitionId, def.id));

      const [lastRun] = await db
        .select({ status: wfRunsTable.status, createdAt: wfRunsTable.createdAt })
        .from(wfRunsTable)
        .where(eq(wfRunsTable.definitionId, def.id))
        .orderBy(desc(wfRunsTable.createdAt))
        .limit(1);

      return {
        ...def,
        publishedVersionLabel: published?.label ?? null,
        publishedVersionNumber: published?.versionNumber ?? null,
        triggerCount: Number(trigCount?.cnt ?? 0),
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.createdAt ?? null,
      };
    }));

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "workflows: list definitions failed");
    sendError(res, 500, "Failed to list definitions");
  }
});

router.post("/admin/workflows/definitions", requireAdmin, async (req: Request, res: Response) => {
  const body = z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    concurrencyLimit: z.number().int().min(1).max(50).optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const [def] = await db.insert(wfDefinitionsTable).values({
      name: body.data.name,
      description: body.data.description,
      concurrencyLimit: body.data.concurrencyLimit ?? 5,
    }).returning();

    const [version] = await db.insert(wfVersionsTable).values({
      definitionId: def.id,
      versionNumber: 1,
      label: "v1 — Initial draft",
      status: "draft",
      graph: { nodes: [], edges: [] },
    }).returning();

    res.status(201).json({ ...def, draftVersionId: version.id });
  } catch (err) {
    req.log.error({ err }, "workflows: create definition failed");
    sendError(res, 500, "Failed to create definition");
  }
});

router.get("/admin/workflows/definitions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");
  try {
    const [def] = await db.select().from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, id)).limit(1);
    if (!def) return sendError(res, 404, "Not found");
    res.json(def);
  } catch (err) {
    sendError(res, 500, "Failed to fetch definition");
  }
});

router.put("/admin/workflows/definitions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");

  const body = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    concurrencyLimit: z.number().int().min(1).max(50).optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const [updated] = await db
      .update(wfDefinitionsTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(wfDefinitionsTable.id, id))
      .returning();
    if (!updated) return sendError(res, 404, "Not found");
    res.json(updated);
  } catch (err) {
    sendError(res, 500, "Failed to update definition");
  }
});

router.delete("/admin/workflows/definitions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");
  try {
    await db.delete(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, id));
    res.status(204).end();
  } catch (err) {
    sendError(res, 500, "Failed to delete definition");
  }
});

// ── Versions ──────────────────────────────────────────────────────────────────

router.get("/admin/workflows/definitions/:id/versions", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");
  try {
    const versions = await db
      .select()
      .from(wfVersionsTable)
      .where(eq(wfVersionsTable.definitionId, id))
      .orderBy(desc(wfVersionsTable.versionNumber));
    res.json(versions);
  } catch (err) {
    sendError(res, 500, "Failed to list versions");
  }
});

router.post("/admin/workflows/definitions/:id/versions", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  const body = z.object({
    label: z.string().optional(),
    graph: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }).optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const [latest] = await db
      .select({ vn: wfVersionsTable.versionNumber })
      .from(wfVersionsTable)
      .where(eq(wfVersionsTable.definitionId, defId))
      .orderBy(desc(wfVersionsTable.versionNumber))
      .limit(1);

    const nextVn = (latest?.vn ?? 0) + 1;
    const [version] = await db.insert(wfVersionsTable).values({
      definitionId: defId,
      versionNumber: nextVn,
      label: body.data.label ?? `v${nextVn} — Draft`,
      status: "draft",
      graph: (body.data.graph as WfGraph) ?? { nodes: [], edges: [] },
    }).returning();

    res.status(201).json(version);
  } catch (err) {
    sendError(res, 500, "Failed to create version");
  }
});

router.get("/admin/workflows/definitions/:id/versions/:vid", requireAdmin, async (req: Request, res: Response) => {
  const vid = parseInt(req.params.vid as string);
  if (isNaN(vid)) return sendError(res, 400, "Invalid version id");
  try {
    const [version] = await db.select().from(wfVersionsTable).where(eq(wfVersionsTable.id, vid)).limit(1);
    if (!version) return sendError(res, 404, "Not found");
    res.json(version);
  } catch (err) {
    sendError(res, 500, "Failed to fetch version");
  }
});

router.put("/admin/workflows/definitions/:id/versions/:vid", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  const vid = parseInt(req.params.vid as string);
  if (isNaN(vid) || isNaN(defId)) return sendError(res, 400, "Invalid version id");

  const body = z.object({
    graph: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }).optional(),
    label: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const [existing] = await db.select().from(wfVersionsTable).where(eq(wfVersionsTable.id, vid)).limit(1);
    if (!existing) return sendError(res, 404, "Not found");

    // If trying to edit a published version, auto-create a new draft from it
    if (existing.status === "published") {
      const [latest] = await db
        .select({ vn: wfVersionsTable.versionNumber })
        .from(wfVersionsTable)
        .where(eq(wfVersionsTable.definitionId, defId))
        .orderBy(desc(wfVersionsTable.versionNumber))
        .limit(1);

      const nextVn = (latest?.vn ?? existing.versionNumber) + 1;
      const [newDraft] = await db.insert(wfVersionsTable).values({
        definitionId: defId,
        versionNumber: nextVn,
        label: body.data.label ?? `v${nextVn} — Draft (from v${existing.versionNumber})`,
        status: "draft",
        graph: (body.data.graph as WfGraph) ?? (existing.graph as WfGraph),
      }).returning();

      return res.status(201).json({ ...newDraft, autoDraftedFrom: existing.id });
    }

    const [updated] = await db
      .update(wfVersionsTable)
      .set({ graph: (body.data.graph as WfGraph) ?? existing.graph, label: body.data.label ?? existing.label })
      .where(eq(wfVersionsTable.id, vid))
      .returning();
    res.json(updated);
  } catch (err) {
    sendError(res, 500, "Failed to update version");
  }
});

router.post("/admin/workflows/definitions/:id/versions/:vid/publish", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  const vid = parseInt(req.params.vid as string);
  if (isNaN(defId) || isNaN(vid)) return sendError(res, 400, "Invalid id");

  const body = z.object({ label: z.string().optional() }).safeParse(req.body);

  try {
    await db
      .update(wfVersionsTable)
      .set({ status: "archived" })
      .where(and(eq(wfVersionsTable.definitionId, defId), eq(wfVersionsTable.status, "published")));

    const [published] = await db
      .update(wfVersionsTable)
      .set({ status: "published", label: body.success ? (body.data.label ?? undefined) : undefined })
      .where(eq(wfVersionsTable.id, vid))
      .returning();

    if (!published) return sendError(res, 404, "Version not found");
    res.json(published);
  } catch (err) {
    sendError(res, 500, "Failed to publish version");
  }
});

// ── Triggers ──────────────────────────────────────────────────────────────────

router.get("/admin/workflows/definitions/:id/triggers", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");
  try {
    const triggers = await db
      .select()
      .from(wfTriggersTable)
      .where(eq(wfTriggersTable.definitionId, defId))
      .orderBy(asc(wfTriggersTable.createdAt));
    res.json(triggers);
  } catch (err) {
    sendError(res, 500, "Failed to list triggers");
  }
});

router.post("/admin/workflows/definitions/:id/triggers", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  const body = z.object({
    type: z.enum(["manual", "schedule", "webhook", "event"]),
    config: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const token = body.data.type === "webhook" ? crypto.randomBytes(24).toString("hex") : null;
    const nextRunAt = body.data.type === "schedule" && body.data.config?.cron
      ? computeNextCronRun(body.data.config.cron as string)
      : null;

    const [trigger] = await db.insert(wfTriggersTable).values({
      definitionId: defId,
      type: body.data.type,
      config: body.data.config ?? {},
      webhookToken: token,
      nextRunAt,
      enabled: body.data.enabled ?? true,
    }).returning();

    res.status(201).json(trigger);
  } catch (err) {
    sendError(res, 500, "Failed to create trigger");
  }
});

router.patch("/admin/workflows/definitions/:id/triggers/:tid", requireAdmin, async (req: Request, res: Response) => {
  const tid = parseInt(req.params.tid as string);
  if (isNaN(tid)) return sendError(res, 400, "Invalid id");

  const body = z.object({
    config: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const updateSet = {
      ...(body.data.config !== undefined && { config: body.data.config as Record<string, unknown> }),
      ...(body.data.enabled !== undefined && { enabled: body.data.enabled }),
    };
    const [updated] = await db
      .update(wfTriggersTable)
      .set(updateSet)
      .where(eq(wfTriggersTable.id, tid))
      .returning();
    if (!updated) return sendError(res, 404, "Not found");
    res.json(updated);
  } catch (err) {
    sendError(res, 500, "Failed to update trigger");
  }
});

router.delete("/admin/workflows/definitions/:id/triggers/:tid", requireAdmin, async (req: Request, res: Response) => {
  const tid = parseInt(req.params.tid as string);
  if (isNaN(tid)) return sendError(res, 400, "Invalid id");
  try {
    await db.delete(wfTriggersTable).where(eq(wfTriggersTable.id, tid));
    res.status(204).end();
  } catch (err) {
    sendError(res, 500, "Failed to delete trigger");
  }
});

router.post("/admin/workflows/definitions/:id/triggers/:tid/rotate-token", requireAdmin, async (req: Request, res: Response) => {
  const tid = parseInt(req.params.tid as string);
  if (isNaN(tid)) return sendError(res, 400, "Invalid id");
  try {
    const newToken = crypto.randomBytes(32).toString("hex");
    const [updated] = await db
      .update(wfTriggersTable)
      .set({ webhookToken: newToken })
      .where(eq(wfTriggersTable.id, tid))
      .returning();
    if (!updated) return sendError(res, 404, "Not found");
    res.json(updated);
  } catch (err) {
    sendError(res, 500, "Failed to rotate token");
  }
});

// ── Manual trigger ────────────────────────────────────────────────────────────

router.post("/admin/workflows/definitions/:id/run", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  try {
    const versionId = req.body.versionId ? parseInt(req.body.versionId as string, 10) : undefined;
    const runId = await fireWorkflowForDefinition(
      defId, "manual", `admin:manual`,
      req.body.payload ?? {},
      versionId ? { versionId } : {},
    );
    if (!runId) return sendError(res, 422, "No runnable version found or concurrency limit reached");
    res.status(202).json({ runId });
  } catch (err) {
    sendError(res, 500, "Failed to trigger workflow");
  }
});

// ── Draft test run (runs live canvas graph inline, no publish required) ──────
// Uses the latest existing version row only for the FK constraint — it does NOT
// create a new version record. The submitted nodes/edges are passed directly to
// the executor as an inlineGraph override, so version history stays clean.

router.post("/admin/workflows/definitions/:id/test-run", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  const body = z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    triggerPayload: z.record(z.unknown()).optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    // Use the latest existing version (any status) for the FK — do NOT insert a new one
    const [latestVersion] = await db
      .select({ id: wfVersionsTable.id })
      .from(wfVersionsTable)
      .where(eq(wfVersionsTable.definitionId, defId))
      .orderBy(desc(wfVersionsTable.versionNumber))
      .limit(1);

    if (!latestVersion) return sendError(res, 422, "No version found — save the workflow canvas first");

    const [inserted] = await db.insert(wfRunsTable).values({
      versionId: latestVersion.id,
      definitionId: defId,
      triggerType: "manual",
      triggerRef: "draft_test",
      payload: body.data.triggerPayload ?? {},
      status: "pending",
    }).returning({ id: wfRunsTable.id });

    const runId = inserted.id;
    const inlineGraph: WfGraph = {
      nodes: body.data.nodes as WfGraph["nodes"],
      edges: body.data.edges as WfGraph["edges"],
    };

    setImmediate(() => {
      executeWorkflowRun(runId, { inlineGraph, dryRun: true }).catch(err => {
        logger.warn({ err, runId }, "workflows: draft test-run execution failed (non-fatal)");
      });
    });

    req.log.info({ defId, runId, nodeCount: inlineGraph.nodes.length }, "workflows: draft test-run started");
    res.status(202).json({ runId });
  } catch (err) {
    req.log.error({ err }, "workflows: draft test-run failed");
    sendError(res, 500, "Failed to start test run");
  }
});

// ── Runs ──────────────────────────────────────────────────────────────────────

router.get("/admin/workflows/runs", requireAdmin, async (req: Request, res: Response) => {
  const definitionId = req.query.definitionId ? parseInt(req.query.definitionId as string) : null;
  const status = req.query.status as string | undefined;
  const fromDate = req.query.from as string | undefined;
  const toDate   = req.query.to   as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 200);
  const offset = parseInt(req.query.offset as string || "0", 10);

  try {
    const conditions = [];
    if (definitionId && !isNaN(definitionId)) conditions.push(eq(wfRunsTable.definitionId, definitionId));
    if (status) conditions.push(eq(wfRunsTable.status, status as "pending" | "running" | "completed" | "failed" | "cancelled"));
    if (fromDate) {
      const d = new Date(fromDate);
      if (!isNaN(d.getTime())) conditions.push(gte(wfRunsTable.createdAt, d));
    }
    if (toDate) {
      const d = new Date(toDate);
      if (!isNaN(d.getTime())) conditions.push(lte(wfRunsTable.createdAt, d));
    }

    const runs = await db
      .select({
        run: wfRunsTable,
        defName: wfDefinitionsTable.name,
        versionLabel: wfVersionsTable.label,
      })
      .from(wfRunsTable)
      .leftJoin(wfDefinitionsTable, eq(wfRunsTable.definitionId, wfDefinitionsTable.id))
      .leftJoin(wfVersionsTable, eq(wfRunsTable.versionId, wfVersionsTable.id))
      .where(conditions.length > 0 ? and(...conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]) : undefined)
      .orderBy(desc(wfRunsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(wfRunsTable)
      .where(conditions.length > 0 ? and(...conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]) : undefined);

    res.json({
      runs: runs.map(r => ({
        ...r.run,
        definitionName: r.defName,
        versionLabel: r.versionLabel,
        durationMs: r.run.startedAt && r.run.finishedAt
          ? r.run.finishedAt.getTime() - r.run.startedAt.getTime()
          : null,
      })),
      total: Number(total),
    });
  } catch (err) {
    req.log.error({ err }, "workflows: list runs failed");
    sendError(res, 500, "Failed to list runs");
  }
});

router.get("/admin/workflows/runs/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");

  try {
    const [row] = await db
      .select({
        run: wfRunsTable,
        defName: wfDefinitionsTable.name,
        versionLabel: wfVersionsTable.label,
        versionNumber: wfVersionsTable.versionNumber,
        graph: wfVersionsTable.graph,
      })
      .from(wfRunsTable)
      .leftJoin(wfDefinitionsTable, eq(wfRunsTable.definitionId, wfDefinitionsTable.id))
      .leftJoin(wfVersionsTable, eq(wfRunsTable.versionId, wfVersionsTable.id))
      .where(eq(wfRunsTable.id, id))
      .limit(1);

    if (!row) return sendError(res, 404, "Not found");

    const logs = await db
      .select()
      .from(wfRunNodeLogsTable)
      .where(eq(wfRunNodeLogsTable.runId, id))
      .orderBy(asc(wfRunNodeLogsTable.timestamp));

    const nodeOutputs = await db
      .select()
      .from(wfRunNodeOutputsTable)
      .where(eq(wfRunNodeOutputsTable.runId, id))
      .orderBy(asc(wfRunNodeOutputsTable.timestamp));

    res.json({
      ...row.run,
      definitionName: row.defName,
      versionLabel: row.versionLabel,
      versionNumber: row.versionNumber,
      graph: row.graph,
      logs,
      nodeOutputs,
      durationMs: row.run.startedAt && row.run.finishedAt
        ? row.run.finishedAt.getTime() - row.run.startedAt.getTime()
        : null,
    });
  } catch (err) {
    sendError(res, 500, "Failed to fetch run");
  }
});

// ── Revert to default ─────────────────────────────────────────────────────────
// Restores the active version to the pinned v1 default for a system workflow.

router.post("/admin/workflows/definitions/:id/revert-to-default", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  try {
    const [v1] = await db
      .select()
      .from(wfVersionsTable)
      .where(and(eq(wfVersionsTable.definitionId, defId), eq(wfVersionsTable.versionNumber, 1)))
      .limit(1);

    if (!v1) return sendError(res, 404, "No default version (v1) found for this workflow");

    // Archive currently published version
    await db
      .update(wfVersionsTable)
      .set({ status: "archived" })
      .where(and(eq(wfVersionsTable.definitionId, defId), eq(wfVersionsTable.status, "published")));

    // Publish v1
    const [published] = await db
      .update(wfVersionsTable)
      .set({ status: "published" })
      .where(eq(wfVersionsTable.id, v1.id))
      .returning();

    req.log.info({ defId, versionId: v1.id }, "workflows: reverted to default v1");
    res.json(published);
  } catch (err) {
    req.log.error({ err }, "workflows: revert-to-default failed");
    sendError(res, 500, "Failed to revert to default");
  }
});

router.post("/admin/workflows/runs/:id/cancel", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");

  try {
    const [updated] = await db
      .update(wfRunsTable)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(wfRunsTable.id, id), sql`status IN ('pending','running')`))
      .returning();

    if (!updated) return sendError(res, 409, "Run is not in a cancellable state");
    res.json(updated);
  } catch (err) {
    sendError(res, 500, "Failed to cancel run");
  }
});

// ── Webhook trigger (public endpoint) ─────────────────────────────────────────

router.post("/webhooks/workflow/:token", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  if (!token) return sendError(res, 400, "Missing token");

  try {
    const [trigger] = await db
      .select()
      .from(wfTriggersTable)
      .where(and(eq(wfTriggersTable.webhookToken, token), eq(wfTriggersTable.enabled, true)))
      .limit(1);

    if (!trigger) return sendError(res, 404, "Invalid webhook token");

    const runId = await fireWorkflowForDefinition(
      trigger.definitionId,
      "webhook",
      `webhook:${trigger.id}`,
      req.body ?? {},
    );

    if (!runId) return sendError(res, 422, "No published version or concurrency limit reached");
    res.status(202).json({ runId });
  } catch (err) {
    sendError(res, 500, "Webhook trigger failed");
  }
});

// ── AI Workflow Graph Generator ───────────────────────────────────────────────

function extractJsonFromText(text: string): unknown {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos !== -1) {
    const bodyStart = text.indexOf("\n", jsonTagPos) + 1;
    const closingPos = text.lastIndexOf("```");
    if (closingPos > bodyStart) {
      try { return JSON.parse(text.slice(bodyStart, closingPos).trim()); } catch { /* fall through */ }
    }
  }
  const anyOpen = text.indexOf("```");
  if (anyOpen !== -1) {
    const afterTag = text.indexOf("\n", anyOpen);
    const closingPos = text.lastIndexOf("```");
    if (afterTag !== -1 && closingPos > afterTag) {
      try { return JSON.parse(text.slice(afterTag + 1, closingPos).trim()); } catch { /* fall through */ }
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

const AI_GRAPH_NODE_SCHEMA = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()),
});

const AI_GRAPH_EDGE_SCHEMA = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
});

const AI_GRAPH_SCHEMA = z.object({
  nodes: z.array(AI_GRAPH_NODE_SCHEMA).min(1),
  edges: z.array(AI_GRAPH_EDGE_SCHEMA),
});

const WORKFLOW_CANVAS_SYSTEM_PROMPT = `You are a Microsoft 365 consulting workflow architect. Generate a React Flow workflow canvas graph.

Respond with a JSON object ONLY — no preamble, no explanation, no markdown prose outside the JSON. Format:
{
  "nodes": [...],
  "edges": [...]
}

## Node schema
Each node must have:
- "id": unique string like "node-1", "node-2", etc.
- "type": one of the valid node types listed below
- "position": {"x": number, "y": number} — lay nodes out top-to-bottom; start at x=400 y=80; each row adds 150px to y; sibling branches spread 300px apart in x
- "data": object with "nodeType" (same as type) and "label" plus type-specific fields

## Valid node types

### Structural
- "start" — data: {nodeType:"start", label:"Start"}
- "end" — data: {nodeType:"end", label:"End"}
- "condition" — data: {nodeType:"condition", label:"Check: ...", expression:"fieldName == 'value'"} — supports == != > < >= <= contains operators on payload field paths
- "delay" — data: {nodeType:"delay", label:"Wait ...", mode:"fixed", duration:3600} (duration in seconds)
- "error" — data: {nodeType:"error", label:"Error Handler"}

### CRM
- "score_lead" — data: {nodeType:"score_lead", label:"Score Lead", leadId:"{{leadId}}", threshold:"50"}
- "assign_pipeline_stage" — data: {nodeType:"assign_pipeline_stage", label:"Assign Stage", opportunityId:"{{opportunityId}}", stage:"DiscoveryCall"}
- "create_opportunity" — data: {nodeType:"create_opportunity", label:"Create Opportunity", leadId:"{{leadId}}", workflowType:"DiscoveryCall"}

### Diagnostics / Quiz
- "parse_quiz_results" — data: {nodeType:"parse_quiz_results", label:"Parse Quiz Results", quizLeadId:"{{quizLeadId}}"}
- "generate_readiness_score" — data: {nodeType:"generate_readiness_score", label:"Readiness Score", clientId:"{{clientId}}"}
- "attach_quiz_insights" — data: {nodeType:"attach_quiz_insights", label:"Attach Insights", clientId:"{{clientId}}"}

### M365 Health
- "validate_m365_permissions" — data: {nodeType:"validate_m365_permissions", label:"Validate Permissions", clientId:"{{clientId}}"}
- "update_intelligence_tables" — data: {nodeType:"update_intelligence_tables", label:"Update Intel Tables", clientId:"{{clientId}}"}
- "generate_diff_report" — data: {nodeType:"generate_diff_report", label:"Generate Diff Report", clientId:"{{clientId}}"}
- "notify_major_changes" — data: {nodeType:"notify_major_changes", label:"Notify Changes", clientId:"{{clientId}}", changeThreshold:"15"}

### Action (actionType controls behaviour)
- "action" — data: {nodeType:"action", label:"...", actionType:"send_email"|"send_sms"|"http_request"|"create_lead"|"convert_to_opportunity"|"create_client"|"create_project"|"execute_runbook"|"update_m365_profile"|"generate_document"|"emit_event"}

## Edge schema
Each edge:
- "id": unique string like "edge-1"
- "source": source node id
- "target": target node id
- "sourceHandle": use "true" or "false" only when source is a condition node; omit for all other node types

## Rules
- Every graph must have exactly one "start" node and at least one "end" node
- Condition nodes fork into "true" and "false" edge paths — both paths should eventually reach an "end" node
- Use {{fieldName}} handlebars syntax for payload references in data strings
- Keep graphs focused: 4–12 nodes is ideal; never exceed 20
- Generate clean, readable layouts — nodes should not overlap`;

router.post("/admin/workflows/ai-generate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = z.object({
      description: z.string().min(1).max(2000),
    }).safeParse(req.body);
    if (!body.success) { sendError(res, 400, body.error.message); return; }

    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: WORKFLOW_CANVAS_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Generate a workflow graph for:\n\n${body.data.description}`,
      }],
    });

    const block = msg.content.find(b => b.type === "text");
    if (!block || block.type !== "text") { sendError(res, 500, "AI returned no text"); return; }

    const parsed = extractJsonFromText(block.text);
    if (!parsed) {
      req.log.warn({ preview: block.text.slice(0, 300) }, "workflows/ai-generate: could not extract JSON");
      sendError(res, 422, "AI response could not be parsed. Try rephrasing your description.");
      return;
    }

    const validated = AI_GRAPH_SCHEMA.safeParse(parsed);
    if (!validated.success) {
      req.log.warn({ issues: validated.error.issues, preview: block.text.slice(0, 300) }, "workflows/ai-generate: schema validation failed");
      sendError(res, 422, `AI generated an invalid graph: ${validated.error.issues[0]?.message ?? "schema mismatch"}`);
      return;
    }

    req.log.info({ nodeCount: validated.data.nodes.length, edgeCount: validated.data.edges.length }, "workflows/ai-generate: success");
    res.json(validated.data);
  } catch (err) {
    req.log.error({ err }, "workflows/ai-generate: failed");
    sendError(res, 500, "AI generation failed — please try again");
  }
});

export default router;

