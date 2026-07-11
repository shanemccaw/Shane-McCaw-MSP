/**
 * report-nodes.ts
 *
 * Workflow node handler for `generate_report`.
 *
 * Node config:
 *   definitionId: string  — UUID of the msp_report_definitions row
 *   customerId?: number   — override customer scope
 *   promptOverride?: string
 *
 * Node input (injected by trigger route):
 *   reportRunId?: string  — UUID of a pre-created msp_report_runs row (status "pending").
 *                           When provided, the handler updates the existing row instead of
 *                           creating a new one. This is the path used by the API trigger
 *                           endpoint so the run ID can be returned to the caller immediately.
 *   definitionId?: string — falls back to config.definitionId
 *   triggeredByUserId?: number
 *
 * Execution flow:
 *   1. Resolve definitionId + optionally a pre-created reportRunId
 *   2. Load report definition + customer context
 *   3. Upsert / update msp_report_runs row (status → "generating")
 *   4. AI-generate HTML content
 *   5. Convert HTML → PDF via pdf-lib
 *   6. Persist generated content + status "generated"
 *   7. If deliveryMethod includes "email" → send via Exchange Online (Graph)
 *   8. Mark run "delivered"
 *
 * Output: { runId, title, status, pdfSizeBytes, docType }
 *
 * On any unhandled error the handler:
 *   - Updates the run row to status "failed" with the error message
 *   - Re-throws so the workflow engine can apply its retry policy and eventually
 *     route the run to the DLQ and create an operator task.
 */

import { registerNodeHandler } from "./portal-workflow-engine";
import type { NodeExecutionContext } from "./portal-workflow-engine";
import {
  db,
  mspReportDefinitionsTable,
  mspReportRunsTable,
  mspCustomersTable,
  mspsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sendMailViaGraph } from "./graph";

// ── PDF helper (text-based, same approach as doc-pipeline-nodes.ts) ───────────

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

