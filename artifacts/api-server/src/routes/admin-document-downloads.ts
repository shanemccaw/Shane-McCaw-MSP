/**
 * admin-document-downloads.ts
 *
 * Rehomed from admin-insights.ts (Git #3478). #3417 set out to delete
 * admin-insights.ts wholesale as orphaned Insights Engine code, but three of
 * its GET routes were never Insights-specific in practice and have live,
 * non-Insights-Engine consumers:
 *
 * GET /api/admin/insights/documents/:id/download — the URL stored in every
 *   generated document's `pdf_url` (stamped by workflow-executor.ts's
 *   `generateDocument()` / `generateSowDocument()` paths). Unmounting this
 *   404s the download link on every already-generated document, not just new
 *   ones — the URL path is kept exactly as-is to avoid invalidating those
 *   stored links.
 * GET /api/admin/insights/documents — backs the document pickers in
 *   ScriptGeneratorPage.tsx and WorkflowBuilderPage.tsx.
 * GET /api/admin/insights/projects — backs project pickers in
 *   WorkflowBuilderPage.tsx and WorkflowListPage.tsx.
 *
 * Everything else that used to live in admin-insights.ts (the AI-generation
 * routes, already 410-gated; the automations CRUD/runner; the telemetry
 * scores/heatmap endpoints) was genuinely Insights-Engine-specific and was
 * deleted along with that file, not moved here.
 */

import { Router, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  insightsGeneratedDocumentsTable,
  usersTable,
  projectsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { stripStagedForReviewBanner } from "../lib/sow-pricing.ts";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const log = logger.child({ channel: "admin.documents" });
const router = Router();

// ── Brand colours ─────────────────────────────────────────────────────────────

const navyPdf  = rgb(0.039, 0.145, 0.251); // #0A2540
const bluePdf  = rgb(0,     0.471, 0.831); // #0078D4
const whitePdf = rgb(1,     1,     1);
const greyPdf  = rgb(0.42,  0.49,  0.56);

// ── PDF helpers ───────────────────────────────────────────────────────────────

function sanitizePdf(text: string): string {
  return text
    .replace(/‑/g, "-").replace(/–/g, "-").replace(/—/g, "--")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, "...").replace(/ /g, " ").replace(/•/g, "-")
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
 * Handles the patterns used by AI-generated documents.
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
 * Build a branded PDF from a generated document's HTML content.
 * Uses pdf-lib (already a project dependency via service-overview-pdf / generate-artifacts).
 */
async function generateDocumentPdf(
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
    log.error({ err }, "admin document downloads: projects list error");
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
    log.error({ err }, "admin document downloads: documents list error");
    res.status(500).json({ error: "Failed to load documents" });
  }
});

// ── GET /api/admin/insights/documents/:id/download ────────────────────────────
// Serves a real PDF generated from the stored HTML content using pdf-lib.
// Pass ?format=html to get the raw HTML instead.
//
// URL kept exactly as-is (not renamed alongside the file) — it is the literal
// value stamped into insights_generated_documents.pdf_url by workflow-executor.ts
// for every document already generated, and moving it would 404 every one of
// them.

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

    const pdfBuffer = await generateDocumentPdf(
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
    log.error({ err }, "admin document downloads: document download error");
    return res.status(500).json({ error: "Failed to generate PDF" });
  }
});

export default router;
