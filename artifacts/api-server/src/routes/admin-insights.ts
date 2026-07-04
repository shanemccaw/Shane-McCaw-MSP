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
 * POST /api/admin/insights/automations/:id/run     — run automation immediately
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  db,
  scriptRunResultsTable,
  clientScoresTable,
  clientHealthHistoryTable,
  clientM365ProfilesTable,
  usersTable,
  projectsTable,
  kanbanTasksTable,
  powershellScriptsTable,
  insightsGeneratedDocumentsTable,
  insightsAutomationsTable,
  notificationsTable,
  engagementProjectsTable,
  quickWinPresentationsTable,
} from "@workspace/db";
import { broadcastPresentationScopeChange, broadcastPresentationDocsChange } from "../lib/sse-broadcast";
import { eq, desc, and, sql, inArray, isNull, notInArray, ne } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";
import { getPrompt, getDocumentStylePrefix } from "../lib/prompt-loader";
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
import { sendWebPushToAdmins } from "../lib/web-push";
import { extractAiHtml, parseSowPricing, parseSowAllPricing, patchSowGrandTotal, stripStagedForReviewBanner, type SowPricingLine } from "../lib/sow-pricing";
import { ensureOpportunityForSow } from "../lib/crm-pipeline";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const router = Router();

// ── Helper: broadcast scope change to all presentations for a project ──────────
// Called fire-and-forget after a SOW document is created or its pricing updated.
// Finds all presentations for the project and notifies open SSE clients so the
// client tab can show a "scope updated" banner and re-fetch the latest pricing.
async function broadcastSowChangeForProject(projectId: number): Promise<void> {
  try {
    const presentations = await db
      .select({ id: quickWinPresentationsTable.id })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId));
    const ts = String(Date.now());
    for (const p of presentations) {
      broadcastPresentationScopeChange(p.id, ts);
    }
  } catch (err) {
    logger.warn({ err, projectId }, "broadcastSowChangeForProject: failed");
  }
}

// ── Helper: broadcast document list change to open presentation tabs ──────────
// Called fire-and-forget after any document is generated or deleted so open
// client presentation tabs can show the "documents updated" banner immediately.
async function broadcastDocsChangeForProject(projectId: number): Promise<void> {
  try {
    const presentations = await db
      .select({ id: quickWinPresentationsTable.id })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId));
    for (const p of presentations) {
      broadcastPresentationDocsChange(p.id);
    }
  } catch (err) {
    logger.warn({ err, projectId }, "broadcastDocsChangeForProject: failed");
  }
}

// ── Helper: upsert a new doc into draft presentations for the same project ────
// When a SOW or other document is generated/approved for a project, any draft
// presentations for that project should include it (replacing any stale entry
// with the same doc_type so IDs don't pile up).
async function syncPresentationDocIds(
  projectId: number,
  newDocId: number,
  newDocType: string,
): Promise<void> {
  try {
    const drafts = await db
      .select({ id: quickWinPresentationsTable.id, documentsIncluded: quickWinPresentationsTable.documentsIncluded })
      .from(quickWinPresentationsTable)
      .where(and(
        eq(quickWinPresentationsTable.projectId, projectId),
        eq(quickWinPresentationsTable.status, "draft"),
      ));

    for (const draft of drafts) {
      const existing = (draft.documentsIncluded ?? []) as number[];

      // Find which existing IDs have the same doc_type so we can replace them
      const sameTypeDocs = existing.length > 0
        ? await db
            .select({ id: insightsGeneratedDocumentsTable.id })
            .from(insightsGeneratedDocumentsTable)
            .where(and(
              inArray(insightsGeneratedDocumentsTable.id, existing),
              eq(insightsGeneratedDocumentsTable.docType, newDocType),
            ))
        : [];

      const sameTypeIds = new Set(sameTypeDocs.map(d => d.id));
      // Remove stale same-type entries; append new doc if not already present
      const filtered = existing.filter(id => !sameTypeIds.has(id));
      if (!filtered.includes(newDocId)) filtered.push(newDocId);

      await db.update(quickWinPresentationsTable)
        .set({ documentsIncluded: filtered, updatedAt: new Date() })
        .where(eq(quickWinPresentationsTable.id, draft.id));
    }
  } catch (err) {
    logger.warn({ err, projectId, newDocId }, "syncPresentationDocIds: failed (non-fatal)");
  }
}

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
  return stripStagedForReviewBanner(html)
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
  security: number; compliance: number; copilot: number; governance: number; productivity: number; composite: number;
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

  const security    = avg("security",    avg("Security",    60));
  const compliance  = avg("compliance",  avg("Compliance",  60));
  const copilot     = avg("copilotReadiness", avg("copilot_readiness", avg("CopilotReadiness", avg("copilot", 50))));
  const governance  = avg("governance",  avg("Governance",  55));
  const productivity = avg("productivity", avg("Productivity", 55));
  const composite   = Math.round((security + compliance + copilot + governance + productivity) / 5);
  return { security, compliance, copilot, governance, productivity, composite };
}

/**
 * Fetch the latest health score per category from client_health_history and
 * map them into the {security, governance, readiness, composite} shape used by
 * document generation. Returns null when no health history exists for the
 * client so callers can fall back to computeScoresFromRuns().
 */
