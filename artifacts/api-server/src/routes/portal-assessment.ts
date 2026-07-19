/**
 * ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
 * This file's POST /portal/assessment/debug-trigger-scan route (below) exists
 * only so scan progress can be watched live during development. It is hard-gated
 * to isTestbed=true customers, but must be fully removed before this flow reaches
 * real customers. See backlog: [Shane to add ticket].
 *
 * portal-assessment.ts
 *
 * Customer-facing flow-control endpoint for the Assessment wizard (the shell
 * built in assessment-shell.tsx). This is the *container* backend — it reports
 * where a customer is in the funnel so the wizard can gate its locked,
 * sequential steps. It does NOT generate or return document *content* (that is
 * a later task); it only reports generation status so the wizard knows when to
 * unlock a step.
 *
 * Single route:
 *   GET /api/portal/assessment/status
 *     — Everything the wizard polls for:
 *         • scan     : the customer's latest diagnostics run (active or last
 *                      completed) so the wizard can drive the live scan step and
 *                      open the existing diagnostics SSE stream by runId.
 *         • documents: the customer's generated assessment documents with their
 *                      lifecycle status (generating → approved/delivered/failed),
 *                      the established polling signal (insights docs have no
 *                      per-document SSE channel), so the wizard can show the
 *                      "reports generating" wait state and unlock review when done.
 *         • mfa       : whether the customer has enrolled portal-login MFA, so the
 *                      wizard can enforce the mandatory first-login MFA gate.
 *
 * ID-space note (see the platform's users.id vs msp_customers.id split):
 *   - diagnostics runs are keyed by msp_customers.id  → req.user.customerId claim
 *   - insights documents are keyed by users.id        → req.user.id
 * Both are resolved here from the JWT, server-side, so the client never has to
 * reason about the two id spaces.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspDiagnosticRunsTable,
  insightsGeneratedDocumentsTable,
  mfaEnrollmentsTable,
  webauthnCredentialsTable,
  mspCustomersTable,
  mspUsersTable,
  clientServicesTable,
  servicesTable,
} from "@workspace/db";
import { eq, ne, and, desc, inArray, isNull, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { extractAndStoreOmgCards, type OmgCard } from "../lib/omg-card-extractor";
import { runDiagnostics } from "../lib/diagnostics-runner";
import { generateConsolidatedSowDocument } from "../lib/consolidated-sow-generator";
import { randomUUID } from "crypto";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

/** Resolve the customer's msp_customers.id from their JWT claim (diagnostics id space). */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

// Run statuses that mean "a scan is in flight right now" vs "finished with data".
const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;
const COMPLETED_RUN_STATUSES = ["completed", "partial"] as const;

// Document statuses that count as "finished generating, ready to review".
const READY_DOC_STATUSES = ["approved", "delivered"] as const;

