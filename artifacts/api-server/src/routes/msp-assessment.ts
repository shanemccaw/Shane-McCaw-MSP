/**
 * msp-assessment.ts — the SOW & Assessment expansion API (Git #4350).
 *
 * The operator-authored assessment layer MyArchitect's "SOW & Assessment"
 * workspace (Epic #3454) drives: real, separate CRUD objects for Scope Item,
 * Finding, Gap and Risk — the things the read-only #3475 viewer (an aggregate
 * CopilotScore / gate verdict / remediation %) never had. Evidence is NOT
 * re-implemented here: every object attaches evidence through the shared
 * `/api/msp/evidence` surface (#4353) using linkedType
 * "scope_item"|"finding"|"gap"|"risk".
 *
 *   Scope Items:  GET/POST /assessment/scope-items         PATCH/DELETE /assessment/scope-items/:id
 *   Findings:     GET/POST /assessment/findings            PATCH/DELETE /assessment/findings/:id
 *                 POST /assessment/findings/:id/convert-to-gap
 *   Gaps:         GET/POST /assessment/gaps                PATCH/DELETE /assessment/gaps/:id
 *                 POST /assessment/gaps/:id/convert-to-poam
 *                 POST /assessment/gaps/:id/convert-to-cab
 *                 POST /assessment/gaps/:id/convert-to-automation
 *   Risks:        GET/POST /assessment/risks               PATCH/DELETE /assessment/risks/:id
 *                 POST /assessment/risks/:id/convert-to-cab
 *                 POST /assessment/risks/:id/convert-to-poam
 *   Summary:      GET /assessment/summary
 *
 * All routes are customer-scoped under `/msp/customers/:customerId/...`, gated by
 * requireCapability("ladder.msp-operator") + assertCustomerAccess — the identical
 * pattern as msp-automations.ts (#4354). Conversions create real rows in the
 * existing tables (msp_poams, msp_change_requests, automations) and record the
 * link back on the source object, mirroring the create paths in msp-poams.ts /
 * msp-changes.ts / msp-automations.ts. Every mutation writes a real audit row.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  assessmentScopeItemsTable,
  assessmentFindingsTable,
  assessmentGapsTable,
  assessmentRisksTable,
  evidenceTable,
  evidenceLinksTable,
  mspPoamsTable,
  mspChangeRequestsTable,
  automationsTable,
  powershellScriptsTable,
  tenantsTable,
  ASSESSMENT_CATEGORIES,
  ASSESSMENT_SEVERITIES,
  ASSESSMENT_PRIORITIES,
  ASSESSMENT_LIKELIHOODS,
  ASSESSMENT_IMPACTS,
  ASSESSMENT_SCOPE_ITEM_STATUSES,
  ASSESSMENT_FINDING_STATUSES,
  ASSESSMENT_GAP_STATUSES,
  ASSESSMENT_RISK_STATUSES,
  type AssessmentScopeItem,
  type AssessmentFinding,
  type AssessmentGap,
  type AssessmentRisk,
  type AssessmentSeverity,
} from "@workspace/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { createAuditLog, resolveAuditActorRole } from "../lib/audit.ts";
import { randomPlaceholder, assignPoamId } from "../lib/poam-ref.ts";

const log = logger.child({ channel: "workflow.assessment" });

const router: IRouter = Router();

// ── Shared helpers ────────────────────────────────────────────────────────────

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Parse+validate :customerId and confirm the caller may access it. */
async function resolveCustomer(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

/** The customer's owning mspId (JWT claim, falling back to the tenant row). */
async function resolveMspId(req: Request, customerId: number): Promise<number | null> {
  if (typeof req.user?.mspId === "number") return req.user.mspId;
  const [tenant] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  return tenant?.mspId ?? null;
}

/** The tenant descriptor fields the POA&M / CAB rows require (text, not the numeric id). */
async function resolveTenantFields(
  customerId: number,
): Promise<{ tenantId: string; tenantName: string; primaryDomain: string }> {
  const [tenant] = await db
    .select({
      tenantId: tenantsTable.tenantId,
      customerName: tenantsTable.customerName,
      domain: tenantsTable.domain,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  return {
    tenantId: tenant?.tenantId || String(customerId),
    tenantName: tenant?.customerName || `Customer ${customerId}`,
    primaryDomain: tenant?.domain || "",
  };
}

function auditActor(req: Request) {
  return {
    actorUserId: req.user?.id ?? null,
    actorName: req.user?.name ?? req.user?.email ?? "unknown",
    actorRole: resolveAuditActorRole(req.user!),
  };
}

function actorUserId(req: Request): number | null {
  return typeof req.user?.id === "number" ? req.user.id : null;
}

function validationError(res: Response, parsed: z.SafeParseError<unknown>): void {
  res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
}

// ── Wire mappers ──────────────────────────────────────────────────────────────

function toWireScopeItem(r: AssessmentScopeItem) {
  return {
    id: r.id,
    customerId: r.customerId,
    category: r.category,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toWireFinding(r: AssessmentFinding) {
  return {
    id: r.id,
    customerId: r.customerId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    category: r.category,
    relatedGapId: r.relatedGapId,
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toWireGap(r: AssessmentGap) {
  return {
    id: r.id,
    customerId: r.customerId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    category: r.category,
    relatedFindingId: r.relatedFindingId,
    relatedRiskId: r.relatedRiskId,
    recommendedRemediation: r.recommendedRemediation,
    status: r.status,
    convertedToPoamId: r.convertedToPoamId,
    convertedToCabId: r.convertedToCabId,
    convertedToAutomationId: r.convertedToAutomationId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toWireRisk(r: AssessmentRisk) {
  return {
    id: r.id,
    customerId: r.customerId,
    title: r.title,
    description: r.description,
    likelihood: r.likelihood,
    impact: r.impact,
    severity: r.severity,
    category: r.category,
    relatedGapId: r.relatedGapId,
    status: r.status,
    convertedToPoamId: r.convertedToPoamId,
    convertedToCabId: r.convertedToCabId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A. Scope Items
// ════════════════════════════════════════════════════════════════════════════

const scopeItemCreateSchema = z.object({
  category: z.enum(ASSESSMENT_CATEGORIES),
  title: z.string().min(1).max(500),
  description: z.string().max(8000).nullable().optional(),
  priority: z.enum(ASSESSMENT_PRIORITIES).optional(),
  status: z.enum(ASSESSMENT_SCOPE_ITEM_STATUSES).optional(),
});
const scopeItemPatchSchema = scopeItemCreateSchema.partial();

router.get(
  "/msp/customers/:customerId/assessment/scope-items",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    try {
      const rows = await db
        .select()
        .from(assessmentScopeItemsTable)
        .where(eq(assessmentScopeItemsTable.customerId, customerId))
        .orderBy(desc(assessmentScopeItemsTable.updatedAt));
      res.json({ scopeItems: rows.map(toWireScopeItem) });
    } catch (err) {
      log.error({ err, customerId }, "GET scope-items failed");
      res.status(500).json({ error: "Failed to load scope items" });
    }
  },
);

router.post(
  "/msp/customers/:customerId/assessment/scope-items",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const parsed = scopeItemCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const [row] = await db
        .insert(assessmentScopeItemsTable)
        .values({
          customerId,
          mspId,
          category: parsed.data.category,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          priority: parsed.data.priority ?? "medium",
          status: parsed.data.status ?? "proposed",
          createdByUserId: actorUserId(req),
        })
        .returning();
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.scope_item.create",
        entityType: "assessment_scope_item",
        entityId: row.id,
        entityLabel: row.title,
        tenantId: customerId,
        metadata: { category: row.category },
      });
      res.status(201).json({ scopeItem: toWireScopeItem(row) });
    } catch (err) {
      log.error({ err, customerId }, "POST scope-item failed");
      res.status(500).json({ error: "Failed to create scope item" });
    }
  },
);

router.patch(
  "/msp/customers/:customerId/assessment/scope-items/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = scopeItemPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const [row] = await db
        .update(assessmentScopeItemsTable)
        .set({
          ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(assessmentScopeItemsTable.id, id), eq(assessmentScopeItemsTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.scope_item.update",
        entityType: "assessment_scope_item",
        entityId: id,
        entityLabel: row.title,
        tenantId: customerId,
      });
      res.json({ scopeItem: toWireScopeItem(row) });
    } catch (err) {
      log.error({ err, customerId, id }, "PATCH scope-item failed");
      res.status(500).json({ error: "Failed to update scope item" });
    }
  },
);

router.delete(
  "/msp/customers/:customerId/assessment/scope-items/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const [row] = await db
        .delete(assessmentScopeItemsTable)
        .where(and(eq(assessmentScopeItemsTable.id, id), eq(assessmentScopeItemsTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.scope_item.delete",
        entityType: "assessment_scope_item",
        entityId: id,
        tenantId: customerId,
      });
      res.json({ deleted: true, id });
    } catch (err) {
      log.error({ err, customerId, id }, "DELETE scope-item failed");
      res.status(500).json({ error: "Failed to delete scope item" });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// B. Findings
// ════════════════════════════════════════════════════════════════════════════

const findingCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(8000).nullable().optional(),
  severity: z.enum(ASSESSMENT_SEVERITIES).optional(),
  category: z.enum(ASSESSMENT_CATEGORIES).nullable().optional(),
  relatedGapId: z.number().int().positive().nullable().optional(),
  status: z.enum(ASSESSMENT_FINDING_STATUSES).optional(),
});
const findingPatchSchema = findingCreateSchema.partial();

router.get(
  "/msp/customers/:customerId/assessment/findings",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    try {
      const rows = await db
        .select()
        .from(assessmentFindingsTable)
        .where(eq(assessmentFindingsTable.customerId, customerId))
        .orderBy(desc(assessmentFindingsTable.updatedAt));
      res.json({ findings: rows.map(toWireFinding) });
    } catch (err) {
      log.error({ err, customerId }, "GET findings failed");
      res.status(500).json({ error: "Failed to load findings" });
    }
  },
);

router.post(
  "/msp/customers/:customerId/assessment/findings",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const parsed = findingCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const [row] = await db
        .insert(assessmentFindingsTable)
        .values({
          customerId,
          mspId,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          severity: parsed.data.severity ?? "medium",
          category: parsed.data.category ?? null,
          relatedGapId: parsed.data.relatedGapId ?? null,
          status: parsed.data.status ?? "open",
          createdByUserId: actorUserId(req),
        })
        .returning();
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.finding.create",
        entityType: "assessment_finding",
        entityId: row.id,
        entityLabel: row.title,
        tenantId: customerId,
        metadata: { severity: row.severity },
      });
      res.status(201).json({ finding: toWireFinding(row) });
    } catch (err) {
      log.error({ err, customerId }, "POST finding failed");
      res.status(500).json({ error: "Failed to create finding" });
    }
  },
);

