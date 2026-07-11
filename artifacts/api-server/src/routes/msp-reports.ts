/**
 * msp-reports.ts
 *
 * Report Builder & Report Runs API for MSP Portal.
 *
 * Report Definitions (CRUD):
 *   GET    /api/msp/reports/definitions               — list (scoped to mspId)
 *   POST   /api/msp/reports/definitions               — create
 *   GET    /api/msp/reports/definitions/:defId        — get one
 *   PATCH  /api/msp/reports/definitions/:defId        — update
 *   DELETE /api/msp/reports/definitions/:defId        — delete (soft: isActive=false)
 *
 * Report Runs:
 *   POST   /api/msp/reports/definitions/:defId/trigger  — trigger generation (async)
 *   GET    /api/msp/reports/runs                         — list runs (scoped)
 *   GET    /api/msp/reports/runs/:runId                  — get run detail
 *   GET    /api/msp/reports/runs/:runId/download         — download PDF
 *
 * License Waste:
 *   GET    /api/msp/reports/license-waste               — savings tile for dashboard
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspReportDefinitionsTable,
  mspReportRunsTable,
  mspCustomersTable,
  clientM365ProfilesTable,
  REPORT_DOC_TYPES,
  REPORT_DELIVERY_METHODS,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveMspIdOrZero } from "../lib/resolve-msp-id.ts";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createRun, executeRun, upsertWorkflow } from "../lib/portal-workflow-engine";
import { REPORT_GENERATION_WORKFLOW_KEY, REPORT_GENERATION_GRAPH } from "../lib/report-nodes";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Ensure the report generation workflow exists in portal_wf_workflows.
 * Idempotent — safe to call on every trigger request.
 */
async function ensureReportGenWorkflow(): Promise<void> {
  await upsertWorkflow({
    workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
    label: "MSP Report Generation",
    description: "Generates an MSP report via AI and PDF. Failures route to DLQ and create an operator task.",
    graph: REPORT_GENERATION_GRAPH,
    isActive: true,
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) { lines.push(""); continue; }
    const words = para.split(" ");
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > maxChars) {
        if (cur.trim()) lines.push(cur.trim());
        cur = w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
  }
  return lines;
}

async function buildPdf(text: string, title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 60, LH = 14, FS = 10, TS = 16;
  const charsPerLine = Math.floor((W - M * 2) / (FS * 0.55));
  const lines = wrapText(text, charsPerLine);

  let page = pdfDoc.addPage([W, H]);
  let y = H - M;

  page.drawText(title.slice(0, 80), { x: M, y, size: TS, font: bold, color: rgb(0.04, 0.15, 0.25) });
  y -= TS + 10;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= LH;

  for (const line of lines) {
    if (y < M + LH) { page = pdfDoc.addPage([W, H]); y = H - M; }
    if (line) page.drawText(line.slice(0, 120), { x: M, y, size: FS, font, color: rgb(0.1, 0.1, 0.1) });
    y -= LH;
  }

  const n = pdfDoc.getPageCount();
  const today = new Date().toISOString().split("T")[0]!;
  for (let i = 0; i < n; i++) {
    const pg = pdfDoc.getPage(i);
    pg.drawText(`Page ${i + 1} of ${n}`, { x: M, y: M / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    pg.drawText(today, { x: W - M - 60, y: M / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  }
  return Buffer.from(await pdfDoc.save());
}

const DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary:           "Executive Summary",
  full_readiness_report:       "Full Readiness Report",
  security_posture_report:     "Security Posture Report",
  governance_maturity_report:  "Governance Maturity Report",
  data_exposure_risk_report:   "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
  license_waste_report:        "License Waste Analysis Report",
};

// ── GET /api/msp/reports/definitions ─────────────────────────────────────────

router.get(
  "/msp/reports/definitions",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const customerId = req.query["customerId"] ? Number(req.query["customerId"]) : undefined;

      const conditions = mspId
        ? customerId
          ? [eq(mspReportDefinitionsTable.mspId, mspId), eq(mspReportDefinitionsTable.customerId, customerId)]
          : [eq(mspReportDefinitionsTable.mspId, mspId)]
        : [];

      const defs = await db
        .select()
        .from(mspReportDefinitionsTable)
        .where(conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])) : undefined)
        .orderBy(desc(mspReportDefinitionsTable.createdAt));

      res.json({ definitions: defs, total: defs.length });
    } catch (err) {
      logger.error({ err }, "msp-reports: GET definitions failed");
      res.status(500).json({ error: "Failed to fetch report definitions" });
    }
  },
);

