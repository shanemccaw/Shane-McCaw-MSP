/**
 * admin-insights.ts
 *
 * Insights & Outputs — aggregates telemetry from script_run_results into
 * actionable dashboard data, AI-generated staged deliverables, and recurring
 * automation schedules.
 *
 * GET  /api/admin/insights/scores                  — per-customer M365 health scores
 * GET  /api/admin/insights/heatmap                 — risk heatmap matrix by domain/severity
 * GET  /api/admin/insights/telemetry-summary       — last-N results with findings/recommendations
 * GET  /api/admin/insights/customers               — clients with script run data
 * GET  /api/admin/insights/projects                — projects for a customer
 * GET  /api/admin/insights/documents               — list generated reports
 * GET  /api/admin/insights/documents/:id           — single document
 * GET  /api/admin/insights/documents/:id/download  — download as PDF (default) or HTML
 * POST /api/admin/insights/documents/generate      — AI-generate a report document
 * PUT  /api/admin/insights/documents/:id           — update status / approve / archive
 * DELETE /api/admin/insights/documents/:id         — delete document
 * POST /api/admin/insights/consulting/generate     — AI-generate a consulting deliverable
 * POST /api/admin/insights/consulting/:id/send     — email + SharePoint upload (approved only)
 * GET  /api/admin/insights/automations             — list automations
 * POST /api/admin/insights/automations             — create automation
 * PATCH /api/admin/insights/automations/:id        — update automation
 * DELETE /api/admin/insights/automations/:id       — delete automation
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  scriptRunResultsTable,
  clientScoresTable,
  usersTable,
  projectsTable,
  kanbanTasksTable,
  powershellScriptsTable,
  insightsGeneratedDocumentsTable,
  insightsAutomationsTable,
} from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";
import { getPrompt } from "../lib/prompt-loader";
import { sendMessage } from "../lib/graphEmail";
import {
  graphCredentialsPresent,
  uploadFileToSharePoint,
  ensureSharePointFolderAtRoot,
} from "../lib/graph";
import {
  createRunbookJob,
  isAzureConfigured,
} from "../lib/azure-automation";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const router = Router();

// ── Brand colours ─────────────────────────────────────────────────────────────

const navyPdf  = rgb(0.039, 0.145, 0.251); // #0A2540
const bluePdf  = rgb(0,     0.471, 0.831); // #0078D4
const whitePdf = rgb(1,     1,     1);
const greyPdf  = rgb(0.42,  0.49,  0.56);

const CONSULTING_DELIVERABLES_FOLDER = "Consulting Deliverables";

// ── PDF helpers ───────────────────────────────────────────────────────────────

function sanitizePdf(text: string): string {
  return text
    .replace(/\u2011/g, "-").replace(/\u2013/g, "-").replace(/\u2014/g, "--")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...").replace(/\u00A0/g, " ").replace(/\u2022/g, "-")
    .replace(/[^\x00-\xFF]/g, "?");
}

function dt(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: { font: PDFFont; size: number; color: ReturnType<typeof rgb> },
): void {
  try {
    page.drawText(sanitizePdf(text), { x, y, ...opts });
  } catch { /* non-printable character — skip */ }
}