router.patch(
  "/msp/customers/:customerId/assessment/findings/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = findingPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const [row] = await db
        .update(assessmentFindingsTable)
        .set({
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.severity !== undefined ? { severity: parsed.data.severity } : {}),
          ...(parsed.data.category !== undefined ? { category: parsed.data.category ?? null } : {}),
          ...(parsed.data.relatedGapId !== undefined ? { relatedGapId: parsed.data.relatedGapId ?? null } : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(assessmentFindingsTable.id, id), eq(assessmentFindingsTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.finding.update",
        entityType: "assessment_finding",
        entityId: id,
        entityLabel: row.title,
        tenantId: customerId,
      });
      res.json({ finding: toWireFinding(row) });
    } catch (err) {
      log.error({ err, customerId, id }, "PATCH finding failed");
      res.status(500).json({ error: "Failed to update finding" });
    }
  },
);

router.delete(
  "/msp/customers/:customerId/assessment/findings/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const [row] = await db
        .delete(assessmentFindingsTable)
        .where(and(eq(assessmentFindingsTable.id, id), eq(assessmentFindingsTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.finding.delete",
        entityType: "assessment_finding",
        entityId: id,
        tenantId: customerId,
      });
      res.json({ deleted: true, id });
    } catch (err) {
      log.error({ err, customerId, id }, "DELETE finding failed");
      res.status(500).json({ error: "Failed to delete finding" });
    }
  },
);