router.get(
  "/portal/assessment/status",
  // Floor is Assessment (the lowest role); CustomerUser/Free above it also carry
  // a customerId and may read their own status. MSP-side roles have no customerId
  // claim and fall through to the 403 below.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    const userId = req.user?.id;
    if (customerId === null || userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // ── Scan state (msp_customers.id space) ──────────────────────────────
      const [latestRun] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const [lastCompleted] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(
          and(
            eq(mspDiagnosticRunsTable.customerId, customerId),
            inArray(mspDiagnosticRunsTable.status, [...COMPLETED_RUN_STATUSES]),
          ),
        )
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const scanActive =
        latestRun != null && (ACTIVE_RUN_STATUSES as readonly string[]).includes(latestRun.status);

      // ── Document state (users.id space) ──────────────────────────────────
      // Non-archived docs only; archived rows are superseded regenerations that
      // should not hold the wizard open or count toward readiness.
      const docRows = await db
        .select({
          id: insightsGeneratedDocumentsTable.id,
          docType: insightsGeneratedDocumentsTable.docType,
          category: insightsGeneratedDocumentsTable.category,
          title: insightsGeneratedDocumentsTable.title,
          status: insightsGeneratedDocumentsTable.status,
          createdAt: insightsGeneratedDocumentsTable.createdAt,
        })
        .from(insightsGeneratedDocumentsTable)
        .where(eq(insightsGeneratedDocumentsTable.customerId, userId))
        .orderBy(insightsGeneratedDocumentsTable.createdAt);

      const documents = docRows.filter((d) => d.status !== "archived");
      const generatingCount = documents.filter((d) => d.status === "generating").length;
      const readyCount = documents.filter((d) =>
        (READY_DOC_STATUSES as readonly string[]).includes(d.status),
      ).length;
      const failedCount = documents.filter((d) => d.status === "failed").length;

      // ── MFA enrollment state (users.id space) ────────────────────────────
      // Only the two customer-offered methods count toward the gate: Authenticator
      // (TOTP) and Passkey. SMS is intentionally excluded (no SMS vendor is wired
      // for this flow). A passkey enrollment writes both a webauthn_credentials
      // row and an mfa_enrollments(method:"passkey") row, so the enrollments table
      // alone is authoritative; the credentials table is checked as a belt-and-
      // suspenders fallback.
      const enrollments = await db
        .select({ method: mfaEnrollmentsTable.method })
        .from(mfaEnrollmentsTable)
        .where(
          and(
            eq(mfaEnrollmentsTable.userId, userId),
            eq(mfaEnrollmentsTable.enabled, true),
            inArray(mfaEnrollmentsTable.method, ["totp", "passkey"]),
          ),
        );
      const [passkey] = await db
        .select({ id: webauthnCredentialsTable.id })
        .from(webauthnCredentialsTable)
        .where(eq(webauthnCredentialsTable.userId, userId))
        .limit(1);
      const mfaEnrolled = enrollments.length > 0 || passkey != null;

      // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
      // isTestbed is exposed here only so the wizard can show the debug scan
      // trigger button to testbed customers. Remove alongside that button.
      const [customerRow] = await db
        .select({ isTestbed: mspCustomersTable.isTestbed })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);

      res.json({
        scan: {
          active: scanActive,
          runId: scanActive ? latestRun.runId : null,
          status: latestRun?.status ?? null,
          startedAt: scanActive ? latestRun.startedAt : null,
          checksTotal: latestRun?.checksTotal ?? null,
          checksOk: latestRun?.checksOk ?? null,
          checksError: latestRun?.checksError ?? null,
          lastScanAt: lastCompleted ? (lastCompleted.completedAt ?? lastCompleted.createdAt) : null,
          everScanned: latestRun != null,
        },
        documents: {
          items: documents.map((d) => ({
            id: d.id,
            docType: d.docType,
            category: d.category,
            title: d.title,
            status: d.status,
          })),
          total: documents.length,
          generating: generatingCount,
          ready: readyCount,
          failed: failedCount,
          // "Reports are done" = at least one finished document and nothing still
          // generating. Zero documents means generation hasn't started yet (its
          // trigger is a later task), so the wizard stays in the wait state.
          allReady: documents.length > 0 && generatingCount === 0 && readyCount > 0,
        },
        mfa: {
          enrolled: mfaEnrolled,
        },
        // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ (see note above)
        isTestbed: customerRow?.isTestbed === true,
      });
    } catch (err) {
      log.error({ err, customerId, userId }, "GET /portal/assessment/status failed");
      res.status(500).json({ error: "Failed to load assessment status" });
    }
  },
);

