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
 * POST   /api/admin/workflows/runs/:id/rerun
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
  pendingApprovalsTable,
  type WfGraph,
} from "@workspace/db";
import { eq, and, desc, asc, count, sql, gte, lte, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { fireWorkflowForDefinition, computeNextCronRun, executeWorkflowRun, resumeWorkflowRun } from "../lib/workflow-executor";
import { registerAdminWorkflowEventClient } from "../lib/sse-broadcast";
import { anthropic } from "@workspace/integrations-anthropic-ai";
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

    if (defs.length === 0) { res.json([]); return; }

    const defIds = defs.map(d => d.id);

    // Batch query 1 — latest published version per definition
    // DISTINCT ON keeps only the first row per definition_id when ordered by version_number DESC
    const publishedRows = await db.execute<{
      definition_id: number;
      label: string | null;
      version_number: number;
    }>(sql`
      SELECT DISTINCT ON (definition_id) definition_id, label, version_number
      FROM   wf_versions
      WHERE  definition_id = ANY(${sql.raw(`ARRAY[${defIds.join(",")}]::int[]`)})
        AND  status = 'published'
      ORDER  BY definition_id, version_number DESC
    `);

    // Batch query 2 — all triggers for all definitions
    const allTriggers = defIds.length > 0
      ? await db
          .select({ definitionId: wfTriggersTable.definitionId, type: wfTriggersTable.type, config: wfTriggersTable.config })
          .from(wfTriggersTable)
          .where(inArray(wfTriggersTable.definitionId, defIds))
      : [];

    // Batch query 3 — last run per definition
    const lastRunRows = await db.execute<{
      definition_id: number;
      status: string;
      created_at: string;
    }>(sql`
      SELECT DISTINCT ON (definition_id) definition_id, status, created_at
      FROM   wf_runs
      WHERE  definition_id = ANY(${sql.raw(`ARRAY[${defIds.join(",")}]::int[]`)})
      ORDER  BY definition_id, created_at DESC
    `);

    // Batch query 4 — latest version graph per definition (for ask_for_input fields)
    const latestVersionRows = await db.execute<{
      definition_id: number;
      graph: unknown;
    }>(sql`
      SELECT DISTINCT ON (definition_id) definition_id, graph
      FROM   wf_versions
      WHERE  definition_id = ANY(${sql.raw(`ARRAY[${defIds.join(",")}]::int[]`)})
      ORDER  BY definition_id, version_number DESC
    `);

    // Index the batch results by definition_id for O(1) lookup
    const publishedByDef = new Map(publishedRows.rows.map(r => [r.definition_id, r]));
    const lastRunByDef   = new Map(lastRunRows.rows.map(r => [r.definition_id, r]));
    const latestVerByDef = new Map(latestVersionRows.rows.map(r => [r.definition_id, r]));

    const triggersByDef = new Map<number, typeof allTriggers>();
    for (const t of allTriggers) {
      const arr = triggersByDef.get(t.definitionId) ?? [];
      arr.push(t);
      triggersByDef.set(t.definitionId, arr);
    }

    type GraphNode = { type: string; data?: Record<string, unknown> };

    const enriched = defs.map(def => {
      const published   = publishedByDef.get(def.id);
      const lastRun     = lastRunByDef.get(def.id);
      const latestVer   = latestVerByDef.get(def.id);
      const triggerRows = triggersByDef.get(def.id) ?? [];

      const triggerTypes      = [...new Set(triggerRows.map(t => t.type))];
      const triggerEventNames = triggerRows
        .filter(t => t.type === "event")
        .map(t => (t.config as Record<string, unknown>).eventName as string | undefined)
        .filter((n): n is string => typeof n === "string" && n.length > 0);

      const graphNodes = (latestVer?.graph as { nodes?: GraphNode[] } | undefined)?.nodes ?? [];
      const askForInputNode   = graphNodes.find(n => n.type === "ask_for_input");
      const askForInputFields = (askForInputNode?.data?.fields as Array<{
        variableName: string; label: string; type: string;
        required?: boolean; options?: string; multi?: boolean;
      }> | undefined) ?? null;

      return {
        ...def,
        publishedVersionLabel:  published?.label ?? null,
        publishedVersionNumber: published?.version_number ?? null,
        triggerCount:      triggerRows.length,
        triggerTypes,
        triggerEventNames,
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt:     lastRun?.created_at ? new Date(lastRun.created_at) : null,
        askForInputFields,
      };
    });

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
    maxRunDepth: z.number().int().min(1).max(10).optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const [def] = await db.insert(wfDefinitionsTable).values({
      name: body.data.name,
      description: body.data.description,
      concurrencyLimit: body.data.concurrencyLimit ?? 5,
      maxRunDepth: body.data.maxRunDepth ?? 5,
    }).returning();

    const [version] = await db.insert(wfVersionsTable).values({
      definitionId: def.id,
      versionNumber: 1,
      label: "v1 — Initial draft",
      status: "draft",
      graph: {
        nodes: [{
          id: "node-1",
          type: "start",
          position: { x: 300, y: 100 },
          data: { nodeType: "start", label: "Start" },
        }],
        edges: [],
      },
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
    maxRunDepth: z.number().int().min(1).max(10).optional(),
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

router.patch("/admin/workflows/definitions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");

  const body = z.object({
    category: z.string().max(100).nullable().optional(),
    name: z.string().min(1).max(200).optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);
  if (body.data.category === undefined && !body.data.name) return sendError(res, 400, "Nothing to update");

  try {
    const [existing] = await db
      .select({ metadata: wfDefinitionsTable.metadata })
      .from(wfDefinitionsTable)
      .where(eq(wfDefinitionsTable.id, id))
      .limit(1);
    if (!existing) return sendError(res, 404, "Not found");

    type UpdateFields = {
      updatedAt: Date;
      metadata?: Record<string, unknown>;
      name?: string;
    };
    const updateFields: UpdateFields = { updatedAt: new Date() };

    if (body.data.category !== undefined) {
      const merged: Record<string, unknown> = { ...(existing.metadata ?? {}) };
      if (body.data.category === null || body.data.category === "") {
        delete merged.category;
      } else {
        merged.category = body.data.category;
      }
      updateFields.metadata = merged;
    }

    if (body.data.name) {
      updateFields.name = body.data.name;
    }

    const [updated] = await db
      .update(wfDefinitionsTable)
      .set(updateFields)
      .where(eq(wfDefinitionsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to patch definition");
    sendError(res, 500, "Failed to update workflow");
  }
});

// ── Duplicate a workflow definition (clones latest version graph + triggers) ──
router.post("/admin/workflows/definitions/:id/duplicate", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");

  try {
    // Load source definition
    const [src] = await db.select().from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, id)).limit(1);
    if (!src) return sendError(res, 404, "Not found");

    // Load latest draft version (fall back to any version)
    const versions = await db
      .select()
      .from(wfVersionsTable)
      .where(eq(wfVersionsTable.definitionId, id))
      .orderBy(desc(wfVersionsTable.versionNumber));
    const srcVersion = versions.find(v => v.status === "draft") ?? versions[0];

    // Load triggers
    const srcTriggers = await db
      .select()
      .from(wfTriggersTable)
      .where(eq(wfTriggersTable.definitionId, id));

    // Create new definition
    const [newDef] = await db.insert(wfDefinitionsTable).values({
      name: `Copy of ${src.name}`,
      description: src.description ?? undefined,
      concurrencyLimit: src.concurrencyLimit,
      maxRunDepth: src.maxRunDepth,
      metadata: { ...((src.metadata ?? {}) as Record<string, unknown>), system: false },
    }).returning();

    // Clone the version graph
    const [newVersion] = await db.insert(wfVersionsTable).values({
      definitionId: newDef.id,
      versionNumber: 1,
      label: "v1 — Initial draft",
      status: "draft",
      graph: srcVersion?.graph ?? { nodes: [], edges: [] },
    }).returning();

    // Clone triggers (exclude webhook tokens — those must be unique)
    if (srcTriggers.length > 0) {
      await db.insert(wfTriggersTable).values(
        srcTriggers.map(t => ({
          definitionId: newDef.id,
          type: t.type,
          config: t.config,
          enabled: t.enabled,
          nextRunAt: t.type === "schedule" ? t.nextRunAt : undefined,
        })),
      );
    }

    res.status(201).json({ ...newDef, draftVersionId: newVersion.id });
  } catch (err) {
    req.log.error({ err }, "workflows: duplicate definition failed");
    sendError(res, 500, "Failed to duplicate workflow");
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
      .set({ graph: (body.data.graph as WfGraph) ?? existing.graph, label: body.data.label ?? existing.label, updatedAt: new Date() })
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
    const inputValues = (req.body.inputValues && typeof req.body.inputValues === "object")
      ? req.body.inputValues as Record<string, string | string[]>
      : undefined;
    const runId = await fireWorkflowForDefinition(
      defId, "manual", `admin:manual`,
      req.body.payload ?? {},
      { ...(versionId ? { versionId } : {}), inputValues },
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
    inputValues: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    dryRun: z.boolean().optional().default(true),
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
    const inputValues = body.data.inputValues ?? {};

    const dryRun = body.data.dryRun;
    setImmediate(() => {
      executeWorkflowRun(runId, { inlineGraph, dryRun, inputValues }).catch(err => {
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
  const triggerType = req.query.triggerType as string | undefined;
  const triggerRef  = req.query.triggerRef  as string | undefined;
  // triggerRefs: comma-separated list of event names (used for category-level filtering)
  const triggerRefsRaw = req.query.triggerRefs as string | undefined;
  const triggerRefs = triggerRefsRaw ? triggerRefsRaw.split(",").map(s => s.trim()).filter(Boolean) : null;
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
    if (triggerType) conditions.push(eq(wfRunsTable.triggerType, triggerType as "manual" | "schedule" | "webhook" | "event"));
    if (triggerRef) {
      conditions.push(eq(wfRunsTable.triggerRef, triggerRef));
    } else if (triggerRefs && triggerRefs.length > 0) {
      conditions.push(inArray(wfRunsTable.triggerRef, triggerRefs));
    }

    const whereClause = conditions.length > 0 ? and(...conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]) : undefined;

    const [runs, [{ total }]] = await Promise.all([
      db
        .select({
          run: wfRunsTable,
          defName: wfDefinitionsTable.name,
          defMetadata: wfDefinitionsTable.metadata,
          versionLabel: wfVersionsTable.label,
        })
        .from(wfRunsTable)
        .leftJoin(wfDefinitionsTable, eq(wfRunsTable.definitionId, wfDefinitionsTable.id))
        .leftJoin(wfVersionsTable, eq(wfRunsTable.versionId, wfVersionsTable.id))
        .where(whereClause)
        .orderBy(desc(wfRunsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(wfRunsTable)
        .where(whereClause),
    ]);

    res.json({
      runs: runs.map(r => ({
        ...r.run,
        definitionName: r.defName,
        isSystem: r.defMetadata?.system === true,
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

    // Derive which node is currently executing: the most recent node that has a
    // "started" log entry but no completed output yet.  Lets the live viewer show
    // a pulsing card for long-running nodes (AI doc gen, runbooks, etc.) that
    // have been running for 30–120 s without writing any DB output.
    const completedNodeIds = new Set(nodeOutputs.map(o => o.nodeId));
    const activeNodeId =
      row.run.status === "running" || row.run.status === "pending"
        ? [...logs]
            .reverse()
            .find(
              l =>
                (l.metadata as Record<string, unknown> | null)?.started === true &&
                !completedNodeIds.has(l.nodeId),
            )?.nodeId ?? null
        : null;

    res.json({
      ...row.run,
      definitionName: row.defName,
      versionLabel: row.versionLabel,
      versionNumber: row.versionNumber,
      graph: row.graph,
      logs,
      nodeOutputs,
      activeNodeId,
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

router.post("/admin/workflows/runs/:id/rerun", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");

  try {
    const [sourceRun] = await db
      .select({
        definitionId: wfRunsTable.definitionId,
        versionId: wfRunsTable.versionId,
        triggerType: wfRunsTable.triggerType,
        triggerRef: wfRunsTable.triggerRef,
        payload: wfRunsTable.payload,
        status: wfRunsTable.status,
      })
      .from(wfRunsTable)
      .where(eq(wfRunsTable.id, id))
      .limit(1);

    if (!sourceRun) return sendError(res, 404, "Run not found");
    if (sourceRun.status !== "failed" && sourceRun.status !== "cancelled" && sourceRun.status !== "completed") {
      return sendError(res, 409, "Only failed, cancelled, or completed runs can be re-run");
    }

    // Verify the definition still exists
    const [def] = await db
      .select({ id: wfDefinitionsTable.id })
      .from(wfDefinitionsTable)
      .where(eq(wfDefinitionsTable.id, sourceRun.definitionId))
      .limit(1);
    if (!def) return sendError(res, 409, "Workflow definition no longer exists");

    // Use the source run's original version so behaviour is identical
    const newRunId = await fireWorkflowForDefinition(
      sourceRun.definitionId,
      (sourceRun.triggerType as "manual" | "schedule" | "webhook" | "event") ?? "manual",
      sourceRun.triggerRef ?? "rerun",
      sourceRun.payload ?? {},
      { versionId: sourceRun.versionId },
    );

    if (!newRunId) return sendError(res, 500, "Could not create re-run (concurrency limit or version not found)");

    await db
      .update(wfRunsTable)
      .set({ retriggeredFromRunId: id } as Partial<typeof wfRunsTable.$inferInsert>)
      .where(eq(wfRunsTable.id, newRunId));

    req.log.info({ sourceRunId: id, newRunId }, "workflows: re-run created");
    res.json({ runId: newRunId });
  } catch (err) {
    req.log.error({ err }, "workflows: rerun failed");
    sendError(res, 500, "Failed to re-run");
  }
});

// ── Pending Approvals ─────────────────────────────────────────────────────────

router.get("/admin/workflows/pending-approvals", requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        approval: pendingApprovalsTable,
        defName: wfDefinitionsTable.name,
      })
      .from(pendingApprovalsTable)
      .leftJoin(wfRunsTable, eq(pendingApprovalsTable.runId, wfRunsTable.id))
      .leftJoin(wfDefinitionsTable, eq(wfRunsTable.definitionId, wfDefinitionsTable.id))
      .where(eq(pendingApprovalsTable.status, "pending"))
      .orderBy(desc(pendingApprovalsTable.createdAt));

    res.json(rows.map(r => ({ ...r.approval, definitionName: r.defName })));
  } catch (err) {
    req.log.error({ err }, "pending-approvals: list failed");
    sendError(res, 500, "Failed to list pending approvals");
  }
});

router.post("/admin/workflows/pending-approvals/:id/decide", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return sendError(res, 400, "Invalid id");

  const body = z.object({
    decision: z.enum(["approved", "rejected"]),
    note: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  try {
    const [approval] = await db
      .select()
      .from(pendingApprovalsTable)
      .where(and(eq(pendingApprovalsTable.id, id), eq(pendingApprovalsTable.status, "pending")))
      .limit(1);

    if (!approval) return sendError(res, 404, "Pending approval not found or already decided");

    await db.update(pendingApprovalsTable).set({
      status: body.data.decision,
      decidedAt: new Date(),
      decisionNote: body.data.note ?? null,
      decidedBy: "admin",
    }).where(eq(pendingApprovalsTable.id, id));

    if (body.data.decision === "approved") {
      const resumePayload = (approval.context as Record<string, unknown>) ?? {};
      const decisionNote = body.data.note;
      setImmediate(() => {
        resumeWorkflowRun(approval.runId, approval.nodeId, resumePayload, decisionNote).catch(err => {
          logger.warn({ err, runId: approval.runId }, "pending-approvals: resume failed (non-fatal)");
        });
      });
      req.log.info({ approvalId: id, runId: approval.runId }, "pending-approvals: approved, resuming run");
    } else {
      await db.update(wfRunsTable).set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: `Rejected by admin at approval gate: ${body.data.note ?? "(no reason given)"}`,
      }).where(eq(wfRunsTable.id, approval.runId));
      req.log.info({ approvalId: id, runId: approval.runId }, "pending-approvals: rejected, run marked failed");
    }

    res.json({ ok: true, decision: body.data.decision, runId: approval.runId });
  } catch (err) {
    req.log.error({ err }, "pending-approvals: decide failed");
    sendError(res, 500, "Failed to process decision");
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

// ── AI prompt quality guard ───────────────────────────────────────────────────
// Detects at least one workflow-relevant term so vague/off-topic inputs (e.g.
// "write a poem", "email") are rejected before burning AI credits.
const WORKFLOW_KEYWORDS_RE =
  /\b(send|creat|notif|assign|qualif|trigger|check|generat|pars|validat|process|schedul|rout|filter|approv|reject|invit|enroll|activat|updat|scor|assess|alert|review|detect|monitor|escalat|dela|wait|branch|loop|lead|client|email|workflow|form|contract|payment|message|task|stage|pipeline|m365|sharepoint|teams|opportunity|deal|contact|account|user|notification|condition|step|webhook|invoice|calendar|follow.?up|onboard|handl)\w*/i;

function checkWorkflowRelevance(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 20) {
    return "Description is too short — add more detail (minimum 20 characters). Describe the specific steps, conditions, and actions you want in the workflow.";
  }
  if (!WORKFLOW_KEYWORDS_RE.test(trimmed)) {
    return "Description doesn't seem to describe a workflow. Include specific actions or steps such as 'send an email', 'qualify a lead', 'trigger when payment received', or 'notify Shane'. The more specific, the better.";
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
  unsupportedFeatures: z.array(z.string()).nullable().optional(),
  replitPrompt: z.string().nullable().optional(),
});

const WORKFLOW_CANVAS_SYSTEM_PROMPT = `You are a Microsoft 365 consulting workflow architect. Generate a React Flow workflow canvas graph.

Respond with a JSON object ONLY — no preamble, no explanation, no markdown prose outside the JSON. Format:
{
  "nodes": [...],
  "edges": [...],
  "unsupportedFeatures": ["...", "..."],
  "replitPrompt": "..."
}

After building the graph, check whether every step the user requested is covered by the supported node types. If any steps or behaviours are NOT implementable with the current engine:
- List each gap as a plain-English string in "unsupportedFeatures"
- Write a concise, actionable Replit AI prompt in "replitPrompt" that a developer can paste directly into Replit to add those missing node types. The prompt must:
  - State the project context (pnpm monorepo, Express/Node API, React admin panel, PostgreSQL, existing workflow engine)
  - Name each missing node type and what it should do
  - Reference where the existing node types live in the codebase (artifacts/api-server/src/routes/admin-workflows.ts for execution, WorkflowBuilderPage.tsx for the canvas config panel, and lib/db/src/schema/index.ts for the WfNode.type union)
  - Ask for end-to-end implementation: schema update, executor case, config panel, and system-prompt addition
If everything the user asked for is fully covered, set both "unsupportedFeatures" and "replitPrompt" to null.

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

### Platform
- "http_request" — data: {nodeType:"http_request", label:"HTTP Request", params:{method:"GET", url:"https://…", bodyRaw:""}}
- "sql_query" — data: {nodeType:"sql_query", label:"SQL Query", query:"SELECT …"}
- "emit_event" — data: {nodeType:"emit_event", label:"Emit Event", eventName:"my.event.name", eventPayload:"{}"}
- "cancel_workflow" — data: {nodeType:"cancel_workflow", label:"Cancel Workflow"}

### Communication
- "send_email" — data: {nodeType:"send_email", label:"Send Email", to:"{{email}}", subject:"…", body:"Hi {{name}}, …"}
- "send_sms" — data: {nodeType:"send_sms", label:"Send SMS", to:"{{phone}}", message:"Hi {{name}}, …"}

### CRM Actions
- "create_lead" — data: {nodeType:"create_lead", label:"Create Lead", name:"{{payload.name}}", email:"{{payload.email}}"}
- "convert_to_opportunity" — data: {nodeType:"convert_to_opportunity", label:"Convert to Opportunity", leadId:"{{leadId}}", workflowType:"DiscoveryCall"}
- "create_client" — data: {nodeType:"create_client", label:"Create Client", name:"{{payload.name}}", email:"{{payload.email}}"}
- "create_project" — data: {nodeType:"create_project", label:"Create Project", title:"{{payload.leadName}} Onboarding", projectType:"project", clientUserId:"{{clientId}}"}

### Azure / Microsoft 365
- "execute_runbook" — data: {nodeType:"execute_runbook", label:"Execute Runbook", runbookName:"My-Runbook-Name", runbookParams:"{}"}
- "update_m365_profile" — data: {nodeType:"update_m365_profile", label:"Update M365 Profile", clientId:"{{clientId}}", runbookName:"M365-Health-Check", runbookParams:"{}"}
- "generate_document" — data: {nodeType:"generate_document", label:"Generate Document", clientId:"{{clientId}}", docType:"security", docTitle:"{{payload.company}} Report"}

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
      triggerContext: z.string().max(100).optional(),
    }).safeParse(req.body);
    if (!body.success) { sendError(res, 400, body.error.message); return; }

    const qualityErr = checkWorkflowRelevance(body.data.description);
    if (qualityErr) { sendError(res, 400, qualityErr); return; }

    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    const triggerLine = body.data.triggerContext
      ? `Trigger type selected by user: ${body.data.triggerContext}\n\n`
      : "";

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: WORKFLOW_CANVAS_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Generate a workflow graph for:\n\n${triggerLine}${body.data.description}`,
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

    const { nodes, edges } = validated.data;

    // Unique node IDs
    const nodeIdSet = new Set(nodes.map(n => n.id));
    if (nodeIdSet.size !== nodes.length) {
      sendError(res, 422, "AI generated duplicate node IDs — try rephrasing your description"); return;
    }

    // Unique edge IDs
    const edgeIdSet = new Set(edges.map(e => e.id));
    if (edgeIdSet.size !== edges.length) {
      sendError(res, 422, "AI generated duplicate edge IDs — try rephrasing your description"); return;
    }

    // Edge referential integrity — source and target must reference existing nodes
    for (const e of edges) {
      if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) {
        req.log.warn({ edgeId: e.id, source: e.source, target: e.target }, "workflows/ai-generate: edge references unknown node");
        sendError(res, 422, "AI generated an edge pointing to a non-existent node — try rephrasing your description"); return;
      }
    }

    // Exactly one start node
    const startCount = nodes.filter(n => n.type === "start").length;
    if (startCount !== 1) {
      sendError(res, 422, `AI generated ${startCount} start node${startCount === 1 ? "" : "s"} — expected exactly 1. Try rephrasing your description.`); return;
    }

    // At least one end node
    const endCount = nodes.filter(n => n.type === "end").length;
    if (endCount < 1) {
      sendError(res, 422, "AI generated no end nodes — at least one is required. Try rephrasing your description."); return;
    }

    req.log.info({ nodeCount: nodes.length, edgeCount: edges.length }, "workflows/ai-generate: success");
    res.json({
      nodes,
      edges,
      unsupportedFeatures: validated.data.unsupportedFeatures ?? null,
      replitPrompt: validated.data.replitPrompt ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "workflows/ai-generate: failed");
    sendError(res, 500, "AI generation failed — please try again");
  }
});

// ── AI Workflow Refiner ───────────────────────────────────────────────────────

const WORKFLOW_REFINE_SYSTEM_PROMPT = `You are a Microsoft 365 consulting workflow architect. You are given an existing React Flow workflow graph and a refinement instruction from the user. Apply the instruction to the graph while preserving all unchanged parts.

Return the COMPLETE updated graph as a JSON object — no preamble, no explanation:
{
  "nodes": [...],
  "edges": [...]
}

## Node schema (same as generation)
Each node must have:
- "id": keep existing IDs for unchanged nodes; use new unique IDs like "node-new-1" for added nodes
- "type": one of start | end | condition | delay | error | score_lead | assign_pipeline_stage | create_opportunity | parse_quiz_results | generate_readiness_score | attach_quiz_insights | validate_m365_permissions | update_intelligence_tables | generate_diff_report | notify_major_changes | http_request | sql_query | send_email | send_sms | emit_event | cancel_workflow | create_lead | convert_to_opportunity | create_client | create_project | execute_runbook | update_m365_profile | generate_document
- "position": {"x": number, "y": number} — keep existing positions for unchanged nodes; place new nodes appropriately nearby
- "data": keep existing data fields for unchanged nodes; add required fields for new nodes

## Edge schema
Each edge:
- "id": keep existing IDs for unchanged edges; use new unique IDs like "edge-new-1" for added edges
- "source", "target": node IDs
- "sourceHandle": "true" or "false" only for condition nodes; omit otherwise

## Rules
- Preserve all nodes/edges not affected by the refinement
- Every graph must have exactly one "start" node and at least one "end" node
- Condition nodes branch into "true" and "false" paths
- Use {{fieldName}} handlebars for payload references
- Return the full graph, not a diff — every node and edge that should exist must be in the output`;

router.post("/admin/workflows/ai-refine", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = z.object({
      instruction: z.string().min(1).max(2000),
      graph: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          type: z.string(),
          position: z.object({ x: z.number(), y: z.number() }),
          data: z.record(z.unknown()),
        })).min(1),
        edges: z.array(z.object({
          id: z.string(),
          source: z.string(),
          target: z.string(),
          sourceHandle: z.string().nullable().optional(),
        })),
      }),
    }).safeParse(req.body);
    if (!body.success) { sendError(res, 400, body.error.message); return; }

    const qualityErr = checkWorkflowRelevance(body.data.instruction);
    if (qualityErr) { sendError(res, 400, qualityErr); return; }

    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    const graphSummary = JSON.stringify(body.data.graph, null, 2);

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: WORKFLOW_REFINE_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Current workflow graph:\n\`\`\`json\n${graphSummary}\n\`\`\`\n\nRefinement instruction: ${body.data.instruction}`,
      }],
    });

    const block = msg.content.find(b => b.type === "text");
    if (!block || block.type !== "text") { sendError(res, 500, "AI returned no text"); return; }

    const parsed = extractJsonFromText(block.text);
    if (!parsed) {
      req.log.warn({ preview: block.text.slice(0, 300) }, "workflows/ai-refine: could not extract JSON");
      sendError(res, 422, "AI response could not be parsed. Try rephrasing your instruction.");
      return;
    }

    const validated = AI_GRAPH_SCHEMA.safeParse(parsed);
    if (!validated.success) {
      req.log.warn({ issues: validated.error.issues }, "workflows/ai-refine: schema validation failed");
      sendError(res, 422, `AI produced an invalid graph: ${validated.error.issues[0]?.message ?? "schema mismatch"}`);
      return;
    }

    const { nodes, edges } = validated.data;

    const nodeIdSet = new Set(nodes.map(n => n.id));
    if (nodeIdSet.size !== nodes.length) { sendError(res, 422, "AI produced duplicate node IDs"); return; }

    const edgeIdSet = new Set(edges.map(e => e.id));
    if (edgeIdSet.size !== edges.length) { sendError(res, 422, "AI produced duplicate edge IDs"); return; }

    for (const e of edges) {
      if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) {
        sendError(res, 422, "AI produced an edge referencing a non-existent node"); return;
      }
    }

    const startCount = nodes.filter(n => n.type === "start").length;
    if (startCount !== 1) { sendError(res, 422, `Expected exactly 1 start node, AI produced ${startCount}`); return; }

    const endCount = nodes.filter(n => n.type === "end").length;
    if (endCount < 1) { sendError(res, 422, "AI produced no end nodes — at least one is required"); return; }

    req.log.info({ nodeCount: nodes.length, edgeCount: edges.length }, "workflows/ai-refine: success");
    res.json({ nodes, edges });
  } catch (err) {
    req.log.error({ err }, "workflows/ai-refine: failed");
    sendError(res, 500, "AI refinement failed — please try again");
  }
});