// Convert a finding to a gap (Panel B: "Convert to Gap").
router.post(
  "/msp/customers/:customerId/assessment/findings/:id/convert-to-gap",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const [finding] = await db
        .select()
        .from(assessmentFindingsTable)
        .where(and(eq(assessmentFindingsTable.id, id), eq(assessmentFindingsTable.customerId, customerId)))
        .limit(1);
      if (!finding) {
        res.status(404).json({ error: "Finding not found" });
        return;
      }
      if (finding.relatedGapId) {
        const [existing] = await db
          .select()
          .from(assessmentGapsTable)
          .where(and(eq(assessmentGapsTable.id, finding.relatedGapId), eq(assessmentGapsTable.customerId, customerId)))
          .limit(1);
        if (existing) {
          res.status(200).json({ gap: toWireGap(existing), alreadyConverted: true });
          return;
        }
      }
      const [gap] = await db
        .insert(assessmentGapsTable)
        .values({
          customerId,
          mspId,
          title: finding.title,
          description: finding.description,
          severity: finding.severity,
          category: finding.category,
          relatedFindingId: finding.id,
          status: "open",
          createdByUserId: actorUserId(req),
        })
        .returning();
      await db
        .update(assessmentFindingsTable)
        .set({ relatedGapId: gap.id, status: "converted", updatedAt: new Date() })
        .where(eq(assessmentFindingsTable.id, finding.id));
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.finding.convert_to_gap",
        entityType: "assessment_finding",
        entityId: id,
        entityLabel: finding.title,
        tenantId: customerId,
        metadata: { gapId: gap.id },
      });
      res.status(201).json({ gap: toWireGap(gap) });
    } catch (err) {
      log.error({ err, customerId, id }, "convert finding->gap failed");
      res.status(500).json({ error: "Failed to convert finding to gap" });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// C. Gaps
// ════════════════════════════════════════════════════════════════════════════

const gapCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(8000).nullable().optional(),
  severity: z.enum(ASSESSMENT_SEVERITIES).optional(),
  category: z.enum(ASSESSMENT_CATEGORIES).nullable().optional(),
  relatedFindingId: z.number().int().positive().nullable().optional(),
  relatedRiskId: z.number().int().positive().nullable().optional(),
  recommendedRemediation: z.string().max(8000).nullable().optional(),
  status: z.enum(ASSESSMENT_GAP_STATUSES).optional(),
});
const gapPatchSchema = gapCreateSchema.partial();