function wrapText(text: string, maxW: number, font: PDFFont, size: number): string[] {
  const words = sanitizePdf(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    try {
      if (font.widthOfTextAtSize(test, size) <= maxW) { cur = test; continue; }
    } catch { /* skip */ }
    if (cur) lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

/**
 * Convert stored HTML content to structured plain-text lines for PDF rendering.
 * Handles the patterns used by the AI-generated insight documents.
 */
function htmlToLines(html: string): string[] {
  return html
    // Remove the staged-for-review banner (it's admin-only context)
    .replace(/<div[^>]*>⚠️[^<]*Staged for Review[^<]*<\/div>/gi, "")
    .replace(/<div[^>]*>📋[^<]*Staged for Review[^<]*<\/div>/gi, "")
    // Headings
    .replace(/<h1[^>]*>(.*?)<\/h1>/gis, "\n# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gis, "\n## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gis, "\n### $1\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gis, "\n#### $1\n")
    // Table cells (extract text, separated by | )
    .replace(/<th[^>]*>(.*?)<\/th>/gis, " | $1")
    .replace(/<td[^>]*>(.*?)<\/td>/gis, " | $1")
    .replace(/<tr[^>]*>(.*?)<\/tr>/gis, "$1\n")
    .replace(/<t(?:head|body|foot)[^>]*>|<\/t(?:head|body|foot)>/gis, "")
    .replace(/<table[^>]*>|<\/table>/gis, "\n---\n")
    // List items
    .replace(/<li[^>]*>(.*?)<\/li>/gis, "\n- $1")
    .replace(/<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>/gis, "\n")
    // Paragraphs & line breaks
    .replace(/<p[^>]*>(.*?)<\/p>/gis, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr[^>]*\/?>/gi, "\n---\n")
    // Inline formatting — strip tags, keep text
    .replace(/<strong[^>]*>(.*?)<\/strong>/gis, "$1")
    .replace(/<b[^>]*>(.*?)<\/b>/gis, "$1")
    .replace(/<em[^>]*>(.*?)<\/em>/gis, "$1")
    .replace(/<i[^>]*>(.*?)<\/i>/gis, "$1")
    .replace(/<a[^>]*>(.*?)<\/a>/gis, "$1")
    .replace(/<code[^>]*>(.*?)<\/code>/gis, "$1")
    .replace(/<span[^>]*>(.*?)<\/span>/gis, "$1")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // HTML entities
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "--").replace(/&ndash;/g, "-").replace(/&hellip;/g, "...")
    // Normalise whitespace
    .split("\n")
    .map(l => l.trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0)); // collapse consecutive blanks
}

/**
 * Build a branded PDF from an insights document's HTML content.
 * Uses pdf-lib (already a project dependency via service-overview-pdf / generate-artifacts).
 */
async function generateInsightsPdf(
  title: string,
  htmlContent: string,
  clientName: string,
  date: Date,
): Promise<Buffer> {
  const pdfDoc  = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageW  = 595;
  const pageH  = 842;
  const margin = 55;
  const bodyW  = pageW - margin * 2;
  const dateStr = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const addPage = (): PDFPage => {
    const p = pdfDoc.addPage([pageW, pageH]);
    // Header bar
    p.drawRectangle({ x: 0, y: pageH - 52, width: pageW, height: 52, color: navyPdf });
    dt(p, "Shane McCaw Consulting",     margin, pageH - 22, { font: bold,    size: 14, color: whitePdf });
    dt(p, "Lead Microsoft 365 Architect", margin, pageH - 38, { font: regular, size:  9, color: rgb(0.7, 0.8, 0.9) });
    // Footer bar
    p.drawRectangle({ x: 0, y: 0, width: pageW, height: 28, color: navyPdf });
    dt(p, clientName,      margin,          10, { font: regular, size: 7, color: rgb(0.6, 0.7, 0.8) });
    dt(p, `Generated ${dateStr}`, pageW - 160, 10, { font: regular, size: 7, color: rgb(0.5, 0.6, 0.7) });
    return p;
  };

  let page = addPage();
  let y = pageH - 72;

  // Document title
  dt(page, title, margin, y, { font: bold, size: 15, color: navyPdf });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1.5, color: bluePdf });
  y -= 24;

  const lines = htmlToLines(htmlContent);

  for (const line of lines) {
    if (y < 50) { page = addPage(); y = pageH - 72; }

    if (line.startsWith("# ")) {
      const text = line.slice(2).trim();
      y -= 4;
      dt(page, text, margin, y, { font: bold, size: 13, color: navyPdf });
      y -= 5;
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.8, color: bluePdf });
      y -= 14;
    } else if (line.startsWith("## ")) {
      y -= 2;
      dt(page, line.slice(3).trim(), margin, y, { font: bold, size: 11, color: bluePdf });
      y -= 14;
    } else if (line.startsWith("### ") || line.startsWith("#### ")) {
      const lvl = line.startsWith("#### ") ? 5 : 4;
      dt(page, line.slice(lvl).trim(), margin, y, { font: bold, size: 10, color: navyPdf });
      y -= 13;
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = line.slice(2).trim();
      const wrapped = wrapText(text, bodyW - 14, regular, 9);
      for (let i = 0; i < wrapped.length; i++) {
        if (y < 50) { page = addPage(); y = pageH - 72; }
        if (i === 0) dt(page, "•", margin, y, { font: bold, size: 9, color: bluePdf });
        dt(page, wrapped[i]!, margin + 12, y, { font: regular, size: 9, color: navyPdf });
        y -= 12;
      }
    } else if (line === "---") {
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: greyPdf });
      y -= 8;
    } else if (line === "") {
      y -= 6;
    } else if (line.startsWith("| ")) {
      // Table row — render as plain indented line
      const cellText = line.replace(/\|/g, "  ").trim();
      const wrapped = wrapText(cellText, bodyW - 8, regular, 8);
      for (const wl of wrapped) {
        if (y < 50) { page = addPage(); y = pageH - 72; }
        dt(page, wl, margin + 4, y, { font: regular, size: 8, color: navyPdf });
        y -= 11;
      }
    } else {
      const wrapped = wrapText(line, bodyW, regular, 9);
      for (const wl of wrapped) {
        if (y < 50) { page = addPage(); y = pageH - 72; }
        dt(page, wl, margin, y, { font: regular, size: 9, color: navyPdf });
        y -= 13;
      }
      y -= 3;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ── Telemetry helpers ─────────────────────────────────────────────────────────

function computeScoresFromRuns(runs: { scoreImpact: Record<string, number> }[]): {
  security: number; governance: number; readiness: number; composite: number;
} {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const run of runs) {
    for (const [k, v] of Object.entries(run.scoreImpact ?? {})) {
      sums[k] = (sums[k] ?? 0) + v;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const avg = (key: string, fallback = 0): number =>
    counts[key] ? Math.min(100, Math.max(0, Math.round(sums[key]! / counts[key]!))) : fallback;

  const security = avg("security", avg("Security", 60));
  const governance = avg("governance", avg("Governance", 55));
  const readiness = avg("copilotReadiness", avg("copilot_readiness", avg("CopilotReadiness", 50)));
  const composite = Math.round((security + governance + readiness) / 3);
  return { security, governance, readiness, composite };
}

function collectFindings(runs: { parsedFindings: string[]; recommendations: string[] }[]): {
  findings: string[]; recommendations: string[];
} {
  const findings = new Set<string>();
  const recommendations = new Set<string>();
  for (const run of runs) {
    for (const f of run.parsedFindings ?? []) findings.add(f);
    for (const r of run.recommendations ?? []) recommendations.add(r);
  }
  return { findings: [...findings].slice(0, 50), recommendations: [...recommendations].slice(0, 50) };
}

/**
 * Fetch completed script runs for a customer, optionally filtered by project
 * (via the kanban_tasks → projects FK chain).
 */
async function fetchRunsForCustomer(customerId?: number, projectId?: number, limit = 100) {
  const conditions: ReturnType<typeof eq>[] = [
    eq(scriptRunResultsTable.status, "completed") as ReturnType<typeof eq>,
  ];
  if (customerId) {
    conditions.push(eq(scriptRunResultsTable.customerId, customerId) as ReturnType<typeof eq>);
  }

  // Project filter: script_run_results → kanban_tasks.project_id
  if (projectId) {
    const taskRows = await db
      .select({ id: kanbanTasksTable.id })
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.projectId, projectId));
    const taskIds = taskRows.map(t => t.id);
    if (taskIds.length === 0) return []; // no runs for this project
    conditions.push(
      inArray(scriptRunResultsTable.kanbanTaskId, taskIds) as unknown as ReturnType<typeof eq>,
    );
  }

  return db.select({
    id: scriptRunResultsTable.id,
    customerId: scriptRunResultsTable.customerId,
    scoreImpact: scriptRunResultsTable.scoreImpact,
    parsedFindings: scriptRunResultsTable.parsedFindings,
    recommendations: scriptRunResultsTable.recommendations,
    profileUpdates: scriptRunResultsTable.profileUpdates,
    createdAt: scriptRunResultsTable.createdAt,
    status: scriptRunResultsTable.status,
  }).from(scriptRunResultsTable)
    .where(and(...conditions))
    .orderBy(desc(scriptRunResultsTable.createdAt))
    .limit(limit);
}

// ── GET /api/admin/insights/scores ────────────────────────────────────────────