// ── POST /api/msp/reports/definitions ────────────────────────────────────────

router.post(
  "/msp/reports/definitions",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const user = req.user!;
      const {
        name, description, docType = "executive_summary",
        deliveryMethod = "in_app", deliveryEmail, customerId,
        fieldMappings = {}, scheduleConfig = {},
      } = req.body as {
        name?: string; description?: string; docType?: string;
        deliveryMethod?: string; deliveryEmail?: string; customerId?: number;
        fieldMappings?: Record<string, unknown>; scheduleConfig?: Record<string, unknown>;
      };

      if (!name) { res.status(400).json({ error: "name is required" }); return; }
      if (!REPORT_DOC_TYPES.includes(docType as typeof REPORT_DOC_TYPES[number])) {
        res.status(400).json({ error: `invalid docType. Valid values: ${REPORT_DOC_TYPES.join(", ")}` });
        return;
      }
      if (!REPORT_DELIVERY_METHODS.includes(deliveryMethod as typeof REPORT_DELIVERY_METHODS[number])) {
        res.status(400).json({ error: `invalid deliveryMethod. Valid values: ${REPORT_DELIVERY_METHODS.join(", ")}` });
        return;
      }

      const createdByUserId = user.id ?? 0;

      const [def] = await db
        .insert(mspReportDefinitionsTable)
        .values({
          mspId: mspId || 1,
          customerId: customerId ?? null,
          name,
          description: description ?? null,
          docType: docType as typeof REPORT_DOC_TYPES[number],
          deliveryMethod: deliveryMethod as typeof REPORT_DELIVERY_METHODS[number],
          deliveryEmail: deliveryEmail ?? null,
          fieldMappings,
          scheduleConfig,
          isActive: true,
          createdByUserId,
        })
        .returning();

      res.status(201).json({ definition: def });
    } catch (err) {
      logger.error({ err }, "msp-reports: POST definitions failed");
      res.status(500).json({ error: "Failed to create report definition" });
    }
  },
);

// ── GET /api/msp/reports/definitions/:defId ───────────────────────────────────

router.get(
  "/msp/reports/definitions/:defId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const { defId } = req.params as { defId: string };

      const [def] = await db
        .select()
        .from(mspReportDefinitionsTable)
        .where(
          mspId
            ? and(eq(mspReportDefinitionsTable.definitionId, defId), eq(mspReportDefinitionsTable.mspId, mspId))
            : eq(mspReportDefinitionsTable.definitionId, defId),
        )
        .limit(1);

      if (!def) { res.status(404).json({ error: "Report definition not found" }); return; }
      res.json({ definition: def });
    } catch (err) {
      logger.error({ err }, "msp-reports: GET definition failed");
      res.status(500).json({ error: "Failed to fetch definition" });
    }
  },
);

// ── PATCH /api/msp/reports/definitions/:defId ─────────────────────────────────

router.patch(
  "/msp/reports/definitions/:defId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const { defId } = req.params as { defId: string };

      const allowed = ["name", "description", "docType", "deliveryMethod", "deliveryEmail", "fieldMappings", "scheduleConfig", "isActive", "customerId"];
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of allowed) {
        if (key in req.body) updates[key] = (req.body as Record<string, unknown>)[key];
      }

      const [updated] = await db
        .update(mspReportDefinitionsTable)
        .set(updates)
        .where(
          mspId
            ? and(eq(mspReportDefinitionsTable.definitionId, defId), eq(mspReportDefinitionsTable.mspId, mspId))
            : eq(mspReportDefinitionsTable.definitionId, defId),
        )
        .returning();

      if (!updated) { res.status(404).json({ error: "Report definition not found" }); return; }
      res.json({ definition: updated });
    } catch (err) {
      logger.error({ err }, "msp-reports: PATCH definition failed");
      res.status(500).json({ error: "Failed to update definition" });
    }
  },
);

