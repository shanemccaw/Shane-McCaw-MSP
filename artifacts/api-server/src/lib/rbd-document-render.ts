/**
 * rbd-document-render.ts — the signed RBD document render (#1512, part of
 * #1487). Renders a captured `msp_rbd_versions` row (#1508) as the single
 * stable document its version chain promises: the same version must render
 * IDENTICALLY every time, including a superseded one.
 *
 * This is a deterministic TEMPLATE render of the version's own stored
 * `content` snapshot and its own `signed`/`signedBy`/`signatureData` columns
 * — never an AI generation (unlike `document-engine-sow.ts` next door), and
 * never a re-read of live child rows. Reuses the existing HTML→PDF pipeline
 * (`insight-pdf.ts`'s `buildHtmlDoc` + `htmlToPdf`, the same Chromium path
 * `portal-remediation-tracker-export.ts` and `dashboard-export.ts` already
 * use) rather than building a second render path, and persists through
 * `msp_report_runs` (via `rbdVersionUid`, #1512's migration) rather than a
 * second storage table — see that column's own comment in the schema.
 *
 * `content` is untyped jsonb (#1508/#1509 — the line-item shape is not yet
 * formalized), so the body renderer below is a generic key/value walk of
 * whatever shape is actually stored. It is not a guess at a display
 * vocabulary — it renders exactly the real snapshot, whatever shape #1509
 * eventually settles it into, and should be replaced with a shape-aware
 * renderer once that issue lands.
 */
import { randomUUID } from "node:crypto";
import { db, mspReportDefinitionsTable, mspReportRunsTable, type MspRbdVersion } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { buildHtmlDoc, htmlToPdf } from "./insight-pdf.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "workflow.doc-pipeline" });

const RBD_DOC_TYPE = "risk_decision_document" as const;
const RBD_DEFINITION_NAME = "Risk Decision Document (RBD)";

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "hazardDescription" -> "Hazard Description" — a display label, not a data value. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function renderScalar(value: unknown): string {
  if (value === null || value === undefined || value === "") return "<em>Not recorded</em>";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return escapeHtml(value);
}

/**
 * Generic renderer for the untyped `content` snapshot — a definition list of
 * key/value pairs, one level of nested object/array handled inline. Renders
 * exactly what is stored; invents no field that is not present.
 */