router.get(
  "/msp/customers/:customerId/assessment/gaps",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    try {
      const rows = await db
        .select()
        .from(assessmentGapsTable)
        .where(eq(assessmentGapsTable.customerId, customerId))
        .orderBy(desc(assessmentGapsTable.updatedAt));
      res.json({ gaps: rows.map(toWireGap) });
    } catch (err) {
      log.error({ err, customerId }, "GET gaps failed");
      res.status(500).json({ error: "Failed to load gaps" });
    }
  },
);

router.post(
  "/msp/customers/:customerId/assessment/gaps",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const parsed = gapCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const [row] = await db
        .insert(assessmentGapsTable)
        .values({
          customerId,
          mspId,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          severity: parsed.data.severity ?? "medium",
          category: parsed.data.category ?? null,
          relatedFindingId: parsed.data.relatedFindingId ?? null,
          relatedRiskId: parsed.data.relatedRiskId ?? null,
          recommendedRemediation: parsed.data.recommendedRemediation ?? null,
          status: parsed.data.status ?? "open",
          createdByUserId: actorUserId(req),
        })
        .returning();
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.gap.create",
        entityType: "assessment_gap",
        entityId: row.id,
        entityLabel: row.title,
        tenantId: customerId,
        metadata: { severity: row.severity },
      });
      res.status(201).json({ gap: toWireGap(row) });
    } catch (err) {
      log.error({ err, customerId }, "POST gap failed");
      res.status(500).json({ error: "Failed to create gap" });
    }
  },
);

router.patch(
  "/msp/customers/:customerId/assessment/gaps/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = gapPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const [row] = await db
        .update(assessmentGapsTable)
        .set({
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.severity !== undefined ? { severity: parsed.data.severity } : {}),
          ...(parsed.data.category !== undefined ? { category: parsed.data.category ?? null } : {}),
          ...(parsed.data.relatedFindingId !== undefined ? { relatedFindingId: parsed.data.relatedFindingId ?? null } : {}),
          ...(parsed.data.relatedRiskId !== undefined ? { relatedRiskId: parsed.data.relatedRiskId ?? null } : {}),
          ...(parsed.data.recommendedRemediation !== undefined
            ? { recommendedRemediation: parsed.data.recommendedRemediation ?? null }
            : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(assessmentGapsTable.id, id), eq(assessmentGapsTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Gap not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.gap.update",
        entityType: "assessment_gap",
        entityId: id,
        entityLabel: row.title,
        tenantId: customerId,
      });
      res.json({ gap: toWireGap(row) });
    } catch (err) {
      log.error({ err, customerId, id }, "PATCH gap failed");
      res.status(500).json({ error: "Failed to update gap" });
    }
  },
);

router.delete(
  "/msp/customers/:customerId/assessment/gaps/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const [row] = await db
        .delete(assessmentGapsTable)
        .where(and(eq(assessmentGapsTable.id, id), eq(assessmentGapsTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Gap not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.gap.delete",
        entityType: "assessment_gap",
        entityId: id,
        tenantId: customerId,
      });
      res.json({ deleted: true, id });
    } catch (err) {
      log.error({ err, customerId, id }, "DELETE gap failed");
      res.status(500).json({ error: "Failed to delete gap" });
    }
  },
);