// ── DELETE /api/msp/reports/definitions/:defId ────────────────────────────────

router.delete(
  "/msp/reports/definitions/:defId",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const { defId } = req.params as { defId: string };

      const [deleted] = await db
        .update(mspReportDefinitionsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          mspId
            ? and(eq(mspReportDefinitionsTable.definitionId, defId), eq(mspReportDefinitionsTable.mspId, mspId))
            : eq(mspReportDefinitionsTable.definitionId, defId),
        )
        .returning({ definitionId: mspReportDefinitionsTable.definitionId });

      if (!deleted) { res.status(404).json({ error: "Report definition not found" }); return; }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "msp-reports: DELETE definition failed");
      res.status(500).json({ error: "Failed to delete definition" });
    }
  },
);

// ── POST /api/msp/reports/definitions/:defId/trigger ──────────────────────────

router.post(
  "/msp/reports/definitions/:defId/trigger",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const user = req.user!;
      const { defId } = req.params as { defId: string };

      const [def] = await db
        .select()
        .from(mspReportDefinitionsTable)
        .where(
          mspId
            ? and(eq(mspReportDefinitionsTable.definitionId, defId), eq(mspReportDefinitionsTable.mspId, mspId))
            : eq(mspReportDefinitionsTable.definitionId, defId),
        )
        .limit(1);

      if (!def) { res.status(404).json({ error: "Report definition not found" }); return; }
      if (!def.isActive) { res.status(400).json({ error: "Report definition is inactive" }); return; }

      const docTypeLabel = DOC_TYPE_LABELS[def.docType] ?? def.docType;
      const customerName = def.customerId
        ? await db.select({ name: mspCustomersTable.name }).from(mspCustomersTable).where(eq(mspCustomersTable.id, def.customerId)).limit(1).then(r => r[0]?.name ?? "")
        : null;

      const title = customerName ? `${docTypeLabel} — ${customerName}` : `${docTypeLabel} — Portfolio`;

      const triggeredByUserId = user.id ?? 0;

      const [run] = await db
        .insert(mspReportRunsTable)
        .values({
          definitionId: def.definitionId,
          mspId: def.mspId,
          customerId: def.customerId ?? null,
          title,
          docType: def.docType,
          status: "pending",
          triggeredByUserId,
        })
        .returning();

      if (!run) { res.status(500).json({ error: "Failed to create run" }); return; }

      // Respond immediately — run is now "pending" in msp_report_runs
      res.status(202).json({ runId: run.runId, title, status: "pending" });

      // Route generation through the Portal Workflow Engine so any failure produces
      // a DLQ entry and an operator task identical to every other engine failure.
      void (async () => {
        try {
          await ensureReportGenWorkflow();
          const wfRunId = await createRun({
            workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
            tenantContext: { mspId: def.mspId, customerId: def.customerId ?? null },
            triggerEventType: "msp.report.trigger",
            inputPayload: {
              reportRunId: run.runId,
              definitionId: def.definitionId,
              triggeredByUserId,
            },
          });
          await executeRun(wfRunId);
        } catch (err) {
          logger.error({ err, runId: run.runId }, "msp-reports: workflow engine dispatch error");
        }
      })();
    } catch (err) {
      logger.error({ err }, "msp-reports: trigger failed");
      res.status(500).json({ error: "Failed to trigger report" });
    }
  },
);

// ── GET /api/msp/reports/runs ─────────────────────────────────────────────────