// ── Single document — content + OMG cards for the Results Viewer ───────────────
//
// Returns one of the customer's own generated assessment documents: its rendered
// HTML (for the iframe viewer, same pattern as customer-sow.tsx) plus its
// AI-extracted "OMG cards".
//
// OMG cards are extracted LAZILY here, on the customer's first open of the
// document, then persisted to insights_generated_documents.omg_cards. This avoids
// spending an AI call on any document the customer never opens (assessments always
// run a fresh scan and AI credits cost money). Every later view reads the stored
// cards. Extraction failure never blocks the document — the HTML is always
// returned; cards simply come back empty.
router.get(
  "/portal/assessment/documents/:id",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const documentId = Number(req.params.id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }

    try {
      // Scope strictly to the caller's own documents (users.id space).
      const [doc] = await db
        .select({
          id: insightsGeneratedDocumentsTable.id,
          customerId: insightsGeneratedDocumentsTable.customerId,
          docType: insightsGeneratedDocumentsTable.docType,
          category: insightsGeneratedDocumentsTable.category,
          title: insightsGeneratedDocumentsTable.title,
          status: insightsGeneratedDocumentsTable.status,
          htmlContent: insightsGeneratedDocumentsTable.htmlContent,
          omgCards: insightsGeneratedDocumentsTable.omgCards,
        })
        .from(insightsGeneratedDocumentsTable)
        .where(
          and(
            eq(insightsGeneratedDocumentsTable.id, documentId),
            eq(insightsGeneratedDocumentsTable.customerId, userId),
          ),
        )
        .limit(1);

      if (!doc || doc.status === "archived") {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // Only expose documents that have finished generating and are ready to read.
      const isReady = (READY_DOC_STATUSES as readonly string[]).includes(doc.status);
      if (!isReady) {
        res.status(409).json({ error: "Document is not ready yet", status: doc.status });
        return;
      }

      // Lazily extract OMG cards on first view; reuse stored cards thereafter.
      let omgCards: OmgCard[] = (doc.omgCards as OmgCard[] | null) ?? [];
      if (doc.omgCards == null) {
        omgCards = await extractAndStoreOmgCards({
          id: doc.id,
          docType: doc.docType,
          title: doc.title,
          htmlContent: doc.htmlContent,
          customerUserId: doc.customerId,
        });
      }

      res.json({
        id: doc.id,
        docType: doc.docType,
        category: doc.category,
        title: doc.title,
        status: doc.status,
        htmlContent: doc.htmlContent,
        omgCards,
      });
    } catch (err) {
      log.error({ err, userId, documentId }, "GET /portal/assessment/documents/:id failed");
      res.status(500).json({ error: "Failed to load document" });
    }
  },
);

// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// POST /portal/assessment/debug-trigger-scan
// Exists only so scan progress can be watched live during development. Real
// customers never get a self-serve scan trigger (prevents AI-credit spam) —
// this is a narrow, hard-gated exception: testbed customers only, enforced
// server-side (not just by hiding the button client-side). Reuses the exact
// packageKey resolution + runDiagnostics call from msp-diagnostics.ts's
// POST /msp/customers/:customerId/diagnostics/run — do not reimplement that
// logic elsewhere. Remove this route entirely before production. See
// backlog: [Shane to add ticket].
router.post(
  "/portal/assessment/debug-trigger-scan",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // Hard server-side testbed guard — this check is what actually prevents
      // real customers from triggering scans, not the button's visibility.
      const [customer] = await db
        .select({ isTestbed: mspCustomersTable.isTestbed, mspId: mspCustomersTable.mspId, tenantId: mspCustomersTable.tenantId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);

      if (!customer || customer.isTestbed !== true) {
        log.warn({ customerId }, "debug-trigger-scan: blocked — customer is not a testbed tenant");
        res.status(403).json({ error: "Scan trigger is not available for this account" });
        return;
      }

      // Same packageKey resolution as msp-diagnostics.ts's diagnostics/run route.
      const [pkgRow] = await db
        .select({ packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'` })
        .from(mspUsersTable)
        .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, mspUsersTable.userId))
        .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
        .where(
          and(
            eq(mspUsersTable.customerId, customerId),
            eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
            eq(clientServicesTable.status, "active"),
          )
        )
        .limit(1);
      const packageKey = pkgRow?.packageKey ?? "core:security-baseline";

      const triggeredByUserId = req.user!.id;
      const runId = randomUUID();

      await db
        .insert(mspDiagnosticRunsTable)
        .values({
          runId,
          mspId: customer.mspId,
          customerId,
          tenantId: customer.tenantId ?? undefined,
          packageKey,
          status: "pending",
          triggeredByUserId,
        });

      res.status(202).json({ runId, status: "pending", message: "Debug scan trigger started" });

      void runDiagnostics({ customerId, packageKey, existingRunId: runId, triggeredByUserId }).catch(
        (err: unknown) => {
          log.error({ err, runId }, "debug-trigger-scan: async run failed");
        },
      );
    } catch (err) {
      log.error({ err, customerId }, "POST /portal/assessment/debug-trigger-scan failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to trigger scan" });
    }
  },
);