router.get("/admin/insights/scores", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = req.query["customerId"] ? parseInt(String(req.query["customerId"]), 10) : undefined;
    const projectId  = req.query["projectId"]  ? parseInt(String(req.query["projectId"]),  10) : undefined;

    const [runs, clientScores, totalRunsRaw] = await Promise.all([
      fetchRunsForCustomer(customerId, projectId, 200),

      db.select({
        clientId: clientScoresTable.clientId,
        identity: clientScoresTable.identity,
        security: clientScoresTable.security,
        collaboration: clientScoresTable.collaboration,
        compliance: clientScoresTable.compliance,
        copilotReadiness: clientScoresTable.copilotReadiness,
        updatedAt: clientScoresTable.updatedAt,
      }).from(clientScoresTable)
        .where(customerId ? eq(clientScoresTable.clientId, customerId) : sql`TRUE`)
        .limit(50),

      db.select({ count: sql<number>`count(*)::int` })
        .from(scriptRunResultsTable)
        .where(
          and(
            eq(scriptRunResultsTable.status, "completed"),
            ...(customerId ? [eq(scriptRunResultsTable.customerId, customerId)] : []),
          ),
        ),
    ]);

    const scores = computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
    const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);

    const runsWithFindings = (runs as { parsedFindings: string[] }[]).filter(r => r.parsedFindings?.length > 0).length;
    const coveragePct = runs.length > 0 ? Math.round((runsWithFindings / runs.length) * 100) : 0;

    let totalGaps = 0;
    for (const run of runs as { profileUpdates: Record<string, unknown> }[]) {
      for (const v of Object.values(run.profileUpdates ?? {})) {
        if (v === false || v === null || v === "" || v === 0) totalGaps++;
      }
    }

    // Weekly trend (last 8 weeks)
    const weeklyTrend: { week: string; composite: number; security: number; governance: number; readiness: number }[] = [];
    const now = new Date();
    for (let w = 7; w >= 0; w--) {
      const weekEnd = new Date(now); weekEnd.setDate(now.getDate() - w * 7);
      const weekStart = new Date(weekEnd); weekStart.setDate(weekEnd.getDate() - 7);
      const weekRuns = (runs as { createdAt: Date; scoreImpact: Record<string, number> }[]).filter(r => {
        const d = new Date(r.createdAt);
        return d >= weekStart && d < weekEnd;
      });
      if (weekRuns.length > 0) {
        weeklyTrend.push({ week: weekStart.toISOString().slice(0, 10), ...computeScoresFromRuns(weekRuns) });
      }
    }

    const caEntries = (runs as { profileUpdates: Record<string, unknown> }[]).flatMap(r =>
      Object.entries(r.profileUpdates ?? {}).filter(([k]) => k.toLowerCase().includes("conditionalaccess") || k.toLowerCase().includes("ca_"))
    );
    const deviceEntries = (runs as { profileUpdates: Record<string, unknown> }[]).flatMap(r =>
      Object.entries(r.profileUpdates ?? {}).filter(([k]) => k.toLowerCase().includes("device") || k.toLowerCase().includes("intune"))
    );
    const conditionalAccessPct = caEntries.length > 0
      ? Math.round((caEntries.filter(([, v]) => v === true).length / caEntries.length) * 100) : 0;
    const deviceCompliancePct  = deviceEntries.length > 0
      ? Math.round((deviceEntries.filter(([, v]) => v === true).length / deviceEntries.length) * 100) : 0;

    res.json({
      scores, coveragePct, totalGaps,
      totalRuns: totalRunsRaw[0]?.count ?? 0,
      findings, recommendations, clientScores, weeklyTrend,
      conditionalAccessPct, deviceCompliancePct,
    });
  } catch (err) {
    logger.error({ err }, "insights scores error");
    res.status(500).json({ error: "Failed to load insights scores" });
  }
});

// ── GET /api/admin/insights/heatmap ───────────────────────────────────────────

const DOMAINS = ["Identity", "Security", "Exchange", "SharePoint", "Devices", "Compliance"] as const;
type Domain = typeof DOMAINS[number];

const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  Identity:    ["identity", "user", "mfa", "password", "entra", "aad", "signin"],
  Security:    ["security", "threat", "conditional", "defender", "audit"],
  Exchange:    ["exchange", "mail", "email", "outlook", "message", "spam"],
  SharePoint:  ["sharepoint", "onedrive", "site", "document"],
  Devices:     ["device", "intune", "mdm", "compliance", "endpoint"],
  Compliance:  ["compliance", "dlp", "retention", "purview", "policy"],
};

function classifyDomain(text: string): Domain {
  const lower = text.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [Domain, string[]][]) {
    if (keywords.some(k => lower.includes(k))) return domain;
  }
  return "Security";
}

router.get("/admin/insights/heatmap", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = req.query["customerId"] ? parseInt(String(req.query["customerId"]), 10) : undefined;
    const projectId  = req.query["projectId"]  ? parseInt(String(req.query["projectId"]),  10) : undefined;
    const runs = await fetchRunsForCustomer(customerId, projectId, 100);

    const matrix: Record<Domain, { high: number; medium: number; low: number; total: number }> = {} as never;
    for (const d of DOMAINS) matrix[d] = { high: 0, medium: 0, low: 0, total: 0 };

    for (const run of runs as { parsedFindings: string[]; scoreImpact: Record<string, number> }[]) {
      const scores = computeScoresFromRuns([run]);
      for (const finding of run.parsedFindings ?? []) {
        const domain = classifyDomain(finding);
        const severity = scores.composite < 40 ? "high" : scores.composite < 65 ? "medium" : "low";
        matrix[domain][severity]++;
        matrix[domain].total++;
      }
    }

    const heatmap = DOMAINS.map(domain => ({
      domain,
      high: matrix[domain].high, medium: matrix[domain].medium, low: matrix[domain].low,
      total: matrix[domain].total,
      riskScore: matrix[domain].high * 3 + matrix[domain].medium * 2 + matrix[domain].low,
    }));

    res.json({ heatmap, domains: DOMAINS });
  } catch (err) {
    logger.error({ err }, "insights heatmap error");
    res.status(500).json({ error: "Failed to load heatmap" });
  }
});

// ── GET /api/admin/insights/telemetry-summary ─────────────────────────────────

router.get("/admin/insights/telemetry-summary", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = req.query["customerId"] ? parseInt(String(req.query["customerId"]), 10) : undefined;
    const projectId  = req.query["projectId"]  ? parseInt(String(req.query["projectId"]),  10) : undefined;
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 50);
    const runs = await fetchRunsForCustomer(customerId, projectId, limit);
    res.json({ results: runs, total: runs.length });
  } catch (err) {
    logger.error({ err }, "insights telemetry-summary error");
    res.status(500).json({ error: "Failed to load telemetry summary" });
  }
});

// ── GET /api/admin/insights/customers ─────────────────────────────────────────

