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
  wfNodeOutputSamplesTable,
  wfTriggersTable,
  wfTriggerEventsTable,
  pendingApprovalsTable,
  type WfGraph,
} from "@workspace/db";
import { STATIC_NODE_SAMPLES, DYNAMIC_SHAPE_NODE_TYPES } from "../lib/workflow-node-default-samples";
import { eq, and, desc, asc, count, sql, gte, lte, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "workflow.run" });
import { fireWorkflowForDefinition, computeNextCronRun, executeWorkflowRun, resumeWorkflowRun } from "../lib/workflow-executor";
import { registerAdminWorkflowEventClient } from "../lib/sse-channels";
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
    graph: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }).optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);

  const defaultGraph = {
    nodes: [{
      id: "node-1",
      type: "start",
      position: { x: 300, y: 100 },
      data: { nodeType: "start", label: "Start" },
    }],
    edges: [] as unknown[],
  };

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
      graph: body.data.graph ?? defaultGraph,
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
    description: z.string().max(2000).nullable().optional(),
    owner: z.string().max(200).nullable().optional(),
    tags: z.array(z.string().max(50)).max(20).nullable().optional(),
    riskLevel: z.enum(["low", "medium", "high"]).nullable().optional(),
  }).safeParse(req.body);
  if (!body.success) return sendError(res, 400, body.error.message);
  const hasAnyField = Object.values(body.data).some(v => v !== undefined);
  if (!hasAnyField) return sendError(res, 400, "Nothing to update");

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

    const metaFields: Array<"category" | "description" | "owner" | "tags" | "riskLevel"> = ["category", "description", "owner", "tags", "riskLevel"];
    const anyMetaField = metaFields.some(f => body.data[f] !== undefined);

    if (anyMetaField) {
      const merged: Record<string, unknown> = { ...(existing.metadata ?? {}) };
      for (const field of metaFields) {
        const val = body.data[field];
        if (val === undefined) continue;
        if (val === null || val === "") {
          delete merged[field];
        } else {
          merged[field] = val;
        }
      }
      updateFields.metadata = merged;
    }

    if (body.data.name) {
      updateFields.name = body.data.name;
    }

    // description lives in two places: the canonical top-level column (read by workflow
    // list cards and other screens) AND metadata.description (read by the Metadata panel).
    // Keep both in sync when the caller supplies a description value.
    type UpdateFieldsWithDesc = UpdateFields & { description?: string | null };
    const updateFieldsExt = updateFields as UpdateFieldsWithDesc;
    if (body.data.description !== undefined) {
      updateFieldsExt.description = body.data.description ?? null;
    }

    const [updated] = await db
      .update(wfDefinitionsTable)
      .set(updateFieldsExt)
      .where(eq(wfDefinitionsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    log.error({ err }, "Failed to patch definition");
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
      .select({
        id: wfVersionsTable.id,
        definitionId: wfVersionsTable.definitionId,
        versionNumber: wfVersionsTable.versionNumber,
        label: wfVersionsTable.label,
        status: wfVersionsTable.status,
        graph: wfVersionsTable.graph,
        isDefault: wfVersionsTable.isDefault,
        createdAt: wfVersionsTable.createdAt,
        updatedAt: wfVersionsTable.updatedAt,
        runCount: sql<number>`(SELECT COUNT(*) FROM wf_runs WHERE wf_runs.version_id = ${wfVersionsTable.id})::int`,
      })
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
    healthScore: z.number().int().min(0).max(100).optional(),
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

      // Persist health score to definition metadata when provided
      if (body.data.healthScore !== undefined) {
        const [defRow] = await db.select({ metadata: wfDefinitionsTable.metadata }).from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, defId)).limit(1);
        const existingMeta = (defRow?.metadata ?? {}) as Record<string, unknown>;
        await db.update(wfDefinitionsTable).set({ metadata: { ...existingMeta, healthScore: body.data.healthScore }, updatedAt: new Date() }).where(eq(wfDefinitionsTable.id, defId));
      }

      return res.status(201).json({ ...newDraft, autoDraftedFrom: existing.id });
    }

    const [updated] = await db
      .update(wfVersionsTable)
      .set({ graph: (body.data.graph as WfGraph) ?? existing.graph, label: body.data.label ?? existing.label, updatedAt: new Date() })
      .where(eq(wfVersionsTable.id, vid))
      .returning();

    // Persist health score to definition metadata when provided
    if (body.data.healthScore !== undefined) {
      const [defRow] = await db.select({ metadata: wfDefinitionsTable.metadata }).from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, defId)).limit(1);
      const existingMeta = (defRow?.metadata ?? {}) as Record<string, unknown>;
      await db.update(wfDefinitionsTable).set({ metadata: { ...existingMeta, healthScore: body.data.healthScore }, updatedAt: new Date() }).where(eq(wfDefinitionsTable.id, defId));
    }

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
    // Archive-old + publish-new run in a single transaction so the two updates
    // are atomic — otherwise a concurrent read (e.g. run_workflow resolving
    // the "published" version for this definition) could observe zero or two
    // published rows mid-flight and pick a stale version.
    const published = await db.transaction(async (tx) => {
      await tx
        .update(wfVersionsTable)
        .set({ status: "archived" })
        .where(and(eq(wfVersionsTable.definitionId, defId), eq(wfVersionsTable.status, "published")));

      const [row] = await tx
        .update(wfVersionsTable)
        .set({ status: "published", label: body.success ? (body.data.label ?? undefined) : undefined, updatedAt: new Date() })
        .where(eq(wfVersionsTable.id, vid))
        .returning();
      return row;
    });

    if (!published) return sendError(res, 404, "Version not found");
    res.json(published);
  } catch (err) {
    sendError(res, 500, "Failed to publish version");
  }
});

// ── Node Output Samples ────────────────────────────────────────────────────────
// Returns captured output samples for every node in a definition, merged with
// static hand-authored defaults for fixed-shape node types.
// Used by the Config Panel variable-picker so it shows real sample keys.
//
// GET  /api/admin/workflows/definitions/:id/node-output-samples
//   → { samples: { [nodeId]: { nodeType, sample, capturedAt, sourceRunId } } }
//
// POST /api/admin/workflows/definitions/:id/node-output-samples/seed-defaults
//   → seeds static default samples for every node in the latest version graph
//     whose type matches a fixed-shape entry in STATIC_NODE_SAMPLES.

router.get("/admin/workflows/definitions/:id/node-output-samples", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  try {
    const rows = await db
      .select()
      .from(wfNodeOutputSamplesTable)
      .where(eq(wfNodeOutputSamplesTable.definitionId, defId));

    // Key by nodeId for easy client-side lookup
    const byNodeId: Record<string, {
      nodeType: string;
      sample: Record<string, unknown>;
      capturedAt: Date;
      sourceRunId: number | null;
    }> = {};

    for (const row of rows) {
      byNodeId[row.nodeId] = {
        nodeType: row.nodeType,
        sample: row.sample,
        capturedAt: row.capturedAt,
        sourceRunId: row.sourceRunId,
      };
    }

    res.json({ samples: byNodeId });
  } catch (err) {
    req.log.error({ err }, "node-output-samples: fetch failed");
    sendError(res, 500, "Failed to fetch node output samples");
  }
});

router.post("/admin/workflows/definitions/:id/node-output-samples/seed-defaults", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  if (isNaN(defId)) return sendError(res, 400, "Invalid id");

  try {
    // Load the latest version graph to find all node IDs and types
    const [latestVersion] = await db
      .select({ graph: wfVersionsTable.graph })
      .from(wfVersionsTable)
      .where(eq(wfVersionsTable.definitionId, defId))
      .orderBy(desc(wfVersionsTable.versionNumber))
      .limit(1);

    if (!latestVersion) return sendError(res, 404, "No version found");

    const graph = latestVersion.graph as { nodes?: Array<{ id: string; type: string; data?: Record<string, unknown> }> };
    const nodes = graph.nodes ?? [];

    // Collect nodes that have a static default sample
    const seeded: string[] = [];
    const skipped: string[] = [];

    for (const node of nodes) {
      const resolvedType = (node.data?.actionType as string | undefined) ?? node.type;
      const staticSample = STATIC_NODE_SAMPLES[resolvedType];

      if (!staticSample) {
        skipped.push(node.id);
        continue;
      }

      // Only insert if no captured sample already exists (don't overwrite real runs)
      await db
        .insert(wfNodeOutputSamplesTable)
        .values({
          definitionId: defId,
          nodeId: node.id,
          nodeType: resolvedType,
          sample: staticSample,
          capturedAt: new Date(),
          sourceRunId: null,
        })
        .onConflictDoNothing()
        .catch(() => { /* non-fatal */ });

      seeded.push(node.id);
    }

    req.log.info({ defId, seeded: seeded.length, skipped: skipped.length }, "node-output-samples: seeded defaults");
    res.json({ seeded: seeded.length, skipped: skipped.length, seededNodeIds: seeded });
  } catch (err) {
    req.log.error({ err }, "node-output-samples: seed-defaults failed");
    sendError(res, 500, "Failed to seed default samples");
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
  const defId = parseInt(req.params.id as string);
  const tid = parseInt(req.params.tid as string);
  if (isNaN(defId) || isNaN(tid)) return sendError(res, 400, "Invalid id");

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
      .where(and(eq(wfTriggersTable.id, tid), eq(wfTriggersTable.definitionId, defId)))
      .returning();
    if (!updated) return sendError(res, 404, "Not found");
    res.json(updated);
  } catch (err) {
    sendError(res, 500, "Failed to update trigger");
  }
});

router.delete("/admin/workflows/definitions/:id/triggers/:tid", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  const tid = parseInt(req.params.tid as string);
  if (isNaN(defId) || isNaN(tid)) return sendError(res, 400, "Invalid id");
  try {
    const result = await db.delete(wfTriggersTable).where(and(eq(wfTriggersTable.id, tid), eq(wfTriggersTable.definitionId, defId))).returning({ id: wfTriggersTable.id });
    if (!result.length) return sendError(res, 404, "Not found");
    res.status(204).end();
  } catch (err) {
    sendError(res, 500, "Failed to delete trigger");
  }
});