// ── POST /api/admin/workflows/:id/publish-to-prod ─────────────────────────────
// Upserts the workflow definition + latest published version graph + triggers
// into the production database. Returns 503 if DATABASE_URL_PROD is not set.

router.post("/admin/workflows/definitions/:id/publish-to-prod", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  const { isProdDbConfigured, buildProdDb } = await import("../lib/prod-db.ts");
  if (!isProdDbConfigured()) {
    return sendError(res, 503, "Production database is not configured. Set DATABASE_URL_PROD in Replit Secrets.");
  }

  try {
    const [def] = await db.select().from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, defId)).limit(1);
    if (!def) return sendError(res, 404, "Workflow not found");

    const [publishedVersion] = await db
      .select()
      .from(wfVersionsTable)
      .where(and(eq(wfVersionsTable.definitionId, defId), eq(wfVersionsTable.status, "published")))
      .orderBy(desc(wfVersionsTable.versionNumber))
      .limit(1);

    const triggers = await db
      .select()
      .from(wfTriggersTable)
      .where(eq(wfTriggersTable.definitionId, defId));

    const { db: prodDb, pool: prodPool } = buildProdDb();

    await prodDb
      .insert(wfDefinitionsTable)
      .values({
        id: def.id,
        name: def.name,
        description: def.description,
        concurrencyLimit: def.concurrencyLimit,
        metadata: def.metadata,
        createdAt: def.createdAt,
        updatedAt: def.updatedAt,
      })
      .onConflictDoUpdate({
        target: wfDefinitionsTable.id,
        set: {
          name: def.name,
          description: def.description,
          concurrencyLimit: def.concurrencyLimit,
          metadata: def.metadata,
          updatedAt: new Date(),
        },
      });

    if (publishedVersion) {
      await prodDb
        .insert(wfVersionsTable)
        .values({
          id: publishedVersion.id,
          definitionId: def.id,
          versionNumber: publishedVersion.versionNumber,
          label: publishedVersion.label,
          status: "published" as const,
          graph: publishedVersion.graph,
          isDefault: publishedVersion.isDefault,
          createdAt: publishedVersion.createdAt,
        })
        .onConflictDoUpdate({
          target: wfVersionsTable.id,
          set: {
            label: publishedVersion.label,
            status: "published" as const,
            graph: publishedVersion.graph,
            isDefault: publishedVersion.isDefault,
          },
        });
    }

    for (const trigger of triggers) {
      await prodDb
        .insert(wfTriggersTable)
        .values({
          id: trigger.id,
          definitionId: def.id,
          type: trigger.type,
          config: trigger.config,
          webhookToken: trigger.webhookToken ?? null,
          nextRunAt: trigger.nextRunAt,
          enabled: trigger.enabled,
          createdAt: trigger.createdAt,
        })
        .onConflictDoUpdate({
          target: wfTriggersTable.id,
          set: {
            type: trigger.type,
            config: trigger.config,
            webhookToken: trigger.webhookToken ?? null,
            nextRunAt: trigger.nextRunAt,
            enabled: trigger.enabled,
          },
        });
    }

    await prodPool.end();

    req.log.info({ defId, name: def.name, triggerCount: triggers.length }, "workflows: published to prod DB");
    res.json({
      ok: true,
      definitionId: def.id,
      name: def.name,
      publishedVersionId: publishedVersion?.id ?? null,
      triggersPublished: triggers.length,
    });
  } catch (err) {
    req.log.error({ err, defId }, "workflows: publish-to-prod failed");
    sendError(res, 500, err instanceof Error ? err.message : "Failed to publish to production");
  }
});

