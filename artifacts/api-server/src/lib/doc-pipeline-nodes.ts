/**
 * doc-pipeline-nodes.ts
 *
 * Document lifecycle pipeline node handlers for the MSP Portal Workflow Engine.
 *
 * Pipeline stage sequence:
 *   doc_store_html       → stores HTML canonical in msp_document_versions
 *   doc_generate_pdf     → renders HTML to PDF (pdf-lib text extraction)
 *   doc_save_sharepoint  → uploads PDF to SharePoint with checksum deduplication
 *   doc_register_version → links version to parent document
 *   doc_publish          → marks document status = active / pipeline_status = published
 *   doc_audit_export     → emits canonical audit event
 *   doc_cleanup          → clears any temp pipeline resources
 *
 * Node configs and input/output contracts are documented inline.
 * All nodes are idempotent: retrying with the same inputs produces the same output.
 */

import { createHash } from "crypto";
import { registerNodeHandler } from "./portal-workflow-engine";
import type { NodeExecutionContext } from "./portal-workflow-engine";
import { dispatchEvent, systemActor } from "./event-bus";
import {
  db,
  mspDocumentsTable,
  mspDocumentVersionsTable,
  mspSharepointConnectorsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "workflow.doc-pipeline" });
import { uploadToSharePoint, ensureSharePointFolder, computeChecksum } from "./sharepoint-connector";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomUUID } from "crypto";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Strip HTML tags and normalise whitespace for text-based PDF rendering. */
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
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Wrap text at word boundaries for PDF rendering. */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > maxCharsPerLine) {
        if (current.trim()) lines.push(current.trim());
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current.trim()) lines.push(current.trim());
  }
  return lines;
}