// ── Trigger activity summary (all definitions, today) ────────────────────────
// Returns today's trigger-event counts aggregated per workflow definition so
// the workflow list page can show "N runs today" badges without N+1 queries.

router.get("/admin/workflows/trigger-activity-summary", requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows = await db.execute<{
      definition_id: number;
      today_count: number;
      last_fired_at: string | null;
    }>(sql`
      SELECT
        t.definition_id,
        COUNT(te.id)::int AS today_count,
        MAX(te.fired_at)  AS last_fired_at
      FROM wf_triggers t
      LEFT JOIN wf_trigger_events te
        ON  te.trigger_id = t.id
        AND te.fired_at  >= date_trunc('day', now() AT TIME ZONE 'UTC')
      GROUP BY t.definition_id
    `);
    res.json(rows.rows.map(r => ({
      definitionId: Number(r.definition_id),
      todayCount:   Number(r.today_count),
      lastFiredAt:  r.last_fired_at ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "workflows: trigger-activity-summary failed");
    sendError(res, 500, "Failed to fetch trigger activity summary");
  }
});

// ── Trigger event history ─────────────────────────────────────────────────────

router.get("/admin/workflows/definitions/:id/triggers/:tid/events", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  const tid = parseInt(req.params.tid as string);
  if (isNaN(defId) || isNaN(tid)) return sendError(res, 400, "Invalid id");
  const limit = Math.min(parseInt(req.query.limit as string || "50", 10), 200);
  try {
    // Verify trigger belongs to this definition
    const [trigger] = await db.select({ id: wfTriggersTable.id }).from(wfTriggersTable)
      .where(and(eq(wfTriggersTable.id, tid), eq(wfTriggersTable.definitionId, defId))).limit(1);
    if (!trigger) return sendError(res, 404, "Trigger not found");
    const events = await db
      .select()
      .from(wfTriggerEventsTable)
      .where(eq(wfTriggerEventsTable.triggerId, tid))
      .orderBy(desc(wfTriggerEventsTable.firedAt))
      .limit(limit);
    res.json(events);
  } catch (err) {
    sendError(res, 500, "Failed to fetch events");
  }
});

router.get("/admin/workflows/definitions/:id/triggers/:tid/stats", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  const tid = parseInt(req.params.tid as string);
  if (isNaN(defId) || isNaN(tid)) return sendError(res, 400, "Invalid id");
  try {
    // Verify trigger belongs to this definition
    const [trigger] = await db.select({ id: wfTriggersTable.id }).from(wfTriggersTable)
      .where(and(eq(wfTriggersTable.id, tid), eq(wfTriggersTable.definitionId, defId))).limit(1);
    if (!trigger) return sendError(res, 404, "Trigger not found");
    // Last 30 days bucket counts
    const buckets = await db.execute(sql`
      SELECT
        date_trunc('day', fired_at) AS day,
        COUNT(*)::int AS total,
        SUM(CASE WHEN status = 'fired' THEN 1 ELSE 0 END)::int AS fired,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errors
      FROM wf_trigger_events
      WHERE trigger_id = ${tid}
        AND fired_at >= now() - interval '30 days'
      GROUP BY 1
      ORDER BY 1
    `);
    const [agg] = await db
      .select({
        total: count(),
        avgDurationMs: sql<number>`AVG(duration_ms)::int`,
      })
      .from(wfTriggerEventsTable)
      .where(eq(wfTriggerEventsTable.triggerId, tid));
    const [latest] = await db
      .select()
      .from(wfTriggerEventsTable)
      .where(eq(wfTriggerEventsTable.triggerId, tid))
      .orderBy(desc(wfTriggerEventsTable.firedAt))
      .limit(1);
    res.json({
      total: Number(agg?.total ?? 0),
      avgDurationMs: agg?.avgDurationMs ?? null,
      lastFiredAt: latest?.firedAt ?? null,
      lastStatus: latest?.status ?? null,
      dailyBuckets: (buckets.rows as Array<{ day: Date; total: number; fired: number; errors: number }>).map(r => ({
        day: r.day,
        total: Number(r.total),
        fired: Number(r.fired),
        errors: Number(r.errors),
      })),
    });
  } catch (err) {
    sendError(res, 500, "Failed to fetch stats");
  }
});