router.get(
  "/msp/reports/runs",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const limit = Math.min(Number(req.query["limit"] ?? 50), 100);
      const defId = req.query["definitionId"] ? String(req.query["definitionId"]) : undefined;

      const conditions = mspId
        ? defId
          ? [eq(mspReportRunsTable.mspId, mspId), eq(mspReportRunsTable.definitionId, defId)]
          : [eq(mspReportRunsTable.mspId, mspId)]
        : defId
          ? [eq(mspReportRunsTable.definitionId, defId)]
          : [];

      const runs = await db
        .select({
          id: mspReportRunsTable.id,
          runId: mspReportRunsTable.runId,
          definitionId: mspReportRunsTable.definitionId,
          mspId: mspReportRunsTable.mspId,
          customerId: mspReportRunsTable.customerId,
          title: mspReportRunsTable.title,
          docType: mspReportRunsTable.docType,
          status: mspReportRunsTable.status,
          pdfSizeBytes: mspReportRunsTable.pdfSizeBytes,
          deliveredAt: mspReportRunsTable.deliveredAt,
          deliveryEmail: mspReportRunsTable.deliveryEmail,
          errorMessage: mspReportRunsTable.errorMessage,
          generatedAt: mspReportRunsTable.generatedAt,
          createdAt: mspReportRunsTable.createdAt,
        })
        .from(mspReportRunsTable)
        .where(conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])) : undefined)
        .orderBy(desc(mspReportRunsTable.createdAt))
        .limit(limit);

      res.json({ runs, total: runs.length });
    } catch (err) {
      logger.error({ err }, "msp-reports: GET runs failed");
      res.status(500).json({ error: "Failed to fetch runs" });
    }
  },
);

// ── GET /api/msp/reports/runs/:runId ─────────────────────────────────────────

router.get(
  "/msp/reports/runs/:runId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const { runId } = req.params as { runId: string };

      const [run] = await db
        .select({
          id: mspReportRunsTable.id,
          runId: mspReportRunsTable.runId,
          definitionId: mspReportRunsTable.definitionId,
          mspId: mspReportRunsTable.mspId,
          customerId: mspReportRunsTable.customerId,
          title: mspReportRunsTable.title,
          docType: mspReportRunsTable.docType,
          status: mspReportRunsTable.status,
          pdfSizeBytes: mspReportRunsTable.pdfSizeBytes,
          deliveredAt: mspReportRunsTable.deliveredAt,
          deliveryEmail: mspReportRunsTable.deliveryEmail,
          errorMessage: mspReportRunsTable.errorMessage,
          generatedAt: mspReportRunsTable.generatedAt,
          createdAt: mspReportRunsTable.createdAt,
        })
        .from(mspReportRunsTable)
        .where(
          mspId
            ? and(eq(mspReportRunsTable.runId, runId), eq(mspReportRunsTable.mspId, mspId))
            : eq(mspReportRunsTable.runId, runId),
        )
        .limit(1);

      if (!run) { res.status(404).json({ error: "Run not found" }); return; }
      res.json({ run });
    } catch (err) {
      logger.error({ err }, "msp-reports: GET run failed");
      res.status(500).json({ error: "Failed to fetch run" });
    }
  },
);

// ── GET /api/msp/reports/runs/:runId/download ────────────────────────────────

router.get(
  "/msp/reports/runs/:runId/download",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      const { runId } = req.params as { runId: string };

      const [run] = await db
        .select({
          runId: mspReportRunsTable.runId,
          mspId: mspReportRunsTable.mspId,
          title: mspReportRunsTable.title,
          docType: mspReportRunsTable.docType,
          status: mspReportRunsTable.status,
          pdfBase64: mspReportRunsTable.pdfBase64,
          htmlContent: mspReportRunsTable.htmlContent,
        })
        .from(mspReportRunsTable)
        .where(
          mspId
            ? and(eq(mspReportRunsTable.runId, runId), eq(mspReportRunsTable.mspId, mspId))
            : eq(mspReportRunsTable.runId, runId),
        )
        .limit(1);

      if (!run) { res.status(404).json({ error: "Run not found" }); return; }
      if (run.status === "pending" || run.status === "generating") {
        res.status(409).json({ error: "Report is still being generated", status: run.status });
        return;
      }
      if (run.status === "failed") {
        res.status(422).json({ error: "Report generation failed", status: run.status });
        return;
      }

      // If we have a stored PDF, serve it
      if (run.pdfBase64) {
        const pdfBuffer = Buffer.from(run.pdfBase64, "base64");
        const safeTitle = (run.title ?? "report").replace(/[^a-zA-Z0-9\s-]/g, "").trim();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
        res.setHeader("Content-Length", String(pdfBuffer.length));
        res.send(pdfBuffer);
        return;
      }

      // Regenerate PDF from stored HTML
      if (run.htmlContent) {
        const pdfBuffer = await buildPdf(stripHtml(run.htmlContent), run.title ?? "Report");
        const safeTitle = (run.title ?? "report").replace(/[^a-zA-Z0-9\s-]/g, "").trim();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
        res.setHeader("Content-Length", String(pdfBuffer.length));
        res.send(pdfBuffer);
        return;
      }

      res.status(404).json({ error: "PDF not available" });
    } catch (err) {
      logger.error({ err }, "msp-reports: download failed");
      res.status(500).json({ error: "Failed to download report" });
    }
  },
);