// ── Interactive SOW scope selector (Assessment wizard, task 4) ─────────────────
//
// The consolidated SOW is the last document in the wizard sequence. Unlike the
// read-only findings reports, the customer can toggle optional workstream phases
// on/off here. Two price surfaces:
//   • Instant, free preview — the client sums the already-stored per-phase
//     sowPricingLines on every checkbox click. No AI call, no round-trip.
//   • Deliberate regeneration — POST .../sow/select produces a real, updated,
//     telemetry-grounded SOW for the narrower scope (a genuine AI cost), UNLESS
//     the requested scope exactly matches a version already in storage (e.g.
//     "reset to full scope" restores the original document), in which case that
//     stored version is simply re-activated for free.
//
// Versioning: exactly one consolidated_sow row is "approved" (active) at a time;
// every superseded version is "archived" (hidden by the reader filters but still
// retrievable by exact-scope match). The generator writes those transitions in
// supersedeMode: "archive"; this route owns the free re-activation path.
//
// Pricing window (30-day / 72-hour rule): the SOW and its price are valid for 30
// days from the first generation; a 72-hour pay-in-full discount window opens at
// that same anchor. There is no dedicated timestamp column — the anchor is the
// earliest non-failed consolidated_sow row's createdAt, which is preserved across
// regenerations (superseded rows are archived, not deleted), so re-scoping never
// resets the clock. The actual pay-in-full vs phased choice is task 5; this route
// only surfaces where the customer sits in the window.

const SOW_DOC_TYPE = "consolidated_sow";
const DISCOUNT_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours
const VALIDITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Statuses that represent a real, persisted SOW (anchor-eligible); excludes
// "generating" (not yet a document) and "failed" (never became one).
const SOW_REAL_STATUSES = ["approved", "delivered", "archived"] as const;
const SOW_ACTIVE_STATUSES = ["approved", "delivered"] as const;

type SowPricingLineRow = {
  title: string;
  scope: string;
  priceUsd: number;
  notes?: string;
  line_type?: "workstream" | "adjustment";
  weeks?: number;
  deliveryDate?: string;
};

interface SowDocRow {
  id: number;
  projectId: number | null;
  title: string;
  status: string;
  htmlContent: string;
  sowPricingLines: SowPricingLineRow[] | null;
  sowTotalPrice: string | null;
  createdAt: Date;
}

function loadSowDocs(userId: number): Promise<SowDocRow[]> {
  return db
    .select({
      id: insightsGeneratedDocumentsTable.id,
      projectId: insightsGeneratedDocumentsTable.projectId,
      title: insightsGeneratedDocumentsTable.title,
      status: insightsGeneratedDocumentsTable.status,
      htmlContent: insightsGeneratedDocumentsTable.htmlContent,
      sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
      sowTotalPrice: insightsGeneratedDocumentsTable.sowTotalPrice,
      createdAt: insightsGeneratedDocumentsTable.createdAt,
    })
    .from(insightsGeneratedDocumentsTable)
    .where(
      and(
        eq(insightsGeneratedDocumentsTable.customerId, userId),
        eq(insightsGeneratedDocumentsTable.docType, SOW_DOC_TYPE),
        ne(insightsGeneratedDocumentsTable.status, "failed"),
      ),
    )
    .orderBy(insightsGeneratedDocumentsTable.createdAt) as Promise<SowDocRow[]>;
}