router.get("/admin/insights/customers", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT u.id, u.name, u.email, u.company
      FROM users u
      INNER JOIN script_run_results sr ON sr.customer_id = u.id
      WHERE u.role = 'client'
      ORDER BY u.name
      LIMIT 100
    `);
    type Row = { id: number; name: string; email: string; company: string };
    res.json({ customers: (rows as unknown as { rows: Row[] }).rows ?? [] });
  } catch (err) {
    logger.error({ err }, "insights customers error");
    res.status(500).json({ error: "Failed to load customers" });
  }
});

// ── GET /api/admin/insights/projects ──────────────────────────────────────────

router.get("/admin/insights/projects", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = req.query["customerId"] ? parseInt(String(req.query["customerId"]), 10) : undefined;
    const projects = await db.select({
      id: projectsTable.id,
      title: projectsTable.title,
      status: projectsTable.status,
      phase: projectsTable.phase,
      sharepointFolderUrl: projectsTable.sharepointFolderUrl,
    }).from(projectsTable)
      .where(customerId ? eq(projectsTable.clientUserId, customerId) : sql`TRUE`)
      .orderBy(desc(projectsTable.createdAt))
      .limit(50);
    res.json({ projects });
  } catch (err) {
    logger.error({ err }, "insights projects error");
    res.status(500).json({ error: "Failed to load projects" });
  }
});

// ── GET /api/admin/insights/documents ─────────────────────────────────────────

router.get("/admin/insights/documents", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = req.query["customerId"] ? parseInt(String(req.query["customerId"]), 10) : undefined;
    const projectId  = req.query["projectId"]  ? parseInt(String(req.query["projectId"]),  10) : undefined;
    const category   = req.query["category"] as "report" | "consulting" | undefined;
    const status     = req.query["status"] as string | undefined;

    const conditions = [];
    if (customerId) conditions.push(eq(insightsGeneratedDocumentsTable.customerId, customerId));
    if (projectId)  conditions.push(eq(insightsGeneratedDocumentsTable.projectId,  projectId));
    if (category)   conditions.push(eq(insightsGeneratedDocumentsTable.category,   category));
    if (status)     conditions.push(eq(insightsGeneratedDocumentsTable.status, status as "draft" | "approved" | "delivered" | "archived"));

    const docs = await db.select({
      id: insightsGeneratedDocumentsTable.id,
      customerId: insightsGeneratedDocumentsTable.customerId,
      projectId: insightsGeneratedDocumentsTable.projectId,
      category: insightsGeneratedDocumentsTable.category,
      docType: insightsGeneratedDocumentsTable.docType,
      title: insightsGeneratedDocumentsTable.title,
      pdfUrl: insightsGeneratedDocumentsTable.pdfUrl,
      status: insightsGeneratedDocumentsTable.status,
      approvedAt: insightsGeneratedDocumentsTable.approvedAt,
      deliveredAt: insightsGeneratedDocumentsTable.deliveredAt,
      createdAt: insightsGeneratedDocumentsTable.createdAt,
      updatedAt: insightsGeneratedDocumentsTable.updatedAt,
    }).from(insightsGeneratedDocumentsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
      .limit(100);

    res.json({ documents: docs });
  } catch (err) {
    logger.error({ err }, "insights documents list error");
    res.status(500).json({ error: "Failed to load documents" });
  }
});

// ── GET /api/admin/insights/documents/:id ─────────────────────────────────────

router.get("/admin/insights/documents/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [doc] = await db.select().from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id)).limit(1);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    return res.json({ document: doc });
  } catch (err) {
    logger.error({ err }, "insights document fetch error");
    return res.status(500).json({ error: "Failed to load document" });
  }
});

// ── GET /api/admin/insights/documents/:id/download ────────────────────────────
// Serves a real PDF generated from the stored HTML content using pdf-lib.
// Pass ?format=html to get the raw HTML instead.

router.get("/admin/insights/documents/:id/download", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [doc] = await db.select({
      id: insightsGeneratedDocumentsTable.id,
      title: insightsGeneratedDocumentsTable.title,
      htmlContent: insightsGeneratedDocumentsTable.htmlContent,
      customerId: insightsGeneratedDocumentsTable.customerId,
      createdAt: insightsGeneratedDocumentsTable.createdAt,
    }).from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id)).limit(1);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const safeTitle = (doc.title ?? "document").replace(/[^a-z0-9_\- ]/gi, "_").slice(0, 80);
    const format = String(req.query["format"] ?? "pdf").toLowerCase();

    if (format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.html"`);
      return res.send(doc.htmlContent);
    }

    // Default: PDF
    let clientName = "Shane McCaw Consulting";
    if (doc.customerId) {
      const [cust] = await db.select({ name: usersTable.name, company: usersTable.company })
        .from(usersTable).where(eq(usersTable.id, doc.customerId)).limit(1);
      clientName = cust?.company ?? cust?.name ?? clientName;
    }

    const pdfBuffer = await generateInsightsPdf(
      doc.title,
      doc.htmlContent,
      clientName,
      new Date(doc.createdAt),
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err }, "insights document download error");
    return res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// ── POST /api/admin/insights/documents/generate ───────────────────────────────

const REPORT_DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary:          "Executive Summary",
  full_readiness_report:      "Full Readiness Report",
  security_posture_report:    "Security Posture Report",
  governance_maturity_report: "Governance Maturity Report",
  data_exposure_risk_report:  "Data Exposure Risk Report",
  license_optimization_report:"License Optimization Report",
};

// Substitutes {{token}} placeholders in a prompt template string.
function substituteTokens(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    template,
  );
}

// Fallback prompt used when the DB row is missing (first boot, seed race, etc.)
const INSIGHTS_REPORT_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect. Generate a professional, client-facing {{docLabel}} in HTML format.

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
- Structure: header with "Shane McCaw Consulting" + report metadata, executive overview table with the 4 score cards, findings section with a data table, recommendations section, configuration status summary (use profileUpdates data), next steps, footer with Shane's name
- Write in first person as Shane McCaw with professional consulting tone
- Be specific and actionable — reference actual findings, not generic advice
- Include at the very top: <div style="background:#fff3cd;border:1px solid #ffc107;padding:10px 16px;margin-bottom:20px;border-radius:6px;font-size:13px">⚠️ <strong>Staged for Review</strong> — This document has not been delivered to the client. Approve it in the Admin Panel before sending.</div>
- Total length: 800-1500 words of body content`;

const INSIGHTS_CONSULTING_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a professional consulting {{typeLabel}} in HTML format.

Client: {{clientName}}
{{projectDesc}}Deliverable title: {{title}}
Date: {{date}}

M365 Health Context:
{{scores}}

Key Findings: {{findings}}
Key Recommendations: {{recommendations}}

Configuration Telemetry Sample (from profileUpdates — use in your analysis):
{{profileSample}}

Document Sections Required:
{{sectionHints}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — professional white background, #0078D4 (Azure Blue) accent, Inter/system-font typography, responsive tables
- Each major section as <h2> with a horizontal rule separator
- Data tables where appropriate (border-collapse, alternating rows)
- Use [TO BE DETERMINED] placeholders for pricing/dates that need client input
- Professional consulting tone as Shane McCaw, first person where appropriate
- Include at the very top: <div style="background:#d1ecf1;border:1px solid #bee5eb;padding:10px 16px;margin-bottom:24px;border-radius:6px;font-size:13px">📋 <strong>Staged for Review</strong> — Review this deliverable and click <em>Send to Customer</em> only after explicit approval.</div>
- Total length: 1000-2000 words`;

