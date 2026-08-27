import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  projectsTable,
  documentsTable,
  invoicesTable,
  messagesTable,
  clientM365ProfilesTable,
  clientDocumentsTable,
  auditLogsTable,
  quizLeadsTable,
  tenantsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  tenantEngineSnapshotsTable,
  engineScoreDailyRollupTable,
  engineBaselineHistoryTable,
  tenantSignalHistoryTable,
  mspDocumentsTable,
  mspSowsTable,
  mspReportRunsTable,
  mspCustomerClickwrapsTable,
  mspSalesBundleAssignmentsTable,
  mspAuditLogsTable,
} from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveSiblingUserIds } from "../lib/tenant-signals.ts";
import { createAuditLog } from "../lib/audit.ts";
import { submitSelfServiceDeletionRequest } from "../lib/data-rights.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// ── Portal: data export (right to portability) ────────────────────────────────
// GET /api/portal/data-export
// Returns a JSON archive of all data the authenticated client owns.
router.get("/portal/data-export", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const [user] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      company: usersTable.company,
      phone: usersTable.phone,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // #1397: this archive claims to hold "all data ... for your account" — the
    // legacy users.id-keyed records (projects/invoices/messages/documents/M365
    // profile) belong to the CUSTOMER, so export them across every linked login,
    // not just the requesting one. The personal audit trail below stays
    // user-scoped (it is genuinely "who did this").
    const siblingIds = await resolveSiblingUserIds(userId);

    const projects = await db.select({
      id: projectsTable.id,
      title: projectsTable.title,
      status: projectsTable.status,
      createdAt: projectsTable.createdAt,
    }).from(projectsTable).where(inArray(projectsTable.clientUserId, siblingIds)).orderBy(desc(projectsTable.createdAt));

    const projectIds = projects.map(p => p.id);

    const documents = projectIds.length > 0
      ? await db.select({
          id: documentsTable.id,
          name: documentsTable.name,
          filename: documentsTable.filename,
          projectId: documentsTable.projectId,
          createdAt: documentsTable.createdAt,
        }).from(documentsTable).where(inArray(documentsTable.projectId, projectIds)).orderBy(desc(documentsTable.createdAt))
      : [];

    const invoices = await db.select({
      id: invoicesTable.id,
      amount: invoicesTable.amount,
      status: invoicesTable.status,
      description: invoicesTable.description,
      createdAt: invoicesTable.createdAt,
    }).from(invoicesTable).where(inArray(invoicesTable.clientUserId, siblingIds)).orderBy(desc(invoicesTable.createdAt));

    const messages = await db.select({
      id: messagesTable.id,
      body: messagesTable.body,
      senderUserId: messagesTable.senderUserId,
      createdAt: messagesTable.createdAt,
    }).from(messagesTable).where(inArray(messagesTable.clientUserId, siblingIds)).orderBy(desc(messagesTable.createdAt));

    const [m365Profile] = await db.select({
      profile: clientM365ProfilesTable.profile,
      updatedAt: clientM365ProfilesTable.updatedAt,
    }).from(clientM365ProfilesTable).where(inArray(clientM365ProfilesTable.clientId, siblingIds)).limit(1);

    const clientDocs = await db.select({
      id: clientDocumentsTable.id,
      filename: clientDocumentsTable.filename,
      mimeType: clientDocumentsTable.mimeType,
      createdAt: clientDocumentsTable.createdAt,
    }).from(clientDocumentsTable).where(inArray(clientDocumentsTable.clientUserId, siblingIds)).orderBy(desc(clientDocumentsTable.createdAt));

    const auditEntries = await db.select({
      actionType: auditLogsTable.actionType,
      entityType: auditLogsTable.entityType,
      createdAt: auditLogsTable.createdAt,
    }).from(auditLogsTable)
      .where(eq(auditLogsTable.actorUserId, userId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(500);

    const quizResults = await db.select({
      id: quizLeadsTable.id,
      email: quizLeadsTable.email,
      tier: quizLeadsTable.tier,
      categoryScores: quizLeadsTable.categoryScores,
      createdAt: quizLeadsTable.createdAt,
    }).from(quizLeadsTable).where(eq(quizLeadsTable.email, user.email)).orderBy(desc(quizLeadsTable.createdAt));

    // ── Current-schema (MSP tenant) data ────────────────────────────────────────
    // The legacy queries above are keyed by usersTable.id. Customers provisioned
    // under the current schema hold their real data (diagnostics, engine scores,
    // SOWs, MSP documents, consent, monitoring history) keyed by tenants.id.
    // req.user.customerId is that id (the JWT claim carries users.tenantId —
    // Phase 1 froze the wire name); it is undefined for staff/admin accounts
    // and for legacy-only clients, in which case this whole section is omitted.
    const customerId = req.user!.customerId;
    let currentSchema: Record<string, unknown> | null = null;
    if (typeof customerId === "number") {
      const [
        mspCustomer,
        diagnosticRuns,
        diagnosticFindings,
        engineScoreHistory,
        engineScoreDailyRollup,
        engineBaselineHistory,
        signalHistory,
        mspDocuments,
        sows,
        reportRuns,
        clickwraps,
        consent,
        bundleAssignments,
        mspAudit,
      ] = await Promise.all([
        db.select({
          id: tenantsTable.id, name: tenantsTable.customerName, domain: tenantsTable.domain,
          industry: tenantsTable.industry, status: tenantsTable.status, createdAt: tenantsTable.createdAt,
        }).from(tenantsTable).where(eq(tenantsTable.id, customerId)).limit(1),
        db.select({
          runId: mspDiagnosticRunsTable.runId, packageKey: mspDiagnosticRunsTable.packageKey,
          status: mspDiagnosticRunsTable.status, checksTotal: mspDiagnosticRunsTable.checksTotal,
          checksOk: mspDiagnosticRunsTable.checksOk, checksError: mspDiagnosticRunsTable.checksError,
          startedAt: mspDiagnosticRunsTable.startedAt, completedAt: mspDiagnosticRunsTable.completedAt,
          createdAt: mspDiagnosticRunsTable.createdAt,
        }).from(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, customerId)).orderBy(desc(mspDiagnosticRunsTable.createdAt)),
        db.select({
          findingId: mspDiagnosticFindingsTable.findingId, checkKey: mspDiagnosticFindingsTable.checkKey,
          checkLabel: mspDiagnosticFindingsTable.checkLabel, severity: mspDiagnosticFindingsTable.severity,
          title: mspDiagnosticFindingsTable.title, description: mspDiagnosticFindingsTable.description,
          recommendation: mspDiagnosticFindingsTable.recommendation, createdAt: mspDiagnosticFindingsTable.createdAt,
        }).from(mspDiagnosticFindingsTable).where(eq(mspDiagnosticFindingsTable.customerId, customerId)).orderBy(desc(mspDiagnosticFindingsTable.createdAt)).limit(2000),
        db.select({
          engineKey: tenantEngineSnapshotsTable.engineKey, score: tenantEngineSnapshotsTable.score,
          previousScore: tenantEngineSnapshotsTable.previousScore, delta: tenantEngineSnapshotsTable.delta,
          trendDirection: tenantEngineSnapshotsTable.trendDirection, capturedAt: tenantEngineSnapshotsTable.capturedAt,
        }).from(tenantEngineSnapshotsTable).where(eq(tenantEngineSnapshotsTable.customerId, customerId)).orderBy(desc(tenantEngineSnapshotsTable.capturedAt)).limit(2000),
        db.select({
          engineKey: engineScoreDailyRollupTable.engineKey, day: engineScoreDailyRollupTable.day,
          score: engineScoreDailyRollupTable.score,
        }).from(engineScoreDailyRollupTable).where(eq(engineScoreDailyRollupTable.customerId, customerId)).orderBy(desc(engineScoreDailyRollupTable.day)).limit(2000),
        db.select({
          engineKey: engineBaselineHistoryTable.engineKey, baselineScore: engineBaselineHistoryTable.baselineScore,
          resetTriggerType: engineBaselineHistoryTable.resetTriggerType, createdAt: engineBaselineHistoryTable.createdAt,
        }).from(engineBaselineHistoryTable).where(eq(engineBaselineHistoryTable.customerId, customerId)).orderBy(desc(engineBaselineHistoryTable.createdAt)).limit(2000),
        db.select({
          signalKey: tenantSignalHistoryTable.signalKey, category: tenantSignalHistoryTable.category,
          firedAt: tenantSignalHistoryTable.firedAt, resolvedAt: tenantSignalHistoryTable.resolvedAt,
        }).from(tenantSignalHistoryTable).where(eq(tenantSignalHistoryTable.customerId, customerId)).orderBy(desc(tenantSignalHistoryTable.firedAt)).limit(2000),
        db.select({
          documentId: mspDocumentsTable.documentId, title: mspDocumentsTable.title,
          documentType: mspDocumentsTable.documentType, status: mspDocumentsTable.status,
          createdAt: mspDocumentsTable.createdAt,
        }).from(mspDocumentsTable).where(eq(mspDocumentsTable.customerId, customerId)).orderBy(desc(mspDocumentsTable.createdAt)),
        db.select({
          sowId: mspSowsTable.sowId, title: mspSowsTable.title, amountCents: mspSowsTable.amountCents,
          currency: mspSowsTable.currency, status: mspSowsTable.status, signerName: mspSowsTable.signerName,
          signedAt: mspSowsTable.signedAt, signedIp: mspSowsTable.signedIp, createdAt: mspSowsTable.createdAt,
        }).from(mspSowsTable).where(eq(mspSowsTable.customerId, customerId)).orderBy(desc(mspSowsTable.createdAt)),
        db.select({
          runId: mspReportRunsTable.runId, status: mspReportRunsTable.status, createdAt: mspReportRunsTable.createdAt,
        }).from(mspReportRunsTable).where(eq(mspReportRunsTable.customerId, customerId)).orderBy(desc(mspReportRunsTable.createdAt)),
        db.select({
          agreementTextSnapshot: mspCustomerClickwrapsTable.agreementTextSnapshot,
          ipAddress: mspCustomerClickwrapsTable.ipAddress, acceptedAt: mspCustomerClickwrapsTable.acceptedAt,
        }).from(mspCustomerClickwrapsTable).where(eq(mspCustomerClickwrapsTable.customerId, customerId)).orderBy(desc(mspCustomerClickwrapsTable.acceptedAt)),
        // Consent lives on tenants.consent (jsonb keyed by type — graph /
        // writeBack / sharepoint) since Phase 0 folded the three consent
        // tables into it; export the whole map rather than one row per type.
        db.select({ consent: tenantsTable.consent }).from(tenantsTable).where(eq(tenantsTable.id, customerId)).limit(1),
        db.select({
          status: mspSalesBundleAssignmentsTable.status, activatedAt: mspSalesBundleAssignmentsTable.activatedAt,
          trialExpiresAt: mspSalesBundleAssignmentsTable.trialExpiresAt, assignedAt: mspSalesBundleAssignmentsTable.assignedAt,
          revokedAt: mspSalesBundleAssignmentsTable.revokedAt,
        }).from(mspSalesBundleAssignmentsTable).where(eq(mspSalesBundleAssignmentsTable.customerId, customerId)).orderBy(desc(mspSalesBundleAssignmentsTable.assignedAt)),
        db.select({
          actionType: mspAuditLogsTable.actionType, entityType: mspAuditLogsTable.entityType,
          outcome: mspAuditLogsTable.outcome, occurredAt: mspAuditLogsTable.occurredAt,
        }).from(mspAuditLogsTable).where(eq(mspAuditLogsTable.customerId, customerId)).orderBy(desc(mspAuditLogsTable.occurredAt)).limit(500),
      ]);

      currentSchema = {
        customerProfile: mspCustomer[0] ?? null,
        diagnosticRuns,
        diagnosticFindings,
        engineScoreHistory,
        engineScoreDailyRollup,
        engineBaselineHistory,
        signalHistory,
        documents: mspDocuments,
        sows,
        reportRuns,
        clickwrapAcceptances: clickwraps,
        tenantConsent: consent[0]?.consent ?? {},
        salesBundleAssignments: bundleAssignments,
        auditActivity: mspAudit,
      };
    }

    const archive = {
      exportedAt: new Date().toISOString(),
      exportVersion: "2",
      notice: "This archive contains all personal and project data held by Shane McCaw Consulting LLC for your account, across both the legacy portal records and the current MSP platform records. Invoices, signed contracts, and signed statements of work are retained per legal requirements and are visible here but not deleted upon account deletion requests.",
      profile: user,
      projects,
      documents,
      invoices,
      messages,
      m365Profile: m365Profile ?? null,
      clientDocuments: clientDocs,
      auditActivity: auditEntries,
      quizResults,
      currentSchema,
    };

    void createAuditLog({
      actorUserId: userId,
      actorName: user.name ?? user.email,
      actorRole: "client",
      actionType: "data_export_downloaded",
      entityType: "user",
      entityId: userId,
      clientId: userId,
      metadata: { exportedAt: archive.exportedAt },
    });

    const filename = `data-export-${user.email.replace(/[^a-zA-Z0-9]/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(archive);
  } catch (err) {
    req.log.error({ err }, "portal: data-export failed");
    res.status(500).json({ error: "Failed to generate data export" });
  }
});

// ── Portal: deletion request (right to erasure) ───────────────────────────────
// POST /api/portal/deletion-request
// Records a deletion request and notifies the platform operator.
router.post("/portal/deletion-request", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const [user] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      company: usersTable.company,
    }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Resolve the customer's current-schema (MSP tenant) identity so the manual
    // fulfillment process can reach data that is NOT keyed by usersTable.id.
    // Without this, an admin processing the request via CRM → Delete Client would
    // never see (and today's delete would never touch) the customer's diagnostics,
    // engine-score history, SOWs, MSP documents, consent, or monitoring history.
    // Shared with the MSP-admin-initiated path in msp-data-rights.ts — see
    // lib/data-rights.ts for the single source of truth both call into.
    await submitSelfServiceDeletionRequest(user, req.user!.customerId);

    res.json({
      ok: true,
      message: "Your deletion request has been received. We will process it within 30 days and send a confirmation to your email address. Note: signed contracts and invoices are retained for 7 years as required by law.",
    });
  } catch (err) {
    req.log.error({ err }, "portal: deletion-request failed");
    res.status(500).json({ error: "Failed to submit deletion request" });
  }
});

export default router;