/** Load one gap scoped to the customer. */
async function loadGap(id: number, customerId: number): Promise<AssessmentGap | null> {
  const [row] = await db
    .select()
    .from(assessmentGapsTable)
    .where(and(eq(assessmentGapsTable.id, id), eq(assessmentGapsTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

/** A default scheduled-completion date for a converted POA&M: +90 days, YYYY-MM-DD. */
function defaultCompletionDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 90);
  return d.toISOString().slice(0, 10);
}

/** Map an assessment severity to the CAB riskLevel vocabulary (critical|high|medium|low). */
function severityToRiskLevel(sev: AssessmentSeverity): "critical" | "high" | "medium" | "low" {
  if (sev === "critical") return "critical";
  if (sev === "high") return "high";
  if (sev === "low" || sev === "info") return "low";
  return "medium";
}

// Gap → POA&M (Panel C: "Convert to POA&M").
router.post(
  "/msp/customers/:customerId/assessment/gaps/:id/convert-to-poam",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const gap = await loadGap(id, customerId);
      if (!gap) {
        res.status(404).json({ error: "Gap not found" });
        return;
      }
      if (gap.convertedToPoamId) {
        res.status(200).json({ poamId: gap.convertedToPoamId, alreadyConverted: true });
        return;
      }
      const tenant = await resolveTenantFields(customerId);
      const completion = defaultCompletionDate();
      const placeholder = randomPlaceholder();
      const [inserted] = await db
        .insert(mspPoamsTable)
        .values({
          mspId,
          poamId: placeholder,
          tenantId: tenant.tenantId,
          tenantName: tenant.tenantName,
          primaryDomain: tenant.primaryDomain,
          title: gap.title,
          weaknessDescription: gap.description || gap.title,
          scheduledCompletionDate: completion,
          originalScheduledCompletionDate: completion,
          interimCompensatingControl: gap.recommendedRemediation || "To be determined",
          resourcesRequired: "To be determined",
          status: "draft",
        })
        .returning({ id: mspPoamsTable.id });
      const poamCode = await assignPoamId(inserted.id, placeholder);
      await db
        .update(assessmentGapsTable)
        .set({ convertedToPoamId: inserted.id, status: "in_remediation", updatedAt: new Date() })
        .where(eq(assessmentGapsTable.id, gap.id));
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.gap.convert_to_poam",
        entityType: "assessment_gap",
        entityId: id,
        entityLabel: gap.title,
        tenantId: customerId,
        metadata: { poamId: inserted.id, poamCode },
      });
      res.status(201).json({ poamId: inserted.id, poamCode });
    } catch (err) {
      log.error({ err, customerId, id }, "convert gap->poam failed");
      res.status(500).json({ error: "Failed to convert gap to POA&M" });
    }
  },
);

/** Insert a CAB change request converted from an assessment gap or risk. Returns the new id. */
async function createCabChangeFromAssessment(input: {
  mspId: number;
  customerId: number;
  title: string;
  description: string;
  severity: AssessmentSeverity;
  requestedBy: string;
}): Promise<number> {
  const tenant = await resolveTenantFields(input.customerId);
  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: input.mspId,
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      primaryDomain: tenant.primaryDomain,
      title: input.title,
      description: input.description,
      changeClass: "normal",
      riskLevel: severityToRiskLevel(input.severity),
      category: "Identity",
      targetResource: "To be determined",
      psaTicketId: "No ticket reference",
      requestedBy: input.requestedBy,
      requestedAt: new Date().toISOString(),
      scheduledFor: "To be scheduled",
      status: "pending_approval",
      backupVerified: false,
      backupHash: "",
      preChangeSnapshot: {},
      proposedPayload: {},
      rollbackScriptSnippet: "",
    })
    .returning({ id: mspChangeRequestsTable.id });
  return inserted.id;
}

// Gap → CAB Change (Panel C: "Convert to CAB Change").
router.post(
  "/msp/customers/:customerId/assessment/gaps/:id/convert-to-cab",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const gap = await loadGap(id, customerId);
      if (!gap) {
        res.status(404).json({ error: "Gap not found" });
        return;
      }
      if (gap.convertedToCabId) {
        res.status(200).json({ changeRequestId: gap.convertedToCabId, alreadyConverted: true });
        return;
      }
      const cabId = await createCabChangeFromAssessment({
        mspId,
        customerId,
        title: gap.title,
        description: gap.recommendedRemediation || gap.description || "Raised from an assessment gap.",
        severity: gap.severity,
        requestedBy: req.user?.email ?? auditActor(req).actorName,
      });
      await db
        .update(assessmentGapsTable)
        .set({ convertedToCabId: cabId, status: "in_remediation", updatedAt: new Date() })
        .where(eq(assessmentGapsTable.id, gap.id));
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.gap.convert_to_cab",
        entityType: "assessment_gap",
        entityId: id,
        entityLabel: gap.title,
        tenantId: customerId,
        metadata: { changeRequestId: cabId },
      });
      res.status(201).json({ changeRequestId: cabId });
    } catch (err) {
      log.error({ err, customerId, id }, "convert gap->cab failed");
      res.status(500).json({ error: "Failed to convert gap to CAB change" });
    }
  },
);

