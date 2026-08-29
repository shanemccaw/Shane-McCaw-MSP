/**
 * admin-m365-interpretations.ts — the Microsoft Changes INTERPRETATION layer's
 * API (Git #1532, part of #1494).
 *
 * #1494's split: interpretation is universal, resolution is per-tenant. An
 * interpretation is authored ONCE per MSP and every tenant's resolution layer
 * reuses it. This route is the authoring surface's backend: it lists the library,
 * proposes a structured reading with AI, and persists Shane's create / edit /
 * confirm actions.
 *
 * Authoring model (#1532): Shane authors, AI proposes. `POST .../propose` runs the
 * model and returns an UNSAVED structured reading; the client shows it for review;
 * a create persists it as `status = 'proposed'`; `.../confirm` promotes it to
 * `status = 'confirmed'` — the gate the resolution layer reads. No unverified
 * interpretation is ever applied to a tenant.
 *
 *   GET    /api/admin/m365/interpretations            — the library for this MSP (+ counts)
 *   GET    /api/admin/m365/interpretations/candidates — roadmap/message-center sources with no interpretation yet
 *   POST   /api/admin/m365/interpretations/propose    — AI proposes a reading (does NOT save)
 *   POST   /api/admin/m365/interpretations            — create (defaults status 'proposed')
 *   PATCH  /api/admin/m365/interpretations/:id        — edit fields
 *   POST   /api/admin/m365/interpretations/:id/confirm — Shane confirms → status 'confirmed'
 *   POST   /api/admin/m365/interpretations/:id/reject  — read and discard → status 'rejected'
 *   DELETE /api/admin/m365/interpretations/:id        — remove one
 *
 * Resolution layer (#1533 — interpretation names WHAT to count; resolution runs
 * it against a real tenant and returns a NUMBER):
 *   POST   /api/admin/m365/interpretations/:id/resolve     — run the count across the MSP's tenants (confirmed only)
 *   GET    /api/admin/m365/interpretations/:id/resolutions — the stored per-tenant answers
 *
 * Auth: `requireAdmin` — the platform-admin session the AdminV2 console carries.
 * Scoping is per-MSP: the library is resolved against the single direct-business
 * MSP (structurally per-MSP even though there is one MSP today, #1532), never taken
 * from the request body.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  m365ChangeInterpretationsTable,
  m365ChangeResolutionsTable,
  m365RoadmapItemsTable,
  mspMessageCenterItemsTable,
  mspsTable,
  tenantsTable,
  M365_CHANGE_CLASSES,
  M365_INTERPRETATION_STATUSES,
  M365_ACTORS,
  M365_CONTROLLABILITY,
  type M365ChangeInterpretation,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { proposeInterpretation } from "../lib/m365-interpretation-proposer.ts";
import { resolveInterpretationAcrossTenants } from "../lib/m365-change-resolver.ts";
import { getCrossedOverFeatureIds, hasRoadmapFeatureIdsColumn, withCrossoverFlag } from "../lib/m365-roadmap-mc-link.ts";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

// ── Per-MSP scope ─────────────────────────────────────────────────────────────
// Structurally per-MSP (#1532). Today there is one MSP — the direct-business one —
// so the library resolves against it. Resolved server-side, never from the body.
async function resolveDefaultMspId(): Promise<number | null> {
  const [direct] = await db
    .select({ id: mspsTable.id })
    .from(mspsTable)
    .where(eq(mspsTable.isDirectBusiness, true))
    .limit(1);
  if (direct) return direct.id;
  // Fallback: the lowest-id MSP, so a dev DB without the isDirectBusiness flag set
  // still resolves rather than dead-ending the whole surface.
  const [any] = await db.select({ id: mspsTable.id }).from(mspsTable).orderBy(mspsTable.id).limit(1);
  return any?.id ?? null;
}

// ── Wire mapper ─────────────────────────────────────────────────────────────
function toWire(row: M365ChangeInterpretation) {
  return {
    id: row.id,
    mspId: row.mspId,
    featureId: row.featureId,
    graphMessageId: row.graphMessageId,
    sourceKind: row.sourceKind,
    title: row.title,
    summary: row.summary,
    changeClass: row.changeClass,
    touches: row.touches,
    whoActs: row.whoActs,
    controllable: row.controllable,
    controlMethod: row.controlMethod,
    probe: row.probe,
    status: row.status,
    proposedBy: row.proposedBy,
    aiModel: row.aiModel,
    aiRationale: row.aiRationale,
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt instanceof Date ? row.confirmedAt.toISOString() : row.confirmedAt,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

// ── GET /admin/m365/interpretations ─────────────────────────────────────────
router.get("/admin/m365/interpretations", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.json({ mspId: null, interpretations: [], counts: { proposed: 0, confirmed: 0, rejected: 0, total: 0 }, noMsp: true });
      return;
    }
    const rows = await db
      .select()
      .from(m365ChangeInterpretationsTable)
      .where(eq(m365ChangeInterpretationsTable.mspId, mspId))
      .orderBy(desc(m365ChangeInterpretationsTable.updatedAt));

    const counts = { proposed: 0, confirmed: 0, rejected: 0, total: rows.length };
    for (const r of rows) {
      if (r.status === "proposed") counts.proposed += 1;
      else if (r.status === "confirmed") counts.confirmed += 1;
      else if (r.status === "rejected") counts.rejected += 1;
    }

    res.json({ mspId, interpretations: rows.map(toWire), counts });
  } catch (err) {
    log.error({ err }, "GET /admin/m365/interpretations failed");
    res.status(500).json({ error: "Failed to load interpretations" });
  }
});

// ── GET /admin/m365/interpretations/candidates ──────────────────────────────
// Roadmap items (and distinct Message Center posts) that do NOT yet have an
// interpretation for this MSP — the sources Shane can pick to interpret next.
router.get("/admin/m365/interpretations/candidates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.json({ roadmap: [], messageCenter: [], noMsp: true });
      return;
    }

    const existing = await db
      .select({ featureId: m365ChangeInterpretationsTable.featureId, graphMessageId: m365ChangeInterpretationsTable.graphMessageId })
      .from(m365ChangeInterpretationsTable)
      .where(eq(m365ChangeInterpretationsTable.mspId, mspId));
    const usedFeatureIds = new Set(existing.map((e) => e.featureId).filter((x): x is string => !!x));
    const usedMessageIds = new Set(existing.map((e) => e.graphMessageId).filter((x): x is string => !!x));

    // Roadmap candidates — most-recently-modified first, bounded.
    const roadmapRows = await db
      .select({
        featureId: m365RoadmapItemsTable.featureId,
        title: m365RoadmapItemsTable.title,
        status: m365RoadmapItemsTable.status,
        products: m365RoadmapItemsTable.products,
        msModified: m365RoadmapItemsTable.msModified,
      })
      .from(m365RoadmapItemsTable)
      .orderBy(desc(m365RoadmapItemsTable.msModified))
      .limit(400);
    // #1531 — has this roadmap item actually landed in a tenant's Message
    // Center feed yet? That crossing is when the affected-object count stops
    // being hypothetical, so it is worth surfacing to the author picking what
    // to interpret next, not just to the (separate, #1533/#1535) resolution
    // and timeline layers.
    const crossedOverFeatureIds = await getCrossedOverFeatureIds(mspId);
    const roadmap = withCrossoverFlag(
      roadmapRows
        .filter((r) => !usedFeatureIds.has(r.featureId))
        .slice(0, 200)
        .map((r) => ({
          featureId: r.featureId,
          title: r.title,
          status: r.status,
          products: r.products,
          msModified: r.msModified instanceof Date ? r.msModified.toISOString() : r.msModified,
        })),
      crossedOverFeatureIds,
    );

    // Message Center candidates — distinct by graphMessageId within this MSP.
    // #1531 — roadmap_feature_ids (the roadmap ID(s) this post's own body
    // named) ships in a manual migration Shane runs himself; this ALREADY-LIVE
    // route must keep working before that lands, so the column is only ever
    // selected once hasRoadmapFeatureIdsColumn() confirms it exists — every
    // row honestly reports [] rather than the whole route throwing.
    const roadmapColumnReady = await hasRoadmapFeatureIdsColumn();
    const mcRowsBase = {
      graphMessageId: mspMessageCenterItemsTable.graphMessageId,
      title: mspMessageCenterItemsTable.title,
      category: mspMessageCenterItemsTable.category,
      isMajorChange: mspMessageCenterItemsTable.isMajorChange,
      services: mspMessageCenterItemsTable.services,
      lastModifiedDateTime: mspMessageCenterItemsTable.lastModifiedDateTime,
    };
    const mcRows = roadmapColumnReady
      ? await db
          .select({ ...mcRowsBase, roadmapFeatureIds: mspMessageCenterItemsTable.roadmapFeatureIds })
          .from(mspMessageCenterItemsTable)
          .where(eq(mspMessageCenterItemsTable.mspId, mspId))
          .orderBy(desc(mspMessageCenterItemsTable.lastModifiedDateTime))
          .limit(400)
      : (
          await db
            .select(mcRowsBase)
            .from(mspMessageCenterItemsTable)
            .where(eq(mspMessageCenterItemsTable.mspId, mspId))
            .orderBy(desc(mspMessageCenterItemsTable.lastModifiedDateTime))
            .limit(400)
        ).map((r) => ({ ...r, roadmapFeatureIds: [] as string[] }));
    const seenMc = new Set<string>();
    const messageCenter: Array<{
      graphMessageId: string;
      title: string;
      category: string | null;
      isMajorChange: boolean;
      services: string[];
      roadmapFeatureIds: string[];
      lastModifiedDateTime: string | null;
    }> = [];
    for (const r of mcRows) {
      if (usedMessageIds.has(r.graphMessageId) || seenMc.has(r.graphMessageId)) continue;
      seenMc.add(r.graphMessageId);
      messageCenter.push({
        graphMessageId: r.graphMessageId,
        title: r.title,
        category: r.category,
        isMajorChange: r.isMajorChange,
        services: r.services,
        roadmapFeatureIds: r.roadmapFeatureIds,
        lastModifiedDateTime: r.lastModifiedDateTime instanceof Date ? r.lastModifiedDateTime.toISOString() : r.lastModifiedDateTime,
      });
      if (messageCenter.length >= 200) break;
    }

    res.json({ roadmap, messageCenter });
  } catch (err) {
    log.error({ err }, "GET /admin/m365/interpretations/candidates failed");
    res.status(500).json({ error: "Failed to load candidates" });
  }
});

// ── POST /admin/m365/interpretations/propose ────────────────────────────────
// AI proposes a structured reading from a source. Does NOT persist — the client
// reviews the proposal and then creates it. A source is a roadmap featureId or a
// Message Center graphMessageId; the prose is read from that source's own row.
const proposeSchema = z.object({
  featureId: z.string().min(1).max(200).optional(),
  graphMessageId: z.string().min(1).max(400).optional(),
});

router.post("/admin/m365/interpretations/propose", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = proposeSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.featureId && !parsed.data.graphMessageId)) {
      res.status(400).json({ error: "Provide a featureId or a graphMessageId to interpret" });
      return;
    }
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.status(400).json({ error: "No MSP configured to author interpretations for" });
      return;
    }

    let title = "";
    let bodyContent = "";
    let sourceKind: "roadmap" | "message_center" = "roadmap";
    let context: Parameters<typeof proposeInterpretation>[0]["context"] = {};

    if (parsed.data.featureId) {
      const [item] = await db
        .select()
        .from(m365RoadmapItemsTable)
        .where(eq(m365RoadmapItemsTable.featureId, parsed.data.featureId))
        .limit(1);
      if (!item) {
        res.status(404).json({ error: "Roadmap item not found for that featureId" });
        return;
      }
      title = item.title;
      bodyContent = item.description ?? "";
      sourceKind = "roadmap";
      context = { products: item.products, tags: item.tags, status: item.status };
    } else {
      const [item] = await db
        .select()
        .from(mspMessageCenterItemsTable)
        .where(and(eq(mspMessageCenterItemsTable.mspId, mspId), eq(mspMessageCenterItemsTable.graphMessageId, parsed.data.graphMessageId!)))
        .limit(1);
      if (!item) {
        res.status(404).json({ error: "Message Center post not found for that graphMessageId" });
        return;
      }
      title = item.title;
      bodyContent = item.bodyContent ?? "";
      sourceKind = "message_center";
      context = { services: item.services, tags: item.tags, status: item.category };
    }

    if (!bodyContent.trim()) {
      res.status(422).json({ error: "That source has no body content to interpret" });
      return;
    }

    const proposal = await proposeInterpretation({ title, bodyContent, context });
    res.json({
      sourceKind,
      featureId: parsed.data.featureId ?? null,
      graphMessageId: parsed.data.graphMessageId ?? null,
      title,
      proposal,
    });
  } catch (err) {
    log.error({ err }, "POST /admin/m365/interpretations/propose failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "AI proposal failed" });
  }
});

// ── Shared field schema ─────────────────────────────────────────────────────
const touchesSchema = z.object({
  services: z.array(z.string().max(200)).max(50).default([]),
  protocols: z.array(z.string().max(200)).max(50).default([]),
  skus: z.array(z.string().max(200)).max(50).default([]),
  settings: z.array(z.string().max(200)).max(50).default([]),
});
const probeSchema = z.object({
  description: z.string().max(2000).default(""),
  monitorCheckKey: z.string().max(200).nullable().optional(),
  powershell: z.string().max(8000).nullable().optional(),
  graphEndpoint: z.string().max(1000).nullable().optional(),
});

// ── POST /admin/m365/interpretations (create) ───────────────────────────────
const createSchema = z.object({
  featureId: z.string().max(200).nullable().optional(),
  graphMessageId: z.string().max(400).nullable().optional(),
  sourceKind: z.enum(["roadmap", "message_center", "manual"]).default("roadmap"),
  title: z.string().min(1).max(500),
  summary: z.string().max(4000).nullable().optional(),
  changeClass: z.enum(M365_CHANGE_CLASSES),
  touches: touchesSchema.optional(),
  whoActs: z.enum(M365_ACTORS).default("microsoft"),
  controllable: z.enum(M365_CONTROLLABILITY).default("unknown"),
  controlMethod: z.string().max(4000).nullable().optional(),
  probe: probeSchema.optional(),
  proposedBy: z.enum(["ai", "human"]).default("human"),
  aiModel: z.string().max(200).nullable().optional(),
  aiRationale: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  // A create may confirm in the same step (Shane authoring by hand). Default is
  // the safe 'proposed' — an AI-proposed reading is never born confirmed.
  status: z.enum(M365_INTERPRETATION_STATUSES).default("proposed"),
});

router.post("/admin/m365/interpretations", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.status(400).json({ error: "No MSP configured to author interpretations for" });
      return;
    }
    const d = parsed.data;
    const who = req.user?.name || req.user?.email || "Platform Admin";
    const confirming = d.status === "confirmed";

    const [inserted] = await db
      .insert(m365ChangeInterpretationsTable)
      .values({
        mspId,
        featureId: d.featureId ?? null,
        graphMessageId: d.graphMessageId ?? null,
        sourceKind: d.sourceKind,
        title: d.title,
        summary: d.summary ?? null,
        changeClass: d.changeClass,
        touches: d.touches ?? { services: [], protocols: [], skus: [], settings: [] },
        whoActs: d.whoActs,
        controllable: d.controllable,
        controlMethod: d.controllable === "yes" ? d.controlMethod ?? null : null,
        probe: d.probe ?? { description: "" },
        status: d.status,
        proposedBy: d.proposedBy,
        aiModel: d.aiModel ?? null,
        aiRationale: d.aiRationale ?? null,
        confirmedBy: confirming ? who : null,
        confirmedAt: confirming ? new Date() : null,
        notes: d.notes ?? null,
        createdBy: who,
      })
      .returning();

    log.info({ id: inserted.id, mspId, featureId: inserted.featureId, status: inserted.status }, "m365 interpretation created");
    res.status(201).json({ interpretation: toWire(inserted) });
  } catch (err) {
    // A duplicate (msp_id, feature_id) trips the partial unique index.
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      res.status(409).json({ error: "An interpretation already exists for that roadmap feature" });
      return;
    }
    log.error({ err }, "POST /admin/m365/interpretations failed");
    res.status(500).json({ error: "Failed to create interpretation" });
  }
});

// ── PATCH /admin/m365/interpretations/:id (edit) ────────────────────────────
const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  summary: z.string().max(4000).nullable().optional(),
  changeClass: z.enum(M365_CHANGE_CLASSES).optional(),
  touches: touchesSchema.optional(),
  whoActs: z.enum(M365_ACTORS).optional(),
  controllable: z.enum(M365_CONTROLLABILITY).optional(),
  controlMethod: z.string().max(4000).nullable().optional(),
  probe: probeSchema.optional(),
  notes: z.string().max(4000).nullable().optional(),
});

router.patch("/admin/m365/interpretations/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid interpretation id" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.status(400).json({ error: "No MSP configured" });
      return;
    }
    const d = parsed.data;
    const patch: Partial<typeof m365ChangeInterpretationsTable.$inferInsert> = { updatedAt: new Date() };
    if (d.title !== undefined) patch.title = d.title;
    if (d.summary !== undefined) patch.summary = d.summary;
    if (d.changeClass !== undefined) patch.changeClass = d.changeClass;
    if (d.touches !== undefined) patch.touches = d.touches;
    if (d.whoActs !== undefined) patch.whoActs = d.whoActs;
    if (d.controllable !== undefined) patch.controllable = d.controllable;
    if (d.controlMethod !== undefined) patch.controlMethod = d.controlMethod;
    if (d.probe !== undefined) patch.probe = d.probe;
    if (d.notes !== undefined) patch.notes = d.notes;
    // Keep the controlMethod / controllable invariant even across edits: a method
    // is only meaningful when the change is controllable.
    const nextControllable = d.controllable ?? undefined;
    if (nextControllable === "no" || nextControllable === "unknown") patch.controlMethod = null;

    const [updated] = await db
      .update(m365ChangeInterpretationsTable)
      .set(patch)
      .where(and(eq(m365ChangeInterpretationsTable.id, id), eq(m365ChangeInterpretationsTable.mspId, mspId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Interpretation not found" });
      return;
    }
    res.json({ interpretation: toWire(updated) });
  } catch (err) {
    log.error({ err }, "PATCH /admin/m365/interpretations/:id failed");
    res.status(500).json({ error: "Failed to update interpretation" });
  }
});

// ── POST /admin/m365/interpretations/:id/confirm ────────────────────────────
// Shane confirms an AI-proposed reading. This is the ONLY path to 'confirmed' —
// the gate the resolution layer reads before an interpretation touches a tenant.
router.post("/admin/m365/interpretations/:id/confirm", requireAdmin, async (req: Request, res: Response) => {
  await setStatus(req, res, "confirmed");
});

// ── POST /admin/m365/interpretations/:id/reject ─────────────────────────────
router.post("/admin/m365/interpretations/:id/reject", requireAdmin, async (req: Request, res: Response) => {
  await setStatus(req, res, "rejected");
});

async function setStatus(req: Request, res: Response, status: "confirmed" | "rejected"): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid interpretation id" });
      return;
    }
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.status(400).json({ error: "No MSP configured" });
      return;
    }
    const who = req.user?.name || req.user?.email || "Platform Admin";
    const patch: Partial<typeof m365ChangeInterpretationsTable.$inferInsert> = {
      status,
      updatedAt: new Date(),
      confirmedBy: status === "confirmed" ? who : null,
      confirmedAt: status === "confirmed" ? new Date() : null,
    };
    const [updated] = await db
      .update(m365ChangeInterpretationsTable)
      .set(patch)
      .where(and(eq(m365ChangeInterpretationsTable.id, id), eq(m365ChangeInterpretationsTable.mspId, mspId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Interpretation not found" });
      return;
    }
    log.info({ id, status, by: who }, "m365 interpretation status changed");
    res.json({ interpretation: toWire(updated) });
  } catch (err) {
    log.error({ err, status }, "POST /admin/m365/interpretations/:id status change failed");
    res.status(500).json({ error: "Failed to change interpretation status" });
  }
}

// ── DELETE /admin/m365/interpretations/:id ──────────────────────────────────
router.delete("/admin/m365/interpretations/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid interpretation id" });
      return;
    }
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.status(400).json({ error: "No MSP configured" });
      return;
    }
    const deleted = await db
      .delete(m365ChangeInterpretationsTable)
      .where(and(eq(m365ChangeInterpretationsTable.id, id), eq(m365ChangeInterpretationsTable.mspId, mspId)))
      .returning({ id: m365ChangeInterpretationsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Interpretation not found" });
      return;
    }
    res.json({ ok: true, id });
  } catch (err) {
    log.error({ err }, "DELETE /admin/m365/interpretations/:id failed");
    res.status(500).json({ error: "Failed to delete interpretation" });
  }
});

// ── POST /admin/m365/interpretations/:id/resolve (#1533) ────────────────────
// Run the interpretation's count against the MSP's real estate NOW. Confirmed
// interpretations only — the #1532 gate. `live` (default true: this endpoint IS
// the deliberate "go read the tenant" action) permits a live executeMonitorCheck
// run when no fresh stored profile exists; the daily sweep never goes live.
const resolveSchema = z.object({
  customerId: z.number().int().positive().optional(),
  live: z.boolean().default(true),
});

router.post("/admin/m365/interpretations/:id/resolve", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid interpretation id" });
      return;
    }
    const parsed = resolveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.status(400).json({ error: "No MSP configured" });
      return;
    }
    const [interpretation] = await db
      .select()
      .from(m365ChangeInterpretationsTable)
      .where(and(eq(m365ChangeInterpretationsTable.id, id), eq(m365ChangeInterpretationsTable.mspId, mspId)))
      .limit(1);
    if (!interpretation) {
      res.status(404).json({ error: "Interpretation not found" });
      return;
    }
    if (interpretation.status !== "confirmed") {
      res.status(409).json({ error: "Only a confirmed interpretation may be resolved against tenants" });
      return;
    }

    const results = await resolveInterpretationAcrossTenants({
      interpretation,
      allowLive: parsed.data.live,
      onlyCustomerId: parsed.data.customerId,
    });
    res.json({
      interpretationId: id,
      results: results.map((r) => ({
        customerId: r.customerId,
        tenantName: r.tenantName,
        status: r.outcome.status,
        affectedCount: r.outcome.affectedCount,
        basis: r.outcome.basis,
        basisDetail: r.outcome.basisDetail,
        errorMessage: r.outcome.errorMessage,
        measuredAt: r.outcome.measuredAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    log.error({ err }, "POST /admin/m365/interpretations/:id/resolve failed");
    res.status(500).json({ error: "Failed to resolve interpretation against tenants" });
  }
});

// ── GET /admin/m365/interpretations/:id/resolutions (#1533) ─────────────────
// The stored per-tenant answers for one interpretation — each tenant's CURRENT
// number (or its honest not-measured reason), joined with the tenant's name.
router.get("/admin/m365/interpretations/:id/resolutions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid interpretation id" });
      return;
    }
    const mspId = await resolveDefaultMspId();
    if (mspId === null) {
      res.status(400).json({ error: "No MSP configured" });
      return;
    }
    const rows = await db
      .select({
        id: m365ChangeResolutionsTable.id,
        customerId: m365ChangeResolutionsTable.customerId,
        tenantName: tenantsTable.customerName,
        status: m365ChangeResolutionsTable.status,
        affectedCount: m365ChangeResolutionsTable.affectedCount,
        basis: m365ChangeResolutionsTable.basis,
        basisDetail: m365ChangeResolutionsTable.basisDetail,
        errorMessage: m365ChangeResolutionsTable.errorMessage,
        measuredAt: m365ChangeResolutionsTable.measuredAt,
        updatedAt: m365ChangeResolutionsTable.updatedAt,
      })
      .from(m365ChangeResolutionsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, m365ChangeResolutionsTable.customerId))
      .where(
        and(
          eq(m365ChangeResolutionsTable.interpretationId, id),
          eq(m365ChangeResolutionsTable.mspId, mspId),
        ),
      )
      .orderBy(desc(m365ChangeResolutionsTable.updatedAt));

    res.json({
      interpretationId: id,
      resolutions: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        tenantName: (r.tenantName ?? "").trim() || `Customer ${r.customerId}`,
        status: r.status,
        affectedCount: r.affectedCount,
        basis: r.basis,
        basisDetail: r.basisDetail,
        errorMessage: r.errorMessage,
        measuredAt: r.measuredAt instanceof Date ? r.measuredAt.toISOString() : r.measuredAt,
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
      })),
    });
  } catch (err) {
    log.error({ err }, "GET /admin/m365/interpretations/:id/resolutions failed");
    res.status(500).json({ error: "Failed to load resolutions" });
  }
});

export default router;