const linesOf = (d: SowDocRow): SowPricingLineRow[] => (d.sowPricingLines ?? []) as SowPricingLineRow[];
// Only an explicit "adjustment" line_type is a mandatory (non-toggleable) adjustment;
// anything else (incl. legacy rows without line_type) is treated as a toggleable workstream.
const workstreamLinesOf = (d: SowDocRow): SowPricingLineRow[] => linesOf(d).filter((l) => l.line_type !== "adjustment");
const adjustmentLinesOf = (d: SowDocRow): SowPricingLineRow[] => linesOf(d).filter((l) => l.line_type === "adjustment");
const workstreamTitlesOf = (d: SowDocRow): string[] => workstreamLinesOf(d).map((l) => l.title);
const normalizeSet = (titles: string[]): string => [...new Set(titles)].sort().join("");

/**
 * The baseline full-scope document = the SOW version containing the most
 * workstream phases (the original generation always includes every fired-signal
 * workstream; a narrowed regeneration has fewer). Ties break to the earliest.
 * Its workstream lines define the complete toggleable set the client renders,
 * even when a narrower version is currently active.
 */
function baselineDoc(docs: SowDocRow[]): SowDocRow | null {
  let best: SowDocRow | null = null;
  let bestCount = -1;
  for (const d of docs) {
    const count = workstreamLinesOf(d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function buildSowState(docs: SowDocRow[]) {
  const activeDoc =
    [...docs]
      .filter((d) => (SOW_ACTIVE_STATUSES as readonly string[]).includes(d.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const regenerating = docs.some((d) => d.status === "generating");

  if (!activeDoc) {
    return { ready: false as const, regenerating };
  }

  const baseline = baselineDoc(docs) ?? activeDoc;
  const allWorkstreams = workstreamLinesOf(baseline).map((l) => ({
    title: l.title,
    scope: l.scope,
    priceUsd: l.priceUsd,
    weeks: l.weeks ?? null,
    deliveryDate: l.deliveryDate ?? null,
  }));
  const adjustments = adjustmentLinesOf(activeDoc).map((l) => ({
    title: l.title,
    scope: l.scope,
    priceUsd: l.priceUsd,
  }));
  const selectedWorkstreamTitles = workstreamTitlesOf(activeDoc);
  const isFullScope = normalizeSet(selectedWorkstreamTitles) === normalizeSet(allWorkstreams.map((w) => w.title));

  // Pricing window anchored to the earliest real SOW row (preserved across regens).
  const anchorRow = docs.find((d) => (SOW_REAL_STATUSES as readonly string[]).includes(d.status)) ?? activeDoc;
  const anchorAt = anchorRow.createdAt;
  const discountWindowEndsAt = new Date(anchorAt.getTime() + DISCOUNT_WINDOW_MS);
  const validUntil = new Date(anchorAt.getTime() + VALIDITY_WINDOW_MS);
  const now = Date.now();
  const windowState: "discount" | "standard" | "expired" =
    now < discountWindowEndsAt.getTime() ? "discount" : now < validUntil.getTime() ? "standard" : "expired";

  return {
    ready: true as const,
    regenerating,
    doc: {
      id: activeDoc.id,
      title: activeDoc.title,
      htmlContent: activeDoc.htmlContent,
      totalPrice: activeDoc.sowTotalPrice != null ? Number(activeDoc.sowTotalPrice) : null,
    },
    allWorkstreams,
    adjustments,
    selectedWorkstreamTitles,
    isFullScope,
    pricing: {
      anchorAt: anchorAt.toISOString(),
      discountWindowEndsAt: discountWindowEndsAt.toISOString(),
      validUntil: validUntil.toISOString(),
      windowState,
    },
  };
}

// GET — current interactive SOW state (active doc, full toggleable phase set,
// current selection, mandatory adjustments, and pricing-window countdown).
router.get(
  "/portal/assessment/sow",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    try {
      const docs = await loadSowDocs(userId);
      res.json(buildSowState(docs));
    } catch (err) {
      log.error({ err, userId }, "GET /portal/assessment/sow failed");
      res.status(500).json({ error: "Failed to load statement of work" });
    }
  },
);

// POST — apply a scope selection.
//   • Exact match to a stored version (incl. full scope) → re-activate it, free.
//   • Genuinely new subset → regenerate a real, updated SOW (AI cost). Responds
//     202 with the new "generating" docId once the row exists; generation
//     continues in the background and the client polls GET .../sow for completion.
router.post(
  "/portal/assessment/sow/select",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const rawSelected = (req.body as { selectedWorkstreamTitles?: unknown })?.selectedWorkstreamTitles;
    if (!Array.isArray(rawSelected) || !rawSelected.every((t) => typeof t === "string")) {
      res.status(400).json({ error: "selectedWorkstreamTitles must be an array of strings" });
      return;
    }

    try {
      const docs = await loadSowDocs(userId);
      const state = buildSowState(docs);
      if (!state.ready) {
        res.status(409).json({ error: "No active statement of work to update yet" });
        return;
      }
      if (state.regenerating) {
        res.status(409).json({ error: "A scope update is already in progress" });
        return;
      }

      const activeDoc =
        [...docs]
          .filter((d) => (SOW_ACTIVE_STATUSES as readonly string[]).includes(d.status))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
      const projectId = activeDoc.projectId;

      // Constrain the request to real, toggleable workstream titles from the baseline.
      const allTitles = new Set(state.allWorkstreams.map((w) => w.title));
      const requested = [...new Set(rawSelected)].filter((t) => allTitles.has(t));
      if (requested.length === 0) {
        res.status(400).json({ error: "Select at least one workstream phase" });
        return;
      }
      const requestedKey = normalizeSet(requested);

      // Free path — a stored version already has exactly this workstream set.
      // Re-activate it and archive every other version. Covers "reset to full
      // scope" and re-selecting any previously-generated subset.
      const match = docs.find((d) => normalizeSet(workstreamTitlesOf(d)) === requestedKey);
      if (match) {
        if (match.status !== "approved") {
          await db
            .update(insightsGeneratedDocumentsTable)
            .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
            .where(eq(insightsGeneratedDocumentsTable.id, match.id));
        }
        await db
          .update(insightsGeneratedDocumentsTable)
          .set({ status: "archived", updatedAt: new Date() })
          .where(
            and(
              eq(insightsGeneratedDocumentsTable.customerId, userId),
              projectId != null
                ? eq(insightsGeneratedDocumentsTable.projectId, projectId)
                : isNull(insightsGeneratedDocumentsTable.projectId),
              eq(insightsGeneratedDocumentsTable.docType, SOW_DOC_TYPE),
              ne(insightsGeneratedDocumentsTable.id, match.id),
              inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered"]),
            ),
          );
        log.info(
          { userId, docId: match.id, requestedCount: requested.length },
          "portal/assessment/sow/select: re-activated stored scope version (no regeneration)",
        );
        res.json({ regenerated: false, docId: match.id });
        return;
      }

      // Regeneration path — a genuinely new, narrower subset. Kick off a real
      // generation and respond as soon as the "generating" row exists so the
      // client can show its progress state; the AI step continues in the background.
      log.info(
        { userId, projectId, requestedCount: requested.length, selectedTitles: requested },
        "portal/assessment/sow/select: regenerating SOW for new customer scope selection",
      );

      let responded = false;
      let onRow: (docId: number) => void = () => {};
      const rowReady = new Promise<number>((resolve, reject) => {
        onRow = (docId: number) => resolve(docId);
        void generateConsolidatedSowDocument({
          clientUserId: userId,
          projectId,
          title: activeDoc.title,
          selectedWorkstreamTitles: requested,
          supersedeMode: "archive",
          onRowCreated: (docId) => onRow(docId),
        })
          .then((result) => resolve(result.docId))
          .catch((genErr) => {
            if (responded) {
              log.error({ genErr, userId }, "portal/assessment/sow/select: background SOW regeneration failed");
            } else {
              reject(genErr);
            }
          });
      });

      const newDocId = await rowReady;
      responded = true;
      res.status(202).json({ regenerated: true, docId: newDocId, status: "generating" });
    } catch (err) {
      log.error({ err, userId }, "POST /portal/assessment/sow/select failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to update statement of work scope" });
    }
  },
);

export default router;