// Gap → Automation (Panel C: "Convert to Automation"). Auto-populates a Script
// Library script template from the gap's recommended remediation, then wraps it
// as an Automation (#4354, type "script").
router.post(
  "/msp/customers/:customerId/assessment/gaps/:id/convert-to-automation",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const gap = await loadGap(id, customerId);
      if (!gap) {
        res.status(404).json({ error: "Gap not found" });
        return;
      }
      if (gap.convertedToAutomationId) {
        res.status(200).json({ automationId: gap.convertedToAutomationId, alreadyConverted: true });
        return;
      }
      // Auto-populated script template — a scaffold the operator fills in, not a
      // runnable script (no ps_cmdlet_key binding, so it stays download-only per #4262).
      const remediation = gap.recommendedRemediation || "Describe the remediation steps here.";
      const scriptBody = [
        `# Remediation script template — generated from assessment gap #${gap.id}`,
        `# Gap: ${gap.title}`,
        gap.description ? `# Detail: ${gap.description.replace(/\r?\n/g, " ")}` : null,
        "#",
        "# Recommended remediation:",
        ...remediation.split(/\r?\n/).map((line) => `#   ${line}`),
        "",
        "# TODO: implement the remediation below.",
        "",
      ]
        .filter((l): l is string => l !== null)
        .join("\n");
      const [script] = await db
        .insert(powershellScriptsTable)
        .values({
          title: `Remediation: ${gap.title}`.slice(0, 500),
          description: `Auto-generated from assessment gap #${gap.id} (${gap.title}).`,
          category: "other",
          scriptBody,
        })
        .returning({ id: powershellScriptsTable.id });
      const [automation] = await db
        .insert(automationsTable)
        .values({
          customerId,
          mspId,
          type: "script",
          wrappedRefId: script.id,
          name: `Remediation: ${gap.title}`.slice(0, 500),
          description: gap.recommendedRemediation ?? null,
        })
        .returning({ id: automationsTable.id });
      await db
        .update(assessmentGapsTable)
        .set({ convertedToAutomationId: automation.id, status: "in_remediation", updatedAt: new Date() })
        .where(eq(assessmentGapsTable.id, gap.id));
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.gap.convert_to_automation",
        entityType: "assessment_gap",
        entityId: id,
        entityLabel: gap.title,
        tenantId: customerId,
        metadata: { automationId: automation.id, scriptId: script.id },
      });
      res.status(201).json({ automationId: automation.id, scriptId: script.id });
    } catch (err) {
      log.error({ err, customerId, id }, "convert gap->automation failed");
      res.status(500).json({ error: "Failed to convert gap to automation" });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// D. Risks
// ════════════════════════════════════════════════════════════════════════════

const riskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(8000).nullable().optional(),
  likelihood: z.enum(ASSESSMENT_LIKELIHOODS).optional(),
  impact: z.enum(ASSESSMENT_IMPACTS).optional(),
  severity: z.enum(ASSESSMENT_SEVERITIES).optional(),
  category: z.enum(ASSESSMENT_CATEGORIES).nullable().optional(),
  relatedGapId: z.number().int().positive().nullable().optional(),
  status: z.enum(ASSESSMENT_RISK_STATUSES).optional(),
});
const riskPatchSchema = riskCreateSchema.partial();

router.get(
  "/msp/customers/:customerId/assessment/risks",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    try {
      const rows = await db
        .select()
        .from(assessmentRisksTable)
        .where(eq(assessmentRisksTable.customerId, customerId))
        .orderBy(desc(assessmentRisksTable.updatedAt));
      res.json({ risks: rows.map(toWireRisk) });
    } catch (err) {
      log.error({ err, customerId }, "GET risks failed");
      res.status(500).json({ error: "Failed to load risks" });
    }
  },
);

router.post(
  "/msp/customers/:customerId/assessment/risks",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const parsed = riskCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const [row] = await db
        .insert(assessmentRisksTable)
        .values({
          customerId,
          mspId,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          likelihood: parsed.data.likelihood ?? "medium",
          impact: parsed.data.impact ?? "medium",
          severity: parsed.data.severity ?? "medium",
          category: parsed.data.category ?? null,
          relatedGapId: parsed.data.relatedGapId ?? null,
          status: parsed.data.status ?? "open",
          createdByUserId: actorUserId(req),
        })
        .returning();
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.risk.create",
        entityType: "assessment_risk",
        entityId: row.id,
        entityLabel: row.title,
        tenantId: customerId,
        metadata: { severity: row.severity },
      });
      res.status(201).json({ risk: toWireRisk(row) });
    } catch (err) {
      log.error({ err, customerId }, "POST risk failed");
      res.status(500).json({ error: "Failed to create risk" });
    }
  },
);

router.patch(
  "/msp/customers/:customerId/assessment/risks/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = riskPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);
    try {
      const [row] = await db
        .update(assessmentRisksTable)
        .set({
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.likelihood !== undefined ? { likelihood: parsed.data.likelihood } : {}),
          ...(parsed.data.impact !== undefined ? { impact: parsed.data.impact } : {}),
          ...(parsed.data.severity !== undefined ? { severity: parsed.data.severity } : {}),
          ...(parsed.data.category !== undefined ? { category: parsed.data.category ?? null } : {}),
          ...(parsed.data.relatedGapId !== undefined ? { relatedGapId: parsed.data.relatedGapId ?? null } : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(assessmentRisksTable.id, id), eq(assessmentRisksTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Risk not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.risk.update",
        entityType: "assessment_risk",
        entityId: id,
        entityLabel: row.title,
        tenantId: customerId,
      });
      res.json({ risk: toWireRisk(row) });
    } catch (err) {
      log.error({ err, customerId, id }, "PATCH risk failed");
      res.status(500).json({ error: "Failed to update risk" });
    }
  },
);

