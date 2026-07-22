/**
 * admin-document-type-definitions.ts
 *
 * Admin routes for document_type_definitions CRUD — the templates that drive
 * per-document AI generation in the Assessment Document Generation Workflow
 * (distinct from document_types, the older insights/consulting registry
 * served by admin-document-types.ts).
 *
 * All routes require admin auth.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "admin.document-type-definitions" });

const router: IRouter = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

const SELECT_WITH_SERVICE = sql`
  SELECT dtd.id, dtd.key, dtd.label, dtd.description,
         dtd.service_id AS "serviceId",
         s.id AS "service.id", s.name AS "service.name",
         dtd.included_profile_key_patterns AS "includedProfileKeyPatterns",
         dtd.included_signal_categories AS "includedSignalCategories",
         dtd.sections,
         dtd.ai_prompt_key AS "aiPromptKey",
         dtd.msp_id AS "mspId",
         dtd.is_active AS "isActive",
         dtd.created_at AS "createdAt", dtd.updated_at AS "updatedAt"
  FROM document_type_definitions dtd
  LEFT JOIN services s ON s.id = dtd.service_id
`;

function rowToDefinition(r: Record<string, unknown>): Record<string, unknown> {
  const serviceId = r["service.id"];
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    serviceId: r.serviceId,
    service: serviceId != null ? { id: serviceId, name: r["service.name"] } : null,
    includedProfileKeyPatterns: r.includedProfileKeyPatterns,
    includedSignalCategories: r.includedSignalCategories,
    sections: r.sections,
    aiPromptKey: r.aiPromptKey,
    mspId: r.mspId,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ── Document Type Definitions ────────────────────────────────────────────────

router.get("/admin/document-type-definitions", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`${SELECT_WITH_SERVICE} ORDER BY dtd.id`);
    res.json({ documentTypeDefinitions: (rows.rows as Record<string, unknown>[]).map(rowToDefinition) });
  } catch (err) {
    log.error({ err }, "admin-document-type-definitions: list failed");
    res.status(500).json({ error: "Failed to list document type definitions" });
  }
});

router.get("/admin/document-type-definitions/services-lookup", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, name, slug FROM services WHERE is_public = true ORDER BY name
    `);
    res.json({ services: rows.rows });
  } catch (err) {
    log.error({ err }, "admin-document-type-definitions: services lookup failed");
    res.status(500).json({ error: "Failed to list services" });
  }
});

router.get("/admin/document-type-definitions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const rows = await db.execute(sql`${SELECT_WITH_SERVICE} WHERE dtd.id = ${id}`);
    if (rows.rows.length === 0) { res.status(404).json({ error: "Document type definition not found" }); return; }
    res.json({ documentTypeDefinition: rowToDefinition(rows.rows[0] as Record<string, unknown>) });
  } catch (err) {
    log.error({ err, id }, "admin-document-type-definitions: get failed");
    res.status(500).json({ error: "Failed to get document type definition" });
  }
});

router.post("/admin/document-type-definitions", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  if (!b.key || !b.label) { res.status(400).json({ error: "key and label are required" }); return; }
  if (!b.aiPromptKey || typeof b.aiPromptKey !== "string" || b.aiPromptKey.trim() === "") {
    res.status(400).json({ error: "aiPromptKey is required" });
    return;
  }
  try {
    const result = await db.execute(sql`
      INSERT INTO document_type_definitions (
        key, label, description, service_id, included_profile_key_patterns,
        included_signal_categories, sections, ai_prompt_key, msp_id, is_active
      ) VALUES (
        ${b.key as string},
        ${b.label as string},
        ${(b.description ?? null) as string | null},
        ${(b.serviceId ?? null) as number | null},
        ${JSON.stringify(b.includedProfileKeyPatterns ?? [])},
        ${JSON.stringify(b.includedSignalCategories ?? [])},
        ${JSON.stringify(b.sections ?? [])},
        ${b.aiPromptKey as string},
        ${(b.mspId ?? null) as number | null},
        ${(b.isActive ?? true) as boolean}
      ) RETURNING id
    `);
    const newId = (result.rows[0] as { id: number }).id;
    log.info({ id: newId }, "admin-document-type-definitions: definition created");
    res.status(201).json({ id: newId });
  } catch (err) {
    log.error({ err }, "admin-document-type-definitions: create failed");
    res.status(500).json({ error: "Failed to create document type definition" });
  }
});

router.patch("/admin/document-type-definitions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const b = req.body as Record<string, unknown>;
  try {
    await db.execute(sql`
      UPDATE document_type_definitions SET
        key = COALESCE(${(b.key ?? null) as string | null}, key),
        label = COALESCE(${(b.label ?? null) as string | null}, label),
        description = COALESCE(${(b.description ?? null) as string | null}, description),
        service_id = COALESCE(${(b.serviceId ?? null) as number | null}, service_id),
        included_profile_key_patterns = COALESCE(${b.includedProfileKeyPatterns != null ? JSON.stringify(b.includedProfileKeyPatterns) : null}, included_profile_key_patterns::text)::jsonb,
        included_signal_categories = COALESCE(${b.includedSignalCategories != null ? JSON.stringify(b.includedSignalCategories) : null}, included_signal_categories::text)::jsonb,
        sections = COALESCE(${b.sections != null ? JSON.stringify(b.sections) : null}, sections::text)::jsonb,
        ai_prompt_key = COALESCE(${(b.aiPromptKey ?? null) as string | null}, ai_prompt_key),
        msp_id = COALESCE(${(b.mspId ?? null) as number | null}, msp_id),
        is_active = COALESCE(${(b.isActive ?? null) as boolean | null}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
    `);
    res.json({ ok: true });
  } catch (err) {
    log.error({ err, id }, "admin-document-type-definitions: update failed");
    res.status(500).json({ error: "Failed to update document type definition" });
  }
});

router.delete("/admin/document-type-definitions/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await db.execute(sql`UPDATE document_type_definitions SET is_active = false, updated_at = NOW() WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    log.error({ err, id }, "admin-document-type-definitions: deactivate failed");
    res.status(500).json({ error: "Failed to deactivate document type definition" });
  }
});

export default router;
