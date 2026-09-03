/**
 * msp-remediation-tracker-export.ts — Git #2670, Feature #1684 (Remediation
 * Tracking, MSP Console). MSP-side mirror of `portal-remediation-tracker-
 * export.ts` (#733/#742) — same status-table export, same evidence pack (only
 * `verificationState === "verified"` rows qualify — a tick alone is never
 * evidence), resolved for `:customerId` under an MSP ownership check instead
 * of the caller's own JWT `customerId` claim.
 *
 *   GET /api/msp/customers/:customerId/remediation-tracker/export.csv
 *   GET /api/msp/customers/:customerId/remediation-tracker/export.pdf
 *   GET /api/msp/customers/:customerId/remediation-tracker/evidence-pack.pdf
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantsTable,
  usersTable,
  mspsTable,
  remediationTrackerStepsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { buildHtmlDoc, htmlToPdf } from "../lib/insight-pdf";
import {
  REMEDIATION_TRACKER_CATALOGUE,
  REMEDIATION_TRACKER_STATUS_LABELS,
} from "../lib/remediation-tracker-catalogue";
import { REMEDIATION_TRACKER_STEP_CHECK_KEYS } from "../lib/remediation-tracker-verification";

/** MSP-side roles (`users.mspRole`) — see lib/db/src/schema/index.ts's MSP_ROLES. */
const MSP_STAFF_ROLES = new Set(["PlatformAdmin", "MSPAdmin", "MSPOperator", "ServiceAccount"]);

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/** Same resolve+authorize idiom as msp-remediation-tracker.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
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

interface ExportRow {
  readonly stepLabel: string;
  readonly title: string;
  readonly pillar: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
}

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

interface EvidenceRow {
  readonly stepLabel: string;
  readonly title: string;
  readonly pillar: string;
  readonly statusLabel: string;
  readonly verifiedAt: string | null;
  readonly verifiedBy: string;
  readonly findingSummary: string;
}

async function buildEvidenceRows(customerId: number): Promise<EvidenceRow[]> {
  const claimed = await db
    .select({
      stepId: remediationTrackerStepsTable.stepId,
      status: remediationTrackerStepsTable.status,
      verifiedAt: remediationTrackerStepsTable.verifiedAt,
      verifiedByRunId: remediationTrackerStepsTable.verifiedByRunId,
      updatedByUserId: remediationTrackerStepsTable.updatedByUserId,
    })
    .from(remediationTrackerStepsTable)
    .where(
      and(
        eq(remediationTrackerStepsTable.customerId, customerId),
        eq(remediationTrackerStepsTable.verificationState, "verified"),
      ),
    );

  if (claimed.length === 0) return [];

  const catalogueById = new Map(REMEDIATION_TRACKER_CATALOGUE.map((s) => [s.id, s]));

  const runIds = Array.from(new Set(claimed.map((r) => r.verifiedByRunId).filter((id): id is string => id !== null)));
  const findings = runIds.length
    ? await db
        .select({
          runId: mspDiagnosticFindingsTable.runId,
          checkKey: mspDiagnosticFindingsTable.checkKey,
          title: mspDiagnosticFindingsTable.title,
          checkLabel: mspDiagnosticFindingsTable.checkLabel,
          severity: mspDiagnosticFindingsTable.severity,
        })
        .from(mspDiagnosticFindingsTable)
        .where(
          and(
            inArray(mspDiagnosticFindingsTable.runId, runIds),
            eq(mspDiagnosticFindingsTable.customerId, customerId),
            eq(mspDiagnosticFindingsTable.severity, "ok"),
          ),
        )
    : [];

  const userIds = Array.from(new Set(claimed.map((r) => r.updatedByUserId).filter((id): id is number => id !== null)));
  const users = userIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, mspRole: usersTable.mspRole, mspId: usersTable.mspId })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  const mspIds = Array.from(new Set(users.map((u) => u.mspId).filter((id): id is number => id !== null)));
  const msps = mspIds.length
    ? await db.select({ id: mspsTable.id, name: mspsTable.name }).from(mspsTable).where(inArray(mspsTable.id, mspIds))
    : [];
  const mspNameById = new Map(msps.map((m) => [m.id, m.name]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const iso = (v: Date | string | null): string | null =>
    v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

  const rows: EvidenceRow[] = [];
  for (const row of claimed) {
    const step = catalogueById.get(row.stepId);
    if (!step) continue;

    const mappedKeys = REMEDIATION_TRACKER_STEP_CHECK_KEYS[row.stepId] ?? [];
    const stepFindings = findings.filter((f) => f.runId === row.verifiedByRunId && mappedKeys.includes(f.checkKey));
    const findingSummary =
      stepFindings.length > 0
        ? Array.from(new Set(stepFindings.map((f) => f.title || f.checkLabel))).join("; ")
        : "Confirmed clean on re-scan";

    const user = row.updatedByUserId !== null ? userById.get(row.updatedByUserId) : undefined;
    let verifiedBy = "Unattributed";
    if (user) {
      const isStaff = MSP_STAFF_ROLES.has(user.mspRole);
      const mspName = user.mspId !== null ? mspNameById.get(user.mspId) : undefined;
      verifiedBy = isStaff ? (mspName ?? "MSP team") : (user.name ?? "Customer team");
    }

    rows.push({
      stepLabel: step.label,
      title: step.title,
      pillar: step.pillar,
      statusLabel: REMEDIATION_TRACKER_STATUS_LABELS[row.status] ?? row.status,
      verifiedAt: iso(row.verifiedAt),
      verifiedBy,
      findingSummary,
    });
  }

  rows.sort((a, b) => Number(a.stepLabel.replace(/\D/g, "")) - Number(b.stepLabel.replace(/\D/g, "")));
  return rows;
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

function toEvidenceHtml(customerName: string, rows: readonly EvidenceRow[]): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const when = (v: string | null) =>
    v ? new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "—";

  if (rows.length === 0) {
    return [
      `<h1>Remediation evidence pack</h1>`,
      `<p>${escape(customerName)} — nothing verified yet.</p>`,
      `<p>Entries appear once a phase is re-scanned. A tick on its own is not evidence.</p>`,
    ].join("\n");
  }

  const body = [
    `<h1>Remediation evidence pack</h1>`,
    `<p>${escape(customerName)} — ${rows.length} verified fix${rows.length === 1 ? "" : "es"}, timestamped.</p>`,
    `<p>What was changed, when the re-scan confirmed it, who did it, and which finding it closes. Written for the people who ask for proof — cyber insurers, auditors and your own board.</p>`,
    "<table>",
    "<thead><tr><th>Step</th><th>Title</th><th>Pillar</th><th>Action</th><th>Finding closed</th><th>Verified</th><th>By</th></tr></thead>",
    "<tbody>",
    ...rows.map(
      (r) =>
        `<tr><td>${escape(r.stepLabel)}</td><td>${escape(r.title)}</td><td>${escape(r.pillar)}</td>` +
        `<td>${escape(r.statusLabel)}</td><td>${escape(r.findingSummary)}</td><td>${escape(when(r.verifiedAt))}</td><td>${escape(r.verifiedBy)}</td></tr>`,
    ),
    "</tbody>",
    "</table>",
  ].join("\n");
  return body;
}

router.get(
  "/msp/customers/:customerId/remediation-tracker/export.csv",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

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
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation-tracker/export.csv failed");
      res.status(500).json({ error: "Failed to generate CSV export" });
    }
  },
);

router.get(
  "/msp/customers/:customerId/remediation-tracker/export.pdf",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

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
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation-tracker/export.pdf failed");
      res.status(500).json({ error: "Failed to generate PDF export" });
    }
  },
);

router.get(
  "/msp/customers/:customerId/remediation-tracker/evidence-pack.pdf",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    try {
      const [rows, customerName] = await Promise.all([
        buildEvidenceRows(customerId),
        resolveCustomerName(customerId),
      ]);
      const pdfBuffer = await htmlToPdf(buildHtmlDoc(toEvidenceHtml(customerName, rows)));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename(customerName)}-remediation-evidence-pack.pdf"`,
      );
      res.setHeader("Content-Length", String(pdfBuffer.length));
      res.end(pdfBuffer);

      log.info({ customerId, rowCount: rows.length }, "MSP-side remediation tracker evidence pack generated");
    } catch (err) {
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation-tracker/evidence-pack.pdf failed");
      res.status(500).json({ error: "Failed to generate evidence pack" });
    }
  },
);

export default router;
