/**
 * admin-document-types.ts
 *
 * Audit-logged CRUD for the document_types registry — the admin-editable
 * replacement for the hardcoded REPORT_DOC_TYPE_LABELS / CONSULTING_TYPE_LABELS /
 * CONSULTING_SECTION_HINTS object literals that used to be duplicated across
 * document-generator.ts and admin-insights.ts. All routes are admin-only.
 *
 * Creating a document type also creates its matching ai_prompts row
 * ("insights-<category>-<key>") with a sensible default prompt body, so the
 * new type is immediately editable via the existing AI Prompt editor with no
 * extra manual step. This route never touches ai_prompts/ai_prompt_versions'
 * own draft/publish/version-history logic — only this one creation point.
 *
 * Routes
 * ──────
 * GET    /api/admin/document-types             — list all types (optional ?category=)
 * GET    /api/admin/document-types/:key        — get one type
 * POST   /api/admin/document-types             — create (audit-logged; also creates ai_prompts row)
 * PUT    /api/admin/document-types/:key        — update (audit-logged)
 * POST   /api/admin/document-types/:key/deactivate — soft-deactivate (audit-logged)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, documentTypesTable, aiPromptsTable, auditLogsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { invalidateDocumentTypeCache } from "../lib/document-types";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "system.core" });
import { z } from "zod";

const router: IRouter = Router();

// ── Validation schemas ─────────────────────────────────────────────────────────

const createSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "key must be lowercase letters, digits, or underscores"),
  label: z.string().min(1).max(200),
  category: z.enum(["report", "consulting"]),
  sectionHints: z.string().max(4000).optional().nullable(),
  requiresSowHtml: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  serviceId: z.number().int().positive().nullable().optional(),
  includedProfileKeyPatterns: z.array(z.string()).default([]),
  includedSignalCategories: z.array(z.string()).default([]),
  pipelineCategory: z.enum(["standalone", "pipeline_output"]).default("standalone"),
});

const updateSchema = createSchema
  .omit({ key: true, category: true })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });

// ── Audit helper ───────────────────────────────────────────────────────────────

async function auditLog(
  req: Request,
  actionType: string,
  entityId: string,
  entityLabel: string,
  metadata?: Record<string, unknown>,
) {
  try {
    const actor = req.user as { id?: number; email?: string; role?: string } | undefined;
    await db.insert(auditLogsTable).values({
      actorUserId: actor?.id ?? null,
      actorName: actor?.email ?? "admin",
      actorRole: "admin",
      actionType,
      entityType: "document_type",
      entityId,
      entityLabel,
      metadata: metadata ?? {},
    });
  } catch (err) {
    log.warn({ err, actionType, entityId }, "admin-document-types: audit log insert failed (non-fatal)");
  }
}

// ── Default prompt body builders ───────────────────────────────────────────────
// Mirror INSIGHTS_REPORT_PROMPT_FALLBACK / INSIGHTS_CONSULTING_PROMPT_FALLBACK
// in admin-insights.ts / document-generator.ts — same tokens, same structure —
// so a freshly-created type's default prompt runs correctly on first use.

function buildDefaultReportPrompt(): string {
  return `You are Shane McCaw, a senior Microsoft 365 Architect. Generate a professional, client-facing {{docLabel}} in HTML format.

Client: {{clientName}}{{projectLine}}
Document title: {{title}}
Report date: {{date}}

M365 Environment Health Scores:
{{scores}}

Key Findings ({{findingsCount}} total):
{{findings}}

Key Recommendations ({{recommendationsCount}} total):
{{recommendations}}

Configuration Telemetry Sample (from profileUpdates):
{{profileSample}}

Script analysis runs: {{runCount}} completed assessments

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS for styling — white background, #0078D4 accent (Microsoft Azure Blue), professional enterprise typography
- Structure: header with "Shane McCaw Consulting" + report metadata, executive overview table with the score cards, findings section with a data table, recommendations section, configuration status summary (use profileUpdates data), next steps, footer with Shane's name
- Write in first person as Shane McCaw with professional consulting tone
- Be specific and actionable — reference actual findings, not generic advice
- Total length: 800-1500 words of body content`;
}

function buildDefaultConsultingPrompt(): string {
  return `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a professional consulting {{typeLabel}} in HTML format.

Client: {{clientName}}
{{projectDesc}}Deliverable title: {{title}}
Date: {{date}}

M365 Health Context:
{{scores}}

Key Findings: {{findings}}
Key Recommendations: {{recommendations}}

Configuration Telemetry Sample (from profileUpdates — use in your analysis):
{{profileSample}}

{{priorDocsSummary}}Document Sections Required:
{{sectionHints}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — professional white background, #0078D4 (Azure Blue) accent, Inter/system-font typography, responsive tables
- Each major section as <h2> with a horizontal rule separator
- Data tables where appropriate (border-collapse, alternating rows)
- Professional consulting tone as Shane McCaw, first person where appropriate
- Never use TBD or placeholder pricing — always calculate firm prices using the Tier 02 formula when provided
- Total length: 1000-2000 words`;
}

// ── List ───────────────────────────────────────────────────────────────────────

router.get("/admin/document-types", requireAdmin, async (req: Request, res: Response) => {
  try {
    const category = req.query["category"];
    const conditions = category === "report" || category === "consulting"
      ? [eq(documentTypesTable.category, category)]
      : [];
    const rows = await db
      .select()
      .from(documentTypesTable)
      .where(conditions.length ? conditions[0] : undefined)
      .orderBy(asc(documentTypesTable.sortOrder));
    res.json(rows);
  } catch (err) {
    log.error({ err }, "admin-document-types: list failed");
    res.status(500).json({ error: "Failed to fetch document types" });
  }
});

// ── Get one ────────────────────────────────────────────────────────────────────

router.get("/admin/document-types/:key", requireAdmin, async (req: Request, res: Response) => {
  const typeKey = String(req.params.key);
  try {
    const [row] = await db
      .select()
      .from(documentTypesTable)
      .where(eq(documentTypesTable.key, typeKey))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err }, "admin-document-types: get failed");
    res.status(500).json({ error: "Failed to fetch document type" });
  }
});

// ── Create ─────────────────────────────────────────────────────────────────────

router.post("/admin/document-types", requireAdmin, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }
  const { key, label, category, sectionHints, requiresSowHtml, sortOrder, isActive, serviceId, includedProfileKeyPatterns, includedSignalCategories, pipelineCategory } = parsed.data;

  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(documentTypesTable)
        .values({ key, label, category, sectionHints: sectionHints ?? null, requiresSowHtml, sortOrder, isActive, serviceId: serviceId ?? null, includedProfileKeyPatterns, includedSignalCategories, pipelineCategory })
        .returning();

      const promptKey = `insights-${category}-${key}`;
      const defaultBody = category === "report" ? buildDefaultReportPrompt() : buildDefaultConsultingPrompt();

      const [promptRow] = await tx
        .insert(aiPromptsTable)
        .values({
          key: promptKey,
          name: `Insights — ${label}`,
          description: `Generates the "${label}" ${category} deliverable in HTML. Created automatically for the document_types registry entry "${key}".`,
          category: "insights",
          featureArea: "Command — Insights",
          featureRoute: "/command/insights",
          model: "claude-haiku-4-5",
          promptBody: defaultBody,
          defaultBody,
        })
        .onConflictDoNothing({ target: aiPromptsTable.key })
        .returning({ id: aiPromptsTable.id });

      let aiPromptId = promptRow?.id ?? null;
      if (!aiPromptId) {
        // A prompt with this key already existed (e.g. one of the 14 seeded
        // keys) — link to it instead of leaving ai_prompt_id null.
        const [existingPrompt] = await tx
          .select({ id: aiPromptsTable.id })
          .from(aiPromptsTable)
          .where(eq(aiPromptsTable.key, promptKey))
          .limit(1);
        aiPromptId = existingPrompt?.id ?? null;
      }

      const [updated] = await tx
        .update(documentTypesTable)
        .set({ aiPromptId, updatedAt: new Date() })
        .where(eq(documentTypesTable.id, created!.id))
        .returning();
      return updated!;
    });

    invalidateDocumentTypeCache();
    await auditLog(req, "create", key, label, { data: parsed.data, aiPromptId: row.aiPromptId });
    res.status(201).json(row);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      res.status(409).json({ error: `A document type with key "${key}" already exists` });
      return;
    }
    log.error({ err }, "admin-document-types: create failed");
    res.status(500).json({ error: "Failed to create document type" });
  }
});

// ── Update ─────────────────────────────────────────────────────────────────────

router.put("/admin/document-types/:key", requireAdmin, async (req: Request, res: Response) => {
  const typeKey = String(req.params.key);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(documentTypesTable)
      .where(eq(documentTypesTable.key, typeKey))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db
      .update(documentTypesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(documentTypesTable.key, typeKey))
      .returning();

    invalidateDocumentTypeCache();
    await auditLog(req, "update", typeKey, updated?.label ?? typeKey, {
      before: existing,
      after: parsed.data,
    });
    res.json(updated);
  } catch (err) {
    log.error({ err }, "admin-document-types: update failed");
    res.status(500).json({ error: "Failed to update document type" });
  }
});

// ── Deactivate ─────────────────────────────────────────────────────────────────
// Soft-toggle only — never a hard delete, since existing insights_generated_documents
// rows reference the key as free text and must keep resolving to a real label.

router.post("/admin/document-types/:key/deactivate", requireAdmin, async (req: Request, res: Response) => {
  const typeKey = String(req.params.key);
  try {
    const [existing] = await db
      .select()
      .from(documentTypesTable)
      .where(eq(documentTypesTable.key, typeKey))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db
      .update(documentTypesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(documentTypesTable.key, typeKey))
      .returning();

    invalidateDocumentTypeCache();
    await auditLog(req, "deactivate", typeKey, existing.label, {});
    res.json(updated);
  } catch (err) {
    log.error({ err }, "admin-document-types: deactivate failed");
    res.status(500).json({ error: "Failed to deactivate document type" });
  }
});

export default router;