// ── Admin workflow events SSE stream ─────────────────────────────────────────
// GET /api/admin/workflows/sound-events
// Admin panel tabs subscribe here to receive real-time play_sound events
// emitted by the workflow executor (Browser target).

router.get("/admin/workflows/sound-events", requireAdmin, (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const keepAlive = setInterval(() => {
    try { res.write(": keep-alive\n\n"); } catch { clearInterval(keepAlive); }
  }, 25_000);

  registerAdminWorkflowEventClient(res, () => clearInterval(keepAlive));
});

// ── Expression helper ─────────────────────────────────────────────────────────
// POST /api/admin/workflows/expression-helper
// Calls Claude to generate a workflow expression from a natural-language prompt.
// Returns { expression, explanation } — expression on line 1, ≤15-word explanation on line 2.

const EXPRESSION_HELPER_SCHEMA = z.object({
  userPrompt: z.string().min(1).max(500),
  availableVariables: z.array(z.object({
    tokenPath: z.string(),
    label: z.string(),
  })).max(200),
  expressionType: z.enum(["boolean", "value"]),
});

router.post("/admin/workflows/expression-helper", requireAdmin, async (req: Request, res: Response) => {
  const parsed = EXPRESSION_HELPER_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { userPrompt, availableVariables, expressionType } = parsed.data;

  const varList = availableVariables.length
    ? availableVariables.map(v => `  {{${v.tokenPath}}} — ${v.label}`).join("\n")
    : "  (no upstream variables available)";

  const systemPrompt = `You are a workflow expression writer for a no-code automation builder.
Expression syntax rules:
- Variable references: {{variablePath}} e.g. {{status}}, {{steps.node-101.score}}
- Comparison operators: ==, !=, >, <, >=, <=, contains
- Logical operators: && (and), || (or)
- Value literals: numbers (42), strings ('active'), booleans (true/false), null
- Example boolean: {{status}} == 'active' && {{score}} > 80
- Example value: {{steps.node-101.tier}}

Available variables for this node:
${varList}

Output format — EXACTLY two lines, no markdown, no prose:
Line 1: the expression
Line 2: plain-English explanation of what it checks (≤15 words)

${expressionType === "boolean" ? "The expression must evaluate to true or false." : "The expression resolves to any value (string, number, boolean, etc.)."}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const lines = raw.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const expression = lines[0] ?? "";
    const explanation = lines[1] ?? "";

    if (!expression) {
      res.status(500).json({ error: "AI returned an empty expression" });
      return;
    }

    req.log.info({ userPrompt, expressionType }, "expression-helper: expression generated");
    res.json({ ok: true, expression, explanation });
  } catch (err) {
    req.log.error({ err }, "expression-helper: AI call failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Expression helper failed" });
  }
});

// ── Sound synthesiser ─────────────────────────────────────────────────────────
// POST /api/admin/workflows/synthesise-sound
// Calls Claude to produce Web Audio API parameters from a natural-language
// description. Returns JSON parameters — no audio binary is generated
// server-side; the browser synthesises sound from the params.

const SYNTHESISE_SOUND_SCHEMA = z.object({
  description: z.string().min(1).max(500),
});

router.post("/admin/workflows/synthesise-sound", requireAdmin, async (req: Request, res: Response) => {
  const parsed = SYNTHESISE_SOUND_SCHEMA.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "description is required (1–500 chars)" });
    return;
  }

  const { description } = parsed.data;

  const systemPrompt = `You are an audio design assistant that converts moment descriptions into Web Audio API synthesis parameters.
Return ONLY valid JSON matching this exact schema — no prose, no markdown fences:
{
  "waveform": "sine" | "square" | "sawtooth" | "triangle",
  "notes": [{ "frequency": number, "startTime": number, "duration": number, "gain": number }],
  "totalDuration": number,
  "envelope": { "attack": number, "decay": number, "sustain": number, "release": number }
}
Rules:
- frequency in Hz (e.g. 440 = A4). Use musically meaningful pitches.
- startTime and duration in seconds. totalDuration should equal the natural end of the last note + its duration + release.
- gain per note: 0.0–1.0.
- envelope times in seconds; release should be short (0.1–0.5 s).
- Keep totalDuration ≤ 3.0 seconds.
- For success/positive: use ascending notes, sine waveform, gentle gain.
- For error/warning: use descending notes or dissonant interval, square or sawtooth waveform, stronger gain.
- For alert/ping: single note, brief duration.
- For celebration/fanfare: 3–5 ascending notes, triangle waveform.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: `Generate sound parameters for: "${description}"` }],
    });

    const raw = message.content[0]?.type === "text" ? message.content[0].text : "";

    let params: Record<string, unknown> | null = null;
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) {
      try { params = JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>; } catch { }
    }
    if (!params) {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { params = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>; } catch { }
      }
    }

    if (!params) {
      req.log.warn({ raw }, "synthesise-sound: AI returned non-JSON response");
      res.status(500).json({ error: "AI returned unexpected format" });
      return;
    }

    req.log.info({ description }, "synthesise-sound: parameters generated");
    res.json({ ok: true, params });
  } catch (err) {
    req.log.error({ err }, "synthesise-sound: AI call failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Sound synthesis failed" });
  }
});

export default router;