/** Generate a basic PDF from plain text using pdf-lib. */
async function generatePdfFromText(plainText: string, title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const MARGIN = 60;
  const LINE_HEIGHT = 14;
  const FONT_SIZE = 10;
  const TITLE_SIZE = 16;
  const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const CHARS_PER_LINE = Math.floor(USABLE_WIDTH / (FONT_SIZE * 0.55));

  const wrappedLines = wrapText(plainText, CHARS_PER_LINE);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  // Title
  page.drawText(title.slice(0, 80), {
    x: MARGIN,
    y,
    size: TITLE_SIZE,
    font: boldFont,
    color: rgb(0.04, 0.15, 0.25),
  });
  y -= TITLE_SIZE + 10;

  // Divider
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= LINE_HEIGHT;

  for (const line of wrappedLines) {
    if (y < MARGIN + LINE_HEIGHT) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
    if (line !== "") {
      page.drawText(line.slice(0, 120), {
        x: MARGIN,
        y,
        size: FONT_SIZE,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    y -= LINE_HEIGHT;
  }

  // Footer on each page
  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const pg = pdfDoc.getPage(i);
    pg.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: MARGIN,
      y: MARGIN / 2,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    pg.drawText(new Date().toISOString().split("T")[0]!, {
      x: PAGE_WIDTH - MARGIN - 60,
      y: MARGIN / 2,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// ── doc_store_html ─────────────────────────────────────────────────────────────
// Config:
//   documentId: string  — UUID of the msp_documents row (required)
//   htmlContent: string — HTML source (required; can also come from input.htmlContent)
//   authorUserId: number
//   changeNote: string   — optional
//   title: string        — optional; updates document title when set
//
// Output: { versionId, documentId, versionNumber, contentHash }
//
// Idempotency: if a version with the same contentHash already exists for this
// document, the existing versionId is returned without creating a duplicate.

async function handleDocStoreHtml(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const documentId = String(ctx.config["documentId"] ?? ctx.input["documentId"] ?? "");
  const htmlContent = String(ctx.config["htmlContent"] ?? ctx.input["htmlContent"] ?? "");
  const authorUserId = Number(ctx.config["authorUserId"] ?? ctx.input["authorUserId"] ?? 0);
  const changeNote = String(ctx.config["changeNote"] ?? ctx.input["changeNote"] ?? "");
  const titleOverride = ctx.config["title"] != null ? String(ctx.config["title"]) : undefined;

  if (!documentId) throw new Error("doc_store_html: documentId is required");
  if (!htmlContent) throw new Error("doc_store_html: htmlContent is required");

  const contentHash = computeChecksum(htmlContent);

  // Idempotency: check for existing version with same hash
  const existing = await db
    .select({
      versionId: mspDocumentVersionsTable.versionId,
      versionNumber: mspDocumentVersionsTable.versionNumber,
    })
    .from(mspDocumentVersionsTable)
    .where(
      and(
        eq(mspDocumentVersionsTable.documentId, documentId),
        eq(mspDocumentVersionsTable.contentHash, contentHash),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const ev = existing[0]!;
    log.info(
      { runId: ctx.runId, nodeId: ctx.nodeId, documentId, versionId: ev.versionId },
      "doc_store_html: existing version with same hash — reusing",
    );
    return {
      versionId: ev.versionId,
      documentId,
      versionNumber: ev.versionNumber,
      contentHash,
      deduplicated: true,
    };
  }

  // Determine next version number
  const countResult = await db
    .select({ n: sql<number>`count(*)` })
    .from(mspDocumentVersionsTable)
    .where(eq(mspDocumentVersionsTable.documentId, documentId));
  const versionNumber = (Number(countResult[0]?.n ?? 0)) + 1;

  const [newVersion] = await db
    .insert(mspDocumentVersionsTable)
    .values({
      documentId,
      versionNumber,
      content: htmlContent,
      contentHash,
      mimeType: "text/html",
      sizeBytes: Buffer.byteLength(htmlContent, "utf8"),
      authorUserId: authorUserId || 0,
      changeNote: changeNote || null,
      pipelineStatus: "html_stored",
    })
    .returning();

  if (!newVersion) throw new Error("doc_store_html: failed to insert document version");

  // Optionally update document title
  await db
    .update(mspDocumentsTable)
    .set({
      pipelineStatus: "html_stored",
      updatedAt: new Date(),
      ...(titleOverride ? { title: titleOverride } : {}),
    })
    .where(eq(mspDocumentsTable.documentId, documentId));

  log.info(
    { runId: ctx.runId, nodeId: ctx.nodeId, documentId, versionId: newVersion.versionId, versionNumber },
    "doc_store_html: version created",
  );

  return {
    versionId: newVersion.versionId,
    documentId,
    versionNumber,
    contentHash,
  };
}

// ── doc_generate_pdf ───────────────────────────────────────────────────────────
// Config: (none required)
//
// Input (from previous node output or input payload):
//   documentId: string
//   versionId: string
//   contentHash: string
//
// Output: { versionId, pdfBase64, pdfSizeBytes, pdfChecksum }
//
// Note: uses pdf-lib text-only rendering. For full HTML fidelity, configure
// playwright-core with a Chromium browser path and replace the render call.

async function handleDocGeneratePdf(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const documentId = String(ctx.input["documentId"] ?? "");
  const versionId = String(ctx.input["versionId"] ?? "");

  if (!documentId || !versionId) {
    throw new Error("doc_generate_pdf: documentId and versionId are required (check previous node output)");
  }

  // Fetch the HTML content
  const [version] = await db
    .select({
      content: mspDocumentVersionsTable.content,
      pipelineStatus: mspDocumentVersionsTable.pipelineStatus,
    })
    .from(mspDocumentVersionsTable)
    .where(eq(mspDocumentVersionsTable.versionId, versionId))
    .limit(1);

  if (!version || !version.content) {
    throw new Error(`doc_generate_pdf: version ${versionId} not found or has no content`);
  }

  // Fetch document title for PDF header
  const [doc] = await db
    .select({ title: mspDocumentsTable.title })
    .from(mspDocumentsTable)
    .where(eq(mspDocumentsTable.documentId, documentId))
    .limit(1);

  const title = doc?.title ?? "Document";

  // Mark as generating
  await db
    .update(mspDocumentVersionsTable)
    .set({ pipelineStatus: "pdf_generating" })
    .where(eq(mspDocumentVersionsTable.versionId, versionId));

  await db
    .update(mspDocumentsTable)
    .set({ pipelineStatus: "pdf_generating", updatedAt: new Date() })
    .where(eq(mspDocumentsTable.documentId, documentId));

  const plainText = stripHtml(version.content);
  const pdfBuffer = await generatePdfFromText(plainText, title);
  const pdfChecksum = computeChecksum(pdfBuffer);
  const pdfBase64 = pdfBuffer.toString("base64");

  // Update version with PDF metadata
  await db
    .update(mspDocumentVersionsTable)
    .set({
      pdfSizeBytes: pdfBuffer.length,
      pipelineStatus: "pdf_ready",
    })
    .where(eq(mspDocumentVersionsTable.versionId, versionId));

  log.info(
    { runId: ctx.runId, nodeId: ctx.nodeId, documentId, versionId, pdfSizeBytes: pdfBuffer.length },
    "doc_generate_pdf: PDF rendered",
  );

  return {
    documentId,
    versionId,
    pdfBase64,
    pdfSizeBytes: pdfBuffer.length,
    pdfChecksum,
  };
}

// ── doc_save_sharepoint ────────────────────────────────────────────────────────
// Config:
//   folderPath: string  — override default folder (e.g. "Documents/Reports")
//   connectorMode: "platform" | "msp_owned"  — optional; read from document if not set
//
// Input (from previous nodes):
//   documentId, versionId, pdfBase64, pdfSizeBytes, pdfChecksum (from doc_generate_pdf)
//
// Output: { sharepointFileId, sharepointFileUrl, deduplicated }
//
// Idempotency: if a version already has sharepointFileId, skip upload and return existing.

async function handleDocSaveSharepoint(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const documentId = String(ctx.input["documentId"] ?? "");
  const versionId = String(ctx.input["versionId"] ?? "");
  const pdfBase64 = String(ctx.input["pdfBase64"] ?? "");
  const pdfChecksum = String(ctx.input["pdfChecksum"] ?? "");

  if (!documentId || !versionId) {
    throw new Error("doc_save_sharepoint: documentId and versionId are required");
  }

  // Check if version already has a SharePoint file (idempotency)
  const [version] = await db
    .select({
      sharepointFileId: mspDocumentVersionsTable.sharepointFileId,
      sharepointFileUrl: mspDocumentVersionsTable.sharepointFileUrl,
      versionNumber: mspDocumentVersionsTable.versionNumber,
    })
    .from(mspDocumentVersionsTable)
    .where(eq(mspDocumentVersionsTable.versionId, versionId))
    .limit(1);

  if (!version) throw new Error(`doc_save_sharepoint: version ${versionId} not found`);

  if (version.sharepointFileId && version.sharepointFileUrl) {
    log.info(
      { runId: ctx.runId, nodeId: ctx.nodeId, documentId, versionId, fileId: version.sharepointFileId },
      "doc_save_sharepoint: SharePoint file already uploaded — skipping (idempotent)",
    );
    return {
      documentId,
      versionId,
      sharepointFileId: version.sharepointFileId,
      sharepointFileUrl: version.sharepointFileUrl,
      deduplicated: true,
    };
  }

  // Load document for connector info
  const [doc] = await db
    .select({
      title: mspDocumentsTable.title,
      mspId: mspDocumentsTable.mspId,
      connectorMode: mspDocumentsTable.connectorMode,
      connectorId: mspDocumentsTable.connectorId,
    })
    .from(mspDocumentsTable)
    .where(eq(mspDocumentsTable.documentId, documentId))
    .limit(1);

  if (!doc) throw new Error(`doc_save_sharepoint: document ${documentId} not found`);

  const connectorMode = (ctx.config["connectorMode"] as "platform" | "msp_owned" | undefined) ?? doc.connectorMode ?? "platform";
  const connectorId = doc.connectorId ?? undefined;

  // Resolve site ID
  let siteId: string | null = null;
  if (connectorMode === "msp_owned" && connectorId) {
    const [connector] = await db
      .select({ sharepointSiteId: mspSharepointConnectorsTable.sharepointSiteId })
      .from(mspSharepointConnectorsTable)
      .where(eq(mspSharepointConnectorsTable.connectorId, connectorId))
      .limit(1);
    siteId = connector?.sharepointSiteId ?? null;
  }

  // Fall back to platform hub site
  if (!siteId) {
    const { db: platformDb, settingsTable } = await import("@workspace/db");
    const { eq: eqFn } = await import("drizzle-orm");
    const [hubRow] = await platformDb
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eqFn(settingsTable.key, "sharepoint_hub_site_id"))
      .limit(1);
    siteId = hubRow?.value ?? null;
  }

  if (!siteId) {
    throw new Error(
      "doc_save_sharepoint: no SharePoint site ID available — configure hub site or MSP-owned connector",
    );
  }

  const folderPath = String(ctx.config["folderPath"] ?? "Documents");
  const filename = `${doc.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_")}_v${version.versionNumber}_${documentId.slice(0, 8)}.pdf`;

  // Ensure the folder exists
  await ensureSharePointFolder({ siteId, folderPath, mode: connectorMode, connectorId });

  // Check for content-hash deduplication across all versions of this document
  const existingByHash = await db
    .select({
      sharepointFileId: mspDocumentVersionsTable.sharepointFileId,
      sharepointFileUrl: mspDocumentVersionsTable.sharepointFileUrl,
    })
    .from(mspDocumentVersionsTable)
    .where(
      and(
        eq(mspDocumentVersionsTable.documentId, documentId),
        eq(mspDocumentVersionsTable.contentHash, pdfChecksum),
      ),
    )
    .limit(1);

  const pdfBuffer = Buffer.from(pdfBase64, "base64");

  // Mark as uploading
  await db
    .update(mspDocumentVersionsTable)
    .set({ pipelineStatus: "sharepoint_uploading" })
    .where(eq(mspDocumentVersionsTable.versionId, versionId));

  await db
    .update(mspDocumentsTable)
    .set({ pipelineStatus: "sharepoint_uploading", updatedAt: new Date() })
    .where(eq(mspDocumentsTable.documentId, documentId));

  const result = await uploadToSharePoint({
    mode: connectorMode,
    connectorId,
    siteId,
    folderPath,
    filename,
    buffer: pdfBuffer,
    mimeType: "application/pdf",
    existingFileId: existingByHash[0]?.sharepointFileId ?? undefined,
    existingFileUrl: existingByHash[0]?.sharepointFileUrl ?? undefined,
  });

  // Persist the SharePoint file ID and URL on the version
  await db
    .update(mspDocumentVersionsTable)
    .set({
      sharepointFileId: result.fileId,
      sharepointFileUrl: result.webUrl,
      pdfSizeBytes: result.sizeBytes,
      pipelineStatus: "sharepoint_uploaded",
    })
    .where(eq(mspDocumentVersionsTable.versionId, versionId));

  await db
    .update(mspDocumentsTable)
    .set({ pipelineStatus: "sharepoint_uploaded", updatedAt: new Date() })
    .where(eq(mspDocumentsTable.documentId, documentId));

  log.info(
    {
      runId: ctx.runId,
      nodeId: ctx.nodeId,
      documentId,
      versionId,
      sharepointFileId: result.fileId,
      deduplicated: result.deduplicated,
    },
    "doc_save_sharepoint: upload complete",
  );

  return {
    documentId,
    versionId,
    sharepointFileId: result.fileId,
    sharepointFileUrl: result.webUrl,
    deduplicated: result.deduplicated ?? false,
  };
}

// ── doc_register_version ───────────────────────────────────────────────────────
// Promotes a completed version to the document's current_version_id and
// advances pipeline_status to version_registered.
//
// Input: { documentId, versionId }
// Output: { documentId, versionId, versionNumber }

async function handleDocRegisterVersion(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const documentId = String(ctx.input["documentId"] ?? "");
  const versionId = String(ctx.input["versionId"] ?? "");

  if (!documentId || !versionId) {
    throw new Error("doc_register_version: documentId and versionId are required");
  }

  const [version] = await db
    .select({ versionNumber: mspDocumentVersionsTable.versionNumber })
    .from(mspDocumentVersionsTable)
    .where(eq(mspDocumentVersionsTable.versionId, versionId))
    .limit(1);

  if (!version) throw new Error(`doc_register_version: version ${versionId} not found`);

  await db
    .update(mspDocumentsTable)
    .set({
      currentVersionId: versionId,
      pipelineStatus: "version_registered",
      updatedAt: new Date(),
    })
    .where(eq(mspDocumentsTable.documentId, documentId));

  await db
    .update(mspDocumentVersionsTable)
    .set({ pipelineStatus: "version_registered" })
    .where(eq(mspDocumentVersionsTable.versionId, versionId));

  log.info(
    { runId: ctx.runId, nodeId: ctx.nodeId, documentId, versionId, versionNumber: version.versionNumber },
    "doc_register_version: version promoted to current",
  );

  return {
    documentId,
    versionId,
    versionNumber: version.versionNumber,
  };
}

// ── doc_publish ────────────────────────────────────────────────────────────────
// Marks the document as active / published. Only transitions from draft.
// Idempotent: already-published documents return success without re-publishing.
//
// Config:
//   publishedByUserId: number — optional
//
// Input: { documentId, versionId }
// Output: { documentId, publishedAt }

async function handleDocPublish(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const documentId = String(ctx.input["documentId"] ?? "");
  const versionId = String(ctx.input["versionId"] ?? "");
  const publishedByUserId = Number(ctx.config["publishedByUserId"] ?? ctx.input["publishedByUserId"] ?? 0) || null;

  if (!documentId) throw new Error("doc_publish: documentId is required");

  const [doc] = await db
    .select({ status: mspDocumentsTable.status, publishedAt: mspDocumentsTable.publishedAt })
    .from(mspDocumentsTable)
    .where(eq(mspDocumentsTable.documentId, documentId))
    .limit(1);

  if (!doc) throw new Error(`doc_publish: document ${documentId} not found`);

  if (doc.status === "active" && doc.publishedAt) {
    log.info(
      { runId: ctx.runId, nodeId: ctx.nodeId, documentId },
      "doc_publish: document already published — idempotent skip",
    );
    return { documentId, publishedAt: doc.publishedAt.toISOString(), alreadyPublished: true };
  }

  const publishedAt = new Date();

  await db
    .update(mspDocumentsTable)
    .set({
      status: "active",
      pipelineStatus: "published",
      publishedAt,
      publishedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(mspDocumentsTable.documentId, documentId));

  if (versionId) {
    await db
      .update(mspDocumentVersionsTable)
      .set({ pipelineStatus: "published" })
      .where(eq(mspDocumentVersionsTable.versionId, versionId));
  }

  log.info(
    { runId: ctx.runId, nodeId: ctx.nodeId, documentId, publishedAt },
    "doc_publish: document published",
  );

  return { documentId, publishedAt: publishedAt.toISOString() };
}

// ── doc_audit_export ───────────────────────────────────────────────────────────
// Emits a canonical msp.document.exported event to the event bus.
// No-op when the event bus is unavailable (best-effort audit trail).
//
// Input: { documentId, versionId }
// Output: { eventId, emitted }

async function handleDocAuditExport(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const documentId = String(ctx.input["documentId"] ?? "");
  const versionId = String(ctx.input["versionId"] ?? "");

  try {
    const dispatched = await dispatchEvent({
      eventType: "msp.document.exported",
      source: "doc-pipeline",
      actor: systemActor(),
      mspId: ctx.tenantContext.mspId,
      customerId: ctx.tenantContext.customerId,
      ownerType: ctx.tenantContext.customerId != null ? "customer" : ctx.tenantContext.mspId != null ? "msp" : "platform",
      causationId: randomUUID(),
      payload: {
        documentId,
        versionId,
        runId: ctx.runId,
        exportedAt: new Date().toISOString(),
      },
    });

    log.info(
      { runId: ctx.runId, nodeId: ctx.nodeId, documentId, eventId: dispatched?.eventId },
      "doc_audit_export: event emitted",
    );

    return { documentId, versionId, eventId: dispatched?.eventId ?? null, emitted: dispatched != null };
  } catch (err) {
    log.warn({ err, runId: ctx.runId, documentId }, "doc_audit_export: event dispatch failed (non-fatal)");
    return { documentId, versionId, eventId: null, emitted: false };
  }
}

// ── doc_cleanup ────────────────────────────────────────────────────────────────
// Cleans up any ephemeral pipeline state (e.g. large base64 blobs from node outputs).
// Currently a no-op — included for pipeline completeness and future temp-file cleanup.
//
// Input: { documentId }
// Output: { cleaned }

async function handleDocCleanup(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const documentId = String(ctx.input["documentId"] ?? "");
  log.info({ runId: ctx.runId, nodeId: ctx.nodeId, documentId }, "doc_cleanup: pipeline complete");
  return { cleaned: true, documentId };
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerDocPipelineHandlers(): void {
  registerNodeHandler("doc_store_html", handleDocStoreHtml);
  registerNodeHandler("doc_generate_pdf", handleDocGeneratePdf);
  registerNodeHandler("doc_save_sharepoint", handleDocSaveSharepoint);
  registerNodeHandler("doc_register_version", handleDocRegisterVersion);
  registerNodeHandler("doc_publish", handleDocPublish);
  registerNodeHandler("doc_audit_export", handleDocAuditExport);
  registerNodeHandler("doc_cleanup", handleDocCleanup);

  log.info(
    {},
    "portal-wf: doc pipeline node handlers registered (doc_store_html, doc_generate_pdf, doc_save_sharepoint, doc_register_version, doc_publish, doc_audit_export, doc_cleanup)",
  );
}

// ── Default document pipeline workflow graph ──────────────────────────────────
// This graph can be seeded into portal_wf_workflows so an MSP can trigger the
// full pipeline by dispatching a msp.document.submit event.

export const DEFAULT_DOC_PIPELINE_GRAPH = {
  nodes: [
    { id: "start", type: "start", config: {} },
    { id: "store_html", type: "doc_store_html", config: {} },
    { id: "generate_pdf", type: "doc_generate_pdf", config: {} },
    { id: "save_sp", type: "doc_save_sharepoint", config: { folderPath: "Documents" } },
    { id: "register_version", type: "doc_register_version", config: {} },
    { id: "publish", type: "doc_publish", config: {} },
    { id: "audit", type: "doc_audit_export", config: {} },
    { id: "cleanup", type: "doc_cleanup", config: {} },
  ],
  edges: [
    { from: "start", to: "store_html" },
    { from: "store_html", to: "generate_pdf" },
    { from: "generate_pdf", to: "save_sp" },
    { from: "save_sp", to: "register_version" },
    { from: "register_version", to: "publish" },
    { from: "publish", to: "audit" },
    { from: "audit", to: "cleanup" },
  ],
};