router.delete(
  "/msp/customers/:customerId/assessment/risks/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const [row] = await db
        .delete(assessmentRisksTable)
        .where(and(eq(assessmentRisksTable.id, id), eq(assessmentRisksTable.customerId, customerId)))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Risk not found" });
        return;
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.risk.delete",
        entityType: "assessment_risk",
        entityId: id,
        tenantId: customerId,
      });
      res.json({ deleted: true, id });
    } catch (err) {
      log.error({ err, customerId, id }, "DELETE risk failed");
      res.status(500).json({ error: "Failed to delete risk" });
    }
  },
);

/** Load one risk scoped to the customer. */
async function loadRisk(id: number, customerId: number): Promise<AssessmentRisk | null> {
  const [row] = await db
    .select()
    .from(assessmentRisksTable)
    .where(and(eq(assessmentRisksTable.id, id), eq(assessmentRisksTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

// Risk → CAB Change (Panel D: "Convert to CAB Change").
router.post(
  "/msp/customers/:customerId/assessment/risks/:id/convert-to-cab",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const risk = await loadRisk(id, customerId);
      if (!risk) {
        res.status(404).json({ error: "Risk not found" });
        return;
      }
      if (risk.convertedToCabId) {
        res.status(200).json({ changeRequestId: risk.convertedToCabId, alreadyConverted: true });
        return;
      }
      const cabId = await createCabChangeFromAssessment({
        mspId,
        customerId,
        title: risk.title,
        description: risk.description || "Raised from an assessment risk.",
        severity: risk.severity,
        requestedBy: req.user?.email ?? auditActor(req).actorName,
      });
      await db
        .update(assessmentRisksTable)
        .set({ convertedToCabId: cabId, status: "mitigated", updatedAt: new Date() })
        .where(eq(assessmentRisksTable.id, risk.id));
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.risk.convert_to_cab",
        entityType: "assessment_risk",
        entityId: id,
        entityLabel: risk.title,
        tenantId: customerId,
        metadata: { changeRequestId: cabId },
      });
      res.status(201).json({ changeRequestId: cabId });
    } catch (err) {
      log.error({ err, customerId, id }, "convert risk->cab failed");
      res.status(500).json({ error: "Failed to convert risk to CAB change" });
    }
  },
);