async function fetchClientHealthScores(customerId: number): Promise<{
  security: number; compliance: number; copilot: number; governance: number; productivity: number; composite: number;
} | null> {
  const rows = await db
    .select({
      category: clientHealthHistoryTable.category,
      score:    clientHealthHistoryTable.score,
    })
    .from(clientHealthHistoryTable)
    .where(eq(clientHealthHistoryTable.clientId, customerId))
    .orderBy(desc(clientHealthHistoryTable.recordedAt));

  if (rows.length === 0) return null;

  // Keep only the most-recent entry per category (rows already DESC by date)
  const latest: Record<string, number> = {};
  for (const row of rows) {
    if (!(row.category in latest)) latest[row.category] = row.score;
  }

  const security    = latest["security"]    ?? null;
  const compliance  = latest["compliance"]  ?? null;
  const copilot     = latest["copilot"]     ?? null;
  const governance  = latest["governance"]  ?? null;
  const productivity = latest["productivity"] ?? null;

  // If we have no meaningful data at all, let the caller fall back
  if (security === null && compliance === null && copilot === null && governance === null && productivity === null) return null;

  const sec  = security    ?? 0;
  const com  = compliance  ?? 0;
  const cop  = copilot     ?? 0;
  const gov  = governance  ?? 0;
  const pro  = productivity ?? 0;
  const total = [sec, com, cop, gov, pro].filter(v => v > 0);
  return {
    security:    sec,
    compliance:  com,
    copilot:     cop,
    governance:  gov,
    productivity: pro,
    composite:   total.length > 0 ? Math.round(total.reduce((a, b) => a + b, 0) / total.length) : 0,
  };
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
async function fetchRunsForCustomer(customerId?: number, _projectId?: number, limit = 100) {
  const conditions: ReturnType<typeof eq>[] = [
    eq(scriptRunResultsTable.status, "completed") as ReturnType<typeof eq>,
  ];
  if (customerId) {
    conditions.push(eq(scriptRunResultsTable.customerId, customerId) as ReturnType<typeof eq>);
  }
  // No project/kanban narrowing — all completed runs for the customer feed generation.

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
    const weeklyTrend: { week: string; composite: number; security: number; compliance: number; copilot: number; governance: number; productivity: number }[] = [];
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
    // By default only show active projects; pass status=all to bypass
    const statusFilter = req.query["status"] === "all" ? undefined : "active";

    const conditions = [];
    if (customerId) conditions.push(eq(projectsTable.clientUserId, customerId));
    if (statusFilter) conditions.push(eq(projectsTable.status, statusFilter as "active"));

    const projects = await db.select({
      id: projectsTable.id,
      title: projectsTable.title,
      status: projectsTable.status,
      projectType: projectsTable.projectType,
      phase: projectsTable.phase,
      sharepointFolderUrl: projectsTable.sharepointFolderUrl,
    }).from(projectsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(projectsTable.createdAt))
      .limit(100);
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
    if (status)     conditions.push(eq(insightsGeneratedDocumentsTable.status, status as "draft" | "approved" | "delivered" | "archived" | "generating"));

    const docs = await db.select({
      id: insightsGeneratedDocumentsTable.id,
      customerId: insightsGeneratedDocumentsTable.customerId,
      projectId: insightsGeneratedDocumentsTable.projectId,
      category: insightsGeneratedDocumentsTable.category,
      docType: insightsGeneratedDocumentsTable.docType,
      title: insightsGeneratedDocumentsTable.title,
      pdfUrl: insightsGeneratedDocumentsTable.pdfUrl,
      status: insightsGeneratedDocumentsTable.status,
      errorMessage: insightsGeneratedDocumentsTable.errorMessage,
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

// Tier 02 pricing formula — embedded verbatim in every SOW prompt
const TIER_02_PRICING_FORMULA_BLOCK = `You are pricing Microsoft 365 remediation projects for Shane McCaw Consulting. These are NOT assessments — they are project-based engagements where real problems are fixed.

STEP 1 — DETECT TENANT TIER (use ONLY "Total Users in Tenant" from the TENANT FACTS block — never infer from any other field):
  Tier01: 1–50 users
  Tier02: 51–250 users
  Tier03: 251–750 users
  Tier04: 751+ users

STEP 2 — BASE CEILINGS (select the row matching the detected tier):
  Workstream        | Tier01   | Tier02   | Tier03   | Tier04
  Governance        | $10,000  | $25,000  | $30,000  | $35,000
  Security          | $10,000  | $28,000  | $35,000  | $42,000
  Copilot           |  $8,000  | $30,000  | $35,000  | $42,000
  Info Architecture | $12,000  | $25,000  | $30,000  | $42,000
  License Optim.    |  $4,000  |  $8,000  | $12,000  | $15,000

  Include only the workstreams relevant to this engagement.
  Workstream Total = sum of all included workstream Base Ceilings.

STEP 3 — ADJUSTMENTS (flat per-tier amounts — apply each adjustment if the findings support it; if a category does not apply, add $0 and explain why):
  Adjustment        | Tier01  | Tier02   | Tier03   | Tier04
  Complexity        | $5,000  | $15,000  | $25,000  | $35,000
  Data Sprawl       | $5,000  | $10,000  | $20,000  | $25,000
  Security/Compli.  | $5,000  | $10,000  | $20,000  | $25,000
  Copilot Readiness | $5,000  | $10,000  | $20,000  | $25,000

  Criteria for applying each adjustment:
  - Complexity: apply if the findings show multiple critical gaps or ≥ 3 remediation domains.
  - Data Sprawl: apply if DLP policies = 0, sensitivity labels unconfigured, or ≥ 50 SharePoint sites with no governance.
  - Security/Compliance: apply if MFA not enforced, Conditional Access = 0, or industry compliance risk identified.
  - Copilot Readiness: apply ONLY when Copilot-related workstreams are in scope; base on Copilot score and blocker count.
  Adjustment Total = sum of all applicable adjustments at the tier-correct dollar amount.

STEP 4 — TOTALS:
  Engagement Total = Workstream Total + Adjustment Total.

Always show the detected tier, always show each step's arithmetic, never leave pricing blank, never say TBD.

Output requirements for the Pricing section:
- Show a per-workstream table with columns: Project/Workstream | Scope | Base Ceiling | Final Price (USD) | Reasoning
  - Each row shows ONLY the workstream's own Base Ceiling and Final Price — NO per-row adjustment breakdown.
  - Final Price for each row = Base Ceiling for that workstream only (adjustments are NOT added per row).
- After the per-workstream table, render a second HTML <table> for the Pricing Adjustments section. This table MUST use proper <table><thead><tbody> elements — NOT divs or CSS classes. Header row: Adjustment Factor | Amount (USD) | Reasoning. One body row per applicable adjustment. A final body row with title "Adjustments Subtotal" showing the sum.
- End with a Grand Total row after both tables. Show the calculation as plain text: Grand Total = $[workstream subtotal] (workstreams) + $[adjustments subtotal] (adjustments) = $[grand total]. Double-check the arithmetic before outputting.
- Always explain the reasoning for each adjustment applied in the Pricing Adjustments table.
- Never invent new pricing models. Never use TBD.
- Your goal is to produce a firm, defensible, enterprise-grade project price.`;

const generateDocSchema = z.object({
  customerId: z.number().int().positive({ message: "A customer must be selected" }),
  projectId:  z.number().int().positive({ message: "A project must be selected" }),
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

    const healthScores = customerId ? await fetchClientHealthScores(customerId) : null;
    const scores = healthScores ?? computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
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

    const scoresBlock = `- Security: ${scores.security}/100\n- Compliance: ${scores.compliance}/100\n- Copilot: ${scores.copilot}/100\n- Governance: ${scores.governance}/100\n- Productivity: ${scores.productivity}/100\n- Composite: ${scores.composite}/100`;
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

    // Find any prior completed doc for same customer+project+docType so we can replace it on success.
    // We do NOT modify it now — prior doc must survive if AI fails.
    let priorReportId: number | null = null;
    if (customerId && projectId) {
      const prior = await db.select({ id: insightsGeneratedDocumentsTable.id })
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          eq(insightsGeneratedDocumentsTable.customerId, customerId),
          eq(insightsGeneratedDocumentsTable.projectId, projectId),
          eq(insightsGeneratedDocumentsTable.docType, docType),
          inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered", "archived"]),
        ))
        .limit(1);
      priorReportId = prior[0]?.id ?? null;
    }

    // Always INSERT a new generating row — fresh createdAt sorts it to the top of the list
    const [genRow] = await db.insert(insightsGeneratedDocumentsTable).values({
      customerId: customerId ?? null, projectId: projectId ?? null,
      category: "report", docType, title, htmlContent: "",
      status: "generating", pdfUrl: null,
    }).returning({ id: insightsGeneratedDocumentsTable.id });
    const reportDocId = genRow!.id;

    // Return immediately — Sonnet generation can take 60-120 s and would hit
    // the proxy timeout if we block.  The client polls GET /documents every 3 s
    // and will see the row flip from "generating" → "approved" naturally.
    res.json({ id: reportDocId, status: "generating" });

    void (async () => {
      try {
        const docStylePrefix = await getDocumentStylePrefix();
        const aiResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          messages: [{ role: "user", content: docStylePrefix + prompt }],
        });
        if (aiResponse.stop_reason === "max_tokens") {
          logger.warn({ docType, reportDocId }, "insights report: output hit max_tokens — document may be truncated");
        }
        const htmlContent = extractAiHtml(aiResponse);

        await db.update(insightsGeneratedDocumentsTable)
          .set({ htmlContent, status: "approved", approvedAt: new Date(), pdfUrl: null, updatedAt: new Date() })
          .where(eq(insightsGeneratedDocumentsTable.id, reportDocId));

        if (priorReportId !== null) {
          await db.delete(insightsGeneratedDocumentsTable)
            .where(eq(insightsGeneratedDocumentsTable.id, priorReportId));
        }

        const pdfUrl = `/api/admin/insights/documents/${reportDocId}/download`;
        await db.update(insightsGeneratedDocumentsTable)
          .set({ pdfUrl })
          .where(eq(insightsGeneratedDocumentsTable.id, reportDocId));

        if (projectId) {
          void syncPresentationDocIds(projectId, reportDocId, docType);
          void broadcastDocsChangeForProject(projectId);
        }
      } catch (err) {
        logger.error({ err, docType, reportDocId }, "insights report: background generation failed");
        await db.update(insightsGeneratedDocumentsTable)
          .set({ status: "failed", errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500), updatedAt: new Date() })
          .where(eq(insightsGeneratedDocumentsTable.id, reportDocId))
          .catch((dbErr) => logger.warn({ dbErr }, "insights: failed to mark report doc as failed"));
      }
    })();
  } catch (err) {
    logger.error({ err }, "insights document generate error");
    return res.status(500).json({ error: "Failed to generate document" });
  }
});

// ── POST /api/admin/insights/documents/payload-preview ────────────────────────
// Returns the assembled Claude payload (data + substituted prompt) for a report
// document without actually calling the AI. Read-only — no DB writes.

router.post("/admin/insights/documents/payload-preview", requireAdmin, async (req: Request, res: Response) => {
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

    const healthScores = customerId ? await fetchClientHealthScores(customerId) : null;
    const scores = healthScores ?? computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
    const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);
    const clientName  = (customer as { company: string | null; name: string | null }[])[0]?.company
      ?? (customer as { company: string | null; name: string | null }[])[0]?.name ?? "Client";
    const projectName = (project as { title: string }[])[0]?.title ?? "";
    const docLabel    = REPORT_DOC_TYPE_LABELS[docType] ?? docType;

    const profileSamplePairs = (runs as { profileUpdates: Record<string, unknown> }[])
      .flatMap(r => Object.entries(r.profileUpdates ?? {}).slice(0, 5))
      .slice(0, 30);
    const profileSample = profileSamplePairs.map(([k, v]) => `  ${k}: ${String(v)}`).join("\n");

    const scoresBlock = `- Security: ${scores.security}/100\n- Compliance: ${scores.compliance}/100\n- Copilot: ${scores.copilot}/100\n- Governance: ${scores.governance}/100\n- Productivity: ${scores.productivity}/100\n- Composite: ${scores.composite}/100`;
    const findingsBlock = findings.slice(0, 15).map((f, i) => `${i + 1}. ${f}`).join("\n") || "No findings recorded yet — assessment runs pending.";
    const recommendationsBlock = recommendations.slice(0, 10).map((r, i) => `${i + 1}. ${r}`).join("\n") || "No recommendations recorded yet.";

    const rawReportTemplate = await getPrompt(`insights-report-${docType}`, INSIGHTS_REPORT_PROMPT_FALLBACK);
    const assembledPrompt = substituteTokens(rawReportTemplate, {
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

    const stylePrefix = await getDocumentStylePrefix();

    return res.json({
      model: "claude-sonnet-4-6",
      maxTokens: 16000,
      stylePrefix: stylePrefix.trim(),
      assembledPrompt,
      scores,
      findings: findings.slice(0, 15),
      recommendations: recommendations.slice(0, 10),
      profileSample: profileSamplePairs.map(([k, v]) => [k, String(v)]),
    });
  } catch (err) {
    logger.error({ err }, "insights document payload-preview error");
    return res.status(500).json({ error: "Failed to assemble payload preview" });
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

    // When a SOW is manually marked delivered, promote to Opportunities pipeline
    if (body.data.status === "delivered" && updated.customerId &&
        (updated.docType === "sow" || updated.docType === "consolidated_sow")) {
      void ensureOpportunityForSow(updated.customerId, updated.id);
    }

    // When a SOW/consolidated_sow is approved or delivered, sync it into draft
    // presentations for the same project so they always reference the latest doc.
    if ((body.data.status === "approved" || body.data.status === "delivered") &&
        updated.projectId &&
        (updated.docType === "sow" || updated.docType === "consolidated_sow")) {
      void syncPresentationDocIds(updated.projectId, updated.id, updated.docType);
      void broadcastDocsChangeForProject(updated.projectId);
    }

    // If HTML content was updated on a SOW document, the pricing may have changed —
    // notify any open client tabs so they can re-fetch and show the stale-scope banner.
    if (body.data.htmlContent !== undefined && updated.projectId &&
        (updated.docType === "sow" || updated.docType === "consolidated_sow")) {
      void broadcastSowChangeForProject(updated.projectId);
    }

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
    // Fetch projectId before deleting so we can broadcast to affected presentation tabs
    const [toDelete] = await db
      .select({ projectId: insightsGeneratedDocumentsTable.projectId })
      .from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id))
      .limit(1);
    await db.delete(insightsGeneratedDocumentsTable).where(eq(insightsGeneratedDocumentsTable.id, id));
    if (toDelete?.projectId) void broadcastDocsChangeForProject(toDelete.projectId);
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "insights document delete error");
    return res.status(500).json({ error: "Failed to delete document" });
  }
});