async function generatePdfBuffer(plainText: string, title: string): Promise<Buffer> {
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

  page.drawText(title.slice(0, 80), {
    x: MARGIN, y, size: TITLE_SIZE, font: boldFont, color: rgb(0.04, 0.15, 0.25),
  });
  y -= TITLE_SIZE + 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
  y -= LINE_HEIGHT;

  for (const line of wrappedLines) {
    if (y < MARGIN + LINE_HEIGHT) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
    if (line !== "") {
      page.drawText(line.slice(0, 120), { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= LINE_HEIGHT;
  }

  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const pg = pdfDoc.getPage(i);
    pg.drawText(`Page ${i + 1} of ${pageCount}`, { x: MARGIN, y: MARGIN / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    pg.drawText(new Date().toISOString().split("T")[0]!, { x: PAGE_WIDTH - MARGIN - 60, y: MARGIN / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// ── Doc type labels ───────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary:           "Executive Summary",
  full_readiness_report:       "Full Readiness Report",
  security_posture_report:     "Security Posture Report",
  governance_maturity_report:  "Governance Maturity Report",
  data_exposure_risk_report:   "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
  license_waste_report:        "License Waste Analysis Report",
};

const DOC_TYPE_SECTION_HINTS: Record<string, string> = {
  executive_summary:           "Include: Executive Overview, Key Findings, Microsoft 365 Health Summary, Top 3 Recommendations, Risk Summary, Next Steps.",
  full_readiness_report:       "Include: Environment Overview, Identity & Access Assessment, Security Posture, Compliance Status, Collaboration Health, Licensing Overview, Priority Recommendations.",
  security_posture_report:     "Include: Threat Landscape, Identity Protection Gaps, MFA & Conditional Access Status, Privileged Access Review, Defender Configuration, Incident Response Readiness, Remediation Priorities.",
  governance_maturity_report:  "Include: Governance Maturity Score, Policy Framework Assessment, Roles & Responsibilities Review, Compliance Gap Analysis, Data Lifecycle Management, Recommendations by Domain.",
  data_exposure_risk_report:   "Include: Data Exposure Summary, Oversharing Analysis, Sensitive Data Findings, External Sharing Review, DLP Coverage Assessment, Remediation Roadmap.",
  license_optimization_report: "Include: License Inventory, Utilization Analysis, Unused Licenses, SKU Right-Sizing Recommendations, Projected Annual Savings, Implementation Plan.",
  license_waste_report:        "Include: License Waste Executive Summary, Total Identifiable Savings ($), Unlicensed User Analysis, Inactive License Inventory, SKU Consolidation Opportunities, 90-Day Action Plan.",
};

// ── generate_report node handler ──────────────────────────────────────────────

/**
 * Exported for unit testing. Registered as "generate_report" node type.
 *
 * Two operating modes:
 *   a) Pre-created run (API trigger path): ctx.input.reportRunId is set.
 *      The trigger endpoint already inserted the msp_report_runs row with
 *      status "pending"; this handler updates it through generating → delivered.
 *   b) Self-created run (event-driven / direct workflow path): no reportRunId.
 *      The handler inserts a new msp_report_runs row with status "generating".
 */
export async function handleGenerateReport(ctx: NodeExecutionContext): Promise<Record<string, unknown>> {
  const definitionId = String(ctx.config["definitionId"] ?? ctx.input["definitionId"] ?? "");
  if (!definitionId) throw new Error("generate_report: definitionId is required");

  // Pre-created run ID (from the API trigger path)
  const preCreatedRunId = ctx.input["reportRunId"] ? String(ctx.input["reportRunId"]) : null;

  // Track the resolved runId so the catch block can mark it "failed" even for early errors.
  let runId: string | null = preCreatedRunId;

  try {
    // 1. Load report definition
    const [def] = await db
      .select()
      .from(mspReportDefinitionsTable)
      .where(eq(mspReportDefinitionsTable.definitionId, definitionId))
      .limit(1);

    if (!def) throw new Error(`generate_report: definition ${definitionId} not found`);

    const customerId = Number(ctx.config["customerId"] ?? ctx.input["customerId"] ?? def.customerId ?? 0) || null;

    // 2. Resolve customer + MSP context
    const [customer, msp] = await Promise.all([
      customerId
        ? db.select({ id: mspCustomersTable.id, name: mspCustomersTable.name, domain: mspCustomersTable.domain })
            .from(mspCustomersTable)
            .where(eq(mspCustomersTable.id, customerId))
            .limit(1)
            .then(rows => rows[0] ?? null)
        : Promise.resolve(null),
      db.select({ id: mspsTable.id, name: mspsTable.name })
        .from(mspsTable)
        .where(eq(mspsTable.id, def.mspId))
        .limit(1)
        .then(rows => rows[0] ?? null),
    ]);

    const docTypeLabel = DOC_TYPE_LABELS[def.docType] ?? def.docType;
    const title = customer ? `${docTypeLabel} — ${customer.name}` : `${docTypeLabel} — ${msp?.name ?? "MSP"} Portfolio`;

    // 3. Resolve or create the msp_report_runs row
    if (preCreatedRunId) {
      // Update existing row from "pending" → "generating"
      await db
        .update(mspReportRunsTable)
        .set({ status: "generating", updatedAt: new Date() })
        .where(eq(mspReportRunsTable.runId, preCreatedRunId));
    } else {
      // Create a new row (event-driven / direct workflow path)
      const [run] = await db
        .insert(mspReportRunsTable)
        .values({
          definitionId: def.definitionId,
          mspId: def.mspId,
          customerId,
          title,
          docType: def.docType,
          status: "generating",
          triggeredByUserId: Number(ctx.input["triggeredByUserId"] ?? 0) || null,
        })
        .returning();

      if (!run) throw new Error("generate_report: failed to create run row");
      runId = run.runId;
    }

    // runId is now confirmed set (preCreatedRunId or newly inserted row)
    const confirmedRunId = runId!;

    // 4. Build AI prompt
    const contextBlock = [
      `REPORT TYPE: ${docTypeLabel}`,
      customer ? `CLIENT: ${customer.name}${customer.domain ? ` (${customer.domain})` : ""}` : `SCOPE: Full MSP Portfolio — ${msp?.name ?? ""}`,
      `GENERATED: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      "",
      "FIELD MAPPINGS / CONTEXT:",
      Object.keys(def.fieldMappings ?? {}).length > 0
        ? JSON.stringify(def.fieldMappings, null, 2)
        : "(No additional context provided — generate from general M365 best practices and industry benchmarks.)",
      "",
      `DOCUMENT STRUCTURE REQUIREMENTS: ${DOC_TYPE_SECTION_HINTS[def.docType] ?? "Generate a comprehensive professional report."}`,
    ].join("\n");

    const promptText = String(ctx.config["promptOverride"] ?? def.description ?? "");
    const systemPrompt = `You are a Microsoft 365 consultant producing a professional ${docTypeLabel} for a managed service provider client. Generate a complete, well-structured HTML document. Use proper HTML formatting with h1, h2, h3, p, ul, li, table tags. No markdown. No code blocks. Begin directly with the content — no preamble.`;

    const userPrompt = [
      contextBlock,
      "",
      promptText ? `ADDITIONAL INSTRUCTIONS: ${promptText}` : "",
      "",
      "Generate a complete, professional HTML report. Include data-driven analysis, specific findings, and actionable recommendations. For license waste reports, prominently display the dollar-value savings opportunity.",
    ].filter(Boolean).join("\n");

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = message.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? (b.text as string) : ""))
      .join("");

    // Extract HTML (Claude sometimes wraps in a code fence)
    const htmlMatch = rawText.match(/```(?:html)?\s*([\s\S]*?)```/i);
    const htmlContent = htmlMatch ? htmlMatch[1]!.trim() : rawText;

    // 5. Generate PDF
    const plainText = stripHtml(htmlContent);
    const pdfBuffer = await generatePdfBuffer(plainText, title);
    const pdfBase64 = pdfBuffer.toString("base64");

    // 6. Update run to generated
    await db
      .update(mspReportRunsTable)
      .set({
        status: "generated",
        htmlContent,
        pdfBase64,
        pdfSizeBytes: pdfBuffer.length,
        generatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mspReportRunsTable.runId, confirmedRunId));

    // 7. Email delivery if requested
    const deliveryMethod = def.deliveryMethod;
    if (deliveryMethod === "email" || deliveryMethod === "both") {
      const toEmail = def.deliveryEmail ?? null;
      const fromUserId = process.env.GRAPH_MAIL_USER_ID;

      if (toEmail && fromUserId) {
        try {
          await db
            .update(mspReportRunsTable)
            .set({ status: "delivering", updatedAt: new Date() })
            .where(eq(mspReportRunsTable.runId, confirmedRunId));

          await sendMailViaGraph({
            fromUserId,
            to: toEmail,
            subject: title,
            htmlBody: `<p>Please find attached your <strong>${docTypeLabel}</strong> report generated on ${new Date().toLocaleDateString()}.</p><p>This report was generated by your MSP platform.</p>`,
            attachments: [{ filename: `${title.replace(/[^a-zA-Z0-9\s]/g, "").trim()}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
          });

          await db
            .update(mspReportRunsTable)
            .set({ status: "delivered", deliveredAt: new Date(), deliveryEmail: toEmail, updatedAt: new Date() })
            .where(eq(mspReportRunsTable.runId, confirmedRunId));
        } catch (emailErr) {
          logger.warn({ err: emailErr, runId: confirmedRunId }, "generate_report: email delivery failed (non-fatal)");
          // Keep as "generated" even if email fails — PDF is still downloadable in-app
          await db
            .update(mspReportRunsTable)
            .set({ status: "generated", errorMessage: `Email delivery failed: ${String(emailErr)}`, updatedAt: new Date() })
            .where(eq(mspReportRunsTable.runId, confirmedRunId));
        }
      } else {
        // No email configured — mark delivered for in_app only
        await db
          .update(mspReportRunsTable)
          .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
          .where(eq(mspReportRunsTable.runId, confirmedRunId));
      }
    } else {
      // In-app only
      await db
        .update(mspReportRunsTable)
        .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(mspReportRunsTable.runId, confirmedRunId));
    }

    logger.info({ runId: confirmedRunId, title, docType: def.docType }, "generate_report: completed");

    return {
      runId: confirmedRunId,
      title,
      status: "delivered",
      pdfSizeBytes: pdfBuffer.length,
      docType: def.docType,
    };
  } catch (err) {
    // Mark the report run as failed, then re-throw so the workflow engine applies
    // its retry policy and eventually routes the run to the DLQ + creates an operator task.
    // runId may be null if the run row hadn't been created/resolved yet (e.g. definition lookup failed
    // before we could set it to "generating"). In that case we skip the update — the engine will
    // still write the DLQ entry and operator task using the workflow run record.
    logger.error({ err, runId }, "generate_report: generation failed");
    if (runId) {
      await db
        .update(mspReportRunsTable)
        .set({ status: "failed", errorMessage: String(err), updatedAt: new Date() })
        .where(eq(mspReportRunsTable.runId, runId));
    }
    throw err;
  }
}

// ── Workflow graph constant ────────────────────────────────────────────────────
// Used by msp-reports.ts to seed the portal_wf_workflows entry on first use.

export const REPORT_GENERATION_WORKFLOW_KEY = "msp.report.generation";

export const REPORT_GENERATION_GRAPH = {
  nodes: [
    { id: "start",    type: "start",           config: {} },
    { id: "generate", type: "generate_report",  config: {} },
  ],
  edges: [
    { from: "start", to: "generate" },
  ],
};

// ── Registration ──────────────────────────────────────────────────────────────

export function registerReportNodes(): void {
  registerNodeHandler("generate_report", handleGenerateReport);
}