// Risk → POA&M (Panel D: "Convert to POA&M").
router.post(
  "/msp/customers/:customerId/assessment/risks/:id/convert-to-poam",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const risk = await loadRisk(id, customerId);
      if (!risk) {
        res.status(404).json({ error: "Risk not found" });
        return;
      }
      if (risk.convertedToPoamId) {
        res.status(200).json({ poamId: risk.convertedToPoamId, alreadyConverted: true });
        return;
      }
      const tenant = await resolveTenantFields(customerId);
      const completion = defaultCompletionDate();
      const placeholder = randomPlaceholder();
      const [inserted] = await db
        .insert(mspPoamsTable)
        .values({
          mspId,
          poamId: placeholder,
          tenantId: tenant.tenantId,
          tenantName: tenant.tenantName,
          primaryDomain: tenant.primaryDomain,
          title: risk.title,
          weaknessDescription: risk.description || risk.title,
          scheduledCompletionDate: completion,
          originalScheduledCompletionDate: completion,
          interimCompensatingControl: "To be determined",
          resourcesRequired: "To be determined",
          status: "draft",
        })
        .returning({ id: mspPoamsTable.id });
      const poamCode = await assignPoamId(inserted.id, placeholder);
      await db
        .update(assessmentRisksTable)
        .set({ convertedToPoamId: inserted.id, status: "mitigated", updatedAt: new Date() })
        .where(eq(assessmentRisksTable.id, risk.id));
      void createAuditLog({
        ...auditActor(req),
        actionType: "assessment.risk.convert_to_poam",
        entityType: "assessment_risk",
        entityId: id,
        entityLabel: risk.title,
        tenantId: customerId,
        metadata: { poamId: inserted.id, poamCode },
      });
      res.status(201).json({ poamId: inserted.id, poamCode });
    } catch (err) {
      log.error({ err, customerId, id }, "convert risk->poam failed");
      res.status(500).json({ error: "Failed to convert risk to POA&M" });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// E. Assessment Summary
// ════════════════════════════════════════════════════════════════════════════

const SEVERITY_WEIGHT: Record<AssessmentSeverity, number> = {
  info: 1,
  low: 3,
  medium: 8,
  high: 15,
  critical: 25,
};

const OPEN_GAP_STATUSES = new Set(["open", "in_remediation"]);
const OPEN_RISK_STATUSES = new Set(["open"]);

router.get(
  "/msp/customers/:customerId/assessment/summary",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const mspId = await resolveMspId(req, customerId);
    if (mspId === null) {
      res.status(404).json({ error: "Customer has no owning MSP" });
      return;
    }
    try {
      const [scopeItems, findings, gaps, risks] = await Promise.all([
        db.select().from(assessmentScopeItemsTable).where(eq(assessmentScopeItemsTable.customerId, customerId)),
        db.select().from(assessmentFindingsTable).where(eq(assessmentFindingsTable.customerId, customerId)),
        db.select().from(assessmentGapsTable).where(eq(assessmentGapsTable.customerId, customerId)),
        db.select().from(assessmentRisksTable).where(eq(assessmentRisksTable.customerId, customerId)),
      ]);

      // Evidence count: distinct shared-evidence rows linked to any assessment
      // object of this customer (reuses #4353's evidence/evidence_links).
      const [evidenceCountRow] = await db
        .select({ count: sql<number>`count(distinct ${evidenceLinksTable.evidenceId})` })
        .from(evidenceLinksTable)
        .innerJoin(evidenceTable, eq(evidenceLinksTable.evidenceId, evidenceTable.id))
        .where(
          and(
            eq(evidenceTable.mspId, mspId),
            eq(evidenceTable.customerId, customerId),
            inArray(evidenceLinksTable.linkedType, ["scope_item", "finding", "gap", "risk"]),
          ),
        );
      const evidenceCount = Number(evidenceCountRow?.count ?? 0);

      // Per-pillar score: 100 minus the weighted penalty of that pillar's OPEN
      // gaps + risks, floored at 0. Overall score: 100 minus the total weighted
      // penalty across ALL open gaps + risks (regardless of pillar), floored at 0
      // — a real, deterministic reflection of open exposure, no fabricated numbers.
      const pillarPenalty: Record<string, number> = {};
      for (const c of ASSESSMENT_CATEGORIES) pillarPenalty[c] = 0;
      let totalPenalty = 0;
      for (const g of gaps) {
        if (!OPEN_GAP_STATUSES.has(g.status)) continue;
        const w = SEVERITY_WEIGHT[g.severity as AssessmentSeverity] ?? SEVERITY_WEIGHT.medium;
        totalPenalty += w;
        if (g.category && g.category in pillarPenalty) pillarPenalty[g.category] += w;
      }
      for (const r of risks) {
        if (!OPEN_RISK_STATUSES.has(r.status)) continue;
        const w = SEVERITY_WEIGHT[r.severity as AssessmentSeverity] ?? SEVERITY_WEIGHT.medium;
        totalPenalty += w;
        if (r.category && r.category in pillarPenalty) pillarPenalty[r.category] += w;
      }
      const pillarBreakdown = ASSESSMENT_CATEGORIES.map((category) => ({
        category,
        score: Math.max(0, 100 - pillarPenalty[category]),
      }));
      const overallScore = Math.max(0, 100 - totalPenalty);

      // Recommended next steps: the highest-severity open gaps, real titles only.
      const openGaps = gaps
        .filter((g) => OPEN_GAP_STATUSES.has(g.status))
        .sort(
          (a, b) =>
            (SEVERITY_WEIGHT[b.severity as AssessmentSeverity] ?? 0) -
            (SEVERITY_WEIGHT[a.severity as AssessmentSeverity] ?? 0),
        )
        .slice(0, 5)
        .map((g) => `Remediate gap: ${g.title}`);

      const lastUpdatedTs = [...scopeItems, ...findings, ...gaps, ...risks]
        .map((r) => (r.updatedAt instanceof Date ? r.updatedAt.getTime() : new Date(r.updatedAt).getTime()))
        .reduce((max, t) => (t > max ? t : max), 0);

      res.json({
        summary: {
          score: overallScore,
          pillarBreakdown,
          scopeItemCount: scopeItems.length,
          findingCount: findings.length,
          gapCount: gaps.length,
          openGapCount: gaps.filter((g) => OPEN_GAP_STATUSES.has(g.status)).length,
          riskCount: risks.length,
          openRiskCount: risks.filter((r) => OPEN_RISK_STATUSES.has(r.status)).length,
          evidenceCount,
          recommendedNextSteps: openGaps,
          lastUpdated: lastUpdatedTs > 0 ? new Date(lastUpdatedTs).toISOString() : null,
        },
      });
    } catch (err) {
      log.error({ err, customerId }, "GET assessment summary failed");
      res.status(500).json({ error: "Failed to compute assessment summary" });
    }
  },
);

export default router;