// ── POST /api/admin/insights/documents/:id/send ───────────────────────────────
// 1. Validates the document is approved
// 2. Sends HTML content as email body via Exchange Online (Graph)
// 3. Uploads PDF to client's SharePoint site (best-effort, non-fatal)
// 4. Marks as delivered and sets deliveredAt

router.post("/admin/insights/documents/:id/send", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [doc] = await db.select().from(insightsGeneratedDocumentsTable)
      .where(eq(insightsGeneratedDocumentsTable.id, id)).limit(1);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Auto-promote legacy drafts so they can always be sent
    if (doc.status === "draft") {
      await db.update(insightsGeneratedDocumentsTable)
        .set({ status: "approved", approvedAt: new Date() })
        .where(eq(insightsGeneratedDocumentsTable.id, id));
      doc.status = "approved";
    }

    if (doc.status !== "approved") {
      return res.status(400).json({ error: "Document must be approved before sending." });
    }

    const recipientEmail = req.body.recipientEmail as string | undefined;
    const subject        = (req.body.subject as string | undefined) ?? `${doc.title} — Shane McCaw Consulting`;

    let toEmail: string | undefined = recipientEmail;
    let sharepointSiteId: string | null = null;
    let clientName = "Client";

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

    const emailBody = `${doc.htmlContent}
<hr style="margin:24px 0">
<p style="font-size:12px;color:#666">Sent by Shane McCaw Consulting · <a href="https://shanemccaw.com">shanemccaw.com</a></p>`;

    // 1. Generate PDF (best-effort) to attach to the email
    const safeTitle = doc.title.replace(/[^a-z0-9_\- ]/gi, "_").slice(0, 80);
    const pdfFilename = `${safeTitle}_${new Date().toISOString().slice(0, 10)}.pdf`;
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await generateInsightsPdf(doc.title, doc.htmlContent, clientName, new Date(doc.createdAt));
    } catch (pdfErr) {
      logger.warn({ pdfErr, docId: id }, "insights: PDF generation failed (non-fatal) — will send email without attachment");
    }

    const sent = await sendMessage({
      userId: mailUserId,
      to: [toEmail],
      subject,
      body: emailBody,
      bodyType: "html",
      ...(pdfBuffer ? {
        attachments: [{ name: pdfFilename, contentType: "application/pdf", contentBytes: pdfBuffer }],
      } : {}),
    });
    if (!sent) return res.status(500).json({ error: "Failed to send email via Exchange Online" });

    // 2. SharePoint upload (best-effort — non-fatal if not configured)
    let sharepointUrl: string | null = null;
    if (sharepointSiteId && graphCredentialsPresent() && pdfBuffer) {
      try {
        await ensureSharePointFolderAtRoot(sharepointSiteId, CONSULTING_DELIVERABLES_FOLDER);
        sharepointUrl = await uploadFileToSharePoint(
          sharepointSiteId,
          CONSULTING_DELIVERABLES_FOLDER,
          pdfFilename,
          pdfBuffer,
          "application/pdf",
        );
        logger.info({ docId: id, pdfFilename, sharepointUrl }, "insights: document uploaded to SharePoint");
      } catch (spErr) {
        logger.warn({ spErr, docId: id }, "insights: SharePoint upload failed (non-fatal) — email was still sent");
      }
    }

    const [updated] = await db.update(insightsGeneratedDocumentsTable)
      .set({
        status:      "delivered",
        deliveredAt: new Date(),
        updatedAt:   new Date(),
        ...(sharepointUrl ? { pdfUrl: sharepointUrl } : {}),
      })
      .where(eq(insightsGeneratedDocumentsTable.id, id))
      .returning();

    // When a SOW is sent to a client, promote them to the Opportunities pipeline
    if (doc.customerId && (doc.docType === "sow" || doc.docType === "consolidated_sow")) {
      void ensureOpportunityForSow(doc.customerId, doc.id);
    }

    // Sync doc into draft presentations for the same project on delivery
    if (doc.projectId && (doc.docType === "sow" || doc.docType === "consolidated_sow")) {
      void syncPresentationDocIds(doc.projectId, doc.id, doc.docType);
      void broadcastDocsChangeForProject(doc.projectId);
    }

    return res.json({ ok: true, document: updated, sentTo: toEmail, sharepointUrl, pdfAttached: !!pdfBuffer });
  } catch (err) {
    logger.error({ err }, "insights document send error");
    return res.status(500).json({ error: "Failed to send document" });
  }
});

// ── SOW pricing parser ────────────────────────────────────────────────────────
// Extracts structured pricing lines from AI-generated SOW HTML so we can store
// them in the DB and use them in the presentation scope step and overview total.


// ── POST /api/admin/insights/consulting/generate ──────────────────────────────

const CONSULTING_TYPE_LABELS: Record<string, string> = {
  consolidated_sow:           "Consolidated Statement of Work",
  sow:                        "Statement of Work",
  remediation_plan:           "Remediation Plan",
  deployment_plan:            "Deployment Plan",
  governance_framework:       "Governance Framework",
  security_hardening_plan:    "Security Hardening Plan",
  copilot_enablement_plan:    "Copilot Enablement Plan",
  identity_modernization_plan:"Identity Modernization Plan",
  copilot_readiness:          "Copilot Readiness Assessment",
};

const generateConsultingSchema = z.object({
  customerId:      z.number().int().positive({ message: "A customer must be selected" }),
  projectId:       z.number().int().positive({ message: "A project must be selected" }),
  deliverableType: z.string().min(1),
  title:           z.string().min(1).max(200),
});