// ── GET /api/msp/reports/license-waste ───────────────────────────────────────
// Returns license waste KPI data for the dashboard tile.
// Reads client_m365_profiles JSONB for hasLicensingWaste flag and licensing data.

router.get(
  "/msp/reports/license-waste",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);

      // PlatformAdmins browsing without a specific MSP context get a zeroed response
      // rather than a query scoped to msp_id = 0 (which would never match real rows).
      if (!mspId) {
        res.json({
          totalCustomers: 0, customersWithWaste: 0,
          estimatedAnnualSavings: 0, estimatedAnnualSavingsFormatted: "$0",
          totalUnusedLicenses: 0, reportsGenerated: 0, hasData: false,
        });
        return;
      }

      // Count customers with licensing waste detected across MSP's customer portfolio
      // (via msp_customers → client_m365_profiles join)
      const result = await db.execute(sql`
        SELECT
          COUNT(DISTINCT mc.id) AS total_customers,
          COUNT(DISTINCT CASE WHEN (cmp.profile->>'hasLicensingWaste')::boolean = true THEN mc.id END) AS customers_with_waste,
          COALESCE(
            SUM(
              CASE WHEN (cmp.profile->>'hasLicensingWaste')::boolean = true
              THEN COALESCE((cmp.profile->>'estimatedAnnualWasteDollars')::numeric, 0)
              ELSE 0 END
            ), 0
          ) AS estimated_annual_savings,
          COALESCE(
            SUM(
              CASE WHEN (cmp.profile->>'hasLicensingWaste')::boolean = true
              THEN COALESCE((cmp.profile->>'unusedLicenseCount')::integer, 0)
              ELSE 0 END
            ), 0
          ) AS total_unused_licenses
        FROM msp_customers mc
        LEFT JOIN users u ON u.company = mc.name
        LEFT JOIN client_m365_profiles cmp ON cmp.client_id = u.id
        WHERE mc.msp_id = ${mspId}
          AND mc.status = 'active'
      `);

      const row = (result as { rows: Array<Record<string, unknown>> }).rows[0] ?? {};

      const totalCustomers = Number(row["total_customers"] ?? 0);
      const customersWithWaste = Number(row["customers_with_waste"] ?? 0);
      const estimatedAnnualSavings = Number(row["estimated_annual_savings"] ?? 0);
      const totalUnusedLicenses = Number(row["total_unused_licenses"] ?? 0);

      // Also count how many license_waste_report runs have been generated for this MSP
      const [reportCount] = await db
        .select({ n: sql<number>`count(*)` })
        .from(mspReportRunsTable)
        .where(
          mspId
            ? and(eq(mspReportRunsTable.mspId, mspId), eq(mspReportRunsTable.docType, "license_waste_report"))
            : eq(mspReportRunsTable.docType, "license_waste_report"),
        );

      res.json({
        totalCustomers,
        customersWithWaste,
        estimatedAnnualSavings,
        estimatedAnnualSavingsFormatted: estimatedAnnualSavings > 0
          ? `$${(estimatedAnnualSavings / 1000).toFixed(0)}k`
          : customersWithWaste > 0
            ? `~$${(customersWithWaste * 3500).toLocaleString()}`
            : "$0",
        totalUnusedLicenses,
        reportsGenerated: Number(reportCount?.n ?? 0),
        hasData: customersWithWaste > 0,
      });
    } catch (err) {
      logger.error({ err }, "msp-reports: license-waste failed");
      res.status(500).json({ error: "Failed to fetch license waste data" });
    }
  },
);

export default router;