function renderContentBlock(content: unknown): string {
  if (content === null || content === undefined) {
    return "<p><em>No content was captured with this version.</em></p>";
  }
  if (Array.isArray(content)) {
    if (content.length === 0) return "<p><em>Empty.</em></p>";
    return `<ul>${content.map((v) => `<li>${typeof v === "object" && v !== null ? renderContentBlock(v) : renderScalar(v)}</li>`).join("")}</ul>`;
  }
  if (typeof content !== "object") {
    return `<p>${renderScalar(content)}</p>`;
  }
  const entries = Object.entries(content as Record<string, unknown>);
  if (entries.length === 0) return "<p><em>Empty.</em></p>";
  const rows = entries
    .map(([key, value]) => {
      const rendered = value !== null && typeof value === "object"
        ? (Array.isArray(value)
          ? (value.length === 0
            ? "<em>None</em>"
            : `<ul>${value.map((v) => `<li>${typeof v === "object" && v !== null ? renderContentBlock(v) : renderScalar(v)}</li>`).join("")}</ul>`)
          : renderContentBlock(value))
        : renderScalar(value);
      return `<tr><th>${escapeHtml(humanizeKey(key))}</th><td>${rendered}</td></tr>`;
    })
    .join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

/**
 * Renders one `msp_rbd_versions` row as a full signable document body (no
 * outer <html>/<head> — `buildHtmlDoc` supplies that, matching every other
 * PDF export in this codebase). Purely a function of the row's own columns —
 * no live query, so a superseded version renders exactly as it did the day it
 * was captured.
 */
export function renderRbdVersionHtml(version: MspRbdVersion): string {
  const createdBy = version.createdBy as { name?: string; upn?: string; timestamp?: string } | null;
  const signedBy = version.signedBy as { name?: string; title?: string; email?: string; signedAt?: string | null } | null;
  const isCurrent = version.supersededAt === null;

  const statusBadge = version.signed
    ? `<p><strong style="color:#0078D4;">SIGNED</strong> — ${escapeHtml(signedBy?.signedAt ?? version.signedAt?.toISOString() ?? "")}</p>`
    : `<p><strong style="color:#94a3b8;">UNSIGNED — DRAFT</strong></p>`;

  const supersededNotice = isCurrent
    ? ""
    : `<blockquote><p>This version was superseded on ${escapeHtml(version.supersededAt?.toISOString() ?? "")}. It is preserved as the truth for the period it was current, and is not editable.</p></blockquote>`;

  const signatureBlock = version.signed
    ? [
      "<h2>Signature</h2>",
      "<table><tbody>",
      `<tr><th>Signed by</th><td>${renderScalar(signedBy?.name)}</td></tr>`,
      `<tr><th>Title</th><td>${renderScalar(signedBy?.title)}</td></tr>`,
      `<tr><th>Email</th><td>${renderScalar(signedBy?.email)}</td></tr>`,
      `<tr><th>Signed at</th><td>${renderScalar(signedBy?.signedAt)}</td></tr>`,
      "</tbody></table>",
      version.signatureData
        ? `<p><img src="${escapeHtml(version.signatureData)}" alt="Signature" style="max-width:320px;border:1px solid #e2e8f0;border-radius:6px;padding:0.5rem;" /></p>`
        : "",
    ].join("")
    : "<h2>Signature</h2><p><em>Not yet signed.</em></p>";

  return [
    `<h1>Risk Basis Decision — ${escapeHtml(version.rbdId)}</h1>`,
    `<p>Version ${escapeHtml(version.versionNumber)} · ${escapeHtml(version.tenantName)}</p>`,
    statusBadge,
    supersededNotice,
    "<h2>Authored by</h2>",
    `<table><tbody><tr><th>Name</th><td>${renderScalar(createdBy?.name)}</td></tr><tr><th>UPN</th><td>${renderScalar(createdBy?.upn)}</td></tr><tr><th>Captured</th><td>${renderScalar(createdBy?.timestamp)}</td></tr></tbody></table>`,
    "<h2>Document Contents</h2>",
    renderContentBlock(version.content),
    signatureBlock,
  ].join("\n");
}

export interface RbdDocumentRun {
  readonly runId: string;
  readonly htmlContent: string;
  readonly pdfBase64: string;
  readonly pdfSizeBytes: number;
  readonly generatedAt: string;
}

/** Finds (or lazily creates, attributed to a real MSP staff user) the one
 * report definition RBD document runs are filed under for this MSP. Never
 * user-facing on its own — msp-reports.ts's Report Builder UI can list it
 * like any other definition, but nothing in #1512 requires that. */
async function ensureRbdDocumentDefinition(mspId: number, createdByUserId: number): Promise<string> {
  const [existing] = await db
    .select({ definitionId: mspReportDefinitionsTable.definitionId })
    .from(mspReportDefinitionsTable)
    .where(and(eq(mspReportDefinitionsTable.mspId, mspId), eq(mspReportDefinitionsTable.docType, RBD_DOC_TYPE)))
    .limit(1);
  if (existing) return existing.definitionId;

  const [created] = await db
    .insert(mspReportDefinitionsTable)
    .values({
      mspId,
      name: RBD_DEFINITION_NAME,
      description: "System definition (#1512) — filed automatically the first time an RBD document is rendered for this MSP.",
      docType: RBD_DOC_TYPE,
      deliveryMethod: "in_app",
      createdByUserId,
    })
    .returning({ definitionId: mspReportDefinitionsTable.definitionId });
  return created.definitionId;
}

/**
 * Renders `version` fresh and persists it as this version's `msp_report_runs`
 * row — one row per version, UPDATEd in place on each call rather than
 * appended, so a re-render after signing (content unchanged, `signed`/
 * `signedBy`/`signatureData` now populated) reflects the version's CURRENT
 * columns rather than serving a stale pre-signature snapshot. The version
 * row itself is the single source of truth being rendered; this function
 * never re-reads any other table.
 *
 * `triggeredByUserId` must be a real authenticated MSP staff user — this is
 * the MSP-side render/refresh path (`POST /api/msp/rbd/.../document`). The
 * customer- and public-facing read paths only ever READ an already-persisted
 * run (see `msp-rbd-versions.ts`) and never call this.
 */
export async function renderAndPersistRbdVersionDocument(
  version: MspRbdVersion,
  triggeredByUserId: number,
): Promise<RbdDocumentRun> {
  const htmlBody = renderRbdVersionHtml(version);
  const fullHtml = buildHtmlDoc(htmlBody);
  const pdfBuffer = await htmlToPdf(fullHtml);
  const pdfBase64 = pdfBuffer.toString("base64");
  const now = new Date();

  const [existingRun] = await db
    .select({ runId: mspReportRunsTable.runId })
    .from(mspReportRunsTable)
    .where(and(eq(mspReportRunsTable.rbdVersionUid, version.versionUid), eq(mspReportRunsTable.docType, RBD_DOC_TYPE)))
    .limit(1);

  if (existingRun) {
    await db
      .update(mspReportRunsTable)
      .set({
        htmlContent: fullHtml,
        pdfBase64,
        pdfSizeBytes: pdfBuffer.byteLength,
        status: "generated",
        generatedAt: now,
        updatedAt: now,
      })
      .where(eq(mspReportRunsTable.runId, existingRun.runId));

    log.info({ mspId: version.mspId, rbdId: version.rbdId, versionUid: version.versionUid, runId: existingRun.runId }, "rbd-document-render: re-rendered and updated existing run");
    return { runId: existingRun.runId, htmlContent: fullHtml, pdfBase64, pdfSizeBytes: pdfBuffer.byteLength, generatedAt: now.toISOString() };
  }

  const definitionId = await ensureRbdDocumentDefinition(version.mspId, triggeredByUserId);
  const runId = randomUUID();

  await db.insert(mspReportRunsTable).values({
    runId,
    definitionId,
    mspId: version.mspId,
    title: `RBD ${version.rbdId} — v${version.versionNumber}`,
    docType: RBD_DOC_TYPE,
    status: "generated",
    htmlContent: fullHtml,
    pdfBase64,
    pdfSizeBytes: pdfBuffer.byteLength,
    rbdVersionUid: version.versionUid,
    triggeredByUserId,
    generatedAt: now,
  });

  log.info({ mspId: version.mspId, rbdId: version.rbdId, versionUid: version.versionUid, runId }, "rbd-document-render: rendered and persisted new run");
  return { runId, htmlContent: fullHtml, pdfBase64, pdfSizeBytes: pdfBuffer.byteLength, generatedAt: now.toISOString() };
}

/** Reads whatever run is already persisted for a version, without rendering.
 * Customer/public read paths use this — they never trigger generation. */
export async function getPersistedRbdVersionDocument(versionUid: string): Promise<RbdDocumentRun | null> {
  const [run] = await db
    .select({
      runId: mspReportRunsTable.runId,
      htmlContent: mspReportRunsTable.htmlContent,
      pdfBase64: mspReportRunsTable.pdfBase64,
      pdfSizeBytes: mspReportRunsTable.pdfSizeBytes,
      generatedAt: mspReportRunsTable.generatedAt,
    })
    .from(mspReportRunsTable)
    .where(and(eq(mspReportRunsTable.rbdVersionUid, versionUid), eq(mspReportRunsTable.docType, RBD_DOC_TYPE)))
    .limit(1);
  if (!run || !run.htmlContent || !run.pdfBase64) return null;
  return {
    runId: run.runId,
    htmlContent: run.htmlContent,
    pdfBase64: run.pdfBase64,
    pdfSizeBytes: run.pdfSizeBytes ?? 0,
    generatedAt: (run.generatedAt ?? new Date()).toISOString(),
  };
}