router.post("/admin/insights/consulting/generate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = generateConsultingSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    const { customerId, projectId, deliverableType, title } = body.data;

    // ── Special path: Consolidated SOW ──────────────────────────────────────────
    if (deliverableType === "consolidated_sow") {
      const stripHtml = (html: string) =>
        html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 1800);

      const [existingDocs, engagementProjects, customerRow, m365ProfileRow, scriptRuns, scoresRow] = await Promise.all([
        customerId
          ? db.select({
              id:       insightsGeneratedDocumentsTable.id,
              title:    insightsGeneratedDocumentsTable.title,
              docType:  insightsGeneratedDocumentsTable.docType,
              category: insightsGeneratedDocumentsTable.category,
              htmlContent: insightsGeneratedDocumentsTable.htmlContent,
            })
            .from(insightsGeneratedDocumentsTable)
            .where(and(
              eq(insightsGeneratedDocumentsTable.customerId, customerId),
              notInArray(insightsGeneratedDocumentsTable.docType, ["sow", "consolidated_sow"]),
            ))
            .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
          : Promise.resolve([] as { id: number; title: string; docType: string; category: string; htmlContent: string }[]),
        db.select({
          title:       engagementProjectsTable.title,
          priceRange:  engagementProjectsTable.priceRange,
          description: engagementProjectsTable.description,
          sowItems:    engagementProjectsTable.sowItems,
        })
        .from(engagementProjectsTable)
        .where(eq(engagementProjectsTable.isVisible, true))
        .orderBy(engagementProjectsTable.sortOrder),
        customerId
          ? db.select({ name: usersTable.name, company: usersTable.company })
              .from(usersTable).where(eq(usersTable.id, customerId)).limit(1)
          : Promise.resolve([] as { name: string | null; company: string | null }[]),
        // M365 Health Profile (profile flags)
        customerId
          ? db.select({ profile: clientM365ProfilesTable.profile })
              .from(clientM365ProfilesTable)
              .where(eq(clientM365ProfilesTable.clientId, customerId))
              .limit(1)
          : Promise.resolve([] as { profile: Record<string, unknown> | null }[]),
        // Script run results — findings, recommendations, and profile updates
        customerId
          ? db.select({
              scriptName:     scriptRunResultsTable.scriptName,
              parsedFindings: scriptRunResultsTable.parsedFindings,
              recommendations: scriptRunResultsTable.recommendations,
              profileUpdates: scriptRunResultsTable.profileUpdates,
              scoreImpact:    scriptRunResultsTable.scoreImpact,
              createdAt:      scriptRunResultsTable.createdAt,
            })
            .from(scriptRunResultsTable)
            .where(and(
              eq(scriptRunResultsTable.customerId, customerId),
              eq(scriptRunResultsTable.status, "completed"),
            ))
            .orderBy(desc(scriptRunResultsTable.createdAt))
            .limit(50)
          : Promise.resolve([] as { scriptName: string | null; parsedFindings: string[] | null; recommendations: string[] | null; profileUpdates: Record<string, unknown> | null; scoreImpact: Record<string, unknown> | null; createdAt: Date }[]),
        // Aggregated health scores — from clientHealthHistoryTable (same source as CRM portal)
        customerId
          ? db.select({
              category:   clientHealthHistoryTable.category,
              score:      clientHealthHistoryTable.score,
            })
            .from(clientHealthHistoryTable)
            .where(eq(clientHealthHistoryTable.clientId, customerId))
            .orderBy(desc(clientHealthHistoryTable.recordedAt))
            .limit(50)
          : Promise.resolve([] as { category: string; score: number }[]),
      ]);

      const clientName = (customerRow as { company: string | null; name: string | null }[])[0]?.company
        ?? (customerRow as { company: string | null; name: string | null }[])[0]?.name ?? "Client";

      // Trim each doc to 600 chars — Opus needs maximum output headroom for thorough generation
      const docsBlock = existingDocs.length > 0
        ? existingDocs.map((d, i) => {
            const excerpt = d.htmlContent
              .replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 600);
            return `[Document ${i + 1}] ${d.title} (${d.docType})\n${excerpt}`;
          }).join("\n\n---\n\n")
        : "No prior documents found for this client — generate from scratch using best practices.";

      const projectsBlock = engagementProjects.length > 0
        ? engagementProjects.map(p =>
            `• ${p.title} — ${p.priceRange}${p.description ? `\n  ${p.description}` : ""}${p.sowItems?.length ? `\n  Deliverables: ${(p.sowItems as string[]).join(", ")}` : ""}`
          ).join("\n\n")
        : "No engagement project pricing configured.";

      // ── Build tenant telemetry block ───────────────────────────────────────
      const telemetryLines: string[] = [];

      // 1. M365 Health Profile flags
      const profile = (m365ProfileRow as { profile: Record<string, unknown> | null }[])[0]?.profile;
      if (profile && Object.keys(profile).length > 0) {
        telemetryLines.push("M365 HEALTH PROFILE FLAGS:");
        for (const [k, v] of Object.entries(profile)) {
          telemetryLines.push(`  ${k}: ${String(v)}`);
        }
      }

      // 2. Health scores — derived from clientHealthHistoryTable (same source as CRM portal)
      const healthHistoryRows = scoresRow as { category: string; score: number }[];
      const latestByCategory: Record<string, number> = {};
      for (const row of healthHistoryRows) {
        if (!(row.category in latestByCategory)) latestByCategory[row.category] = row.score;
      }
      if (Object.keys(latestByCategory).length > 0) {
        telemetryLines.push("\nHEALTH SCORES:");
        const CATEGORY_LABELS: Record<string, string> = {
          security:     "Security Posture",
          compliance:   "Compliance Coverage",
          copilot:      "Copilot Readiness",
          governance:   "Governance Maturity",
          productivity: "Adoption Score",
        };
        for (const [cat, score] of Object.entries(latestByCategory)) {
          const label = CATEGORY_LABELS[cat] ?? cat;
          telemetryLines.push(`  ${label}: ${score}/100`);
        }
      }

      // 3. Script run findings & recommendations
      type RunRow = { scriptName: string | null; parsedFindings: string[] | null; recommendations: string[] | null; profileUpdates: Record<string, unknown> | null };
      const typedRuns = scriptRuns as RunRow[];
      const allFindings = [...new Set(typedRuns.flatMap(r => r.parsedFindings ?? []))].slice(0, 40);
      const allRecs     = [...new Set(typedRuns.flatMap(r => r.recommendations ?? []))].slice(0, 30);

      if (allFindings.length > 0) {
        telemetryLines.push(`\nSCRIPT FINDINGS (${typedRuns.length} completed run${typedRuns.length === 1 ? "" : "s"}):`);
        for (const f of allFindings) telemetryLines.push(`  • ${f}`);
      }

      if (allRecs.length > 0) {
        telemetryLines.push("\nRECOMMENDATIONS FROM SCRIPTS:");
        for (const r of allRecs) telemetryLines.push(`  • ${r}`);
      }

      // 4. Profile key-value updates from script runs — merge all runs into one
      //    deduplicated object (most-recent run wins) so critical keys like
      //    totalUserCount and sharepointSiteCount are never silently dropped
      //    by a flatMap slice cap.
      const mergedSowProfile: Record<string, unknown> = {};
      for (const run of [...typedRuns].reverse()) {
        Object.assign(mergedSowProfile, run.profileUpdates ?? {});
      }
      if (Object.keys(mergedSowProfile).length > 0) {
        telemetryLines.push("\nCONFIGURATION TELEMETRY (from script runs):");
        for (const [k, v] of Object.entries(mergedSowProfile)) {
          telemetryLines.push(`  ${k}: ${String(v)}`);
        }
      }

      const tenantTelemetryBlock = telemetryLines.length > 0
        ? telemetryLines.join("\n")
        : "No tenant telemetry collected yet — generate this SOW after running assessment scripts.";

      // Build an explicit TENANT FACTS block so the AI has unambiguous, labelled
      // numbers for every pricing adjustment. This is injected directly before the
      // pricing formula with a strict "no hallucination" directive.
      const sp = mergedSowProfile;
      const sowTenantFacts = [
        `Total Users in Tenant:       ${sp.totalUserCount ?? "unknown"}`,
        `Licensed Users:              ${sp.licensedUserCount ?? "unknown"}`,
        `Unlicensed Users:            ${typeof sp.totalUserCount === "number" && typeof sp.licensedUserCount === "number" ? sp.totalUserCount - sp.licensedUserCount : "unknown"}`,
        `Active User Percent:         ${sp.activeUserPercent ?? "unknown"}%`,
        `SharePoint Sites:            ${sp.sharepointSiteCount ?? "unknown"}`,
        `Microsoft 365 Groups:        ${sp.m365GroupCount ?? "unknown"}`,
        `Teams Count:                 ${sp.teamCount ?? sp.teamsCount ?? "unknown"}`,
        `Public Teams:                ${sp.teamsPublicCount ?? "unknown"}`,
        `Guest Users:                 ${sp.guestUserCount ?? "unknown"}`,
        `External Sharing Enabled:    ${sp.externalSharingEnabled ?? "unknown"}`,
        `External Shares Found:       ${sp.externalUserSharesFound ?? "unknown"}`,
        `DLP Policies:                ${sp.dlpPoliciesCount ?? (sp.hasDLP === false ? 0 : "unknown")}`,
        `Sensitivity Labels:          ${sp.sensitivityLabelsConfigured === false ? "None configured" : (sp.sensitivityLabelsConfigured ?? "unknown")}`,
        `Retention Policies:          ${sp.hasRetentionPolicies === false ? "None" : (sp.hasRetentionPolicies ?? "unknown")}`,
        `Conditional Access Policies: ${sp.conditionalAccessPolicyCount ?? sp.conditionalAccessPoliciesCount ?? (sp.conditionalAccessEnabled === false ? 0 : "unknown")}`,
        `Copilot Licenses:            ${sp.copilotLicenseCount ?? (sp.hasCopilotLicenses === false ? 0 : "unknown")}`,
        `Copilot Readiness Score:     ${sp.copilotReadinessScore ?? "unknown"}/100`,
        `Intune Enabled:              ${sp.intuneEnabled ?? "unknown"}`,
        `MFA Enforced:                ${sp.mfaEnforced ?? "unknown"}`,
      ].join("\n");
      // ── End tenant telemetry block ─────────────────────────────────────────

      const CONSOLIDATED_SOW_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a comprehensive, client-ready Consolidated Statement of Work in HTML format.

Client: {{clientName}}
Deliverable title: {{title}}
Date: {{date}}

EXISTING DOCUMENTS GENERATED FOR THIS CLIENT (synthesize all findings, recommendations, and remediation items from these into the SOW):
{{existingDocs}}

