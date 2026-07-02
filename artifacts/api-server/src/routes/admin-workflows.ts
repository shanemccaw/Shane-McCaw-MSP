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
import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { fireWorkflowForDefinition, computeNextCronRun } from "../lib/workflow-executor";
import crypto from "crypto";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// ── Definitions ───────────────────────────────────────────────────────────────

router.get("/api/admin/workflows/definitions", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/admin/workflows/definitions", requireAdmin, async (req: Request, res: Response) => {
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

router.get("/api/admin/workflows/definitions/:id", requireAdmin, async (req: Request, res: Response) => {
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

router.put("/api/admin/workflows/definitions/:id", requireAdmin, async (req: Request, res: Response) => {
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

router.delete("/api/admin/workflows/definitions/:id", requireAdmin, async (req: Request, res: Response) => {
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

router.get("/api/admin/workflows/definitions/:id/versions", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/admin/workflows/definitions/:id/versions", requireAdmin, async (req: Request, res: Response) => {
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

router.get("/api/admin/workflows/definitions/:id/versions/:vid", requireAdmin, async (req: Request, res: Response) => {
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

router.put("/api/admin/workflows/definitions/:id/versions/:vid", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/admin/workflows/definitions/:id/versions/:vid/publish", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  const vid = parseInt(req.params.vid as string);
  if (isNaN(defId) || isNaN(vid)) return sendError(res, 400, "Invalid id");

  const body = z.object({ label: z.string().optional() }).safeParse(req.body);

  try {
    await db
      .update(wfVersionsTable)
      .set({ status: "draft" })
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

router.get("/api/admin/workflows/definitions/:id/triggers", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/admin/workflows/definitions/:id/triggers", requireAdmin, async (req: Request, res: Response) => {
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

router.patch("/api/admin/workflows/definitions/:id/triggers/:tid", requireAdmin, async (req: Request, res: Response) => {
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

router.delete("/api/admin/workflows/definitions/:id/triggers/:tid", requireAdmin, async (req: Request, res: Response) => {
  const tid = parseInt(req.params.tid as string);
  if (isNaN(tid)) return sendError(res, 400, "Invalid id");
  try {
    await db.delete(wfTriggersTable).where(eq(wfTriggersTable.id, tid));
    res.status(204).end();
  } catch (err) {
    sendError(res, 500, "Failed to delete trigger");
  }
});

router.post("/api/admin/workflows/definitions/:id/triggers/:tid/rotate-token", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/admin/workflows/definitions/:id/run", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  try {
    const runId = await fireWorkflowForDefinition(defId, "manual", `admin:manual`, req.body.payload ?? {});
    if (!runId) return sendError(res, 422, "No published version found or concurrency limit reached");
    res.status(202).json({ runId });
  } catch (err) {
    sendError(res, 500, "Failed to trigger workflow");
  }
});

// ── Runs ──────────────────────────────────────────────────────────────────────

router.get("/api/admin/workflows/runs", requireAdmin, async (req: Request, res: Response) => {
  const definitionId = req.query.definitionId ? parseInt(req.query.definitionId as string) : null;
  const status = req.query.status as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 200);
  const offset = parseInt(req.query.offset as string || "0", 10);

  try {
    const conditions = [];
    if (definitionId && !isNaN(definitionId)) conditions.push(eq(wfRunsTable.definitionId, definitionId));
    if (status) conditions.push(eq(wfRunsTable.status, status as "pending" | "running" | "completed" | "failed" | "cancelled"));

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

router.get("/api/admin/workflows/runs/:id", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/admin/workflows/runs/:id/cancel", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/webhooks/workflow/:token", async (req: Request, res: Response) => {
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

export default router;
