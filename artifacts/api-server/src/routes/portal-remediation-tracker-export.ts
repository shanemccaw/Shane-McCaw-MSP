/**
 * portal-remediation-tracker-export.ts — Git #733 (Phase D1 of Epic #647,
 * split from the original Phase D scope on 2026-08-11 to run in parallel with
 * Phase C / #732's verification work).
 *
 *   GET /api/portal/remediation-tracker/export.csv
 *   GET /api/portal/remediation-tracker/export.pdf
 *
 * Exports-only, matching the scope Shane confirmed when #733 was split off
 * #647's original Phase D: the evidence pack (bundling verified/completed
 * steps with supporting scan evidence) is explicitly OUT of scope here — it
 * depends on #732's verification state landing first and moved to its own
 * follow-up issue (#742).
 *
 * Deliberately its own file rather than a route added to
 * `portal-remediation-tracker.ts` — that file is under concurrent edit for
 * #732 in the same working tree, and this needs nothing from it beyond the
 * same table/status enum, both read-only here.
 *
 * Reads only the columns Phase A (#730) already landed —
 * `stepId`/`status`/`completedAt`/`updatedAt` — not #732's in-flight
 * `verificationState`/`verifiedAt`/`verifiedByRunId`, which are still
 * mid-migration in this same checkout. No schema change needed for this
 * phase.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, remediationTrackerStepsTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { buildHtmlDoc, htmlToPdf } from "../lib/insight-pdf";
import {
  REMEDIATION_TRACKER_CATALOGUE,
  REMEDIATION_TRACKER_STATUS_LABELS,
} from "../lib/remediation-tracker-catalogue";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/** Same JWT-claim resolution as portal-remediation-tracker.ts. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

interface ExportRow {
  readonly stepLabel: string;
  readonly title: string;
  readonly pillar: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Every catalogue step, joined against whatever the customer has stored —
 * same "no row means not_started" convention as the GET route, so an export
 * taken on an untouched tracker still lists all 30 with a real state instead
 * of quietly omitting rows nobody has touched yet.
 */
async function buildExportRows(customerId: number): Promise<ExportRow[]> {
  const rows = await db
    .select({
      stepId: remediationTrackerStepsTable.stepId,
      status: remediationTrackerStepsTable.status,
      completedAt: remediationTrackerStepsTable.completedAt,
      updatedAt: remediationTrackerStepsTable.updatedAt,
    })
    .from(remediationTrackerStepsTable)
    .where(eq(remediationTrackerStepsTable.customerId, customerId));

  const byStepId = new Map(rows.map((r) => [r.stepId, r]));
  const iso = (v: Date | string | null): string | null =>
    v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

  return REMEDIATION_TRACKER_CATALOGUE.map((step) => {
    const stored = byStepId.get(step.id);
    const status = stored?.status ?? "not_started";
    return {
      stepLabel: step.label,
      title: step.title,
      pillar: step.pillar,
      status,
      statusLabel: REMEDIATION_TRACKER_STATUS_LABELS[status] ?? status,
      completedAt: iso(stored?.completedAt ?? null),
      updatedAt: iso(stored?.updatedAt ?? null),
    };
  });
}

async function resolveCustomerName(customerId: number): Promise<string> {
  const [tenant] = await db
    .select({ customerName: tenantsTable.customerName })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  return tenant?.customerName ?? "Customer";
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: readonly ExportRow[]): string {
  const header = ["Step", "Title", "Pillar", "Status", "Completed At", "Last Updated"];
  const lines = [header.map(csvField).join(",")];
  for (const r of rows) {
    lines.push(
      [r.stepLabel, r.title, r.pillar, r.statusLabel, r.completedAt ?? "", r.updatedAt ?? ""]
        .map(csvField)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

function toHtml(customerName: string, rows: readonly ExportRow[]): string {
  const resolved = rows.filter((r) => r.status !== "not_started").length;
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = [
    `<h1>Remediation Tracker</h1>`,
    `<p>${escape(customerName)} — ${resolved} of ${rows.length} steps resolved.</p>`,
    "<table>",
    "<thead><tr><th>Step</th><th>Title</th><th>Pillar</th><th>Status</th><th>Completed</th><th>Last Updated</th></tr></thead>",
    "<tbody>",
    ...rows.map(
      (r) =>
        `<tr><td>${escape(r.stepLabel)}</td><td>${escape(r.title)}</td><td>${escape(r.pillar)}</td>` +
        `<td>${escape(r.statusLabel)}</td><td>${escape(r.completedAt ?? "—")}</td><td>${escape(r.updatedAt ?? "—")}</td></tr>`,
    ),
    "</tbody>",
    "</table>",
  ].join("\n");
  return body;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "remediation-tracker";
}

// ── CLIENT: Remediation Tracker → CSV export ─────────────────────────────────

router.get(
  "/portal/remediation-tracker/export.csv",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [rows, customerName] = await Promise.all([
        buildExportRows(customerId),
        resolveCustomerName(customerId),
      ]);
      const csv = toCsv(rows);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename(customerName)}-remediation-tracker.csv"`,
      );
      res.send(csv);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/remediation-tracker/export.csv failed");
      res.status(500).json({ error: "Failed to generate CSV export" });
    }
  },
);

// ── CLIENT: Remediation Tracker → PDF export ─────────────────────────────────

router.get(
  "/portal/remediation-tracker/export.pdf",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [rows, customerName] = await Promise.all([
        buildExportRows(customerId),
        resolveCustomerName(customerId),
      ]);
      const pdfBuffer = await htmlToPdf(buildHtmlDoc(toHtml(customerName, rows)));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename(customerName)}-remediation-tracker.pdf"`,
      );
      res.setHeader("Content-Length", String(pdfBuffer.length));
      res.end(pdfBuffer);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/remediation-tracker/export.pdf failed");
      res.status(500).json({ error: "Failed to generate PDF export" });
    }
  },
);

export default router;
