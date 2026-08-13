/**
 * portal-remediation-tracker-export.ts — Git #733 (Phase D1 of Epic #647,
 * split from the original Phase D scope on 2026-08-11 to run in parallel with
 * Phase C / #732's verification work); evidence pack added by Git #742
 * (Phase D2) once #732's verification state had landed.
 *
 *   GET /api/portal/remediation-tracker/export.csv
 *   GET /api/portal/remediation-tracker/export.pdf
 *   GET /api/portal/remediation-tracker/evidence-pack.pdf
 *
 * The first two are the flat status-table export Shane confirmed when #733
 * was split off #647's original Phase D — every catalogue step, whatever the
 * customer has claimed about it. Deliberately reads only the columns Phase A
 * (#730) landed (`stepId`/`status`/`completedAt`/`updatedAt`); it is not
 * proof anything happened, just a record of the claim.
 *
 * The evidence pack is the other half #733 explicitly deferred: only steps a
 * REAL rescan has verified (Phase C / #732's `verificationState`), each cited
 * against the actual scan findings that verified it
 * (`verifiedByRunId` → `msp_diagnostic_runs.run_id` →
 * `msp_diagnostic_findings`), per the design's own "written for the people
 * who ask for proof — cyber insurers, auditors and your own board" panel in
 * `Design/Remediation Tracker.dc.html` (its `evidenceVals()` builder). A tick
 * on its own is not evidence there and is not evidence here either — only
 * `verificationState === "verified"` rows qualify.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  remediationTrackerStepsTable,
  tenantsTable,
  usersTable,
  mspsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
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
 * taken on an untouched tracker still lists all 28 with a real state instead
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

interface EvidenceRow {
  readonly stepLabel: string;
  readonly title: string;
  readonly pillar: string;
  readonly statusLabel: string;
  readonly verifiedAt: string | null;
  readonly verifiedBy: string;
  readonly findingSummary: string;
}

/**
 * Every step this customer's own re-scans have actually verified — the
 * evidence pack's real gate is `verificationState === "verified"`, not
 * `status === "completed"`: #732's verdict rule already requires full
 * check-key coverage and an all-clean result, which is a stronger claim than
 * any single tick. Steps that are `drift` or `unverified` (including ones the
 * customer marked complete but no rescan has confirmed yet) do not appear —
 * matching the design's own "nothing verified yet" / "a tick on its own is
 * not evidence" copy.
 */
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

  // Catalogue order, not query order — the customer reads this top to bottom
  // against the same guide they've been working through.
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

/**
 * The design's own panel copy (`Design/Remediation Tracker.dc.html`,
 * `evidenceVals()`/its surrounding markup) — "what was changed, when the
 * re-scan confirmed it, who did it, and which finding it closes", rendered as
 * a standalone document instead of the in-app dropdown the fixture mocked.
 */
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

// ── CLIENT: Remediation Tracker → Evidence pack PDF ──────────────────────────

router.get(
  "/portal/remediation-tracker/evidence-pack.pdf",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

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

      log.info({ customerId, rowCount: rows.length }, "remediation tracker evidence pack generated");
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/remediation-tracker/evidence-pack.pdf failed");
      res.status(500).json({ error: "Failed to generate evidence pack" });
    }
  },
);

export default router;