ENGAGEMENT PROJECT PRICING CATALOGUE (use these titles, price ranges, and deliverables to populate real pricing in the SOW — select only the projects relevant to this client's needs):
{{engagementProjects}}

TENANT TELEMETRY (live M365 health profile flags, scores, and script findings — use this data to scope the work accurately and to justify pricing decisions):
{{tenantTelemetry}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — professional white background, #0078D4 (Azure Blue) accent, Inter/system-font typography
- Structure: Executive Summary → Scope of Work → Deliverables (table) → Project Pricing (table with line items from the catalogue above) → Timeline (phased Gantt-style) → Resource Requirements → Acceptance Criteria → Terms & Conditions → Signature Block
- The Pricing section MUST contain two parts: (1) a per-workstream table with columns: Project/Workstream | Scope | Base Ceiling | Final Price (USD) | Reasoning — populated from the engagement projects catalogue and the telemetry above; (2) a "Pricing Adjustments" summary section below it that lists each shared adjustment factor (Tenant Size, Complexity, Data Sprawl, Security/Compliance, Copilot Readiness, Timeline) and its dollar value ONCE, followed by a Grand Total row
- You MUST output a single fixed price per project/workstream (no ranges, no TBD, no "depends"); shared adjustments must NOT be added to individual workstream rows
- You MUST calculate pricing using the telemetry and pricing rules provided; each workstream row shows only its Base Ceiling and Final Price; shared adjustments (Tenant Size, Complexity, Data Sprawl, Security/Compliance, Copilot Readiness, Timeline) are listed ONCE in a "Pricing Adjustments" summary section below the workstream table, never repeated on individual rows
- The Grand Total MUST equal the arithmetic sum of all workstream Final Prices plus all adjustment amounts. Show the arithmetic explicitly in the Grand Total cell: "Grand Total = $[workstream subtotal] (workstreams) + $[adjustments subtotal] (adjustments) = $[total]". Verify the addition before writing the number.
- Synthesise all findings and remediation themes across the provided documents into a coherent, unified scope
- Each major section as <h2> with a horizontal rule separator
- Professional consulting tone as Shane McCaw, first person where appropriate
- Total length: 2000-3500 words`;

      const rawTemplate = await getPrompt("insights-consulting-consolidated_sow", CONSOLIDATED_SOW_FALLBACK);
      const prompt = rawTemplate
        .replace(/\{\{clientName\}\}/g, clientName)
        .replace(/\{\{title\}\}/g, title)
        .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }))
        .replace(/\{\{existingDocs\}\}/g, docsBlock)
        .replace(/\{\{engagementProjects\}\}/g, projectsBlock)
        .replace(/\{\{tenantTelemetry\}\}/g, tenantTelemetryBlock)
        + `\n\nCRITICAL — TENANT FACTS (use ONLY these exact numbers for all pricing adjustments; do NOT invent, estimate, or extrapolate any values not listed here):\n${sowTenantFacts}\n\nTIER 02 PRICING FORMULA (shared adjustments are calculated ONCE and shown in the summary section — never on individual rows):\n${TIER_02_PRICING_FORMULA_BLOCK}`;

      // Find any prior completed consolidated_sow for this customer+project (to replace on success)
      let priorSowId: number | null = null;
      if (customerId && projectId) {
        const prior = await db.select({ id: insightsGeneratedDocumentsTable.id })
          .from(insightsGeneratedDocumentsTable)
          .where(and(
            eq(insightsGeneratedDocumentsTable.customerId, customerId),
            eq(insightsGeneratedDocumentsTable.projectId, projectId),
            eq(insightsGeneratedDocumentsTable.docType, "consolidated_sow"),
            inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered", "archived"]),
          ))
          .limit(1);
        priorSowId = prior[0]?.id ?? null;
      }

      // Always INSERT a new generating row — fresh createdAt sorts to top; prior doc untouched until success
      const [genSowRow] = await db.insert(insightsGeneratedDocumentsTable).values({
        customerId: customerId ?? null, projectId: projectId ?? null,
        category: "consulting", docType: "consolidated_sow",
        title, htmlContent: "", status: "generating", pdfUrl: null,
      }).returning({ id: insightsGeneratedDocumentsTable.id });
      const docId = genSowRow!.id;

      // Return immediately — Sonnet generation can take 60-120 s.
      // Client polls GET /documents every 3 s and will see "generating" → "approved".
      res.json({ id: docId, status: "generating" });

      void (async () => {
        try {
          const docStylePrefix = await getDocumentStylePrefix();
          // Consolidated SOW is the highest-stakes deliverable — use the most capable
          // model with maximum output tokens so the document is never cut short.
          // Streaming is required: Opus at 32k tokens can exceed the 10-minute
          // non-streaming timeout. stream() keeps the connection alive; finalMessage()
          // returns the same shape as messages.create() so nothing else changes.
          const stream = anthropic.messages.stream({
            model: "claude-opus-4-8",
            max_tokens: 32000,
            messages: [{ role: "user", content: docStylePrefix + prompt }],
          });
          const aiResponse = await stream.finalMessage();
          if (aiResponse.stop_reason === "max_tokens") {
            logger.warn({ docId }, "consolidated_sow: output hit max_tokens — document may be truncated");
          }

          const rawHtmlContent = extractAiHtml(aiResponse);
          const { workstreamLines, adjustmentLines, computedTotal } = parseSowAllPricing(rawHtmlContent);
          const htmlContent = computedTotal > 0 ? patchSowGrandTotal(rawHtmlContent, computedTotal) : rawHtmlContent;
          const sowLines = [
            ...workstreamLines.map(l => ({ ...l, line_type: "workstream" as const })),
            ...adjustmentLines.map(l => ({ ...l, line_type: "adjustment" as const })),
          ];
          const sowTotal = computedTotal;

          await db.update(insightsGeneratedDocumentsTable)
            .set({
              htmlContent,
              status: "approved",
              approvedAt: new Date(),
              pdfUrl: null,
              sowPricingLines: sowLines.length > 0 ? sowLines : null,
              sowTotalPrice:   sowTotal > 0 ? String(sowTotal) : null,
              updatedAt: new Date(),
            })
            .where(eq(insightsGeneratedDocumentsTable.id, docId));

          if (priorSowId !== null) {
            await db.delete(insightsGeneratedDocumentsTable)
              .where(eq(insightsGeneratedDocumentsTable.id, priorSowId));
          }

          const pdfUrl = `/api/admin/insights/documents/${docId}/download`;
          await db.update(insightsGeneratedDocumentsTable)
            .set({ pdfUrl })
            .where(eq(insightsGeneratedDocumentsTable.id, docId));

          if (projectId) {
            void broadcastSowChangeForProject(projectId);
            void syncPresentationDocIds(projectId, docId, "consolidated_sow");
            void broadcastDocsChangeForProject(projectId);
          }
        } catch (err) {
          logger.error({ err, docId }, "insights consolidated_sow: background generation failed");
          await db.update(insightsGeneratedDocumentsTable)
            .set({ status: "failed", errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500), updatedAt: new Date() })
            .where(eq(insightsGeneratedDocumentsTable.id, docId))
            .catch((dbErr) => logger.warn({ dbErr }, "insights: failed to mark sow doc as failed"));
        }
      })();
      return; // response already sent above — must not fall through to the shared handler below
    }
    // ── End Consolidated SOW ─────────────────────────────────────────────────────

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

    const healthScores = customerId ? await fetchClientHealthScores(customerId) : null;
    const scores = healthScores ?? computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
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
      sow:                        "Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Pricing (see Tier 02 formula below), Acceptance Criteria, Terms & Conditions",
      remediation_plan:           "Include: Executive Summary, Current State Assessment, Critical Findings, Remediation Steps by Domain (Priority 1/2/3), Implementation Timeline, Success Metrics, Risk Mitigation",
      deployment_plan:            "Include: Deployment Overview, Pre-deployment Checklist, Environment Readiness, Phased Rollout Plan, Rollback Procedure, Testing & Validation, Go-live Criteria, Post-deployment Support",
      governance_framework:       "Include: Governance Principles, Roles & Responsibilities Matrix, Policy Framework, Compliance Requirements, Enforcement Mechanisms, Review Cadence, Exception Process",
      security_hardening_plan:    "Include: Threat Assessment, Identity & Access Hardening, Conditional Access Policy Design, Privileged Access Workstations, Defender Configuration, Security Monitoring, Incident Response",
      copilot_enablement_plan:    "Include: Readiness Assessment, License & Entitlement Review, Data Governance Pre-work, Pilot Group Selection, Training Plan, Success Metrics, Rollout Phases, Adoption Strategy",
      identity_modernization_plan:"Include: Current Identity State, Entra ID Configuration, MFA Enforcement, Privileged Identity Management, External Identities, B2B/B2C Strategy, Migration Roadmap, Legacy System Decommission",
      copilot_readiness:          "Include: Executive Readiness Summary, Identity & MFA Posture, Licensing & Entitlement Gaps, Data Governance Readiness (sensitivity labels, DLP, sharing policies), Security Score vs Copilot Minimum Bar, Blockers & Remediation Recommendations, Overall Readiness Rating (Red / Amber / Green)",
    };

    const typeLabel = CONSULTING_TYPE_LABELS[deliverableType] ?? deliverableType;

    const scoresBlock = `- Security: ${scores.security}/100\n- Compliance: ${scores.compliance}/100\n- Copilot: ${scores.copilot}/100\n- Governance: ${scores.governance}/100\n- Productivity: ${scores.productivity}/100\n- Composite: ${scores.composite}/100`;
    const findingsInline = findings.slice(0, 10).join("; ") || "Pending assessment runs";
    const recommendationsInline = recommendations.slice(0, 8).join("; ") || "Pending assessment runs";

    // Fetch prior documents for consistency injection
    const isSowType = deliverableType === "sow" || deliverableType === "consolidated_sow";
    const priorDocs = (customerId && projectId)
      ? await db.select({
          title:       insightsGeneratedDocumentsTable.title,
          docType:     insightsGeneratedDocumentsTable.docType,
          htmlContent: insightsGeneratedDocumentsTable.htmlContent,
        })
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          eq(insightsGeneratedDocumentsTable.customerId, customerId),
          eq(insightsGeneratedDocumentsTable.projectId, projectId),
          ne(insightsGeneratedDocumentsTable.docType, deliverableType),
        ))
        .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
      : [];

    const stripHtmlText = (html: string) =>
      html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 400);

    const priorDocsSummary = priorDocs.length > 0
      ? `PRIOR DOCUMENTS FOR THIS CLIENT (your output must be consistent with these findings and must not contradict these prior conclusions):\n${priorDocs.map(d => `[${d.title} (${d.docType})]: ${stripHtmlText(d.htmlContent)}`).join("\n\n")}\n\n`
      : "";

    // For SOW types embed Tier 02 pricing formula + catalogue
    let pricingAppendix = "";
    if (isSowType) {
      const engProjects = await db.select({
        title:       engagementProjectsTable.title,
        priceRange:  engagementProjectsTable.priceRange,
        description: engagementProjectsTable.description,
        sowItems:    engagementProjectsTable.sowItems,
      })
        .from(engagementProjectsTable)
        .where(eq(engagementProjectsTable.isVisible, true))
        .orderBy(engagementProjectsTable.sortOrder);
      const catalogueBlock = engProjects.length > 0
        ? engProjects.map(p => `• ${p.title} — ${p.priceRange}${p.description ? `\n  ${p.description}` : ""}${p.sowItems?.length ? `\n  Deliverables: ${(p.sowItems as string[]).join(", ")}` : ""}`).join("\n\n")
        : "No engagement project pricing configured.";
      pricingAppendix = `\n\nENGAGEMENT PROJECTS CATALOGUE (use these as Base Ceiling starting points):\n${catalogueBlock}\n\nPRICING FORMULA:\n${TIER_02_PRICING_FORMULA_BLOCK}`;
    }

    // Fallback injects per-type section hints for the case where the DB row is absent
    const consultingFallback = substituteTokens(INSIGHTS_CONSULTING_PROMPT_FALLBACK, {
      sectionHints: sectionHints[deliverableType] ?? "Include relevant sections for this type of consulting deliverable",
    });
    const rawConsultingTemplate = await getPrompt(`insights-consulting-${deliverableType}`, consultingFallback);
    let prompt = substituteTokens(rawConsultingTemplate, {
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
      priorDocsSummary,
    });
    if (pricingAppendix) prompt += pricingAppendix;

    // Find any prior completed doc for same customer+project+deliverableType (to replace on success)
    let priorConsultingId: number | null = null;
    if (customerId && projectId) {
      const prior = await db.select({ id: insightsGeneratedDocumentsTable.id })
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          eq(insightsGeneratedDocumentsTable.customerId, customerId),
          eq(insightsGeneratedDocumentsTable.projectId, projectId),
          eq(insightsGeneratedDocumentsTable.docType, deliverableType),
          inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered", "archived"]),
        ))
        .limit(1);
      priorConsultingId = prior[0]?.id ?? null;
    }

    // Always INSERT a new generating row — fresh createdAt sorts to top; prior doc untouched until success
    const [genConsultingRow] = await db.insert(insightsGeneratedDocumentsTable).values({
      customerId: customerId ?? null, projectId: projectId ?? null,
      category: "consulting", docType: deliverableType,
      title, htmlContent: "", status: "generating", pdfUrl: null,
    }).returning({ id: insightsGeneratedDocumentsTable.id });
    const consultingDocId = genConsultingRow!.id;

    // Return immediately — Sonnet generation can take 60-120 s.
    // Client polls GET /documents every 3 s and will see "generating" → "approved".
    res.json({ id: consultingDocId, status: "generating" });

    void (async () => {
      try {
        const docStylePrefix = await getDocumentStylePrefix();
        const aiResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          messages: [{ role: "user", content: docStylePrefix + prompt }],
        });
        if (aiResponse.stop_reason === "max_tokens") {
          logger.warn({ deliverableType, consultingDocId }, "insights consulting: output hit max_tokens — document may be truncated");
        }
        const rawHtmlContent2 = extractAiHtml(aiResponse);

        let htmlContent: string;
        let sowLines2: SowPricingLine[];
        let sowTotal2: number;
        if (isSowType) {
          const { workstreamLines: ws2, adjustmentLines: adj2, computedTotal: ct2 } = parseSowAllPricing(rawHtmlContent2);
          htmlContent = ct2 > 0 ? patchSowGrandTotal(rawHtmlContent2, ct2) : rawHtmlContent2;
          sowLines2 = [
            ...ws2.map(l => ({ ...l, line_type: "workstream" as const })),
            ...adj2.map(l => ({ ...l, line_type: "adjustment" as const })),
          ];
          sowTotal2 = ct2;
        } else {
          htmlContent = rawHtmlContent2;
          sowLines2 = [];
          sowTotal2 = 0;
        }

        await db.update(insightsGeneratedDocumentsTable)
          .set({
            htmlContent,
            status: "approved",
            approvedAt: new Date(),
            pdfUrl: null,
            sowPricingLines: sowLines2.length > 0 ? sowLines2 : null,
            sowTotalPrice:   sowTotal2 > 0 ? String(sowTotal2) : null,
            updatedAt: new Date(),
          })
          .where(eq(insightsGeneratedDocumentsTable.id, consultingDocId));

        if (priorConsultingId !== null) {
          await db.delete(insightsGeneratedDocumentsTable)
            .where(eq(insightsGeneratedDocumentsTable.id, priorConsultingId));
        }

        const pdfUrl = `/api/admin/insights/documents/${consultingDocId}/download`;
        await db.update(insightsGeneratedDocumentsTable)
          .set({ pdfUrl })
          .where(eq(insightsGeneratedDocumentsTable.id, consultingDocId));

        if (isSowType && projectId) {
          void broadcastSowChangeForProject(projectId);
          void syncPresentationDocIds(projectId, consultingDocId, deliverableType);
          void broadcastDocsChangeForProject(projectId);
        } else if (projectId) {
          void syncPresentationDocIds(projectId, consultingDocId, deliverableType);
          void broadcastDocsChangeForProject(projectId);
        }
      } catch (err) {
        logger.error({ err, deliverableType, consultingDocId }, "insights consulting: background generation failed");
        await db.update(insightsGeneratedDocumentsTable)
          .set({ status: "failed", errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500), updatedAt: new Date() })
          .where(eq(insightsGeneratedDocumentsTable.id, consultingDocId))
          .catch((dbErr) => logger.warn({ dbErr }, "insights: failed to mark consulting doc as failed"));
      }
    })();
  } catch (err) {
    logger.error({ err }, "insights consulting generate error");
    return res.status(500).json({ error: "Failed to generate consulting deliverable" });
  }
});

// ── POST /api/admin/insights/consulting/payload-preview ───────────────────────
// Returns the assembled Claude payload for a consulting deliverable without
// actually calling the AI. Read-only — no DB writes.

router.post("/admin/insights/consulting/payload-preview", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = generateConsultingSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    const { customerId, projectId, deliverableType, title } = body.data;

    // ── Special path: Consolidated SOW ──────────────────────────────────────────
    if (deliverableType === "consolidated_sow") {
      const stripHtml = (html: string) =>
        html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 1800);

      const [existingDocs, engagementProjects, customerRow, m365ProfileRow, scriptRuns, scoresRow] = await Promise.all([
        customerId
          ? db.select({ id: insightsGeneratedDocumentsTable.id, title: insightsGeneratedDocumentsTable.title, docType: insightsGeneratedDocumentsTable.docType, category: insightsGeneratedDocumentsTable.category, htmlContent: insightsGeneratedDocumentsTable.htmlContent })
              .from(insightsGeneratedDocumentsTable)
              .where(and(eq(insightsGeneratedDocumentsTable.customerId, customerId), notInArray(insightsGeneratedDocumentsTable.docType, ["sow", "consolidated_sow"])))
              .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
          : Promise.resolve([] as { id: number; title: string; docType: string; category: string; htmlContent: string }[]),
        db.select({ title: engagementProjectsTable.title, priceRange: engagementProjectsTable.priceRange, description: engagementProjectsTable.description, sowItems: engagementProjectsTable.sowItems })
          .from(engagementProjectsTable).where(eq(engagementProjectsTable.isVisible, true)).orderBy(engagementProjectsTable.sortOrder),
        customerId
          ? db.select({ name: usersTable.name, company: usersTable.company }).from(usersTable).where(eq(usersTable.id, customerId)).limit(1)
          : Promise.resolve([] as { name: string | null; company: string | null }[]),
        customerId
          ? db.select({ profile: clientM365ProfilesTable.profile }).from(clientM365ProfilesTable).where(eq(clientM365ProfilesTable.clientId, customerId)).limit(1)
          : Promise.resolve([] as { profile: Record<string, unknown> | null }[]),
        customerId
          ? db.select({ scriptName: scriptRunResultsTable.scriptName, parsedFindings: scriptRunResultsTable.parsedFindings, recommendations: scriptRunResultsTable.recommendations, profileUpdates: scriptRunResultsTable.profileUpdates, scoreImpact: scriptRunResultsTable.scoreImpact, createdAt: scriptRunResultsTable.createdAt })
              .from(scriptRunResultsTable).where(and(eq(scriptRunResultsTable.customerId, customerId), eq(scriptRunResultsTable.status, "completed"))).orderBy(desc(scriptRunResultsTable.createdAt)).limit(50)
          : Promise.resolve([] as { scriptName: string | null; parsedFindings: string[] | null; recommendations: string[] | null; profileUpdates: Record<string, unknown> | null; scoreImpact: Record<string, unknown> | null; createdAt: Date }[]),
        customerId
          ? db.select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score }).from(clientHealthHistoryTable).where(eq(clientHealthHistoryTable.clientId, customerId)).orderBy(desc(clientHealthHistoryTable.recordedAt)).limit(50)
          : Promise.resolve([] as { category: string; score: number }[]),
      ]);

      const clientName = (customerRow as { company: string | null; name: string | null }[])[0]?.company ?? (customerRow as { company: string | null; name: string | null }[])[0]?.name ?? "Client";

      const docsBlock = existingDocs.length > 0
        ? existingDocs.map((d, i) => `[Document ${i + 1}] ${d.title} (${d.docType})\n${stripHtml(d.htmlContent)}`).join("\n\n---\n\n")
        : "No prior documents found for this client.";

      const projectsBlock = engagementProjects.length > 0
        ? engagementProjects.map(p => `• ${p.title} — ${p.priceRange}${p.description ? `\n  ${p.description}` : ""}${p.sowItems?.length ? `\n  Deliverables: ${(p.sowItems as string[]).join(", ")}` : ""}`).join("\n\n")
        : "No engagement project pricing configured.";

      const telemetryLines: string[] = [];
      const profile = (m365ProfileRow as { profile: Record<string, unknown> | null }[])[0]?.profile;
      if (profile && Object.keys(profile).length > 0) {
        telemetryLines.push("M365 HEALTH PROFILE FLAGS:");
        for (const [k, v] of Object.entries(profile)) telemetryLines.push(`  ${k}: ${String(v)}`);
      }

      type RunRow = { scriptName: string | null; parsedFindings: string[] | null; recommendations: string[] | null; profileUpdates: Record<string, unknown> | null };
      const typedRuns = scriptRuns as RunRow[];
      const allFindings = [...new Set(typedRuns.flatMap(r => r.parsedFindings ?? []))].slice(0, 40);
      const allRecs     = [...new Set(typedRuns.flatMap(r => r.recommendations ?? []))].slice(0, 30);

      if (allFindings.length > 0) { telemetryLines.push(`\nSCRIPT FINDINGS (${typedRuns.length} run${typedRuns.length === 1 ? "" : "s"}):`); for (const f of allFindings) telemetryLines.push(`  • ${f}`); }
      if (allRecs.length > 0) { telemetryLines.push("\nRECOMMENDATIONS FROM SCRIPTS:"); for (const r of allRecs) telemetryLines.push(`  • ${r}`); }

      const mergedSowProfile: Record<string, unknown> = {};
      for (const run of [...typedRuns].reverse()) Object.assign(mergedSowProfile, run.profileUpdates ?? {});
      if (Object.keys(mergedSowProfile).length > 0) {
        telemetryLines.push("\nCONFIGURATION TELEMETRY (from script runs):");
        for (const [k, v] of Object.entries(mergedSowProfile)) telemetryLines.push(`  ${k}: ${String(v)}`);
      }
      const tenantTelemetryBlock = telemetryLines.length > 0 ? telemetryLines.join("\n") : "No tenant telemetry collected yet.";

      const sp = mergedSowProfile;
      const sowTenantFacts = [
        `Total Users in Tenant:       ${sp.totalUserCount ?? "unknown"}`,
        `Licensed Users:              ${sp.licensedUserCount ?? "unknown"}`,
        `Active User Percent:         ${sp.activeUserPercent ?? "unknown"}%`,
        `SharePoint Sites:            ${sp.sharepointSiteCount ?? "unknown"}`,
        `Microsoft 365 Groups:        ${sp.m365GroupCount ?? "unknown"}`,
        `Teams Count:                 ${sp.teamCount ?? sp.teamsCount ?? "unknown"}`,
        `Guest Users:                 ${sp.guestUserCount ?? "unknown"}`,
        `External Sharing Enabled:    ${sp.externalSharingEnabled ?? "unknown"}`,
        `DLP Policies:                ${sp.dlpPoliciesCount ?? (sp.hasDLP === false ? 0 : "unknown")}`,
        `Sensitivity Labels:          ${sp.sensitivityLabelsConfigured === false ? "None configured" : (sp.sensitivityLabelsConfigured ?? "unknown")}`,
        `Conditional Access Policies: ${sp.conditionalAccessPolicyCount ?? sp.conditionalAccessPoliciesCount ?? (sp.conditionalAccessEnabled === false ? 0 : "unknown")}`,
        `Copilot Licenses:            ${sp.copilotLicenseCount ?? (sp.hasCopilotLicenses === false ? 0 : "unknown")}`,
        `MFA Enforced:                ${sp.mfaEnforced ?? "unknown"}`,
      ].join("\n");

      const CONSOLIDATED_SOW_FALLBACK_PREVIEW = `You are Shane McCaw, a senior Microsoft 365 Architect. Generate a comprehensive Consolidated SOW in HTML format.\n\nClient: {{clientName}}\nTitle: {{title}}\nDate: {{date}}\n\nEXISTING DOCUMENTS:\n{{existingDocs}}\n\nENGAGEMENT PROJECTS:\n{{engagementProjects}}\n\nTENANT TELEMETRY:\n{{tenantTelemetry}}`;
      const rawTemplate = await getPrompt("insights-consulting-consolidated_sow", CONSOLIDATED_SOW_FALLBACK_PREVIEW);
      const assembledPrompt = rawTemplate
        .replace(/\{\{clientName\}\}/g, clientName).replace(/\{\{title\}\}/g, title)
        .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }))
        .replace(/\{\{existingDocs\}\}/g, docsBlock).replace(/\{\{engagementProjects\}\}/g, projectsBlock)
        .replace(/\{\{tenantTelemetry\}\}/g, tenantTelemetryBlock)
        + `\n\nCRITICAL — TENANT FACTS:\n${sowTenantFacts}\n\nTIER 02 PRICING FORMULA:\n${TIER_02_PRICING_FORMULA_BLOCK}`;

      const stylePrefix = await getDocumentStylePrefix();
      const healthHistoryRows = scoresRow as { category: string; score: number }[];
      const latestScores: Record<string, number> = {};
      for (const row of healthHistoryRows) { if (!(row.category in latestScores)) latestScores[row.category] = row.score; }

      return res.json({
        model: "claude-sonnet-4-6",
        maxTokens: 16000,
        stylePrefix: stylePrefix.trim(),
        assembledPrompt,
        existingDocsSummary: docsBlock,
        engagementProjectsSummary: projectsBlock,
        scores: {
          security: latestScores["security"] ?? 0, compliance: latestScores["compliance"] ?? 0,
          copilot: latestScores["copilot"] ?? 0, governance: latestScores["governance"] ?? 0,
          productivity: latestScores["productivity"] ?? 0,
          composite: Object.values(latestScores).length > 0 ? Math.round(Object.values(latestScores).reduce((a, b) => a + b, 0) / Object.values(latestScores).length) : 0,
        },
        findings: allFindings.slice(0, 15),
        recommendations: allRecs.slice(0, 10),
        profileSample: Object.entries(mergedSowProfile).slice(0, 30).map(([k, v]) => [k, String(v)]),
        tenantFacts: sowTenantFacts,
        pricingFormula: TIER_02_PRICING_FORMULA_BLOCK,
      });
    }
    // ── End Consolidated SOW ─────────────────────────────────────────────────────

    const [runs, customer, project] = await Promise.all([
      fetchRunsForCustomer(customerId, projectId, 50),
      customerId
        ? db.select({ name: usersTable.name, company: usersTable.company }).from(usersTable).where(eq(usersTable.id, customerId)).limit(1)
        : Promise.resolve([]),
      projectId
        ? db.select({ title: projectsTable.title, phase: projectsTable.phase, description: projectsTable.description }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1)
        : Promise.resolve([]),
    ]);

    const healthScores = customerId ? await fetchClientHealthScores(customerId) : null;
    const scores = healthScores ?? computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
    const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);
    const clientName = (customer as { company: string | null; name: string | null }[])[0]?.company ?? (customer as { company: string | null; name: string | null }[])[0]?.name ?? "Client";
    const projRow = (project as { title: string; phase: string | null; description: string | null }[])[0];
    const projectDesc = projRow ? `Project: ${projRow.title}${projRow.phase ? ` (${projRow.phase})` : ""}${projRow.description ? ` — ${projRow.description}` : ""}` : "";

    const profileSamplePairs = (runs as { profileUpdates: Record<string, unknown> }[])
      .flatMap(r => Object.entries(r.profileUpdates ?? {}).slice(0, 5))
      .slice(0, 30);
    const profileSample = profileSamplePairs.map(([k, v]) => `  ${k}: ${String(v)}`).join("\n");

    const sectionHintsConsulting: Record<string, string> = {
      sow: "Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Pricing (see Tier 02 formula below), Acceptance Criteria, Terms & Conditions",
      remediation_plan: "Include: Executive Summary, Current State Assessment, Critical Findings, Remediation Steps by Domain (Priority 1/2/3), Implementation Timeline, Success Metrics, Risk Mitigation",
      deployment_plan: "Include: Deployment Overview, Pre-deployment Checklist, Environment Readiness, Phased Rollout Plan, Rollback Procedure, Testing & Validation, Go-live Criteria, Post-deployment Support",
      governance_framework: "Include: Governance Principles, Roles & Responsibilities Matrix, Policy Framework, Compliance Requirements, Enforcement Mechanisms, Review Cadence, Exception Process",
      security_hardening_plan: "Include: Threat Assessment, Identity & Access Hardening, Conditional Access Policy Design, Privileged Access Workstations, Defender Configuration, Security Monitoring, Incident Response",
      copilot_enablement_plan: "Include: Readiness Assessment, License & Entitlement Review, Data Governance Pre-work, Pilot Group Selection, Training Plan, Success Metrics, Rollout Phases, Adoption Strategy",
      identity_modernization_plan: "Include: Current Identity State, Entra ID Configuration, MFA Enforcement, Privileged Identity Management, External Identities, B2B/B2C Strategy, Migration Roadmap, Legacy System Decommission",
      copilot_readiness: "Include: Executive Readiness Summary, Identity & MFA Posture, Licensing & Entitlement Gaps, Data Governance Readiness, Security Score vs Copilot Minimum Bar, Blockers & Remediation Recommendations, Overall Readiness Rating (Red / Amber / Green)",
      task_execution_guide: "Include: Task overview, Step-by-step execution instructions per task, Pre-conditions, Success criteria, Rollback steps",
    };

    const typeLabel = CONSULTING_TYPE_LABELS[deliverableType] ?? deliverableType;
    const scoresBlock = `- Security: ${scores.security}/100\n- Compliance: ${scores.compliance}/100\n- Copilot: ${scores.copilot}/100\n- Governance: ${scores.governance}/100\n- Productivity: ${scores.productivity}/100\n- Composite: ${scores.composite}/100`;
    const findingsInline = findings.slice(0, 10).join("; ") || "Pending assessment runs";
    const recommendationsInline = recommendations.slice(0, 8).join("; ") || "Pending assessment runs";

    const isSowType = deliverableType === "sow";
    const priorDocs = (customerId && projectId)
      ? await db.select({ title: insightsGeneratedDocumentsTable.title, docType: insightsGeneratedDocumentsTable.docType, htmlContent: insightsGeneratedDocumentsTable.htmlContent })
          .from(insightsGeneratedDocumentsTable)
          .where(and(eq(insightsGeneratedDocumentsTable.customerId, customerId), eq(insightsGeneratedDocumentsTable.projectId, projectId), ne(insightsGeneratedDocumentsTable.docType, deliverableType)))
          .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
      : [];

    const stripHtmlText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 400);
    const priorDocsSummary = priorDocs.length > 0
      ? `PRIOR DOCUMENTS FOR THIS CLIENT:\n${priorDocs.map(d => `[${d.title} (${d.docType})]: ${stripHtmlText(d.htmlContent)}`).join("\n\n")}\n\n`
      : "";

    let pricingAppendix = "";
    if (isSowType) {
      const engProjects = await db.select({ title: engagementProjectsTable.title, priceRange: engagementProjectsTable.priceRange, description: engagementProjectsTable.description, sowItems: engagementProjectsTable.sowItems })
        .from(engagementProjectsTable).where(eq(engagementProjectsTable.isVisible, true)).orderBy(engagementProjectsTable.sortOrder);
      const catalogueBlock = engProjects.length > 0
        ? engProjects.map(p => `• ${p.title} — ${p.priceRange}${p.description ? `\n  ${p.description}` : ""}${p.sowItems?.length ? `\n  Deliverables: ${(p.sowItems as string[]).join(", ")}` : ""}`).join("\n\n")
        : "No engagement project pricing configured.";
      pricingAppendix = `\n\nENGAGEMENT PROJECTS CATALOGUE:\n${catalogueBlock}\n\nPRICING FORMULA:\n${TIER_02_PRICING_FORMULA_BLOCK}`;
    }

    const consultingFallback = substituteTokens(INSIGHTS_CONSULTING_PROMPT_FALLBACK, {
      sectionHints: sectionHintsConsulting[deliverableType] ?? "Include relevant sections for this type of consulting deliverable",
    });
    const rawConsultingTemplate = await getPrompt(`insights-consulting-${deliverableType}`, consultingFallback);
    let assembledPrompt = substituteTokens(rawConsultingTemplate, {
      typeLabel, clientName,
      projectDesc: projectDesc ? projectDesc + "\n" : "",
      title,
      date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      scores: scoresBlock, findings: findingsInline, recommendations: recommendationsInline,
      profileSample: profileSample || "  No telemetry captured yet.",
      sectionHints: sectionHintsConsulting[deliverableType] ?? "Include relevant sections for this type of consulting deliverable",
      priorDocsSummary,
    });
    if (pricingAppendix) assembledPrompt += pricingAppendix;

    const stylePrefix = await getDocumentStylePrefix();

    const result: Record<string, unknown> = {
      model: "claude-sonnet-4-6",
      maxTokens: 16000,
      stylePrefix: stylePrefix.trim(),
      assembledPrompt,
      scores,
      findings: findings.slice(0, 15),
      recommendations: recommendations.slice(0, 10),
      profileSample: profileSamplePairs.map(([k, v]) => [k, String(v)]),
    };
    if (isSowType) result["pricingFormula"] = TIER_02_PRICING_FORMULA_BLOCK;

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "insights consulting payload-preview error");
    return res.status(500).json({ error: "Failed to assemble consulting payload preview" });
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

    // Auto-promote legacy drafts so they can always be sent
    if (doc.status === "draft") {
      await db.update(insightsGeneratedDocumentsTable)
        .set({ status: "approved", approvedAt: new Date() })
        .where(eq(insightsGeneratedDocumentsTable.id, id));
      doc.status = "approved";
    }

    if (doc.status !== "approved") {
      return res.status(400).json({ error: "Document must be approved before sending." });
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

    // Sync doc into draft presentations for the same project on delivery
    if (doc.projectId && (doc.docType === "sow" || doc.docType === "consolidated_sow")) {
      void syncPresentationDocIds(doc.projectId, doc.id, doc.docType);
      void broadcastDocsChangeForProject(doc.projectId);
    }

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

// ── POST /api/admin/insights/automations/:id/run ──────────────────────────────
// Streams execution progress as Server-Sent Events (text/event-stream).
// Events:
//   event: log   — data: RunLogEntry JSON  (emitted live during execution)
//   event: complete — data: { ok, automation } JSON  (final, closes stream)
//   event: error — data: { error: string }  (on failure)

router.post("/admin/insights/automations/:id/run", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const claimed = await executeAutomation(id, entry => sendEvent("log", entry));
    if (claimed === null) {
      sendEvent("error", { error: "Automation not found" });
      return;
    }
    if (!claimed) {
      sendEvent("error", { error: "This automation is already running. Wait for it to finish before running again." });
      return;
    }
    const [updated] = await db.select().from(insightsAutomationsTable)
      .where(eq(insightsAutomationsTable.id, id)).limit(1);
    if (!updated) {
      sendEvent("error", { error: "Automation not found" });
    } else {
      sendEvent("complete", { ok: true, automation: { ...updated, cronLabel: describeCron(updated.cronExpression) } });
    }
  } catch (err) {
    logger.error({ err }, "insights automation run error");
    sendEvent("error", { error: "Failed to run automation" });
  } finally {
    res.end();
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

type RunLogEntry = { ts: string; level: "info" | "warn" | "error"; message: string };

/**
 * Execute an automation.
 * Returns:
 *   null  — automation not found
 *   false — lock was already held (another run is in progress)
 *   true  — execution completed (success or error; always releases lock in finally)
 *
 * Lock acquisition is atomic: a single UPDATE ... WHERE running_at IS NULL RETURNING
 * ensures only one concurrent caller can claim the lock.
 */
export async function executeAutomation(
  automationId: number,
  onLog?: (entry: RunLogEntry) => void,
): Promise<boolean | null> {
  const [automation] = await db.select().from(insightsAutomationsTable)
    .where(eq(insightsAutomationsTable.id, automationId)).limit(1);
  if (!automation) return null;

  const now = new Date();
  const runLog: RunLogEntry[] = [];

  const log = (level: RunLogEntry["level"], message: string) => {
    const entry: RunLogEntry = { ts: new Date().toISOString(), level, message };
    runLog.push(entry);
    onLog?.(entry);
  };

  log("info", "Automation started");

  // Atomically claim the lock — only proceeds if running_at is currently NULL
  const [claimed] = await db.update(insightsAutomationsTable)
    .set({ runningAt: now })
    .where(and(eq(insightsAutomationsTable.id, automationId), isNull(insightsAutomationsTable.runningAt)))
    .returning({ id: insightsAutomationsTable.id });

  if (!claimed) {
    logger.warn({ automationId }, "insights: automation already running — skipping duplicate execution");
    return false;
  }

  try {
    // ── 1. Trigger linked Azure runbook (if configured) ─────────────────────
    if (automation.linkedRunbookScriptId) {
      if (isAzureConfigured()) {
        log("info", "Resolving linked Azure runbook…");
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
            log("info", `Triggered Azure runbook "${runbookName}" (job ${job.jobId})`);
          } else {
            logger.warn(
              { automationId, linkedRunbookScriptId: automation.linkedRunbookScriptId },
              "insights: linked script has no azureRunbookName — skipping Azure trigger",
            );
            log("warn", "Linked script has no Azure runbook name — runbook trigger skipped");
          }
        } catch (runbookErr) {
          logger.warn({ runbookErr, automationId }, "insights: Azure runbook trigger failed (non-fatal)");
          log("warn", `Azure runbook trigger failed (non-fatal): ${String(runbookErr)}`);
        }
      } else {
        logger.info({ automationId }, "insights: Azure not configured — skipping runbook trigger");
        log("warn", "Azure not configured — runbook trigger skipped");
      }
    }

    // ── 2. Generate document (if enabled) ───────────────────────────────────
    if (automation.generateDocument) {
      log("info", "Fetching telemetry runs for document generation…");
      const runs = await fetchRunsForCustomer(
        automation.customerId ?? undefined,
        automation.projectId  ?? undefined,
        50,
      );
      log("info", `Loaded ${runs.length} telemetry run(s)`);
      const healthScores = automation.customerId ? await fetchClientHealthScores(automation.customerId) : null;
      const scores = healthScores ?? computeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
      const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);
      log("info", `Scores — Security: ${scores.security}/100, Compliance: ${scores.compliance}/100, Copilot: ${scores.copilot}/100, Governance: ${scores.governance}/100 (source: ${healthScores ? "health-history" : "run-impacts"})`);

      const docType   = REPORT_DOC_TYPES_FOR_AUTOMATION[automation.automationType] ?? "executive_summary";
      const docLabel  = REPORT_DOC_TYPE_LABELS_AUTO[docType] ?? docType;
      const reportDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      const profileSample = (runs as { profileUpdates: Record<string, unknown> }[])
        .flatMap(r => Object.entries(r.profileUpdates ?? {}).slice(0, 5))
        .slice(0, 20)
        .map(([k, v]) => `  ${k}: ${String(v)}`)
        .join("\n");

      const prompt = `You are Shane McCaw, a senior Microsoft 365 Architect. Generate an automated ${docLabel} for ${reportDate} in HTML format.
Security: ${scores.security}/100, Compliance: ${scores.compliance}/100, Copilot: ${scores.copilot}/100, Governance: ${scores.governance}/100, Productivity: ${scores.productivity}/100.
Findings: ${findings.slice(0, 10).join("; ") || "No findings"}.
Recommendations: ${recommendations.slice(0, 5).join("; ") || "None"}.
Configuration telemetry:
${profileSample || "  No telemetry captured yet."}
Output ONLY valid HTML with inline CSS (white background, #0078D4 accents). Include: branded header, score summary table, findings section, recommendations section, footer. 400-900 words.`;

      log("info", `AI document generation started (${docLabel})…`);
      const docStylePrefix = await getDocumentStylePrefix();
      const aiResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: docStylePrefix + prompt }],
      });

      const htmlContent = extractAiHtml(aiResponse);
      log("info", "AI generation complete — saving document draft…");

      const [newDoc] = await db.insert(insightsGeneratedDocumentsTable).values({
        customerId: automation.customerId ?? null,
        projectId:  automation.projectId  ?? null,
        category:   "report",
        docType,
        title:      `${automation.name} — ${reportDate}`,
        htmlContent,
        status:     "approved",
        approvedAt: new Date(),
        pdfUrl:     null,
      }).returning();

      const pdfUrl = `/api/admin/insights/documents/${newDoc!.id}/download`;
      await db.update(insightsGeneratedDocumentsTable)
        .set({ pdfUrl })
        .where(eq(insightsGeneratedDocumentsTable.id, newDoc!.id));

      logger.info({ automationId, docType, docId: newDoc!.id }, "insights: automation document generated and auto-approved");
      log("info", `Document saved as draft — "${automation.name} — ${reportDate}" (ID ${newDoc!.id})`);

      // ── Notify admins that a new report is ready for review ─────────────────
      const notifTitle = `New report ready: ${automation.name}`;
      const notifBody  = `An auto-generated ${docLabel} is waiting for your review.`;
      const notifLink  = "/command/insights?tab=documents";

      try {
        const admins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.role, "admin"));

        if (admins.length > 0) {
          await db.insert(notificationsTable).values(
            admins.map(a => ({
              userId:   a.id,
              title:    notifTitle,
              body:     notifBody,
              type:     "document" as const,
              linkPath: notifLink,
            })),
          );
          log("info", `Admin notification sent to ${admins.length} admin(s)`);
        }
      } catch (notifErr) {
        logger.warn({ notifErr, automationId }, "insights: failed to insert report-ready notifications (non-fatal)");
        log("warn", "Failed to insert admin notifications (non-fatal)");
      }

      void sendWebPushToAdmins({
        title:    notifTitle,
        body:     notifBody,
        linkPath: notifLink,
      });
      log("info", "Web push notification dispatched");
    }

    // ── 3. Update last/next run timestamps ──────────────────────────────────
    const nextRunAt = nextRunFromCron(automation.cronExpression);
    log("info", `Next scheduled run: ${nextRunAt ? nextRunAt.toISOString() : "N/A"}`);
    log("info", "Automation completed successfully");

    await db.update(insightsAutomationsTable)
      .set({ lastRunAt: now, nextRunAt, updatedAt: now, lastRunLog: runLog })
      .where(eq(insightsAutomationsTable.id, automationId));

  } catch (err) {
    logger.warn({ err, automationId }, "insights: automation execution failed (non-fatal)");
    log("error", `Automation failed: ${String(err)}`);
    // Persist the partial log even on failure
    await db.update(insightsAutomationsTable)
      .set({ lastRunAt: now, updatedAt: now, lastRunLog: runLog })
      .where(eq(insightsAutomationsTable.id, automationId))
      .catch(() => { /* best-effort */ });
  } finally {
    // Always clear the running lock so the next scheduled/manual run can proceed
    await db.update(insightsAutomationsTable)
      .set({ runningAt: null }).where(eq(insightsAutomationsTable.id, automationId));
  }

  return true;
}

export default router;