const generateDocSchema = z.object({
  customerId: z.number().int().positive().optional(),
  projectId:  z.number().int().positive().optional(),
  docType:    z.string().min(1),
  title:      z.string().min(1).max(200),
});

router.post("/admin/insights/documents/generate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = generateDocSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    const { customerId, projectId, docType, title } = body.data;

    const [runs, customer, project] = await Promise.all([
      fetchRunsForCustomer(customerId, projectId, 50),
      customerId
        ? db.select({ name: usersTable.name, company: usersTable.company })
            .from(usersTable).where(eq(usersTable.id, customerId)).limit(1)
        : Promise.resolve([]),
      projectId
        ? db.select({ title: projectsTable.title }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1)
        : Promise.resolve([]),
    ]);

    const scores = computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
    const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);
    const clientName  = (customer as { company: string | null; name: string | null }[])[0]?.company
      ?? (customer as { company: string | null; name: string | null }[])[0]?.name ?? "Client";
    const projectName = (project as { title: string }[])[0]?.title ?? "";
    const docLabel    = REPORT_DOC_TYPE_LABELS[docType] ?? docType;

    // Build structured profileUpdates data table for richer AI context
    const profileSample = (runs as { profileUpdates: Record<string, unknown> }[])
      .flatMap(r => Object.entries(r.profileUpdates ?? {}).slice(0, 5))
      .slice(0, 30)
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join("\n");

    const scoresBlock = `- Security: ${scores.security}/100\n- Governance: ${scores.governance}/100\n- Copilot Readiness: ${scores.readiness}/100\n- Composite: ${scores.composite}/100`;
    const findingsBlock = findings.slice(0, 15).map((f, i) => `${i + 1}. ${f}`).join("\n") || "No findings recorded yet — assessment runs pending.";
    const recommendationsBlock = recommendations.slice(0, 10).map((r, i) => `${i + 1}. ${r}`).join("\n") || "No recommendations recorded yet.";

    const rawReportTemplate = await getPrompt(`insights-report-${docType}`, INSIGHTS_REPORT_PROMPT_FALLBACK);
    const prompt = substituteTokens(rawReportTemplate, {
      docLabel,
      clientName,
      projectLine: projectName ? ` · Project: ${projectName}` : "",
      title,
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      scores: scoresBlock,
      findingsCount: String(findings.length),
      findings: findingsBlock,
      recommendationsCount: String(recommendations.length),
      recommendations: recommendationsBlock,
      profileSample: profileSample || "  No telemetry captured yet.",
      runCount: String(runs.length),
    });

    const aiResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const htmlContent = (aiResponse.content[0] as { text: string }).text ?? "";

    // Insert with placeholder pdfUrl — updated after we have the id
    const [newDoc] = await db.insert(insightsGeneratedDocumentsTable).values({
      customerId: customerId ?? null,
      projectId:  projectId  ?? null,
      category:   "report",
      docType,
      title,
      htmlContent,
      status: "draft",
      pdfUrl: null, // will be set below
    }).returning();

    // Set pdfUrl to the canonical download endpoint for this document
    const pdfUrl = `/api/admin/insights/documents/${newDoc!.id}/download`;
    const [withPdf] = await db.update(insightsGeneratedDocumentsTable)
      .set({ pdfUrl })
      .where(eq(insightsGeneratedDocumentsTable.id, newDoc!.id))
      .returning();

    return res.json({ document: withPdf });
  } catch (err) {
    logger.error({ err }, "insights document generate error");
    return res.status(500).json({ error: "Failed to generate document" });
  }
});

// ── PUT /api/admin/insights/documents/:id ─────────────────────────────────────

const updateDocSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  htmlContent: z.string().optional(),
  status:      z.enum(["draft", "approved", "delivered", "archived"]).optional(),
});

router.put("/admin/insights/documents/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const body = updateDocSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });

    const updates: Partial<typeof insightsGeneratedDocumentsTable.$inferInsert> = { updatedAt: new Date() };
    if (body.data.title       !== undefined) updates.title       = body.data.title;
    if (body.data.htmlContent !== undefined) updates.htmlContent = body.data.htmlContent;
    if (body.data.status      !== undefined) {
      updates.status = body.data.status;
      if (body.data.status === "approved") updates.approvedAt = new Date();
      if (body.data.status === "delivered") updates.deliveredAt = new Date();
    }

    const [updated] = await db.update(insightsGeneratedDocumentsTable)
      .set(updates).where(eq(insightsGeneratedDocumentsTable.id, id)).returning();

    if (!updated) return res.status(404).json({ error: "Document not found" });
    return res.json({ document: updated });
  } catch (err) {
    logger.error({ err }, "insights document update error");
    return res.status(500).json({ error: "Failed to update document" });
  }
});

// ── DELETE /api/admin/insights/documents/:id ──────────────────────────────────

router.delete("/admin/insights/documents/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    await db.delete(insightsGeneratedDocumentsTable).where(eq(insightsGeneratedDocumentsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "insights document delete error");
    return res.status(500).json({ error: "Failed to delete document" });
  }
});

// ── POST /api/admin/insights/consulting/generate ──────────────────────────────

const CONSULTING_TYPE_LABELS: Record<string, string> = {
  sow:                        "Statement of Work",
  remediation_plan:           "Remediation Plan",
  deployment_plan:            "Deployment Plan",
  governance_framework:       "Governance Framework",
  security_hardening_plan:    "Security Hardening Plan",
  copilot_enablement_plan:    "Copilot Enablement Plan",
  identity_modernization_plan:"Identity Modernization Plan",
};

const generateConsultingSchema = z.object({
  customerId:      z.number().int().positive().optional(),
  projectId:       z.number().int().positive().optional(),
  deliverableType: z.string().min(1),
  title:           z.string().min(1).max(200),
});