// Test-fire a trigger — creates a manual run and records a trigger event
router.post("/admin/workflows/definitions/:id/triggers/:tid/test-fire", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(req.params.id as string);
  const tid = parseInt(req.params.tid as string);
  if (isNaN(defId) || isNaN(tid)) return sendError(res, 400, "Invalid id");
  try {
    const [trigger] = await db
      .select()
      .from(wfTriggersTable)
      .where(and(eq(wfTriggersTable.id, tid), eq(wfTriggersTable.definitionId, defId)))
      .limit(1);
    if (!trigger) return sendError(res, 404, "Trigger not found");
    const t0 = Date.now();
    const runId = await fireWorkflowForDefinition(defId, "manual", `trigger:test:${tid}`, req.body?.payload ?? {});
    const durationMs = Date.now() - t0;
    const [evt] = await db.insert(wfTriggerEventsTable).values({
      triggerId: tid,
      runId: runId ?? undefined,
      status: runId ? "fired" : "skipped",
      durationMs,
      payload: req.body?.payload ?? {},
    }).returning();
    res.json({ runId, eventId: evt.id });
  } catch (err) {
    await db.insert(wfTriggerEventsTable).values({
      triggerId: tid,
      status: "error",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    }).catch(() => {});
    sendError(res, 500, "Failed to test-fire trigger");
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
        log.warn({ err, runId }, "workflows: draft test-run execution failed (non-fatal)");
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

    // Build per-node result map with server-computed log_preview (first 120 chars of last log line)
    const logsByNode: Record<string, string[]> = {};
    for (const l of logs) {
      if (!logsByNode[l.nodeId]) logsByNode[l.nodeId] = [];
      logsByNode[l.nodeId].push(l.message);
    }
    const nodeResultMap: Record<string, {
      status: "ok" | "error" | "skipped";
      durationMs: number | null;
      errorMessage: string | null;
      logPreview: string | null;
      input: Record<string, unknown> | null;
      output: Record<string, unknown> | null;
    }> = {};
    for (const o of nodeOutputs) {
      const rawStatus = o.status as string;
      const s: "ok" | "error" | "skipped" = (rawStatus === "success" || rawStatus === "ok") ? "ok" : rawStatus === "skipped" ? "skipped" : "error";
      const nodeLogs = logsByNode[o.nodeId] ?? [];
      const lastLogMsg = nodeLogs[nodeLogs.length - 1] ?? null;
      const entry = {
        status: s,
        durationMs: o.durationMs,
        errorMessage: o.errorMessage,
        logPreview: lastLogMsg ? lastLogMsg.slice(0, 120) : null,
        input: (o.input as Record<string, unknown> | null) ?? null,
        output: (o.output as Record<string, unknown> | null) ?? null,
      };
      // For nodes that run multiple times (e.g. inside a For loop body), the plain
      // nodeId record is written once per iteration. Always keep the FIRST occurrence
      // so the canvas shows iteration-[0] data, which is consistent with the For
      // node's forItems[0] display. Indexed records (node-104[0], node-104[1], …)
      // are preserved separately and provide full per-iteration detail in the viewer.
      if (!nodeResultMap[o.nodeId]) {
        nodeResultMap[o.nodeId] = entry;
      } else if (o.nodeId.includes("[")) {
        // Always store indexed records (e.g. node-104[1]) — they never clash.
        nodeResultMap[o.nodeId] = entry;
      }
    }

    res.json({
      ...row.run,
      definitionName: row.defName,
      versionLabel: row.versionLabel,
      versionNumber: row.versionNumber,
      graph: row.graph,
      logs,
      nodeOutputs,
      nodeResultMap,
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

    // Archive-old + publish-new in a single transaction (see publish endpoint
    // above for why this must be atomic).
    const published = await db.transaction(async (tx) => {
      await tx
        .update(wfVersionsTable)
        .set({ status: "archived" })
        .where(and(eq(wfVersionsTable.definitionId, defId), eq(wfVersionsTable.status, "published")));

      const [row] = await tx
        .update(wfVersionsTable)
        .set({ status: "published" })
        .where(eq(wfVersionsTable.id, v1.id))
        .returning();
      return row;
    });

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
          log.warn({ err, runId: approval.runId }, "pending-approvals: resume failed (non-fatal)");
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

    const t0 = Date.now();
    const runId = await fireWorkflowForDefinition(
      trigger.definitionId,
      "webhook",
      `webhook:${trigger.id}`,
      req.body ?? {},
    );
    const durationMs = Date.now() - t0;

    // Record trigger event for observability
    await db.insert(wfTriggerEventsTable).values({
      triggerId: trigger.id,
      runId: runId ?? undefined,
      status: runId ? "fired" : "skipped",
      payload: req.body ?? {},
      durationMs,
    }).catch((err: unknown) => { req.log.warn({ err, triggerId: trigger.id }, "wf-engine: failed to record webhook trigger event (non-fatal)"); });

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
      // Archive-then-insert must be atomic: otherwise a query resolving "the
      // published version" for this definition (e.g. event-triggered runs)
      // can observe zero or two rows with status='published' mid-flight and
      // pick a stale one. Every prior publish-to-prod call for this
      // definition leaves its version row behind, so any other row still
      // marked "published" for this definitionId must be archived first.
      await prodDb.transaction(async (tx) => {
        await tx
          .update(wfVersionsTable)
          .set({ status: "archived" })
          .where(and(
            eq(wfVersionsTable.definitionId, def.id),
            eq(wfVersionsTable.status, "published"),
          ));

        await tx
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


// ── Execution Trend Data ──────────────────────────────────────────────────────

router.get("/admin/workflows/definitions/:id/trends", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(defId)) { sendError(res, 400, "Invalid definition ID"); return; }

  const days = Math.min(90, Math.max(1, parseInt((req.query.days as string) ?? "30", 10) || 30));

  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const dailyRows = await pool.query<{
      day: string;
      total: string;
      success: string;
      failure: string;
      avg_ms: string | null;
    }>(`
      SELECT
        date_trunc('day', started_at)::date::text AS day,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::text AS success,
        COUNT(*) FILTER (WHERE status = 'failed')::text AS failure,
        AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::text AS avg_ms
      FROM wf_runs
      WHERE definition_id = $1
        AND started_at >= $2
      GROUP BY date_trunc('day', started_at)
      ORDER BY date_trunc('day', started_at)
    `, [defId, cutoff]);

    const failingNodesRows = await pool.query<{ node_id: string; fail_count: string }>(`
      SELECT
        nout.node_id,
        COUNT(*)::text AS fail_count
      FROM wf_run_node_outputs nout
      JOIN wf_runs r ON r.id = nout.run_id
      WHERE r.definition_id = $1
        AND r.started_at >= $2
        AND nout.status = 'error'
      GROUP BY nout.node_id
      ORDER BY fail_count DESC
      LIMIT 3
    `, [defId, cutoff]);

    const p50p95Rows = await pool.query<{
      day: string;
      p50_ms: string | null;
      p95_ms: string | null;
    }>(`
      SELECT
        date_trunc('day', r.started_at)::date::text AS day,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY nout.duration_ms)::text AS p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY nout.duration_ms)::text AS p95_ms
      FROM wf_run_node_outputs nout
      JOIN wf_runs r ON r.id = nout.run_id
      WHERE r.definition_id = $1
        AND r.started_at >= $2
        AND nout.duration_ms IS NOT NULL
      GROUP BY date_trunc('day', r.started_at)
      ORDER BY date_trunc('day', r.started_at)
    `, [defId, cutoff]);

    res.json({
      daily: dailyRows.rows.map(r => ({
        day: r.day,
        total: parseInt(r.total, 10),
        success: parseInt(r.success, 10),
        failure: parseInt(r.failure, 10),
        avgMs: r.avg_ms ? Math.round(parseFloat(r.avg_ms)) : null,
      })),
      durations: p50p95Rows.rows.map(r => ({
        day: r.day,
        p50Ms: r.p50_ms ? Math.round(parseFloat(r.p50_ms)) : null,
        p95Ms: r.p95_ms ? Math.round(parseFloat(r.p95_ms)) : null,
      })),
      topFailingNodes: failingNodesRows.rows.map(r => ({
        nodeId: r.node_id,
        failCount: parseInt(r.fail_count, 10),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "trends: query failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

// ── Export a single workflow definition ───────────────────────────────────────

router.get("/admin/workflows/definitions/:id/export", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(defId)) { sendError(res, 400, "Invalid definition ID"); return; }
  try {
    const def = await db.query.wfDefinitionsTable.findFirst({ where: eq(wfDefinitionsTable.id, defId) });
    if (!def) { sendError(res, 404, "Workflow not found"); return; }

    const latestVersion = await db.query.wfVersionsTable.findFirst({
      where: eq(wfVersionsTable.definitionId, defId),
      orderBy: [desc(wfVersionsTable.createdAt)],
    });

    const graph = latestVersion?.graph ?? { nodes: [], edges: [] };
    // Derive askForInputFields from the graph (same as the list endpoint)
    const askForInputNode = (graph.nodes ?? []).find((n: { type?: string }) => n.type === "ask_for_input");
    const askForInputFields = (askForInputNode as { data?: { fields?: unknown[] } } | undefined)?.data?.fields ?? [];
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      workflow: {
        name: def.name,
        description: def.description,
        category: def.metadata?.category ?? null,
        concurrencyLimit: def.concurrencyLimit,
        askForInputFields,
        graph,
      },
    };

    const safeName = def.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.wf.json"`);
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "export workflow: query failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Export failed" });
  }
});

// Alias: /admin/workflows/:id/export (same handler as definitions/:id/export above)
router.get("/admin/workflows/:id/export", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(defId)) { sendError(res, 400, "Invalid definition ID"); return; }
  try {
    const def = await db.query.wfDefinitionsTable.findFirst({ where: eq(wfDefinitionsTable.id, defId) });
    if (!def) { sendError(res, 404, "Workflow not found"); return; }

    const latestVersion = await db.query.wfVersionsTable.findFirst({
      where: eq(wfVersionsTable.definitionId, defId),
      orderBy: [desc(wfVersionsTable.createdAt)],
    });

    const graph = latestVersion?.graph ?? { nodes: [], edges: [] };
    const askForInputNode = (graph.nodes ?? []).find((n: { type?: string }) => n.type === "ask_for_input");
    const askForInputFields = (askForInputNode as { data?: { fields?: unknown[] } } | undefined)?.data?.fields ?? [];
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      workflow: {
        name: def.name,
        description: def.description,
        category: def.metadata?.category ?? null,
        concurrencyLimit: def.concurrencyLimit,
        askForInputFields,
        graph,
      },
    };
    const safeName = def.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.wf.json"`);
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "export workflow (alias): query failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Export failed" });
  }
});

// ── Import a workflow from exported JSON ──────────────────────────────────────

router.post("/admin/workflows/import", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { version?: number; workflow?: Record<string, unknown>; name?: string };
    if (body.version !== undefined && body.version !== 1) {
      sendError(res, 400, `Unsupported export version: ${body.version}. Only version 1 is supported.`); return;
    }
    const wf = body.workflow;
    if (!wf || typeof wf !== "object") {
      sendError(res, 400, "Body must contain a 'workflow' object"); return;
    }
    const name = String(body.name ?? wf.name ?? "Imported Workflow").trim() || "Imported Workflow";
    const description = wf.description ? String(wf.description) : undefined;
    const rawGraph = (wf.graph && typeof wf.graph === "object") ? wf.graph as WfGraph : { nodes: [], edges: [] };
    const concurrencyLimit = typeof wf.concurrencyLimit === "number" ? wf.concurrencyLimit : 5;
    const category = wf.category ? String(wf.category) : undefined;

    const [newDef] = await db.insert(wfDefinitionsTable).values({
      name,
      description,
      concurrencyLimit,
      metadata: category ? { category } : {},
    }).returning();

    const [newVersion] = await db.insert(wfVersionsTable).values({
      definitionId: newDef.id,
      graph: rawGraph,
      label: "v1.0",
      status: "draft",
    }).returning();

    req.log.info({ defId: newDef.id, versionId: newVersion.id }, "import workflow: created");
    res.status(201).json({ id: newDef.id, draftVersionId: newVersion.id, name: newDef.name });
  } catch (err) {
    req.log.error({ err }, "import workflow: failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

// ── Node catalog — AI-readable reference of all workflow node types ────────────

// Helper to build a NodeDef entry for the flat `nodes` array.
// `params[].key` is the field name used in node.data.
// `outputs` accepts strings for brevity and is automatically shaped as { key, type, description }
// objects in the returned record, matching the NodeDef contract for AI consumers.
// `sourceHandles` are the labelled handles on graph edges.
function nodeDef(
  type: string,
  label: string,
  category: string,
  description: string,
  params: Array<{ key: string; type: string; description: string; required?: boolean }>,
  outputs: string[],
  sourceHandles: string[],
) {
  return {
    type,
    label,
    category,
    description,
    params,
    outputs: outputs.map(key => ({
      key,
      type: "string",
      description: `The ${key} value emitted by this node into steps.<nodeId>.${key}.`,
    })),
    sourceHandles,
  };
}

const FLAT_NODES = [
  // ── Trigger / Control ──────────────────────────────────────────────────────
  nodeDef("start", "Start", "Trigger / Control", "Entry point of every workflow. Receives the initial trigger payload and makes it available downstream via {{steps.<startId>.*}}. Every workflow must have exactly one start node.", [], ["payload", "triggeredAt", "triggerType"], ["default"]),
  nodeDef("end", "End", "Trigger / Control", "Terminates the workflow run. Optionally surfaces a customerError message in the MSP Portal when the run ends in failure.", [{ key: "customerError", type: "string", description: "Error message shown to the client when the run fails." }], [], []),
  nodeDef("condition", "Condition", "Trigger / Control", "Evaluates a JavaScript expression and routes execution to the 'true' or 'false' handle.", [{ key: "expression", type: "string", required: true, description: "JS expression (e.g. '{{steps.n1.count}} > 0'). Must evaluate to truthy/falsy." }], ["result"], ["true", "false"]),
  nodeDef("foreach", "For Each", "Trigger / Control", "Iterates over an array, executing the 'body' branch once per item, then continues via 'done'.", [{ key: "arrayPath", type: "string", required: true, description: "Template resolving to an array (e.g. '{{steps.n1.items}}')." }, { key: "itemAlias", type: "string", required: true, description: "Variable name for the current item inside the loop (e.g. 'task')." }], ["item", "index", "length"], ["body", "done"]),
  nodeDef("for", "For (Counted Loop)", "Trigger / Control", "Executes the 'body' branch a fixed number of times, then continues via 'done'.", [{ key: "count", type: "number", required: true, description: "Number of iterations." }, { key: "indexAlias", type: "string", description: "Variable name for the current 0-based index (default: 'index')." }], ["index"], ["body", "done"]),
  nodeDef("wait_for_event", "Wait for Event", "Trigger / Control", "Pauses the run until a named event arrives on the event bus, then resumes with the event payload.", [{ key: "eventName", type: "string", required: true, description: "Event bus event name to wait for." }, { key: "timeoutHours", type: "number", description: "Hours before timing out (resumes via 'timeout' handle)." }], ["eventPayload", "timedOut"], ["received", "timeout"]),
  nodeDef("delay", "Delay", "Trigger / Control", "Pauses execution for a fixed number of minutes.", [{ key: "delayMinutes", type: "number", required: true, description: "Minutes to pause." }], [], ["default"]),
  nodeDef("run_workflow", "Run Workflow", "Trigger / Control", "Triggers a child workflow by definition ID, optionally injecting variables and waiting for it to complete.", [{ key: "definitionId", type: "number", required: true, description: "Child workflow definition ID." }, { key: "inputMapping", type: "object", description: "Key-value map of variables passed into the child payload." }, { key: "waitForCompletion", type: "boolean", description: "If true, blocks until the child run finishes (default: false)." }], ["childRunId", "childStatus"], ["default"]),
  nodeDef("parallel", "Parallel", "Trigger / Control", "Executes up to four branches concurrently and optionally waits for all to complete.", [{ key: "waitAll", type: "boolean", description: "If true (default), blocks until all connected branches finish." }], ["branch_1", "branch_2", "branch_3", "branch_4"], ["branch_1", "branch_2", "branch_3", "branch_4"]),
  nodeDef("join", "Join", "Trigger / Control", "Waits for all inbound parallel branches to complete before continuing.", [], ["joined"], ["default"]),
  nodeDef("retry", "Retry", "Trigger / Control", "Wraps a sub-graph and re-executes it up to maxAttempts times on failure before continuing via 'exhausted'.", [{ key: "maxAttempts", type: "number", required: true, description: "Maximum number of attempts (including the first)." }, { key: "delaySeconds", type: "number", description: "Seconds to wait between retries (default: 0)." }], ["attempt", "lastError"], ["body", "exhausted"]),
  nodeDef("switch_case", "Switch / Case", "Trigger / Control", "Routes execution to one of several case handles based on matching an expression value. Source handles are dynamic: one handle per case entry using the case's 'id' field (e.g. 'case-0', 'case-1') plus a 'default' handle for unmatched values.", [{ key: "expression", type: "string", required: true, description: "Template expression to evaluate (its string value is matched against case values)." }, { key: "cases", type: "array", required: true, description: "Array of { id, value, label } case descriptors. A 'default' case is always present." }], ["matchedCase", "matchedId"], ["case", "default"]),
  nodeDef("approval_gate", "Approval Gate", "Trigger / Control", "Pauses the run and waits for a manual admin approval before continuing.", [{ key: "message", type: "string", description: "Optional message shown to the admin in the approval UI." }, { key: "timeoutHours", type: "number", description: "Hours before auto-rejecting if no response is received." }], ["approved", "rejectedBy"], ["approved", "rejected"]),
  nodeDef("emit_event", "Emit Event", "Trigger / Control", "Fires a named event onto the internal event bus for other workflows (or wait_for_event nodes) to receive.", [{ key: "eventName", type: "string", required: true, description: "Event name to emit." }, { key: "payload", type: "object", description: "Data to include with the event." }], ["eventName"], ["default"]),
  nodeDef("cancel_workflow", "Cancel Workflow", "Trigger / Control", "Immediately cancels the current workflow run.", [{ key: "reason", type: "string", description: "Reason for cancellation (stored in the run record)." }], [], []),
  nodeDef("ask_for_input", "Ask for Input", "Trigger / Control", "Presents an input form before run start. Collected values are available as {{variableName}} downstream.", [{ key: "fields", type: "array", required: true, description: "Array of field descriptors: { variableName, label, type, required?, options?, multi? }." }], ["collectedFields"], ["default"]),
  // ── Communication ─────────────────────────────────────────────────────────
  nodeDef("send_email", "Send Email", "Communication", "Sends a transactional email via Resend using a named DB-stored template.", [{ key: "templateName", type: "string", required: true, description: "Name of the DB email template." }, { key: "to", type: "string", required: true, description: "Recipient address. Supports templates." }, { key: "subject", type: "string", description: "Subject line override." }, { key: "variables", type: "object", description: "Template variable map." }], ["messageId", "sent"], ["default"]),
  nodeDef("send_sms", "Send SMS", "Communication", "Sends an SMS via Twilio.", [{ key: "to", type: "string", required: true, description: "E.164 phone number (e.g. +12025551234)." }, { key: "body", type: "string", required: true, description: "SMS body. Supports templates." }], ["sid", "sent"], ["default"]),
  nodeDef("create_notification", "Create Notification", "Communication", "Creates an in-app notification and optionally delivers a browser push to subscribed admins.", [{ key: "title", type: "string", required: true, description: "Notification title." }, { key: "message", type: "string", required: true, description: "Notification body." }, { key: "type", type: "string", description: "Category: info | warning | success | error." }, { key: "sendPush", type: "boolean", description: "If true, also sends a browser push." }], ["notificationCount"], ["default"]),
  nodeDef("send_browser_notification", "Send Browser Notification", "Communication", "Sends a browser notification to the admin panel.", [{ key: "title", type: "string", required: true, description: "Notification title." }, { key: "body", type: "string", required: true, description: "Notification body." }], ["notificationSent"], ["default"]),
  nodeDef("send_mobile_push", "Send Mobile Push", "Communication", "Sends a push notification to mobile app subscribers.", [{ key: "title", type: "string", required: true, description: "Push title." }, { key: "body", type: "string", required: true, description: "Push body." }], ["sent", "sentCount"], ["default"]),
  nodeDef("play_sound", "Play Sound", "Communication", "Plays a sound in the admin browser (notification chime, alert, etc.).", [{ key: "sound", type: "string", required: true, description: "Sound preset name or URL." }], ["soundPlayed"], ["default"]),
  nodeDef("send_campaign_email", "Send Campaign Email", "Communication", "Sends a campaign email to a recipient using a template or direct content.", [{ key: "to", type: "string", required: true, description: "Recipient email." }, { key: "subject", type: "string", required: true, description: "Email subject." }, { key: "templateSlug", type: "string", description: "Template slug if using a named template." }], ["sent", "recipient", "subject", "templateSlug"], ["default"]),
  nodeDef("post_linkedin", "Post to LinkedIn", "Communication", "Posts an organisation post to LinkedIn (text-only).", [{ key: "text", type: "string", required: true, description: "Post body. Supports templates." }, { key: "orgId", type: "string", description: "LinkedIn org ID. Falls back to LINKEDIN_ORG_ID secret." }], ["linkedinPostId", "linkedinPostUrl"], ["default"]),
  nodeDef("post_twitter", "Post to Twitter / X", "Communication", "Posts a tweet via OAuth 1.0a (max 280 chars).", [{ key: "text", type: "string", required: true, description: "Tweet text. Supports templates." }], ["twitterTweetId", "twitterTweetUrl"], ["default"]),
  nodeDef("post_facebook", "Post to Facebook", "Communication", "Posts to a Facebook Page feed (text-only).", [{ key: "message", type: "string", required: true, description: "Post text. Supports templates." }, { key: "pageId", type: "string", description: "Facebook Page ID. Falls back to FACEBOOK_PAGE_ID secret." }], ["facebookPostId", "facebookPostUrl"], ["default"]),
  // ── AI / Documents ────────────────────────────────────────────────────────
  nodeDef("ask_ai", "Ask AI", "AI / Documents", "Calls Claude AI with a freeform prompt and returns the AI-generated text.", [{ key: "prompt", type: "string", required: true, description: "System or user prompt. Supports templates." }, { key: "model", type: "string", description: "Model ID (default: claude-haiku-4-5)." }, { key: "maxTokens", type: "number", description: "Max output tokens." }], ["aiResponse", "model"], ["default"]),
  nodeDef("generate_document", "Generate Document", "AI / Documents", "Generates a consulting document (SOW, report, plan) using AI and saves it to the client's library.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "docCategory", type: "string", description: "Document category (e.g. 'consulting', 'report')." }, { key: "docType", type: "string", required: true, description: "Document type (e.g. 'consolidated_sow', 'executive_summary')." }, { key: "signalsOverride", type: "string", description: "Pre-computed signals expression to skip live evaluation." }], ["documentId", "docType", "name"], ["default"]),
  nodeDef("generate_article", "Generate Article", "AI / Documents", "Uses AI to write a full Markdown article on a given topic.", [{ key: "topic", type: "string", required: true, description: "Article topic or brief. Supports templates." }, { key: "category", type: "string", description: "Article category." }], ["articleTitle", "articleSlug", "articleCategory", "articleSummary", "articleDate", "articleContent"], ["default"]),
  nodeDef("publish_article", "Publish Article", "AI / Documents", "Publishes a Markdown article to the public Resources section of the consulting website.", [{ key: "title", type: "string", required: true, description: "Article title." }, { key: "content", type: "string", required: true, description: "Markdown body." }, { key: "slug", type: "string", required: true, description: "URL slug." }, { key: "category", type: "string", description: "Category tag." }], ["published", "slug", "articleId", "title"], ["default"]),
  nodeDef("topic_picker", "Topic Picker", "AI / Documents", "Uses AI to select the most impactful article topic from recent news and signal context.", [{ key: "context", type: "string", description: "Optional context or sector focus." }], ["articleTopic", "topicCategory", "topicRationale"], ["default"]),
  nodeDef("generate_image", "Generate Image", "AI / Documents", "Generates an AI image and stores it in the server.", [{ key: "prompt", type: "string", required: true, description: "Image generation prompt." }], ["imageUrl", "revisedPrompt"], ["default"]),
  nodeDef("generate_pdf", "Generate PDF", "AI / Documents", "Renders an HTML document to PDF.", [{ key: "html", type: "string", required: true, description: "HTML content to render." }, { key: "fileName", type: "string", description: "Output filename." }], ["pdfBase64", "pdfDataUri", "fileName"], ["default"]),
  nodeDef("generate_diff_report", "Generate Diff Report", "AI / Documents", "Compares two M365 profile snapshots and generates a change report document.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["documentId", "changesFound", "changeCount"], ["default"]),
  nodeDef("build_presentation", "Build Presentation", "AI / Documents", "Builds an MSP Portal proposal presentation for a client.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["presentationHtml", "presentationUrl", "presentationId"], ["default"]),
  nodeDef("generate_script", "Generate Script", "AI / Documents", "Uses AI to generate a PowerShell remediation script.", [{ key: "context", type: "string", required: true, description: "Script context or requirement description." }], ["scriptId", "packageId"], ["default"]),
  nodeDef("check_script_output", "Check Script Output", "AI / Documents", "Analyzes a script run output with AI to determine pass/fail.", [{ key: "scriptRunId", type: "string", required: true, description: "Script run ID to analyze." }], ["passed", "outcome"], ["default"]),
  // ── CRM / Lead Management ─────────────────────────────────────────────────
  nodeDef("create_lead", "Create Lead", "CRM / Lead Management", "Creates a new CRM lead record.", [{ key: "name", type: "string", required: true, description: "Lead full name." }, { key: "email", type: "string", required: true, description: "Lead email." }, { key: "company", type: "string", description: "Company name." }], ["leadId", "leadName", "leadEmail"], ["default"]),
  nodeDef("score_lead", "Score Lead", "CRM / Lead Management", "Computes a qualification score for a lead using signal rules and CRM fields.", [{ key: "leadId", type: "number", required: true, description: "Lead ID." }], ["leadId", "score", "scoreLabel", "qualified"], ["default"]),
  nodeDef("convert_to_opportunity", "Convert to Opportunity", "CRM / Lead Management", "Promotes a lead to an opportunity record.", [{ key: "leadId", type: "number", required: true, description: "Lead ID to convert." }], ["opportunityId", "leadId"], ["default"]),
  nodeDef("create_opportunity", "Create Opportunity", "CRM / Lead Management", "Creates a new sales opportunity record.", [{ key: "leadId", type: "number", required: true, description: "Lead ID." }, { key: "title", type: "string", description: "Opportunity title." }], ["opportunityId", "leadId"], ["default"]),
  nodeDef("assign_pipeline_stage", "Assign Pipeline Stage", "CRM / Lead Management", "Moves a lead or opportunity to a named pipeline stage.", [{ key: "targetType", type: "string", required: true, description: "Target type: lead | opportunity." }, { key: "targetId", type: "number", required: true, description: "Lead or opportunity ID." }, { key: "stage", type: "string", required: true, description: "Pipeline stage name (e.g. 'Warm', 'Proposal')." }], ["targetType", "leadId", "opportunityId", "stage"], ["default"]),
  nodeDef("create_client", "Create Client", "CRM / Lead Management", "Creates a new client account.", [{ key: "name", type: "string", required: true, description: "Client full name." }, { key: "email", type: "string", required: true, description: "Client email." }, { key: "company", type: "string", description: "Company name." }], ["clientId", "clientEmail"], ["default"]),
  nodeDef("create_project", "Create Project", "CRM / Lead Management", "Creates a new engagement project.", [{ key: "clientId", type: "number", required: true, description: "Client user ID." }, { key: "title", type: "string", required: true, description: "Project title." }], ["projectId", "projectTitle"], ["default"]),
  nodeDef("find_object", "Find Object", "CRM / Lead Management", "Queries a collection for a single object matching a field value.", [{ key: "collection", type: "string", required: true, description: "Collection: clients | projects | leads." }, { key: "fieldName", type: "string", required: true, description: "Field to match." }, { key: "fieldValueExpr", type: "string", required: true, description: "Value (supports templates)." }], ["object", "found"], ["default"]),
  nodeDef("list_objects", "List Objects", "CRM / Lead Management", "Returns a filtered list of objects from a collection.", [{ key: "collection", type: "string", required: true, description: "Collection name." }, { key: "filter", type: "object", description: "Key-value filter." }, { key: "limit", type: "number", description: "Max records." }], ["items", "count"], ["default"]),
  // ── Project / Kanban ──────────────────────────────────────────────────────
  nodeDef("get_project_tasks", "Get Project Tasks", "Project / Kanban", "Fetches all kanban tasks for a project as a flat list and grouped by phase.", [{ key: "projectId", type: "string", required: true, description: "Engagement project ID." }], ["phases", "flatTasks", "taskCount", "projectId"], ["default"]),
  nodeDef("update_project_task", "Update Project Task", "Project / Kanban", "Updates a kanban task's column, title, or priority.", [{ key: "taskId", type: "string", required: true, description: "Kanban task ID." }, { key: "column", type: "string", description: "Target column slug." }, { key: "titleExpr", type: "string", description: "New title (supports templates)." }, { key: "priority", type: "string", description: "Priority: low | medium | high | urgent." }], ["updated", "taskId", "column", "title"], ["default"]),
  nodeDef("create_kanban_task", "Create Kanban Task", "Project / Kanban", "Creates a new task card on a kanban board.", [{ key: "boardId", type: "string", description: "Board ID (default: 'marketing')." }, { key: "title", type: "string", required: true, description: "Task title." }, { key: "column", type: "string", description: "Column slug." }, { key: "priority", type: "string", description: "Priority." }, { key: "body", type: "string", description: "Task description." }], ["taskId", "boardId", "columnId", "title"], ["default"]),
  nodeDef("update_milestone", "Update Milestone", "Project / Kanban", "Transitions a project milestone to a new status and optionally seeds kanban cards.", [{ key: "milestoneId", type: "number", required: true, description: "Milestone ID." }, { key: "status", type: "string", required: true, description: "New status: pending | in_progress | complete." }], ["milestoneId", "previousStatus", "newStatus", "kanbanCardsSeeded"], ["default"]),
  nodeDef("get_phases", "Get Phases", "Project / Kanban", "Retrieves the phase list for a presentation.", [{ key: "presentationId", type: "string", required: true, description: "Presentation ID." }], ["phases", "phaseCount", "presentationId"], ["default"]),
  nodeDef("create_phase", "Create Phase", "Project / Kanban", "Adds a new phase to an engagement project.", [{ key: "projectId", type: "string", required: true, description: "Project ID." }, { key: "title", type: "string", required: true, description: "Phase title." }, { key: "price", type: "number", description: "Phase price (USD)." }], ["phaseId", "phaseTitle"], ["default"]),
  // ── Intelligence Engines ─────────────────────────────────────────────────
  nodeDef("calculate_priority", "Calculate Priority Score", "Intelligence Engines", "Runs the Priority Intelligence Engine for a client and returns a weighted priority score.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["engine", "score", "breakdown", "rawSignals", "timestamp"], ["default"]),
  nodeDef("calculate_pricing_engine", "Calculate Pricing Score", "Intelligence Engines", "Runs the Pricing Intelligence Engine and returns pricing impact and value contribution scores.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["engine", "score", "breakdown", "rawSignals", "timestamp"], ["default"]),
  nodeDef("calculate_health", "Calculate Health Score", "Intelligence Engines", "Runs the Health Intelligence Engine and returns a tenant health score.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["engine", "score", "breakdown", "rawSignals", "timestamp"], ["default"]),
  nodeDef("calculate_drift", "Calculate Drift Score", "Intelligence Engines", "Runs the Drift Intelligence Engine and returns a configuration drift score.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["engine", "score", "breakdown", "rawSignals", "timestamp"], ["default"]),
  nodeDef("calculate_forecast", "Calculate Forecast Score", "Intelligence Engines", "Runs the Forecasting Intelligence Engine and returns a trend-based forecast score.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["engine", "score", "breakdown", "rawSignals", "timestamp"], ["default"]),
  nodeDef("calculate_crm", "Calculate CRM Score", "Intelligence Engines", "Runs the CRM Intelligence Engine and returns fit, pain, maturity, intent, and urgency scores.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["engine", "score", "breakdown", "rawSignals", "timestamp"], ["default"]),
  nodeDef("calculate_msp", "Calculate MSP Score", "Intelligence Engines", "Runs the MSP Intelligence Engine and returns an MSP-level aggregate score.", [{ key: "mspId", type: "string", description: "MSP ID (defaults to the current tenant's MSP)." }], ["engine", "score", "breakdown", "rawSignals", "timestamp"], ["default"]),
  nodeDef("calculate_pricing", "Calculate Pricing", "Intelligence Engines", "Computes the pricing for a document's SOW phases and stores the result.", [{ key: "documentId", type: "number", required: true, description: "Document ID." }], ["documentId", "totalPrice", "lineCount"], ["default"]),
  // ── Diagnostics / Readiness ──────────────────────────────────────────────
  nodeDef("parse_quiz_results", "Parse Quiz Results", "Diagnostics / Readiness", "Scores a completed readiness quiz and classifies the lead.", [{ key: "quizLeadId", type: "number", required: true, description: "Quiz lead ID." }], ["quizLeadId", "totalScore", "tier", "recommendedService", "leadName", "leadEmail", "company", "categoryScores"], ["default"]),
  nodeDef("generate_readiness_score", "Generate Readiness Score", "Diagnostics / Readiness", "Computes and persists a readiness score record for a client.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["readinessScore", "readinessLabel", "recordId"], ["default"]),
  nodeDef("attach_quiz_insights", "Attach Quiz Insights", "Diagnostics / Readiness", "Attaches quiz-derived insights to a generated document.", [{ key: "quizLeadId", type: "number", required: true, description: "Quiz lead ID." }, { key: "documentId", type: "number", required: true, description: "Document ID to attach insights to." }], ["insightsAttached", "documentId"], ["default"]),
  nodeDef("validate_m365_permissions", "Validate M365 Permissions", "Diagnostics / Readiness", "Checks that required Graph API app permissions are granted.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["permissionsValid", "missingCount", "jobId"], ["default"]),
  // ── Microsoft 365 / Azure ─────────────────────────────────────────────────
  nodeDef("get_tenant_signals", "Get Tenant Signals", "Microsoft 365 / Azure", "Evaluates active signal rules against a client's M365 profile and returns fired signals.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["signals", "signalCount", "hasSignals"], ["default"]),
  nodeDef("update_m365_profile", "Update M365 Profile", "Microsoft 365 / Azure", "Fetches fresh M365 profile data for a client via Graph API and stores the snapshot.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["jobId", "jobStatus"], ["default"]),
  nodeDef("update_intelligence_tables", "Update Intelligence Tables", "Microsoft 365 / Azure", "Runs the intelligence ingestion pipeline for a client.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["updated", "recordId", "jobId"], ["default"]),
  nodeDef("notify_major_changes", "Notify Major Changes", "Microsoft 365 / Azure", "Checks for significant M365 profile changes and fires a notification if found.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["notified", "skipped"], ["default"]),
  nodeDef("execute_runbook", "Execute Runbook", "Microsoft 365 / Azure", "Triggers one or more Azure Automation runbooks and returns job results.", [{ key: "runbookName", type: "string", required: true, description: "Runbook name or internal UUID." }, { key: "parameters", type: "object", description: "Key-value parameters passed to the runbook." }, { key: "waitForCompletion", type: "boolean", description: "If true, blocks until the job finishes." }], ["jobId", "jobStatus", "runbookName", "jobOutput", "allSucceeded", "results", "succeeded", "failed"], ["default"]),
  nodeDef("save_to_sharepoint", "Save to SharePoint", "Microsoft 365 / Azure", "Saves a document or file to a SharePoint Online site.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "siteUrl", type: "string", required: true, description: "Target SharePoint site URL." }, { key: "fileName", type: "string", required: true, description: "File name." }, { key: "content", type: "string", required: true, description: "File content (base64 or text)." }], ["sharePointItemId", "sharePointWebUrl", "sharePointDownloadUrl"], ["default"]),
  nodeDef("get_from_sharepoint", "Get from SharePoint", "Microsoft 365 / Azure", "Retrieves a file from SharePoint Online.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "siteUrl", type: "string", required: true, description: "SharePoint site URL." }, { key: "filePath", type: "string", required: true, description: "File path within the site." }], ["fileContentBase64", "fileName", "mimeType", "sharePointWebUrl"], ["default"]),
  nodeDef("check_exchange_calendar_availability", "Check Calendar Availability", "Microsoft 365 / Azure", "Queries Exchange Online for free/busy slots.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "startTime", type: "string", required: true, description: "ISO 8601 start time." }, { key: "endTime", type: "string", required: true, description: "ISO 8601 end time." }], ["isBusy", "availableSlots", "busySlots"], ["default"]),
  nodeDef("create_exchange_calendar_event", "Create Calendar Event", "Microsoft 365 / Azure", "Creates a calendar event in Exchange Online.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "subject", type: "string", required: true, description: "Event subject." }, { key: "start", type: "string", required: true, description: "ISO 8601 start." }, { key: "end", type: "string", required: true, description: "ISO 8601 end." }, { key: "attendees", type: "array", description: "Array of attendee email addresses." }], ["eventId", "eventUrl", "eventWebLink"], ["default"]),
  // ── SLA Engine ────────────────────────────────────────────────────────────
  nodeDef("sla_start_timer", "SLA Start Timer", "SLA Engine", "Starts an SLA timer for a project phase.", [{ key: "projectId", type: "string", required: true, description: "Engagement project ID." }, { key: "phase", type: "string", description: "SLA phase identifier (e.g. 'response', 'resolution')." }, { key: "deadlineHours", type: "number", description: "SLA deadline in hours." }], ["timerId", "alreadyExisted"], ["default"]),
  nodeDef("sla_stop_timer", "SLA Stop Timer", "SLA Engine", "Stops a running SLA timer.", [{ key: "timerId", type: "string", required: true, description: "SLA timer ID. Supports templates." }], ["stopped", "timerId"], ["default"]),
  nodeDef("sla_warning", "SLA Warning", "SLA Engine", "Records an SLA warning event when a timer is approaching its deadline.", [{ key: "timerId", type: "string", required: true, description: "SLA timer ID. Supports templates." }], ["warningFired", "timerId"], ["default"]),
  nodeDef("sla_breach", "SLA Breach", "SLA Engine", "Records an SLA breach when a timer has exceeded its deadline.", [{ key: "timerId", type: "string", required: true, description: "SLA timer ID. Supports templates." }], ["breachId", "alreadyExisted"], ["default"]),
  nodeDef("sla_escalate", "SLA Escalate", "SLA Engine", "Creates an SLA escalation record.", [{ key: "timerId", type: "string", required: true, description: "SLA timer ID." }, { key: "level", type: "number", description: "Escalation level (1–5)." }], ["escalationId", "alreadyExisted", "level"], ["default"]),
  nodeDef("sla_resolve", "SLA Resolve", "SLA Engine", "Resolves a running SLA timer and closes open escalations.", [{ key: "timerId", type: "string", required: true, description: "SLA timer ID. Supports templates." }], ["resolved", "timerId"], ["default"]),
  // ── Policy Engine ─────────────────────────────────────────────────────────
  nodeDef("evaluate_signal_policies", "Evaluate Signal Policies", "Policy Engine", "Evaluates all active Signal Policy Engine rules against every customer with a currently-fired signal, firing configured workflow events for anything that qualifies (subject to per-rule cooldown). Takes no input — operates globally across all customers.", [], ["customersChecked", "totalFired"], ["default"]),
  // ── Scope Creep Engine ────────────────────────────────────────────────────
  nodeDef("scope_creep_detect", "Scope Creep Detect", "Scope Creep Engine", "Detects a scope creep event and records a detection row.", [{ key: "projectId", type: "string", required: true, description: "Engagement project ID." }, { key: "detectionType", type: "string", description: "Detection type: drift | addition | change." }], ["detectionId", "alreadyExisted", "detectionType"], ["default"]),
  nodeDef("scope_creep_score", "Scope Creep Score", "Scope Creep Engine", "Computes and persists the composite scope creep score for a project.", [{ key: "projectId", type: "string", required: true, description: "Engagement project ID." }], ["scoreId", "compositeScore", "alreadyExisted"], ["default"]),
  nodeDef("scope_creep_violation", "Scope Creep Violation", "Scope Creep Engine", "Fires a scope creep violation event.", [{ key: "projectId", type: "string", required: true, description: "Engagement project ID." }, { key: "severity", type: "string", description: "Severity: low | medium | high | critical." }], ["violationId", "severity", "alreadyExisted"], ["default"]),
  nodeDef("scope_creep_escalate", "Scope Creep Escalate", "Scope Creep Engine", "Creates a scope creep escalation record.", [{ key: "violationId", type: "string", required: true, description: "Violation ID." }, { key: "level", type: "number", description: "Escalation level." }, { key: "flagSowAmendment", type: "boolean", description: "If true, flags for SOW amendment." }, { key: "flagPricingReview", type: "boolean", description: "If true, flags for pricing review." }], ["escalationId", "alreadyExisted", "level", "flagSowAmendment", "flagPricingReview"], ["default"]),
  nodeDef("scope_creep_resolve", "Scope Creep Resolve", "Scope Creep Engine", "Resolves a scope creep violation and closes open escalations.", [{ key: "violationId", type: "string", required: true, description: "Violation ID. Supports templates." }], ["resolved", "violationId"], ["default"]),
  nodeDef("scope_creep_compliance_update", "Scope Creep Compliance Update", "Scope Creep Engine", "Computes and persists a scope creep compliance snapshot.", [{ key: "projectId", type: "string", required: true, description: "Engagement project ID." }], ["recordId", "compliancePct"], ["default"]),
  // ── Sales Offer Engine ────────────────────────────────────────────────────
  nodeDef("sales_offer_generate", "Sales Offer Generate", "Sales Offer Engine", "Generates AI-ranked sales offer candidates from active signal rules.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }], ["insertedOfferIds", "candidateCount"], ["default"]),
  nodeDef("sales_offer_score", "Sales Offer Score", "Sales Offer Engine", "Re-scores an offer from rule groups.", [{ key: "offerId", type: "string", required: true, description: "Offer ID. Supports templates." }], ["offerId", "previousScore", "newScore"], ["default"]),
  nodeDef("sales_offer_violation", "Sales Offer Violation", "Sales Offer Engine", "Emits a violation event on an offer.", [{ key: "offerId", type: "string", required: true, description: "Offer ID. Supports templates." }, { key: "violationType", type: "string", description: "Violation type: policy | sla | scope." }], ["offerId", "violationType"], ["default"]),
  // ── Commerce / Stripe ─────────────────────────────────────────────────────
  nodeDef("generate_stripe_payment_link", "Generate Stripe Payment Link", "Commerce / Stripe", "Creates a Stripe payment link and returns its URL.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "amountCents", type: "number", required: true, description: "Amount in cents." }, { key: "description", type: "string", description: "Payment description." }], ["paymentLinkId", "paymentLinkUrl"], ["default"]),
  nodeDef("generate_invoice_stripe_payment", "Generate Invoice Stripe Payment", "Commerce / Stripe", "Creates a Stripe invoice and returns the invoice URL.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "amountCents", type: "number", required: true, description: "Amount in cents." }, { key: "description", type: "string", description: "Invoice description." }], ["invoiceId", "invoiceUrl", "invoicePdfUrl", "amountDue", "currency"], ["default"]),
  nodeDef("generate_phased_invoice", "Generate Phased Invoice", "Commerce / Stripe", "Creates a Stripe invoice for a single project phase.", [{ key: "clientId", type: "string", required: true, description: "Client user ID." }, { key: "phaseTitle", type: "string", required: true, description: "Phase title." }, { key: "amountCents", type: "number", required: true, description: "Phase amount in cents." }], ["invoiceId", "customerId", "amountCents", "phaseTitle"], ["default"]),
  nodeDef("create_phased_invoices", "Create Phased Invoices", "Commerce / Stripe", "Creates Stripe invoices for all phases of an engagement project.", [{ key: "projectId", type: "string", required: true, description: "Project ID." }], ["invoiceIds", "phaseCount", "totalScheduled"], ["default"]),
  nodeDef("charge_stripe_invoice", "Charge Stripe Invoice", "Commerce / Stripe", "Finalizes and charges a Stripe invoice.", [{ key: "invoiceId", type: "string", required: true, description: "Stripe invoice ID." }], ["chargeStatus", "amountCharged", "stripePaymentIntentId"], ["default"]),
  nodeDef("edit_stripe_invoice", "Edit Stripe Invoice", "Commerce / Stripe", "Updates a draft Stripe invoice (due date, amount, memo).", [{ key: "invoiceId", type: "string", required: true, description: "Stripe invoice ID." }, { key: "dueDate", type: "string", description: "New due date (ISO 8601)." }], ["invoiceId", "status", "dueDate"], ["default"]),
  // ── Marketing ─────────────────────────────────────────────────────────────
  nodeDef("define_campaign_goal", "Define Campaign Goal", "Marketing", "Sets the goal for a marketing campaign.", [{ key: "goal", type: "string", required: true, description: "Campaign goal description." }], ["campaignGoal"], ["default"]),
  nodeDef("define_target_audience", "Define Target Audience", "Marketing", "Defines and stores the target audience for a campaign.", [{ key: "description", type: "string", required: true, description: "Audience description." }], ["targetAudience"], ["default"]),
  nodeDef("create_campaign_offer", "Create Campaign Offer", "Marketing", "Creates a campaign offer record.", [{ key: "name", type: "string", required: true, description: "Offer name." }, { key: "goal", type: "string", description: "Offer goal." }, { key: "audience", type: "string", description: "Target audience." }], ["offerId", "offerName", "offerGoal", "offerAudience"], ["default"]),
  nodeDef("create_marketing_campaign", "Create Marketing Campaign", "Marketing", "Creates a new marketing campaign record.", [{ key: "name", type: "string", required: true, description: "Campaign name." }, { key: "status", type: "string", description: "Initial status (default: 'draft')." }], ["campaignId", "campaignName", "campaignStatus"], ["default"]),
  nodeDef("publish_landing_page", "Publish Landing Page", "Marketing", "Publishes a marketing landing page.", [{ key: "slug", type: "string", required: true, description: "Landing page URL slug." }], ["landingPageId", "slug", "published", "wasAlreadyPublished"], ["default"]),
  nodeDef("generate_landing_page", "Generate Landing Page", "Marketing", "Uses AI to generate a marketing landing page.", [{ key: "offer", type: "string", required: true, description: "Offer or service description." }], ["landingPageId", "slug", "headline", "subheadline", "published"], ["default"]),
  nodeDef("fetch_news_headlines", "Fetch News Headlines", "Marketing", "Fetches recent industry news headlines and scores their relevance.", [{ key: "topic", type: "string", required: true, description: "News topic to search." }, { key: "sector", type: "string", description: "Industry sector filter." }], ["newsHeadlines", "newsTopic", "newsContext", "newsArticleSuggestion", "hotScore", "isHot", "targetSector", "campaignBrief", "campaignId"], ["default"]),
  // ── Data / Utility ────────────────────────────────────────────────────────
  nodeDef("log_event", "Log Event", "Data / Utility", "Writes a structured log entry to the workflow run audit trail.", [{ key: "level", type: "string", description: "Log level: info | warn | error." }, { key: "message", type: "string", required: true, description: "Log message. Supports templates." }, { key: "data", type: "object", description: "Structured data to include." }], [], ["default"]),
  nodeDef("set_variable", "Set Variable", "Data / Utility", "Computes a value and stores it so downstream nodes can reference it via {{variableName}}.", [{ key: "variableName", type: "string", required: true, description: "Variable name." }, { key: "valueExpr", type: "string", required: true, description: "Value expression (supports templates and JS arithmetic)." }], ["value"], ["default"]),
  nodeDef("update_variable", "Update Variable", "Data / Utility", "Updates an existing workflow variable.", [{ key: "variableName", type: "string", required: true, description: "Variable name to update." }, { key: "valueExpr", type: "string", required: true, description: "New value expression." }], ["value"], ["default"]),
  nodeDef("transform", "Transform", "Data / Utility", "Applies a JS mapping expression to reshape or filter step output data.", [{ key: "inputExpr", type: "string", required: true, description: "Expression resolving to the input data." }, { key: "mapExpr", type: "string", required: true, description: "JS arrow function body (e.g. 'item.name')." }], ["result", "count"], ["default"]),
  nodeDef("compose", "Compose", "Data / Utility", "Assembles multiple template expressions into a single composed value.", [{ key: "template", type: "string", required: true, description: "Template string with {{}} placeholders." }], ["value"], ["default"]),
  nodeDef("group_by", "Group By", "Data / Utility", "Groups an array of objects by a field value.", [{ key: "arrayExpr", type: "string", required: true, description: "Expression resolving to the input array." }, { key: "keyExpr", type: "string", required: true, description: "Expression to extract the grouping key from each item." }], ["groups", "groupCount"], ["default"]),
  nodeDef("http_request", "HTTP Request", "Data / Utility", "Makes an outbound HTTP request and exposes the response as step outputs.", [{ key: "url", type: "string", required: true, description: "Target URL. Supports templates." }, { key: "method", type: "string", required: true, description: "HTTP method: GET | POST | PUT | PATCH | DELETE." }, { key: "headers", type: "object", description: "Request headers." }, { key: "body", type: "object", description: "Request body (JSON-serialized)." }], ["status", "body", "ok"], ["default"]),
  nodeDef("sql_query", "SQL Query", "Data / Utility", "Executes a raw SQL query against the application database and returns rows.", [{ key: "query", type: "string", required: true, description: "SQL query string. Supports templates for parameter injection." }], ["rows", "rowCount"], ["default"]),
  nodeDef("report_progress", "Report Progress", "Data / Utility", "Writes a progress log entry visible in the real-time run viewer without stopping execution.", [{ key: "message", type: "string", required: true, description: "Progress message. Supports templates." }, { key: "step", type: "number", description: "Current step number (optional, for progress bars)." }, { key: "total", type: "number", description: "Total steps (optional, for progress bars)." }], [], ["default"]),
  nodeDef("comment", "Comment", "Data / Utility", "A no-op annotation node. Useful for labelling sections of a workflow graph. Has no effect on execution.", [{ key: "text", type: "string", description: "Annotation text visible in the builder." }], [], ["default"]),
  // ── Error Handling ────────────────────────────────────────────────────────
  nodeDef("error", "Error Handler", "Error Handling", "Catches errors routed via an 'error' or 'onError' edge from any node. Execution continues normally after this node.", [{ key: "label", type: "string", description: "Label describing what error condition this handler addresses." }], ["caught", "label"], ["default"]),
  // ── CRM / Intelligence ────────────────────────────────────────────────────
  nodeDef("write_crm_scores", "Write CRM Scores", "CRM / Lead Management", "Runs the CRM scoring engine for a client, computes fit/pain/maturity/intent/urgency, and persists the scores onto the lead record.", [{ key: "leadId", type: "number", required: true, description: "Lead ID to score." }, { key: "clientUserId", type: "number", required: true, description: "Client user ID (used to retrieve CRM signals)." }, { key: "priorityScoreField", type: "string", description: "Which CRM score field maps to priorityScore (default: 'total')." }, { key: "pricingInfluenceScoreField", type: "string", description: "Which CRM score field maps to pricingInfluenceScore (default: 'total')." }], ["leadId", "priorityScore", "pricingInfluenceScore", "engine", "crmScore"], ["default"]),
  // ── Sales Offer Engine (continued) ────────────────────────────────────────
  nodeDef("sales_offer_escalate", "Sales Offer Escalate", "Sales Offer Engine", "Escalates an offer and emits an admin notification.", [{ key: "offerId", type: "string", required: true, description: "Offer ID. Supports templates." }, { key: "escalatedTo", type: "string", description: "Escalation target (default: 'admin')." }], ["offerId", "escalatedTo"], ["default"]),
  nodeDef("sales_offer_resolve", "Sales Offer Resolve", "Sales Offer Engine", "Transitions an offer to a terminal lifecycle state (accepted, rejected, expired, withdrawn).", [{ key: "offerId", type: "string", required: true, description: "Offer ID. Supports templates." }, { key: "newState", type: "string", required: true, description: "Target state: accepted | rejected | expired | withdrawn." }], ["offerId", "newState"], ["default"]),
  // ── Monitor Package Engine ────────────────────────────────────────────────
  nodeDef("monitor_get_package", "Monitor Get Package", "Monitor Package Engine", "Fetches a monitoring package definition (checks, engines) from the database by its key.", [{ key: "packageKey", type: "string", required: true, description: "Package key (e.g. 'core-security'). Supports templates." }], ["packageKey", "packageId", "packageLabel", "checkCount", "checks", "engines"], ["default"]),
  nodeDef("monitor_execute_package", "Monitor Execute Package", "Monitor Package Engine", "Runs a full monitoring package against a tenant, executing all active checks and recomputing intelligence engine scores.", [{ key: "packageKey", type: "string", required: true, description: "Package key. Supports templates." }, { key: "tenantId", type: "string", required: true, description: "MSP tenant ID. Supports templates." }, { key: "triggerId", type: "string", description: "Optional idempotency key for this run." }], ["packageKey", "tenantId", "runStatus", "triggerId", "checksTotal", "checksOk", "checksError", "requiresScript", "consentRevoked", "checks", "enginesRecomputed", "startedAt", "completedAt"], ["default"]),
  nodeDef("monitor_subscription_ensure", "Monitor Subscription Ensure", "Monitor Package Engine", "Starts or re-confirms an O365 Management Activity API subscription for a tenant+contentType. Non-fatal — returns subscriptionStatus:'error' on failure so the containing loop can continue.", [{ key: "tenantId", type: "string", description: "MSP tenant ID. Falls back to assignment.tenantId in payload." }, { key: "contentType", type: "string", description: "O365 content type (e.g. 'Audit.AzureActiveDirectory'). Falls back to assignment.contentType." }], ["subscriptionStatus", "contentType", "tenantId", "webhookAuthId"], ["default"]),
  nodeDef("monitor_poll_activity", "Monitor Poll Activity", "Monitor Package Engine", "Polls the O365 Management Activity API for new audit events since the last watermark and writes critical findings to tenant_monitor_profile. Non-fatal.", [{ key: "tenantId", type: "string", description: "MSP tenant ID. Falls back to assignment.tenantId." }, { key: "contentType", type: "string", description: "O365 content type. Falls back to assignment.contentType." }, { key: "checkKey", type: "string", description: "Monitor check key. Falls back to assignment.checkKey." }, { key: "mapping", type: "array", description: "Field mapping rules: [{sourceField, targetField}]." }, { key: "severityRules", type: "array", description: "Severity classification rules: [{expression, severity, label?}]." }], ["criticalChangeDetected", "eventCount", "criticalCount", "tenantId", "contentType"], ["default"]),
  // ── MSP / System ──────────────────────────────────────────────────────────
  nodeDef("msp_dunning_advance", "MSP Dunning Advance", "MSP / System", "Advances dunning states for all past-due MSP subscriptions (suspends, revokes, or archives depending on dunning level).", [], ["checked", "advanced", "suspended", "revoked", "archived"], ["default"]),
  nodeDef("msp_overage_meter", "MSP Overage Meter", "MSP / System", "Meters overage usage for all MSP tenants and records billing events for tenants that have exceeded their plan limits.", [], ["subscriptionsChecked", "metered", "totalOverageTenants"], ["default"]),
  nodeDef("reconcile_orphaned_runs", "Reconcile Orphaned Runs", "MSP / System", "Scans for workflow runs that are stuck in 'running' state and resolves them (marks as failed or completes them if the job finished).", [{ key: "task", type: "string", description: "Reconciliation task name (informational)." }], ["reconciled", "task"], ["default"]),
  nodeDef("alert_evaluate_rules", "Evaluate Alert Rules", "MSP / System", "Evaluates platform alert rules (DLQ backlog, billing failures, SLA breaches, event bus backlog, job failure rate) and delivers alerts via Exchange Online email and browser push.", [], ["evaluated"], ["default"]),
  nodeDef("kanban_auto_fire", "Kanban Auto Fire", "MSP / System", "Fires the kanban auto-fire pipeline for a client, evaluating rule triggers and creating kanban tasks for matching actions.", [{ key: "clientId", type: "number", required: true, description: "Client user ID." }, { key: "action", type: "string", description: "Specific action to fire (omit to evaluate all)." }], ["fired", "clientId", "action"], ["default"]),
  nodeDef("save_presentation_phases", "Save Presentation Phases (retired)", "MSP / System", "RETIRED — use a sql_query node instead. Any graph still containing this node type will be auto-patched on server startup. Outputs a deprecation notice and continues.", [], ["skipped", "note"], ["default"]),
  // ── MSP Baseline Actions ──────────────────────────────────────────────────
  nodeDef(
    "graph_write_operation",
    "Graph Write Operation",
    "MSP / Baseline Actions",
    "Executes a Microsoft Graph API write call (POST, PATCH, or PUT) against a customer tenant. Resolves the tenant's Graph tenantId from the customerId. On success routes via the 'success' handle; on failure routes via 'insufficient_privilege', 'conflict', 'bad_request', or 'unexpected' handles. dry-run is explicitly blocked — the node returns a skip indicator instead of executing.",
    [
      { key: "customerId", type: "string", required: true, description: "MSP customer ID used to resolve the Graph tenant. Supports templates." },
      { key: "endpoint", type: "string", required: true, description: "Graph API path (e.g. '/policies/authorizationPolicy'). May contain {{variable}} placeholders." },
      { key: "method", type: "string", required: true, description: "HTTP method: POST | PATCH | PUT." },
      { key: "body", type: "object", required: true, description: "JSON body to send. May be a static object or a {{steps.*}} reference to an object." },
      { key: "expectedStatusCodes", type: "array", description: "HTTP status codes treated as success (default: [200, 201, 204])." },
    ],
    ["success", "status", "data", "errorType"],
    ["success", "insufficient_privilege", "conflict", "bad_request", "unexpected"],
  ),
  nodeDef(
    "execute_baseline_template",
    "Execute Baseline Template",
    "MSP / Baseline Actions",
    "Looks up a platform-authored baseline action template by its templateId slug, resolves {{variable}} placeholders in the body using the current run context, validates all requiredVariables, and delegates execution to graphWriteForTenant. Records the outcome in baseline_action_template_audit_log. Routes via 'success' or error-type handles identical to graph_write_operation. dry-run is explicitly blocked.",
    [
      { key: "customerId", type: "string", required: true, description: "MSP customer ID used to resolve the Graph tenant. Supports templates." },
      { key: "templateId", type: "string", required: true, description: "Stable slug of the baseline action template (e.g. 'entra-security-defaults-enable'). Supports templates." },
    ],
    ["success", "status", "data", "errorType", "templateId", "label", "missingVariables"],
    ["success", "insufficient_privilege", "conflict", "bad_request", "unexpected"],
  ),
];


const NODE_CATALOG = {
  version: 1,
  description: "Complete AI-readable reference of all workflow node types. Use 'nodes' for a flat machine-readable list; 'categories' groups the same nodes for human browsing. Template expressions use {{steps.<nodeId>.<outputKey>}} syntax.",
  templateSyntax: {
    expression: "{{steps.<nodeId>.<outputKey>}}",
    examples: [
      "{{steps.node-1.payload}} — access the start node's payload",
      "{{steps.node-3.count}} — access a numeric output from step node-3",
      "{{clientId}} — shorthand for a top-level payload key",
      "{{steps.node-5.items[0].name}} — array element access",
    ],
    rules: [
      "nodeId is the 'id' field on the graph node (e.g. 'node-1', 'node-abc123').",
      "outputKey must match a key listed in the node's outputs array.",
      "Expressions are resolved via interp() — they always stringify arrays/objects unless resolveExprNative() is used for native-type fields.",
      "Use resolveExprNative() when the field requires a native type (boolean, number, array, object).",
    ],
  },
  graphRules: {
    nodes: "Each graph node has: id (string), type (must be one of the types in the nodes array), position ({x, y}), data ({nodeType, label, ...params}).",
    edges: "Each edge has: id, source (nodeId), target (nodeId), sourceHandle (one of the node's sourceHandles), targetHandle ('input').",
    validation: [
      "Every workflow graph must have exactly one 'start' node.",
      "Condition nodes must have outgoing edges on both 'true' and 'false' source handles.",
      "foreach nodes must have a 'body' edge and a 'done' edge.",
      "wait_for_event may have 'received' and optionally 'timeout' edges.",
      "switch_case source handles are dynamic: one handle per case entry using the case 'id' (e.g. 'case-0') plus a 'default' handle.",
    ],
    parallelJoin: "Fan-out: multiple edges from one source to several targets. Fan-in: use the 'join' node type — waits for all inbound branches before continuing via 'default'.",
    foreach: "Use the 'foreach' node type to iterate. 'body' handle executes per item; 'done' fires when all items complete. Use resolveExprNative() for the items param.",
    retryWrap: "Use the 'retry' node type to re-execute a sub-graph. 'body' connects to the sub-graph; 'exhausted' fires after maxAttempts failures.",
  },
  nodes: FLAT_NODES,
};

router.get("/admin/workflows/node-catalog", requireAdmin, (_req: Request, res: Response) => {
  res.setHeader("Content-Disposition", 'attachment; filename="workflow-node-catalog.json"');
  res.json({ ...NODE_CATALOG, generatedAt: new Date().toISOString() });
});

// ── AI Workflow Narrative ─────────────────────────────────────────────────────

router.post("/admin/workflows/definitions/:id/explain", requireAdmin, async (req: Request, res: Response) => {
  const defId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(defId)) { sendError(res, 400, "Invalid definition ID"); return; }

  const def = await db.query.wfDefinitionsTable.findFirst({
    where: eq(wfDefinitionsTable.id, defId),
  });
  if (!def) { sendError(res, 404, "Workflow not found"); return; }

  const latestVersion = await db.query.wfVersionsTable.findFirst({
    where: eq(wfVersionsTable.definitionId, defId),
    orderBy: [desc(wfVersionsTable.createdAt)],
  });

  // Prefer the current canvas state from request body (unsaved edits) over the persisted version
  type GraphShape = {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
  };
  const bodyGraph = req.body as { nodes?: unknown; edges?: unknown } | null;
  const graph = (Array.isArray(bodyGraph?.nodes) && Array.isArray(bodyGraph?.edges))
    ? { nodes: bodyGraph.nodes, edges: bodyGraph.edges } as GraphShape
    : (latestVersion?.graph ?? { nodes: [], edges: [] }) as GraphShape;

  if (!graph.nodes?.length) {
    res.json({ narrative: "This workflow has no steps yet." });
    return;
  }

  const nodeLines = graph.nodes.map(n => {
    const label = (n.data?.label as string | undefined) || n.type;
    const extraKeys = Object.keys(n.data ?? {}).filter(k => k !== "label" && k !== "nodeType" && k !== "annotation");
    const extras = extraKeys.slice(0, 4).map(k => {
      const v = (n.data ?? {})[k];
      if (typeof v === "object" || Array.isArray(v)) return null;
      return `${k}=${JSON.stringify(v)}`;
    }).filter(Boolean).join(", ");
    return `  [${n.id}] ${n.type} "${label}"${extras ? ` (${extras})` : ""}`;
  }).join("\n");

  const edgeLines = graph.edges.map(e =>
    `  ${e.source} → ${e.target}${e.sourceHandle ? ` [${e.sourceHandle}]` : ""}`
  ).join("\n");

  const systemPrompt = `You are a workflow documentation assistant. Your job is to read a structured workflow definition and write a concise plain-English narrative for a non-technical business user.

Rules:
- Write 3–7 sentences maximum.
- Describe what the workflow DOES and WHY — not implementation details.
- Mention the trigger, the main happy path, any branching, and the final outcome.
- Do NOT mention node IDs (like "node-3") — use only the human-readable labels.
- Write in present tense ("The workflow receives…", "It then sends…").
- If there is an error handler, mention that failures are caught and handled gracefully.
- Output only the narrative text — no JSON, no code fences, no preamble.`;

  const userContent = `Workflow name: ${def.name}

Nodes:
${nodeLines}

Edges (connections):
${edgeLines}

Write a plain-English narrative explaining what this workflow does.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const narrative = message.content[0]?.type === "text"
      ? message.content[0].text.trim()
      : "Unable to generate narrative.";

    req.log.info({ defId }, "explain: narrative generated");
    res.json({ narrative });
  } catch (err) {
    req.log.error({ err }, "explain: AI call failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "AI call failed" });
  }
});

export default router;


