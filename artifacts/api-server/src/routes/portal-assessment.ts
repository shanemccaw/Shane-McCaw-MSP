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
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { extractAndStoreOmgCards, type OmgCard } from "../lib/omg-card-extractor";
import { runDiagnostics } from "../lib/diagnostics-runner";
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

export default router;