router.post("/admin/insights/consulting/generate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = generateConsultingSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    const { customerId, projectId, deliverableType, title } = body.data;

    const [runs, customer, project] = await Promise.all([
      fetchRunsForCustomer(customerId, projectId, 50),
      customerId
        ? db.select({ name: usersTable.name, company: usersTable.company })
            .from(usersTable).where(eq(usersTable.id, customerId)).limit(1)
        : Promise.resolve([]),
      projectId
        ? db.select({ title: projectsTable.title, phase: projectsTable.phase, description: projectsTable.description })
            .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1)
        : Promise.resolve([]),
    ]);

    const scores = computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
    const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);
    const clientName  = (customer as { company: string | null; name: string | null }[])[0]?.company
      ?? (customer as { company: string | null; name: string | null }[])[0]?.name ?? "Client";
    const projRow     = (project as { title: string; phase: string | null; description: string | null }[])[0];
    const projectDesc = projRow ? `Project: ${projRow.title}${projRow.phase ? ` (${projRow.phase})` : ""}${projRow.description ? ` — ${projRow.description}` : ""}` : "";

    const profileSample = (runs as { profileUpdates: Record<string, unknown> }[])
      .flatMap(r => Object.entries(r.profileUpdates ?? {}).slice(0, 5))
      .slice(0, 30)
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join("\n");

    const sectionHints: Record<string, string> = {
      sow:                        "Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Pricing (use [TBD] placeholders), Acceptance Criteria, Terms & Conditions",
      remediation_plan:           "Include: Executive Summary, Current State Assessment, Critical Findings, Remediation Steps by Domain (Priority 1/2/3), Implementation Timeline, Success Metrics, Risk Mitigation",
      deployment_plan:            "Include: Deployment Overview, Pre-deployment Checklist, Environment Readiness, Phased Rollout Plan, Rollback Procedure, Testing & Validation, Go-live Criteria, Post-deployment Support",
      governance_framework:       "Include: Governance Principles, Roles & Responsibilities Matrix, Policy Framework, Compliance Requirements, Enforcement Mechanisms, Review Cadence, Exception Process",
      security_hardening_plan:    "Include: Threat Assessment, Identity & Access Hardening, Conditional Access Policy Design, Privileged Access Workstations, Defender Configuration, Security Monitoring, Incident Response",
      copilot_enablement_plan:    "Include: Readiness Assessment, License & Entitlement Review, Data Governance Pre-work, Pilot Group Selection, Training Plan, Success Metrics, Rollout Phases, Adoption Strategy",
      identity_modernization_plan:"Include: Current Identity State, Entra ID Configuration, MFA Enforcement, Privileged Identity Management, External Identities, B2B/B2C Strategy, Migration Roadmap, Legacy System Decommission",
    };

    const typeLabel = CONSULTING_TYPE_LABELS[deliverableType] ?? deliverableType;

    const scoresBlock = `- Security Score: ${scores.security}/100\n- Governance Score: ${scores.governance}/100\n- Copilot Readiness: ${scores.readiness}/100\n- Composite: ${scores.composite}/100`;
    const findingsInline = findings.slice(0, 10).join("; ") || "Pending assessment runs";
    const recommendationsInline = recommendations.slice(0, 8).join("; ") || "Pending assessment runs";

    // Fallback injects per-type section hints for the case where the DB row is absent
    const consultingFallback = substituteTokens(INSIGHTS_CONSULTING_PROMPT_FALLBACK, {
      sectionHints: sectionHints[deliverableType] ?? "Include relevant sections for this type of consulting deliverable",
    });
    const rawConsultingTemplate = await getPrompt(`insights-consulting-${deliverableType}`, consultingFallback);
    const prompt = substituteTokens(rawConsultingTemplate, {
      typeLabel,
      clientName,
      projectDesc: projectDesc ? projectDesc + "\n" : "",
      title,
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      scores: scoresBlock,
      findings: findingsInline,
      recommendations: recommendationsInline,
      profileSample: profileSample || "  No telemetry captured yet.",
      sectionHints: sectionHints[deliverableType] ?? "Include relevant sections for this type of consulting deliverable",
    });

    const aiResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const htmlContent = (aiResponse.content[0] as { text: string }).text ?? "";

    const [newDoc] = await db.insert(insightsGeneratedDocumentsTable).values({
      customerId: customerId ?? null,
      projectId:  projectId  ?? null,
      category:   "consulting",
      docType:    deliverableType,
      title,
      htmlContent,
      status: "draft",
      pdfUrl: null,
    }).returning();

    const pdfUrl = `/api/admin/insights/documents/${newDoc!.id}/download`;
    const [withPdf] = await db.update(insightsGeneratedDocumentsTable)
      .set({ pdfUrl })
      .where(eq(insightsGeneratedDocumentsTable.id, newDoc!.id))
      .returning();

    return res.json({ document: withPdf });
  } catch (err) {
    logger.error({ err }, "insights consulting generate error");
    return res.status(500).json({ error: "Failed to generate consulting deliverable" });
  }
});

// ── POST /api/admin/insights/consulting/:id/send ──────────────────────────────
// 1. Validates the document is approved
// 2. Sends email via Exchange Online (Graph)
// 3. Uploads PDF to client's SharePoint site (best-effort, non-fatal)
// 4. Marks as delivered

router.post("/admin/insights/consulting/:id/send", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [doc] = await db.select().from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id)).limit(1);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (doc.status !== "approved") {
      return res.status(400).json({ error: "Document must be approved before sending. Approve it first." });
    }

    const recipientEmail = req.body.recipientEmail as string | undefined;
    const subject        = req.body.subject as string | undefined ?? `${doc.title} — Shane McCaw Consulting`;

    // Look up customer email + SharePoint site ID
    let toEmail         = recipientEmail;
    let sharepointSiteId: string | null = null;
    let clientName      = "Client";

    if (doc.customerId) {
      const [cust] = await db.select({
        email: usersTable.email,
        name: usersTable.name,
        company: usersTable.company,
        sharepointSiteId: usersTable.sharepointSiteId,
      }).from(usersTable).where(eq(usersTable.id, doc.customerId)).limit(1);

      if (cust) {
        if (!toEmail) toEmail = cust.email;
        sharepointSiteId = cust.sharepointSiteId ?? null;
        clientName = cust.company ?? cust.name ?? "Client";
      }
    }

    if (!toEmail) {
      return res.status(400).json({
        error: "No recipient email — provide recipientEmail or link the document to a customer with an email address.",
      });
    }

    const mailUserId = process.env["GRAPH_MAIL_USER_ID"];
    if (!mailUserId || !graphCredentialsPresent()) {
      return res.status(503).json({
        error: "Exchange Online not configured. Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, and GRAPH_MAIL_USER_ID in Replit Secrets.",
      });
    }

    // 1. Send email
    const emailBody = `${doc.htmlContent}
<hr style="margin:24px 0">
<p style="font-size:12px;color:#666">Sent by Shane McCaw Consulting · <a href="https://shanemccaw.com">shanemccaw.com</a></p>`;

    const sent = await sendMessage({
      userId: mailUserId,
      to: [toEmail],
      subject,
      body: emailBody,
      bodyType: "html",
    });
    if (!sent) return res.status(500).json({ error: "Failed to send email via Exchange Online" });

    // 2. SharePoint upload (best-effort — non-fatal if not configured)
    let sharepointUrl: string | null = null;
    if (sharepointSiteId && graphCredentialsPresent()) {
      try {
        await ensureSharePointFolderAtRoot(sharepointSiteId, CONSULTING_DELIVERABLES_FOLDER);
        const pdfBuffer = await generateInsightsPdf(doc.title, doc.htmlContent, clientName, new Date(doc.createdAt));
        const safeTitle = doc.title.replace(/[^a-z0-9_\- ]/gi, "_").slice(0, 80);
        const filename  = `${safeTitle}_${new Date().toISOString().slice(0, 10)}.pdf`;
        sharepointUrl = await uploadFileToSharePoint(
          sharepointSiteId,
          CONSULTING_DELIVERABLES_FOLDER,
          filename,
          pdfBuffer,
          "application/pdf",
        );
        logger.info({ docId: id, filename, sharepointUrl }, "insights: consulting deliverable uploaded to SharePoint");
      } catch (spErr) {
        logger.warn({ spErr, docId: id }, "insights: SharePoint upload failed (non-fatal) — email was still sent");
      }
    } else {
      logger.info({ docId: id, sharepointSiteId }, "insights: SharePoint upload skipped — site not configured or Graph not available");
    }

    // 3. Mark delivered; update pdfUrl with SharePoint URL if we got one
    const [updated] = await db.update(insightsGeneratedDocumentsTable)
      .set({
        status:      "delivered",
        deliveredAt: new Date(),
        updatedAt:   new Date(),
        ...(sharepointUrl ? { pdfUrl: sharepointUrl } : {}),
      })
      .where(eq(insightsGeneratedDocumentsTable.id, id))
      .returning();

    return res.json({ ok: true, document: updated, sentTo: toEmail, sharepointUrl });
  } catch (err) {
    logger.error({ err }, "insights consulting send error");
    return res.status(500).json({ error: "Failed to send document" });
  }
});

// ── GET /api/admin/insights/automations ───────────────────────────────────────

router.get("/admin/insights/automations", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const automations = await db.select().from(insightsAutomationsTable)
      .orderBy(desc(insightsAutomationsTable.createdAt)).limit(50);
    const withLabels = automations.map(a => ({ ...a, cronLabel: describeCron(a.cronExpression) }));
    return res.json({ automations: withLabels });
  } catch (err) {
    logger.error({ err }, "insights automations list error");
    return res.status(500).json({ error: "Failed to load automations" });
  }
});

// ── POST /api/admin/insights/automations ──────────────────────────────────────

const AUTOMATION_TYPES = [
  "monthly_tenant_health_report", "quarterly_governance_review",
  "weekly_security_drift_alerts", "license_waste_monitoring", "conditional_access_drift_detection",
] as const;

const createAutomationSchema = z.object({
  name:                   z.string().min(1).max(200),
  customerId:             z.number().int().positive().optional(),
  projectId:              z.number().int().positive().optional(),
  automationType:         z.enum(AUTOMATION_TYPES),
  cronExpression:         z.string().min(1).max(100).default("0 9 1 * *"),
  enabled:                z.boolean().default(true),
  generateDocument:       z.boolean().default(true),
  linkedRunbookScriptId:  z.string().optional(),
});

export function nextRunFromCron(cron: string): Date {
  const candidate = new Date(Date.now() + 60000);
  candidate.setSeconds(0, 0);
  for (let i = 0; i < 10080; i++) {
    if (matchesCron(cron, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return candidate;
}

export function matchesCronField(field: string, val: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && val % step === 0;
  }
  if (field.includes(",")) return field.split(",").some(f => matchesCronField(f.trim(), val));
  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map(Number);
    return val >= (lo ?? 0) && val <= (hi ?? 0);
  }
  return parseInt(field, 10) === val;
}

export function matchesCron(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return matchesCronField(min!, now.getMinutes())
    && matchesCronField(hour!, now.getHours())
    && matchesCronField(dom!, now.getDate())
    && matchesCronField(month!, now.getMonth() + 1)
    && matchesCronField(dow!, now.getDay());
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtTime(hour: string, min: string): string {
  const h = parseInt(hour, 10);
  const m = parseInt(min, 10);
  if (isNaN(h) || isNaN(m)) return `${hour}:${min}`;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const mStr = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  return `${h12}${mStr} ${ampm}`;
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];

  // Every N minutes: */N * * * *
  if (min.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    const n = parseInt(min.slice(2), 10);
    return `Every ${n} minute${n !== 1 ? "s" : ""}`;
  }

  // Every N hours: 0 */N * * *
  if (hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
    const n = parseInt(hour.slice(2), 10);
    return `Every ${n} hour${n !== 1 ? "s" : ""}`;
  }

  const atTime = (hour !== "*") ? ` at ${fmtTime(hour, min === "*" ? "0" : min)}` : "";

  // Daily: * * * * * or 0 H * * *
  if (dom === "*" && month === "*" && dow === "*") {
    return `Daily${atTime}`;
  }

  // Day-of-week patterns
  if (dom === "*" && month === "*" && dow !== "*") {
    if (dow === "1-5") return `Weekdays${atTime}`;
    if (dow === "6,0" || dow === "0,6" || dow === "6-7") return `Weekends${atTime}`;
    const dowNum = parseInt(dow, 10);
    if (!isNaN(dowNum) && dowNum >= 0 && dowNum <= 6) {
      return `Every ${DOW_NAMES[dowNum]}${atTime}`;
    }
    if (dow.includes(",")) {
      const days = dow.split(",").map(d => DOW_NAMES[parseInt(d.trim(), 10)] ?? d).filter(Boolean);
      return `Every ${days.join("/")}${atTime}`;
    }
    return `Weekly (${dow})${atTime}`;
  }

  // Monthly: 0 H dom * *
  if (dom !== "*" && month === "*" && dow === "*") {
    const domNum = parseInt(dom, 10);
    return `${ordinal(domNum)} of every month${atTime}`;
  }

  // Quarterly: specific months
  if (dom !== "*" && dow === "*" && month !== "*") {
    if (month === "1,4,7,10" || month === "*/3") {
      return `Quarterly (${ordinal(parseInt(dom, 10))} of quarter)${atTime}`;
    }
    const months = month.split(",").map(m => MONTH_ABBR[(parseInt(m.trim(), 10) - 1)] ?? m);
    return `${months.join("/")} ${ordinal(parseInt(dom, 10))}${atTime}`;
  }

  return `Custom schedule (${expr})`;
}

router.post("/admin/insights/automations", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = createAutomationSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });

    const [automation] = await db.insert(insightsAutomationsTable).values({
      name:                  body.data.name,
      customerId:            body.data.customerId        ?? null,
      projectId:             body.data.projectId         ?? null,
      automationType:        body.data.automationType,
      cronExpression:        body.data.cronExpression,
      enabled:               body.data.enabled,
      generateDocument:      body.data.generateDocument,
      linkedRunbookScriptId: body.data.linkedRunbookScriptId ?? null,
      nextRunAt:             nextRunFromCron(body.data.cronExpression),
    }).returning();

    return res.json({ automation });
  } catch (err) {
    logger.error({ err }, "insights automation create error");
    return res.status(500).json({ error: "Failed to create automation" });
  }
});

// ── PATCH /api/admin/insights/automations/:id ─────────────────────────────────

const updateAutomationSchema = z.object({
  name:                  z.string().min(1).max(200).optional(),
  cronExpression:        z.string().min(1).max(100).optional(),
  enabled:               z.boolean().optional(),
  generateDocument:      z.boolean().optional(),
  automationType:        z.enum(AUTOMATION_TYPES).optional(),
  customerId:            z.number().int().positive().nullable().optional(),
  projectId:             z.number().int().positive().nullable().optional(),
  linkedRunbookScriptId: z.string().nullable().optional(),
});

router.patch("/admin/insights/automations/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const body = updateAutomationSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });

    const updates: Partial<typeof insightsAutomationsTable.$inferInsert> = { updatedAt: new Date(), ...body.data };
    if (body.data.cronExpression) updates.nextRunAt = nextRunFromCron(body.data.cronExpression);

    const [updated] = await db.update(insightsAutomationsTable)
      .set(updates).where(eq(insightsAutomationsTable.id, id)).returning();

    if (!updated) return res.status(404).json({ error: "Automation not found" });
    return res.json({ automation: updated });
  } catch (err) {
    logger.error({ err }, "insights automation update error");
    return res.status(500).json({ error: "Failed to update automation" });
  }
});

// ── DELETE /api/admin/insights/automations/:id ────────────────────────────────

router.delete("/admin/insights/automations/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    await db.delete(insightsAutomationsTable).where(eq(insightsAutomationsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "insights automation delete error");
    return res.status(500).json({ error: "Failed to delete automation" });
  }
});

// ── Automation execution ───────────────────────────────────────────────────────

const REPORT_DOC_TYPES_FOR_AUTOMATION: Record<string, string> = {
  monthly_tenant_health_report:       "executive_summary",
  quarterly_governance_review:        "governance_maturity_report",
  weekly_security_drift_alerts:       "security_posture_report",
  license_waste_monitoring:           "license_optimization_report",
  conditional_access_drift_detection: "security_posture_report",
};

const REPORT_DOC_TYPE_LABELS_AUTO: Record<string, string> = {
  executive_summary:          "Executive Summary",
  governance_maturity_report: "Governance Maturity Report",
  security_posture_report:    "Security Posture Report",
  license_optimization_report:"License Optimization Report",
};

export async function executeAutomation(automationId: number): Promise<void> {
  const [automation] = await db.select().from(insightsAutomationsTable)
    .where(eq(insightsAutomationsTable.id, automationId)).limit(1);
  if (!automation) return;

  const now = new Date();

  try {
    // ── 1. Trigger linked Azure runbook (if configured) ─────────────────────
    if (automation.linkedRunbookScriptId) {
      if (isAzureConfigured()) {
        try {
          // Resolve the runbook name from the powershell_scripts table
          const [psScript] = await db.select({ azureRunbookName: powershellScriptsTable.azureRunbookName })
            .from(powershellScriptsTable)
            .where(eq(powershellScriptsTable.id, automation.linkedRunbookScriptId))
            .limit(1);

          const runbookName = psScript?.azureRunbookName;
          if (runbookName) {
            const job = await createRunbookJob({ runbookName });
            logger.info(
              { automationId, runbookName, jobId: job.jobId },
              "insights: automation triggered Azure runbook job",
            );
          } else {
            logger.warn(
              { automationId, linkedRunbookScriptId: automation.linkedRunbookScriptId },
              "insights: linked script has no azureRunbookName — skipping Azure trigger",
            );
          }
        } catch (runbookErr) {
          logger.warn({ runbookErr, automationId }, "insights: Azure runbook trigger failed (non-fatal)");
        }
      } else {
        logger.info({ automationId }, "insights: Azure not configured — skipping runbook trigger");
      }
    }

    // ── 2. Generate document (if enabled) ───────────────────────────────────
    if (automation.generateDocument) {
      const runs = await fetchRunsForCustomer(
        automation.customerId ?? undefined,
        automation.projectId  ?? undefined,
        50,
      );
      const scores = computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
      const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);

      const docType   = REPORT_DOC_TYPES_FOR_AUTOMATION[automation.automationType] ?? "executive_summary";
      const docLabel  = REPORT_DOC_TYPE_LABELS_AUTO[docType] ?? docType;
      const reportDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      const profileSample = (runs as { profileUpdates: Record<string, unknown> }[])
        .flatMap(r => Object.entries(r.profileUpdates ?? {}).slice(0, 5))
        .slice(0, 20)
        .map(([k, v]) => `  ${k}: ${String(v)}`)
        .join("\n");

      const prompt = `You are Shane McCaw, a senior Microsoft 365 Architect. Generate an automated ${docLabel} for ${reportDate} in HTML format.
Security: ${scores.security}/100, Governance: ${scores.governance}/100, Readiness: ${scores.readiness}/100.
Findings: ${findings.slice(0, 10).join("; ") || "No findings"}.
Recommendations: ${recommendations.slice(0, 5).join("; ") || "None"}.
Configuration telemetry:
${profileSample || "  No telemetry captured yet."}
Output ONLY valid HTML with inline CSS (white background, #0078D4 accents). Include: branded header, score summary table, findings section, recommendations section, footer. 400-900 words.`;

      const aiResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const htmlContent = (aiResponse.content[0] as { text: string }).text ?? "";

      const [newDoc] = await db.insert(insightsGeneratedDocumentsTable).values({
        customerId: automation.customerId ?? null,
        projectId:  automation.projectId  ?? null,
        category:   "report",
        docType,
        title:      `${automation.name} — ${reportDate}`,
        htmlContent,
        status:     "draft",
        pdfUrl:     null,
      }).returning();

      const pdfUrl = `/api/admin/insights/documents/${newDoc!.id}/download`;
      await db.update(insightsGeneratedDocumentsTable)
        .set({ pdfUrl })
        .where(eq(insightsGeneratedDocumentsTable.id, newDoc!.id));

      logger.info({ automationId, docType, docId: newDoc!.id }, "insights: automation document generated and staged for review");
    }

    // ── 3. Update last/next run timestamps ──────────────────────────────────
    const nextRunAt = nextRunFromCron(automation.cronExpression);
    await db.update(insightsAutomationsTable)
      .set({ lastRunAt: now, nextRunAt, updatedAt: now })
      .where(eq(insightsAutomationsTable.id, automationId));

  } catch (err) {
    logger.warn({ err, automationId }, "insights: automation execution failed (non-fatal)");
  }
}

export default router;
