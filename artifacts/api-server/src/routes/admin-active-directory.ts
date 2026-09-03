// artifacts/api-server/src/routes/admin-active-directory.ts
//
// Active Directory admin surface (initiative: active-directory,
// docs/build-plans/active-directory.md). Phase 1 (Issue #61): read-only tree
// + universal search over real msps/tenants/users rows.
// Phase 2 (Issue #62): MSP Object detail pane. No write actions — those are
// Phases 7-9.
//
// Tenant/User Refactor Phase 3 (#96): the "customer" object this surface
// browses IS a `tenants` row, and every RBAC/linkage column it reads or writes
// lives on `users` directly — msp_customers/msp_users are gone. The HTTP
// payloads deliberately keep their old field names (`name`, `customerId`) via
// select aliases so the admin-panel panes and lib/active-directory.ts's pure
// builders need no rename; only `ownerType` disappears, because the new
// tenants table has no analogue for it.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspsTable,
  tenantsTable,
  usersTable,
  mspSubscriptionsTable,
  servicesTable,
  platformAgreementsTable,
  mspAgreementAcceptancesTable,
  clientServicesTable,
  mspDiagnosticRunsTable,
  activeDirectoryOusTable,
  activeDirectoryOuAssignmentsTable,
  userSessionsTable,
  mfaEnrollmentsTable,
  passwordResetTokensTable,
  accountSetupTokensTable,
  impersonationTokensTable,
  mspAuditLogsTable,
  // ── Phase 9 (Issue #69) hard-delete footprint — explicit-delete tables ─────
  projectsTable,
  workflowStepsTable,
  kanbanTasksTable,
  documentsTable,
  reportsTable,
  invoicesTable,
  messagesTable,
  notificationsTable,
  projectUpdatesTable,
  contractsTable,
  statusReportsTable,
  emailsTable,
  emailDomainRulesTable,
  clientDocumentsTable,
  mfaChallengesTable,
  mfaBypassCodesTable,
  consentInviteTokensTable,
  insightsGeneratedDocumentsTable,
  tenantMonitorProfilesTable,
  mspDiagnosticFindingsTable,
  mspCustomerClickwrapsTable,
  mspImpersonationTokensTable,
  // ── Phase 9 census-only tables (DB auto-cascade — counted, never deleted here)
  customerNotificationPreferencesTable,
  clientM365ProfilesTable,
  clientAppRegistrationsTable,
  webauthnCredentialsTable,
  webauthnChallengesTable,
  clientHealthHistoryTable,
  clientCallbackTokensTable,
  clientScoresTable,
  clientAutomationRunsTable,
  assessmentSowAgreementsTable,
  pushSubscriptionsTable,
  quickWinPresentationsTable,
  quickWinResultSharesTable,
  mspStaffCustomerScopesTable,
  // ── Phase 9 census-only tables (DB auto-set-null — counted, never deleted here)
  projectClosuresTable,
  auditLogsTable,
  azureTenantCredentialsTable,
  inboxMessageLinksTable,
  scriptRunResultsTable,
  scriptDownloadTokensTable,
  insightsAutomationsTable,
  salesOffersTable,
  salesOfferEventsTable,
  // ── Customer hard-delete (Issue #<pending>) — tenant-only tables with a
  // loose customerId/tenantId column pointing at `tenants.id`/`tenants.tenantId`
  // but NO userId/clientUserId column of their own, so the Phase 9 per-user
  // cascade above never reaches them. Audited fresh against lib/db/src/schema
  // on 2026-08-08 — every customerId/tenantId column in the schema, minus the
  // ones already covered (via a user FK) or genuinely unrelated (see the
  // route's own header comment for the full accounting).
  mspEventStoreTable,
  mspDlqStoreTable,
  mspDocumentsTable,
  fulfillmentQueueTable,
  outboundWebhooksTable,
  portalWfRunsTable,
  portalWfOperatorTasksTable,
  aiUsageEventsTable,
  tenantCheckItemDetailsTable,
  simulatorCheckRunsTable,
  mspMessageCenterItemsTable,
  m365ServiceHealthSamplesTable,
  mspReportDefinitionsTable,
  mspReportRunsTable,
  mspSalesBundleAssignmentsTable,
  activitySubscriptionsTable,
  mspSowsTable,
  breakGlassPendingSecretsTable,
  breakGlassOverrideAuditTable,
  dashboardExecutiveSummariesTable,
  mspChangeRequestsTable,
  mspSopRunsTable,
  mspRiskDecisionsTable,
  tenantSignalHistoryTable,
  tenantEngineSnapshotsTable,
  engineScoreDailyRollupTable,
  policyRuleFiringsTable,
  policyRuleIncidentsTable,
  policyRuleSuppressionsTable,
  engineBaselineHistoryTable,
  platformLogStreamTable,
  exceptionOccurrencesTable,
  checkoutSessionsTable,
  type TenantConsentRecord,
} from "@workspace/db";
import type { PgTable } from "drizzle-orm/pg-core";
import { eq, asc, and, inArray, count, desc, or, isNotNull, sql, type SQL } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { revokeAllOtherSessions } from "../lib/session-tracking";
import { createAuditLog } from "../lib/audit";
import { adminResetMfa, isMfaMethod, MFA_METHODS } from "./mfa";
import { sendEmailFromTemplate, passwordResetEmail } from "../lib/mailer.ts";
import { getMspPortalBaseUrl, buildAccountSetupUrl } from "../lib/portal-url.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { mergeConsentKey, graphFetchForTenant } from "../lib/graph.ts";
import {
  buildMspTree,
  buildGroupNodes,
  searchDirectory,
  DIRECTORY_GROUP_ROLES,
  buildMspDetail,
  buildGroupDetail,
  filterGroupMembers,
  type DirectoryGroupRole,
  buildCustomerDetail,
  buildOuNodes,
  buildUserDetail,
  type UserMspLinkage,
  type CustomerConsentStatus,
  deriveEntitlements,
  planRoleChange,
  planAssignmentChange,
  buildUserEntitlementsView,
} from "../lib/active-directory";
import { resolveCustomerUserIds } from "../lib/tenant-signals";
import { userEntitlementOverridesTable } from "@workspace/db";

// Most recent N diagnostic runs shown in the Customer Object pane's summary —
// a run-history preview, not a full diagnostics browser (Issue #63 scope).
const RECENT_DIAGNOSTIC_RUN_LIMIT = 10;

const router: IRouter = Router();
const log = logger.child({ channel: "admin.active-directory" });
// Phase 8 credential/impersonation actions are core auth-surface events, so they
// log on the `auth` channel, and every one of them additionally writes an
// actor/target/timestamp line to the `audit` channel (Issue #68).
const authLog = logger.child({ channel: "auth" });
const auditLog = logger.child({ channel: "audit" });

// Matches /auth/forgot-password's RESET_TOKEN_TTL_MS and portal.ts's
// TEAM_RESET_TOKEN_TTL_MS — one shared reset-link lifetime across the platform.
const FORCED_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
// Matches /auth/forgot-password's no-password-set branch.
const ACCOUNT_SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
// Matches every existing impersonation-token issuer (portal.ts).
const IMPERSONATION_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── GET /admin/active-directory/tree ────────────────────────────────────────
// OU=MSPs (every real MSP, each with its real customers nested underneath) +
// Groups (one node per RBAC role, with a live count).
router.get("/admin/active-directory/tree", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [msps, customers, tenantUserRows, roleCountRows, ous] = await Promise.all([
      db
        .select({
          id: mspsTable.id,
          name: mspsTable.name,
          slug: mspsTable.slug,
          domain: mspsTable.domain,
          status: mspsTable.status,
        })
        .from(mspsTable)
        .orderBy(asc(mspsTable.name)),
      db
        .select({
          id: tenantsTable.id,
          mspId: tenantsTable.mspId,
          name: tenantsTable.customerName,
          domain: tenantsTable.domain,
          tenantId: tenantsTable.tenantId,
          status: tenantsTable.status,
        })
        .from(tenantsTable)
        .orderBy(asc(tenantsTable.customerName)),
      // Phase 10 (Issue #91): real Users nested under each Tenant node. Only
      // tenant-linked accounts (tenantId NOT NULL) belong in this tree shape —
      // MSP staff/PlatformAdmin have no tenant to nest under.
      db
        .select({
          id: usersTable.id,
          tenantId: usersTable.tenantId,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: usersTable.mspRole,
          isActive: usersTable.isActive,
        })
        .from(usersTable)
        .where(isNotNull(usersTable.tenantId))
        .orderBy(asc(usersTable.email)),
      db
        .select({ role: usersTable.mspRole, count: count() })
        .from(usersTable)
        .where(inArray(usersTable.mspRole, [...DIRECTORY_GROUP_ROLES]))
        .groupBy(usersTable.mspRole),
      db
        .select({
          id: activeDirectoryOusTable.id,
          name: activeDirectoryOusTable.name,
          tenantId: activeDirectoryOusTable.tenantId,
          createdAt: activeDirectoryOusTable.createdAt,
          updatedAt: activeDirectoryOusTable.updatedAt,
        })
        .from(activeDirectoryOusTable),
    ]);

    res.json({
      msps: buildMspTree(
        msps,
        customers,
        tenantUserRows.map((u) => ({ ...u, tenantId: u.tenantId as number })),
      ),
      groups: buildGroupNodes(roleCountRows.map((r) => ({ role: r.role, count: Number(r.count) }))),
      ous: buildOuNodes(ous),
    });
  } catch (err) {
    log.error({ err }, "Failed to build Active Directory tree");
    res.status(500).json({ error: "Failed to load Active Directory tree" });
  }
});

// ─── GET /admin/active-directory/search?q= ───────────────────────────────────
// Universal search: one query string, matched across MSP name/slug, customer
// name/domain/tenantId, user name/email, and RBAC role — from a single box.
router.get("/admin/active-directory/search", requireAdmin, async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!q.trim()) {
    res.json({ msps: [], customers: [], users: [], roles: [] });
    return;
  }

  try {
    const [msps, customers, userRows] = await Promise.all([
      db
        .select({
          id: mspsTable.id,
          name: mspsTable.name,
          slug: mspsTable.slug,
          domain: mspsTable.domain,
          status: mspsTable.status,
        })
        .from(mspsTable),
      db
        .select({
          id: tenantsTable.id,
          mspId: tenantsTable.mspId,
          name: tenantsTable.customerName,
          domain: tenantsTable.domain,
          tenantId: tenantsTable.tenantId,
          status: tenantsTable.status,
        })
        .from(tenantsTable),
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: usersTable.mspRole,
          mspId: usersTable.mspId,
          customerId: usersTable.tenantId,
        })
        .from(usersTable),
    ]);

    const mspNameById = new Map(msps.map((m) => [m.id, m.name]));
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

    const users = userRows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      mspRole: u.mspRole,
      mspId: u.mspId,
      mspName: u.mspId != null ? mspNameById.get(u.mspId) ?? null : null,
      customerId: u.customerId,
      customerName: u.customerId != null ? customerNameById.get(u.customerId) ?? null : null,
    }));

    res.json(searchDirectory(q, { msps, customers, users }));
  } catch (err) {
    log.error({ err }, "Active Directory search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

// ─── GET /admin/active-directory/msp/:id ─────────────────────────────────────
// MSP Object detail pane (Phase 2): profile, subscription/plan + dunning
// state, entitlements (derived from the subscription's Product Catalog tier,
// per msp-entitlement.ts's loadTier() — no separate entitlements table),
// linked customers, linked users with roles, and platform agreement
// acceptance status. Read-only — no MSP-level edit actions here.
router.get("/admin/active-directory/msp/:id", requireAdmin, async (req: Request, res: Response) => {
  const mspId = Number(req.params.id);
  if (!Number.isInteger(mspId)) {
    res.status(400).json({ error: "Invalid MSP id" });
    return;
  }

  try {
    const [mspRow] = await db
      .select({
        id: mspsTable.id,
        name: mspsTable.name,
        slug: mspsTable.slug,
        domain: mspsTable.domain,
        logoUrl: mspsTable.logoUrl,
        status: mspsTable.status,
        trialEndsAt: mspsTable.trialEndsAt,
        suspendedAt: mspsTable.suspendedAt,
        offboardingState: mspsTable.offboardingState,
        isDirectBusiness: mspsTable.isDirectBusiness,
        isTestbed: mspsTable.isTestbed,
        writeBackEnabled: mspsTable.writeBackEnabled,
        automatedCustomerEmailsEnabled: mspsTable.automatedCustomerEmailsEnabled,
        primaryContactName: mspsTable.primaryContactName,
        primaryContactEmail: mspsTable.primaryContactEmail,
        primaryContactPhone: mspsTable.primaryContactPhone,
        address: mspsTable.address,
        notes: mspsTable.notes,
        createdAt: mspsTable.createdAt,
      })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspId))
      .limit(1);

    if (!mspRow) {
      res.status(404).json({ error: "MSP not found" });
      return;
    }

    const [subRows, customers, userRows, agreementAcceptances, [currentAgreement]] = await Promise.all([
      db
        .select({
          status: mspSubscriptionsTable.status,
          tierName: servicesTable.name,
          billingInterval: mspSubscriptionsTable.billingInterval,
          currentPeriodStart: mspSubscriptionsTable.currentPeriodStart,
          currentPeriodEnd: mspSubscriptionsTable.currentPeriodEnd,
          dunningState: mspSubscriptionsTable.dunningState,
          paymentFailedAt: mspSubscriptionsTable.paymentFailedAt,
          tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
          contactEmail: mspSubscriptionsTable.contactEmail,
          typeAttributes: servicesTable.typeAttributes,
        })
        .from(mspSubscriptionsTable)
        .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
        .where(eq(mspSubscriptionsTable.mspId, mspId))
        .limit(1),
      db
        .select({
          id: tenantsTable.id,
          name: tenantsTable.customerName,
          domain: tenantsTable.domain,
          tenantId: tenantsTable.tenantId,
          status: tenantsTable.status,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.mspId, mspId))
        .orderBy(asc(tenantsTable.customerName)),
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: usersTable.mspRole,
          isActive: usersTable.isActive,
          lastLoginAt: usersTable.lastLoginAt,
        })
        .from(usersTable)
        .where(eq(usersTable.mspId, mspId))
        .orderBy(asc(usersTable.email)),
      db
        .select({
          agreementVersion: mspAgreementAcceptancesTable.agreementVersion,
          acceptedAt: mspAgreementAcceptancesTable.acceptedAt,
          checkboxConfirmed: mspAgreementAcceptancesTable.checkboxConfirmed,
        })
        .from(mspAgreementAcceptancesTable)
        .where(eq(mspAgreementAcceptancesTable.mspId, mspId))
        .orderBy(desc(mspAgreementAcceptancesTable.acceptedAt)),
      db
        .select({ version: platformAgreementsTable.version })
        .from(platformAgreementsTable)
        .where(eq(platformAgreementsTable.isCurrentVersion, true))
        .limit(1),
    ]);

    res.json(
      buildMspDetail({
        msp: mspRow,
        subscription: subRows[0] ?? null,
        customers,
        users: userRows,
        agreementAcceptances,
        currentAgreementVersion: currentAgreement?.version ?? null,
      }),
    );
  } catch (err) {
    log.error({ err, mspId }, "Failed to build MSP Object detail pane");
    res.status(500).json({ error: "Failed to load MSP detail" });
  }
});

// ─── GET /admin/active-directory/group/:role?q= ──────────────────────────────
// RBAC/Group Object detail pane (Phase 4): every real account holding a given
// role (source-of-truth column is usersTable.mspRole, same column Phase
// 1/2 already query against — no second role-lookup path), a live member
// count, and an optional server-side name/email search filter. Read-only —
// role reassignment is Phase 7.
router.get("/admin/active-directory/group/:role", requireAdmin, async (req: Request, res: Response) => {
  const role = req.params.role as DirectoryGroupRole;
  if (!DIRECTORY_GROUP_ROLES.includes(role)) {
    res.status(400).json({ error: "Invalid RBAC group role" });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q : "";

  try {
    const memberRows = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        mspId: usersTable.mspId,
        customerId: usersTable.tenantId,
        isActive: usersTable.isActive,
        lastLoginAt: usersTable.lastLoginAt,
      })
      .from(usersTable)
      .where(eq(usersTable.mspRole, role))
      .orderBy(asc(usersTable.email));

    const mspIds = [...new Set(memberRows.map((m) => m.mspId).filter((id): id is number => id != null))];
    const customerIds = [...new Set(memberRows.map((m) => m.customerId).filter((id): id is number => id != null))];

    const [mspRows, customerRows] = await Promise.all([
      mspIds.length
        ? db.select({ id: mspsTable.id, name: mspsTable.name }).from(mspsTable).where(inArray(mspsTable.id, mspIds))
        : Promise.resolve([]),
      customerIds.length
        ? db
            .select({ id: tenantsTable.id, name: tenantsTable.customerName })
            .from(tenantsTable)
            .where(inArray(tenantsTable.id, customerIds))
        : Promise.resolve([]),
    ]);

    const mspNameById = new Map(mspRows.map((m) => [m.id, m.name]));
    const customerNameById = new Map(customerRows.map((c) => [c.id, c.name]));

    const members = memberRows.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      mspId: m.mspId,
      mspName: m.mspId != null ? mspNameById.get(m.mspId) ?? null : null,
      customerId: m.customerId,
      customerName: m.customerId != null ? customerNameById.get(m.customerId) ?? null : null,
      isActive: m.isActive,
      lastLoginAt: m.lastLoginAt,
    }));

    res.json(buildGroupDetail(role, filterGroupMembers(q, members)));
  } catch (err) {
    log.error({ err, role }, "Failed to build RBAC Group detail pane");
    res.status(500).json({ error: "Failed to load Group detail" });
  }
});

// ─── GET /admin/active-directory/customer/:id ────────────────────────────────
// Customer Object detail pane (Phase 3): profile, owning MSP (id/name only —
// link-out via the tree's ad-select-object mechanism, no duplicated MSP
// detail render here), linked users with roles, Graph/SharePoint/write
// consent status, purchased services (client_services, reached via
// users.tenantId since client_services has no tenants FK of its own), and a
// summary of the most recent diagnostic runs. Read-only — no customer-level
// edit actions here (those live on the User Object phases).
//
// The three consent panes now read the three keys of the tenant's single
// `consent` jsonb column instead of three separate tables. The grants stay
// independent — an absent key means "never asked", which is why each pane
// still resolves to null rather than a synthesized "pending" record.
// Projects one key of tenants.consent into the flat consent-pane shape the
// Customer Object pane has always rendered. Returns null for an absent key
// (never asked) rather than fabricating a "pending" record — the three grants
// are independent and an absent key must not read as a real consent state.
// The jsonb stores ISO strings, so the timestamps are rehydrated to Dates here
// to keep CustomerConsentStatus's contract unchanged.
function consentPane(tenantGuid: string, record: TenantConsentRecord | undefined): CustomerConsentStatus | null {
  if (!record) return null;
  return {
    tenantId: tenantGuid,
    consentStatus: record.status,
    consentedAt: record.consentedAt ? new Date(record.consentedAt) : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
    adminEmail: record.adminEmail ?? null,
  };
}

router.get("/admin/active-directory/customer/:id", requireAdmin, async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId)) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }

  try {
    const [customerRow] = await db
      .select({
        id: tenantsTable.id,
        mspId: tenantsTable.mspId,
        name: tenantsTable.customerName,
        domain: tenantsTable.domain,
        industry: tenantsTable.industry,
        tenantId: tenantsTable.tenantId,
        tenantUrl: tenantsTable.tenantUrl,
        status: tenantsTable.status,
        isTestbed: tenantsTable.isTestbed,
        consent: tenantsTable.consent,
        createdAt: tenantsTable.createdAt,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId))
      .limit(1);

    if (!customerRow) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    // The raw consent blob feeds the three panes below; it is deliberately kept
    // out of the `customer` profile payload so the pane renders exactly one
    // representation of consent, not two.
    const { consent, ...customerProfile } = customerRow;

    const customerUserIds = await resolveCustomerUserIds(customerId);

    const [
      [owningMsp],
      userRows,
      purchasedServiceRows,
      diagnosticRunRows,
    ] = await Promise.all([
      db.select({ id: mspsTable.id, name: mspsTable.name, slug: mspsTable.slug }).from(mspsTable).where(eq(mspsTable.id, customerRow.mspId)).limit(1),
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: usersTable.mspRole,
          isActive: usersTable.isActive,
          lastLoginAt: usersTable.lastLoginAt,
        })
        .from(usersTable)
        .where(eq(usersTable.tenantId, customerId))
        .orderBy(asc(usersTable.email)),
      customerUserIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: clientServicesTable.id,
              serviceName: servicesTable.name,
              status: clientServicesTable.status,
              billingInterval: clientServicesTable.billingInterval,
              purchasedAt: clientServicesTable.purchasedAt,
            })
            .from(clientServicesTable)
            .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
            .where(inArray(clientServicesTable.clientUserId, customerUserIds))
            .orderBy(desc(clientServicesTable.purchasedAt)),
      db
        .select({
          runId: mspDiagnosticRunsTable.runId,
          packageKey: mspDiagnosticRunsTable.packageKey,
          status: mspDiagnosticRunsTable.status,
          startedAt: mspDiagnosticRunsTable.startedAt,
          completedAt: mspDiagnosticRunsTable.completedAt,
        })
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(RECENT_DIAGNOSTIC_RUN_LIMIT),
    ]);

    res.json(
      buildCustomerDetail({
        customer: customerProfile,
        owningMsp: owningMsp ?? null,
        users: userRows,
        graphConsent: consentPane(customerProfile.tenantId, consent.graph),
        sharePointConsent: consentPane(customerProfile.tenantId, consent.sharepoint),
        writeConsent: consentPane(customerProfile.tenantId, consent.writeBack),
        purchasedServices: purchasedServiceRows,
        recentDiagnosticRuns: diagnosticRunRows,
      }),
    );
  } catch (err) {
    log.error({ err, customerId }, "Failed to build Customer Object detail pane");
    res.status(500).json({ error: "Failed to load Customer detail" });
  }
});

// ─── GET /admin/active-directory/customer/:id/diagnostics/runs ───────────────
// #371 addendum — refresh button on the Customer Object pane's "Recent
// Diagnostic Runs" section. Same query as the runs slice of the full detail
// payload above, split out so the panel can re-fetch just this list without
// re-pulling the whole customer detail (profile, users, consent, services).
router.get("/admin/active-directory/customer/:id/diagnostics/runs", requireAdmin, async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId)) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }

  try {
    const diagnosticRunRows = await db
      .select({
        runId: mspDiagnosticRunsTable.runId,
        packageKey: mspDiagnosticRunsTable.packageKey,
        status: mspDiagnosticRunsTable.status,
        startedAt: mspDiagnosticRunsTable.startedAt,
        completedAt: mspDiagnosticRunsTable.completedAt,
      })
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.customerId, customerId))
      .orderBy(desc(mspDiagnosticRunsTable.createdAt))
      .limit(RECENT_DIAGNOSTIC_RUN_LIMIT);

    res.json({ recentDiagnosticRuns: diagnosticRunRows });
  } catch (err) {
    log.error({ err, customerId }, "Failed to refresh recent diagnostic runs");
    res.status(500).json({ error: "Failed to load recent diagnostic runs" });
  }
});

// ─── GET /admin/active-directory/user/:id ────────────────────────────────────
// User Object detail pane (Phase 6): full profile (users), current role +
// MSP/customer linkage (users.mspRole — the real role source of truth,
// NOT users.role which is only ["admin","client"]), entitlements inherited
// from the linked MSP's subscription tier (reuses Phase 2's
// deriveEntitlements() — no per-user entitlements table exists), active
// session summary, and MFA enrollment status. Read-only — RBAC/MSP
// reassignment, entitlement grant/revoke, credential ops, impersonation, and
// delete are Phases 7/8/9 and are NOT built here.
router.get("/admin/active-directory/user/:id", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    // One row now carries both the base profile and the RBAC/MSP/tenant
    // linkage — the msp_users join this route used to do is gone.
    const [userRow] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        company: usersTable.company,
        phone: usersTable.phone,
        baseRole: usersTable.role,
        createdAt: usersTable.createdAt,
        mspId: usersTable.mspId,
        tenantId: usersTable.tenantId,
        mspRole: usersTable.mspRole,
        isActive: usersTable.isActive,
        mfaEnforced: usersTable.mfaEnforced,
        department: usersTable.department,
        jobTitle: usersTable.jobTitle,
        lastLoginAt: usersTable.lastLoginAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!userRow) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // The `profile` half of the payload keeps exactly the fields it always
    // had — the linkage columns fetched alongside it are rendered by the
    // linkage pane below, not duplicated into the profile block.
    const profile = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      company: userRow.company,
      phone: userRow.phone,
      baseRole: userRow.baseRole,
      createdAt: userRow.createdAt,
    };

    // The linkage is no longer a second row to fetch — it lives on the users
    // row already loaded above. It is still modelled as a nullable value so
    // buildUserDetail()'s "no linkage" branch keeps its meaning: an account
    // with neither an MSP nor a tenant (a bare PlatformAdmin) renders the same
    // honest-empty linkage pane it always did.
    const mspUserRow =
      userRow.mspId == null && userRow.tenantId == null
        ? null
        : {
            mspId: userRow.mspId,
            customerId: userRow.tenantId,
            mspRole: userRow.mspRole,
            isActive: userRow.isActive,
            mfaEnforced: userRow.mfaEnforced,
            department: userRow.department,
            jobTitle: userRow.jobTitle,
            lastLoginAt: userRow.lastLoginAt,
          };

    const [[mspRow], [customerRow], subRows, sessionRows, mfaRows] = await Promise.all([
      mspUserRow?.mspId != null
        ? db.select({ id: mspsTable.id, name: mspsTable.name, slug: mspsTable.slug }).from(mspsTable).where(eq(mspsTable.id, mspUserRow.mspId)).limit(1)
        : Promise.resolve([]),
      mspUserRow?.customerId != null
        ? db
            .select({ id: tenantsTable.id, name: tenantsTable.customerName })
            .from(tenantsTable)
            .where(eq(tenantsTable.id, mspUserRow.customerId))
            .limit(1)
        : Promise.resolve([]),
      mspUserRow?.mspId != null
        ? db
            .select({
              status: mspSubscriptionsTable.status,
              tierName: servicesTable.name,
              billingInterval: mspSubscriptionsTable.billingInterval,
              currentPeriodStart: mspSubscriptionsTable.currentPeriodStart,
              currentPeriodEnd: mspSubscriptionsTable.currentPeriodEnd,
              dunningState: mspSubscriptionsTable.dunningState,
              paymentFailedAt: mspSubscriptionsTable.paymentFailedAt,
              tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
              contactEmail: mspSubscriptionsTable.contactEmail,
              typeAttributes: servicesTable.typeAttributes,
            })
            .from(mspSubscriptionsTable)
            .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
            .where(eq(mspSubscriptionsTable.mspId, mspUserRow.mspId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          sessionType: userSessionsTable.sessionType,
          loginMethod: userSessionsTable.loginMethod,
          ipAddress: userSessionsTable.ipAddress,
          userAgent: userSessionsTable.userAgent,
          createdAt: userSessionsTable.createdAt,
          lastActiveAt: userSessionsTable.lastActiveAt,
          expiresAt: userSessionsTable.expiresAt,
          revokedAt: userSessionsTable.revokedAt,
        })
        .from(userSessionsTable)
        .where(eq(userSessionsTable.userId, userId)),
      db
        .select({ method: mfaEnrollmentsTable.method, createdAt: mfaEnrollmentsTable.createdAt })
        .from(mfaEnrollmentsTable)
        .where(and(eq(mfaEnrollmentsTable.userId, userId), eq(mfaEnrollmentsTable.enabled, true))),
    ]);

    const linkage: UserMspLinkage | null = mspUserRow
      ? {
          mspId: mspUserRow.mspId,
          mspName: mspRow?.name ?? null,
          mspSlug: mspRow?.slug ?? null,
          customerId: mspUserRow.customerId,
          customerName: customerRow?.name ?? null,
          mspRole: mspUserRow.mspRole as DirectoryGroupRole,
          isActive: mspUserRow.isActive,
          mfaEnforced: mspUserRow.mfaEnforced,
          department: mspUserRow.department,
          jobTitle: mspUserRow.jobTitle,
          lastLoginAt: mspUserRow.lastLoginAt,
        }
      : null;

    res.json(
      buildUserDetail({
        profile,
        linkage,
        subscriptionForEntitlements: subRows[0] ?? null,
        sessions: sessionRows,
        mfaEnrollments: mfaRows,
        now: new Date(),
      }),
    );
  } catch (err) {
    log.error({ err, userId }, "Failed to build User Object detail pane");
    res.status(500).json({ error: "Failed to load User detail" });
  }
});

// ─── User Object write actions (Phase 7, Issue #67) ──────────────────────────
// RBAC role change, MSP/customer reassignment, and entitlement grant/revoke.
// All three mutate users (or the user_entitlement_overrides table) and
// additionally emit to the platform-wide `audit` channel via createAuditLog()
// — the same cross-subsystem audit convention graph.ts/data-rights.ts already
// use, as distinct from the MSP-self-service-scoped mspAuditLogsTable/
// writeAuditLog() pattern in msp-settings.ts (always scoped to one
// req.user.mspId, which doesn't fit a PlatformAdmin acting across any MSP).

function auditActor(req: Request): { actorUserId: number; actorName: string; actorRole: "admin" | "client" } {
  const user = req.user!;
  return { actorUserId: user.id, actorName: user.name ?? user.email, actorRole: user.role };
}

// PATCH /admin/active-directory/user/:id/role
// Body: { mspRole: DirectoryGroupRole }. Validated against the account's
// CURRENT mspId/tenantId via planRoleChange() (lib/active-directory.ts) —
// see that function's header comment for the linkage rule, which as of the
// Tenant/User Refactor mirrors the real `users_role_scope_check` CHECK
// constraint. Takes effect on the account's next JWT refresh: auth.ts's
// getMspClaims() already reads the users row live at every token mint, so no
// token-side change is needed here.
router.patch("/admin/active-directory/user/:id/role", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const newRole = req.body?.mspRole;
  if (typeof newRole !== "string" || !DIRECTORY_GROUP_ROLES.includes(newRole as DirectoryGroupRole)) {
    res.status(400).json({ error: `mspRole must be one of: ${DIRECTORY_GROUP_ROLES.join(", ")}` });
    return;
  }

  try {
    const [current] = await db
      .select({ mspRole: usersTable.mspRole, mspId: usersTable.mspId, customerId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const plan = planRoleChange({
      newRole: newRole as DirectoryGroupRole,
      currentMspId: current.mspId,
      currentCustomerId: current.customerId,
    });
    if (!plan.ok) {
      res.status(400).json({ error: plan.error });
      return;
    }

    await db
      .update(usersTable)
      .set({ mspRole: plan.mspRole, mspId: plan.mspId, tenantId: plan.customerId, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));

    await createAuditLog({
      ...auditActor(req),
      actionType: "user.role.update",
      entityType: "user",
      entityId: userId,
      metadata: {
        before: { mspRole: current.mspRole, mspId: current.mspId, customerId: current.customerId },
        after: { mspRole: plan.mspRole, mspId: plan.mspId, customerId: plan.customerId },
      },
    });
    log.info({ userId, mspRole: plan.mspRole }, "PlatformAdmin changed an account's role");

    res.json({ ok: true, mspRole: plan.mspRole, mspId: plan.mspId, customerId: plan.customerId });
  } catch (err) {
    log.error({ err, userId }, "Failed to update user role");
    res.status(500).json({ error: "Failed to update role" });
  }
});

// PATCH /admin/active-directory/user/:id/assignment
// Body: { mspId: number } for an MSP-scoped role, or { customerId: number }
// for CustomerUser — never both. Reassigning a CustomerUser always derives
// mspId server-side from the target customer's real owning MSP (never
// client-supplied), per planAssignmentChange()'s header comment.
router.patch("/admin/active-directory/user/:id/assignment", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const bodyMspId = req.body?.mspId;
  const bodyCustomerId = req.body?.customerId;
  if (bodyMspId != null && !Number.isInteger(bodyMspId)) {
    res.status(400).json({ error: "mspId must be an integer" });
    return;
  }
  if (bodyCustomerId != null && !Number.isInteger(bodyCustomerId)) {
    res.status(400).json({ error: "customerId must be an integer" });
    return;
  }

  try {
    const [current] = await db
      .select({ mspRole: usersTable.mspRole, mspId: usersTable.mspId, customerId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let customerOwningMspId: number | null = null;
    if (bodyCustomerId != null) {
      const [targetCustomer] = await db
        .select({ mspId: tenantsTable.mspId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, bodyCustomerId))
        .limit(1);
      if (!targetCustomer) {
        res.status(404).json({ error: "Target customer not found" });
        return;
      }
      customerOwningMspId = targetCustomer.mspId;
    }
    if (bodyMspId != null) {
      const [targetMsp] = await db.select({ id: mspsTable.id }).from(mspsTable).where(eq(mspsTable.id, bodyMspId)).limit(1);
      if (!targetMsp) {
        res.status(404).json({ error: "Target MSP not found" });
        return;
      }
    }

    const plan = planAssignmentChange({
      currentRole: current.mspRole as DirectoryGroupRole,
      target: { mspId: bodyMspId, customerId: bodyCustomerId },
      customerOwningMspId,
    });
    if (!plan.ok) {
      res.status(400).json({ error: plan.error });
      return;
    }

    await db
      .update(usersTable)
      .set({ mspId: plan.mspId, tenantId: plan.customerId, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));

    await createAuditLog({
      ...auditActor(req),
      actionType: "user.assignment.update",
      entityType: "user",
      entityId: userId,
      metadata: {
        before: { mspId: current.mspId, customerId: current.customerId },
        after: { mspId: plan.mspId, customerId: plan.customerId },
      },
    });
    log.info({ userId, mspId: plan.mspId, customerId: plan.customerId }, "PlatformAdmin reassigned an account's MSP/customer linkage");

    res.json({ ok: true, mspId: plan.mspId, customerId: plan.customerId });
  } catch (err) {
    log.error({ err, userId }, "Failed to update user assignment");
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

// Shared by GET/PATCH .../entitlements — the same inherited-tier + override
// merge Phase 6's buildUserDetail() already performs, exposed standalone so
// the Account Control entitlements UI can view/act on it directly.
async function loadUserEntitlementsView(userId: number) {
  const [mspUserRow] = await db
    .select({ mspId: usersTable.mspId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const [subRows, overrideRows] = await Promise.all([
    mspUserRow?.mspId != null
      ? db
          .select({
            status: mspSubscriptionsTable.status,
            tierName: servicesTable.name,
            billingInterval: mspSubscriptionsTable.billingInterval,
            currentPeriodStart: mspSubscriptionsTable.currentPeriodStart,
            currentPeriodEnd: mspSubscriptionsTable.currentPeriodEnd,
            dunningState: mspSubscriptionsTable.dunningState,
            paymentFailedAt: mspSubscriptionsTable.paymentFailedAt,
            tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
            contactEmail: mspSubscriptionsTable.contactEmail,
            typeAttributes: servicesTable.typeAttributes,
          })
          .from(mspSubscriptionsTable)
          .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
          .where(eq(mspSubscriptionsTable.mspId, mspUserRow.mspId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        capabilityKey: userEntitlementOverridesTable.capabilityKey,
        enabled: userEntitlementOverridesTable.enabled,
        grantedByUserId: userEntitlementOverridesTable.grantedByUserId,
        createdAt: userEntitlementOverridesTable.createdAt,
        updatedAt: userEntitlementOverridesTable.updatedAt,
      })
      .from(userEntitlementOverridesTable)
      .where(eq(userEntitlementOverridesTable.userId, userId)),
  ]);

  return buildUserEntitlementsView(deriveEntitlements(subRows[0] ?? null), overrideRows);
}

// GET /admin/active-directory/user/:id/entitlements
// View the account's inherited (tier-derived), overridden, and effective
// entitlements — same deriveEntitlements() Phase 2/6 already use, merged with
// any user_entitlement_overrides rows via buildUserEntitlementsView().
router.get("/admin/active-directory/user/:id/entitlements", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    res.json(await loadUserEntitlementsView(userId));
  } catch (err) {
    log.error({ err, userId }, "Failed to load user entitlements");
    res.status(500).json({ error: "Failed to load entitlements" });
  }
});

// PATCH /admin/active-directory/user/:id/entitlements
// Body: { capabilityKey: string, enabled: boolean | null }. enabled=null
// clears the override (reverts that key to its tier-inherited value);
// enabled=true/false grants/revokes it. Upserts on the
// (userId, capabilityKey) unique index.
router.patch("/admin/active-directory/user/:id/entitlements", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const capabilityKey = req.body?.capabilityKey;
  if (typeof capabilityKey !== "string" || !capabilityKey.trim()) {
    res.status(400).json({ error: "capabilityKey is required" });
    return;
  }
  const enabled = req.body?.enabled;
  if (enabled !== null && typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be true, false, or null (null clears the override)" });
    return;
  }

  try {
    const [before] = await db
      .select({ enabled: userEntitlementOverridesTable.enabled })
      .from(userEntitlementOverridesTable)
      .where(and(eq(userEntitlementOverridesTable.userId, userId), eq(userEntitlementOverridesTable.capabilityKey, capabilityKey)))
      .limit(1);

    if (enabled === null) {
      await db
        .delete(userEntitlementOverridesTable)
        .where(and(eq(userEntitlementOverridesTable.userId, userId), eq(userEntitlementOverridesTable.capabilityKey, capabilityKey)));
    } else {
      await db
        .insert(userEntitlementOverridesTable)
        .values({ userId, capabilityKey, enabled, grantedByUserId: req.user!.id })
        .onConflictDoUpdate({
          target: [userEntitlementOverridesTable.userId, userEntitlementOverridesTable.capabilityKey],
          set: { enabled, grantedByUserId: req.user!.id, updatedAt: new Date() },
        });
    }

    await createAuditLog({
      ...auditActor(req),
      actionType: enabled === null ? "user.entitlement.clear" : enabled ? "user.entitlement.grant" : "user.entitlement.revoke",
      entityType: "msp_user",
      entityId: userId,
      metadata: { capabilityKey, before: before?.enabled ?? null, after: enabled },
    });
    log.info({ userId, capabilityKey, enabled }, "PlatformAdmin changed a user entitlement override");

    res.json(await loadUserEntitlementsView(userId));
  } catch (err) {
    log.error({ err, userId, capabilityKey }, "Failed to update user entitlement");
    res.status(500).json({ error: "Failed to update entitlement" });
  }
});

// ─── OU CRUD (Phase 5) ────────────────────────────────────────────────────────
// Organizational Unit placeholder objects — create/list/rename/delete a
// container node only. No policy logic, no object-to-OU membership model.

// `tenantId` (#1549): optional, nullable — which real customer tenant this OU
// governs. Validated against a real tenants row when provided; never a bare
// pass-through int, and never required (a platform/MSP-level OU has none).
async function resolveOuTenantId(body: unknown): Promise<{ ok: true; tenantId: number | null } | { ok: false; error: string }> {
  const raw = (body as Record<string, unknown> | null | undefined)?.tenantId;
  if (raw === undefined || raw === null) return { ok: true, tenantId: null };
  const tenantId = Number(raw);
  if (!Number.isInteger(tenantId)) return { ok: false, error: "tenantId must be an integer" };
  const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  if (!tenant) return { ok: false, error: `Tenant '${tenantId}' does not exist` };
  return { ok: true, tenantId };
}

router.post("/admin/active-directory/ou", requireAdmin, async (req: Request, res: Response) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "OU name is required" });
    return;
  }
  const tenantResolution = await resolveOuTenantId(req.body);
  if (!tenantResolution.ok) {
    res.status(400).json({ error: tenantResolution.error });
    return;
  }

  try {
    const [created] = await db.insert(activeDirectoryOusTable).values({ name, tenantId: tenantResolution.tenantId }).returning();
    res.status(201).json(created);
  } catch (err) {
    log.error({ err }, "Failed to create OU");
    res.status(500).json({ error: "Failed to create OU" });
  }
});

router.patch("/admin/active-directory/ou/:id", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }
  if (!name) {
    res.status(400).json({ error: "OU name is required" });
    return;
  }
  // tenantId is only touched when the caller explicitly sends the key — omitting
  // it entirely leaves the OU's existing tenant attachment untouched on a rename.
  const bodyHasTenantId = req.body != null && Object.prototype.hasOwnProperty.call(req.body, "tenantId");
  let tenantId: number | null | undefined;
  if (bodyHasTenantId) {
    const tenantResolution = await resolveOuTenantId(req.body);
    if (!tenantResolution.ok) {
      res.status(400).json({ error: tenantResolution.error });
      return;
    }
    tenantId = tenantResolution.tenantId;
  }

  try {
    const [updated] = await db
      .update(activeDirectoryOusTable)
      .set({ name, ...(bodyHasTenantId ? { tenantId } : {}), updatedAt: new Date() })
      .where(eq(activeDirectoryOusTable.id, ouId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "OU not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    log.error({ err, ouId }, "Failed to rename OU");
    res.status(500).json({ error: "Failed to rename OU" });
  }
});

router.delete("/admin/active-directory/ou/:id", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }

  try {
    const [deleted] = await db.delete(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, ouId)).returning();
    if (!deleted) {
      res.status(404).json({ error: "OU not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    log.error({ err, ouId }, "Failed to delete OU");
    res.status(500).json({ error: "Failed to delete OU" });
  }
});

// ─── OU manual membership assignment (Git #1952) ─────────────────────────────
// Shane's final decision on #1952: department-match (policy-compliance-graph.ts)
// stays the automatic OU-membership resolution, but a real Graph object can be
// EXPLICITLY assigned to an OU, taking precedence over that guess — most tenants
// don't populate `department` at all, and where set it's often stale. Same
// requireAdmin (PlatformAdmin-only) gate as the OU CRUD above; if this needs to
// become customer-self-service instead, that is a follow-up decision, not one
// this build makes silently — see the finding filed alongside this build.
//
// The assigned object is always verified against the real Graph tenant at
// assign time (never trusted from client input alone) — this is what makes the
// row real rather than an invented membership claim.

// Exported (Git #2148) so msp-active-directory.ts's MSP-staff-gated mirror of
// this same CRUD can reuse the identical tenant-resolution and Graph
// verification logic rather than duplicating it — the routes differ only in
// their auth gate and staff-scoping, never in how a customer or object is
// resolved and verified.
export async function resolveAssignmentCustomer(customerId: unknown): Promise<
  | { ok: true; customerId: number; mspId: number; graphTenantId: string }
  | { ok: false; error: string }
> {
  const id = Number(customerId);
  if (!Number.isInteger(id)) return { ok: false, error: "customerId must be an integer" };
  const [tenant] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id))
    .limit(1);
  if (!tenant) return { ok: false, error: `Customer '${id}' does not exist` };
  return { ok: true, customerId: tenant.id, mspId: tenant.mspId, graphTenantId: tenant.tenantId };
}

/** Real Graph user lookup by UPN — the verification step that keeps an assignment real. */
export async function resolveGraphUserByUpn(graphTenantId: string, upn: string): Promise<
  | { ok: true; id: string; userPrincipalName: string; displayName: string | null }
  | { ok: false; error: string }
> {
  const res = await graphFetchForTenant(
    graphTenantId,
    `/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName,displayName`,
  );
  if (res.status === 404) {
    return { ok: false, error: `No Graph user found for '${upn}' on this tenant` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Graph lookup failed (${res.status}): ${text.slice(0, 300)}` };
  }
  const body = (await res.json()) as { id: string; userPrincipalName: string; displayName: string | null };
  return { ok: true, id: body.id, userPrincipalName: body.userPrincipalName, displayName: body.displayName ?? null };
}

// GET /admin/active-directory/ou/:id/assignments
// List every real manual assignment currently pointed at this OU.
router.get("/admin/active-directory/ou/:id/assignments", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(activeDirectoryOuAssignmentsTable)
      .where(eq(activeDirectoryOuAssignmentsTable.ouId, ouId))
      .orderBy(asc(activeDirectoryOuAssignmentsTable.objectUpn));
    res.json(rows);
  } catch (err) {
    log.error({ err, ouId }, "Failed to load OU assignments");
    res.status(500).json({ error: "Failed to load OU assignments" });
  }
});

// POST /admin/active-directory/ou/:id/assignments
// Body: { customerId: number, objectUpn: string }. Upserts on (customerId,
// objectId) — re-assigning an already-assigned object moves it to this OU
// rather than creating a second row, matching real AD's one-object-one-OU shape.
router.post("/admin/active-directory/ou/:id/assignments", requireAdmin, async (req: Request, res: Response) => {
  const ouId = Number(req.params.id);
  if (!Number.isInteger(ouId)) {
    res.status(400).json({ error: "Invalid OU id" });
    return;
  }
  const objectUpn = typeof req.body?.objectUpn === "string" ? req.body.objectUpn.trim() : "";
  if (!objectUpn) {
    res.status(400).json({ error: "objectUpn is required" });
    return;
  }

  const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, ouId)).limit(1);
  if (!ou) {
    res.status(404).json({ error: "OU not found" });
    return;
  }

  const customerResolution = await resolveAssignmentCustomer(req.body?.customerId);
  if (!customerResolution.ok) {
    res.status(400).json({ error: customerResolution.error });
    return;
  }
  const { customerId, mspId, graphTenantId } = customerResolution;

  // A customer-scoped OU (tenantId set) only accepts objects from that same
  // customer. A platform/MSP-level OU (tenantId null) accepts any customer,
  // matching how the department-match guess already applies across an MSP's
  // whole tenant roster.
  if (ou.tenantId !== null && ou.tenantId !== customerId) {
    res.status(400).json({ error: `OU '${ou.name}' belongs to a different customer than '${customerId}'` });
    return;
  }

  const graphUser = await resolveGraphUserByUpn(graphTenantId, objectUpn);
  if (!graphUser.ok) {
    res.status(400).json({ error: graphUser.error });
    return;
  }

  try {
    const [assignment] = await db
      .insert(activeDirectoryOuAssignmentsTable)
      .values({
        mspId,
        ouId,
        customerId,
        tenantId: graphTenantId,
        objectId: graphUser.id,
        objectUpn: graphUser.userPrincipalName,
        objectDisplayName: graphUser.displayName,
        assignedByUserId: req.user!.id,
      })
      .onConflictDoUpdate({
        target: [activeDirectoryOuAssignmentsTable.customerId, activeDirectoryOuAssignmentsTable.objectId],
        set: {
          ouId,
          objectUpn: graphUser.userPrincipalName,
          objectDisplayName: graphUser.displayName,
          assignedByUserId: req.user!.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    await createAuditLog({
      ...auditActor(req),
      actionType: "active_directory.ou_assignment.set",
      entityType: "active_directory_ou",
      entityId: ouId,
      metadata: { customerId, objectId: graphUser.id, objectUpn: graphUser.userPrincipalName, ouName: ou.name },
    });
    log.info({ ouId, customerId, objectId: graphUser.id }, "PlatformAdmin manually assigned an object to an OU");

    res.status(201).json(assignment);
  } catch (err) {
    log.error({ err, ouId, customerId }, "Failed to assign object to OU");
    res.status(500).json({ error: "Failed to assign object to OU" });
  }
});

// PATCH /admin/active-directory/ou-assignments/:id
// Body: { ouId: number }. Moves an existing manual assignment to a different OU.
router.patch("/admin/active-directory/ou-assignments/:id", requireAdmin, async (req: Request, res: Response) => {
  const assignmentId = Number(req.params.id);
  const newOuId = Number(req.body?.ouId);
  if (!Number.isInteger(assignmentId)) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  if (!Number.isInteger(newOuId)) {
    res.status(400).json({ error: "ouId is required" });
    return;
  }

  const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, newOuId)).limit(1);
  if (!ou) {
    res.status(400).json({ error: `OU '${newOuId}' does not exist` });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(activeDirectoryOuAssignmentsTable)
      .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    if (ou.tenantId !== null && ou.tenantId !== existing.customerId) {
      res.status(400).json({ error: `OU '${ou.name}' belongs to a different customer than this assignment's` });
      return;
    }

    const [updated] = await db
      .update(activeDirectoryOuAssignmentsTable)
      .set({ ouId: newOuId, updatedAt: new Date() })
      .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
      .returning();

    await createAuditLog({
      ...auditActor(req),
      actionType: "active_directory.ou_assignment.move",
      entityType: "active_directory_ou",
      entityId: newOuId,
      metadata: { assignmentId, fromOuId: existing.ouId, toOuId: newOuId, objectId: existing.objectId },
    });
    log.info({ assignmentId, fromOuId: existing.ouId, toOuId: newOuId }, "PlatformAdmin moved a manual OU assignment");

    res.json(updated);
  } catch (err) {
    log.error({ err, assignmentId, newOuId }, "Failed to move OU assignment");
    res.status(500).json({ error: "Failed to move OU assignment" });
  }
});

// DELETE /admin/active-directory/ou-assignments/:id
// Removes the manual override — the object reverts to the department-match guess.
router.delete("/admin/active-directory/ou-assignments/:id", requireAdmin, async (req: Request, res: Response) => {
  const assignmentId = Number(req.params.id);
  if (!Number.isInteger(assignmentId)) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(activeDirectoryOuAssignmentsTable)
      .where(eq(activeDirectoryOuAssignmentsTable.id, assignmentId))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    await createAuditLog({
      ...auditActor(req),
      actionType: "active_directory.ou_assignment.clear",
      entityType: "active_directory_ou",
      entityId: deleted.ouId,
      metadata: { assignmentId, objectId: deleted.objectId, customerId: deleted.customerId },
    });
    log.info({ assignmentId, ouId: deleted.ouId }, "PlatformAdmin cleared a manual OU assignment");

    res.status(204).send();
  } catch (err) {
    log.error({ err, assignmentId }, "Failed to delete OU assignment");
    res.status(500).json({ error: "Failed to delete OU assignment" });
  }
});

// ─── User Object credential ops + impersonation (Phase 8, Issue #68) ─────────
// The second tier of User Object write actions. Every one of the three is a
// thin, audited admin-gated entry point onto a mechanism that already exists:
//
//   force-password-reset → passwordResetTokensTable + the "password-reset"
//       e-mail template (the same flow /auth/forgot-password and
//       /portal/team/:userId/reset-password already run), plus
//       revokeAllOtherSessions(userId, null) — the codebase's established
//       session-invalidation convention (lib/session-tracking.ts; the same
//       call /portal/team/:userId/sessions makes to force-logout an account).
//   mfa-reset            → mfa.ts's adminResetMfa(), which is built from the
//       very per-method un-enrollment logic its self-service DELETE routes run.
//   impersonate          → an impersonation_tokens row consumed by the
//       pre-existing, already-generic POST /auth/impersonate-exchange. No
//       second impersonation system is introduced: the exchange endpoint
//       derives the target's full MSP claims itself, opens a
//       sessionType="impersonation" user_sessions row, stamps `impersonatedBy`
//       into the JWT, and audit-logs IMPERSONATION_SESSION_STARTED — which is
//       also what makes the resulting /portal/ session visibly distinct (the
//       amber "Admin Preview Mode" ImpersonationBanner renders off
//       user.impersonatedBy in msp-portal's app-shell).

/** Shared 404-or-row lookup for the three Phase 8 write routes. */
async function loadTargetAccount(userId: number) {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      passwordHash: usersTable.passwordHash,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row ?? null;
}

// ─── POST /admin/active-directory/user/:id/force-password-reset ──────────────
// Forces the account through a password reset and immediately invalidates its
// existing sessions. Accounts that have never set a password (passwordHash
// null) get the account-setup link instead of a reset link — the same branch
// /auth/forgot-password already takes, so an admin never hands out a reset URL
// that the target's account state cannot consume.
router.post("/admin/active-directory/user/:id/force-password-reset", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const target = await loadTargetAccount(userId);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const actor = req.user!;

    // Session invalidation FIRST: even if the e-mail transport is down, the
    // account has already lost every live session and refresh token.
    const revokedSessionCount = await revokeAllOtherSessions(userId, null);

    const token = randomBytes(32).toString("hex");
    const hasPassword = !!target.passwordHash;
    const flow = hasPassword ? "password_reset" : "account_setup";

    if (hasPassword) {
      await db.insert(passwordResetTokensTable).values({
        userId,
        token,
        expiresAt: new Date(Date.now() + FORCED_RESET_TOKEN_TTL_MS),
      });
      const resetUrl = `${getMspPortalBaseUrl()}/reset-password?token=${token}`;
      void sendEmailFromTemplate(
        "password-reset",
        target.email,
        { resetLink: resetUrl },
        "Reset your Shane McCaw Consulting portal password",
        passwordResetEmail({ resetUrl }),
      ).catch((err) => authLog.warn({ err, userId }, "force-password-reset: reset email failed (non-fatal)"));
    } else {
      await db.insert(accountSetupTokensTable).values({
        userId,
        token,
        expiresAt: new Date(Date.now() + ACCOUNT_SETUP_TOKEN_TTL_MS),
      });
      const setupUrl = buildAccountSetupUrl(token);
      void sendEmailFromTemplate(
        "account-setup",
        target.email,
        { setupLink: setupUrl, clientName: target.name ?? target.email },
        "Set up your Shane McCaw Consulting portal password",
        `<p>Hi ${target.name ?? ""},</p><p>Click the link below to set your portal password:</p><p><a href="${setupUrl}">Set my password →</a></p><p>This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
      ).catch((err) => authLog.warn({ err, userId }, "force-password-reset: setup email failed (non-fatal)"));
    }

    void createAuditLog({
      actorUserId: actor.id,
      actorName: actor.name ?? actor.email,
      actorRole: "admin",
      actionType: "admin_forced_password_reset",
      entityType: "user",
      entityId: target.id,
      entityLabel: target.name ?? target.email,
      metadata: { flow, revokedSessionCount, source: "admin.active-directory" },
    });

    auditLog.info(
      {
        actionType: "admin_forced_password_reset",
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetUserId: target.id,
        targetEmail: target.email,
        flow,
        revokedSessionCount,
        occurredAt: new Date().toISOString(),
      },
      "audit: PlatformAdmin forced a password reset",
    );

    authLog.info({ actorUserId: actor.id, targetUserId: target.id, flow, revokedSessionCount }, "force-password-reset applied");

    res.json({ ok: true, flow, revokedSessionCount, emailedTo: target.email });
  } catch (err) {
    log.error({ err, userId }, "Failed to force password reset");
    res.status(500).json({ error: "Failed to force a password reset" });
  }
});

// ─── POST /admin/active-directory/user/:id/mfa-reset ─────────────────────────
// Resets/un-enrolls the account's MFA. Body may carry { method } to clear a
// single method; omitting it clears every method. All of the real work — the
// per-method un-enrollment, the notification e-mail, and the audit trail —
// lives in mfa.ts's adminResetMfa(), shared with its self-service routes.
router.post("/admin/active-directory/user/:id/mfa-reset", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const rawMethod = (req.body as { method?: unknown } | undefined)?.method;
  if (rawMethod !== undefined && !isMfaMethod(rawMethod)) {
    res.status(400).json({ error: `method must be one of: ${MFA_METHODS.join(", ")}` });
    return;
  }

  try {
    const actor = req.user!;
    const result = await adminResetMfa({
      userId,
      method: rawMethod,
      actor: { id: actor.id, email: actor.email, name: actor.name },
      source: "admin.active-directory",
    });
    if (!result) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true, clearedMethods: result.clearedMethods, emailedTo: result.targetEmail });
  } catch (err) {
    log.error({ err, userId }, "Failed to reset MFA");
    res.status(500).json({ error: "Failed to reset MFA" });
  }
});

// ─── POST /admin/active-directory/user/:id/impersonate ───────────────────────
// Issues a single-use, 30-minute impersonation token for the target account,
// consumed by the pre-existing POST /auth/impersonate-exchange. The response
// carries the target's owning-MSP slug because msp-portal's auth-context needs
// `target_slug` alongside the token to land the new tab on the correct
// tenant's URL (without it it can only warn and stay put).
//
// Two guards that the older, narrower issuers did not need:
//   • self-impersonation is refused (a no-op session that only muddies audit);
//   • impersonating another PlatformAdmin is refused — that is lateral admin
//     access, not the customer/MSP preview this mechanism exists for.
router.post("/admin/active-directory/user/:id/impersonate", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const actor = req.user!;
    if (userId === actor.id) {
      res.status(400).json({ error: "You cannot impersonate your own account" });
      return;
    }

    const target = await loadTargetAccount(userId);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [linkage] = await db
      .select({
        mspId: usersTable.mspId,
        customerId: usersTable.tenantId,
        mspRole: usersTable.mspRole,
        isActive: usersTable.isActive,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (linkage?.mspRole === "PlatformAdmin") {
      authLog.warn({ actorUserId: actor.id, targetUserId: userId }, "impersonate: refused PlatformAdmin target");
      res.status(403).json({ error: "PlatformAdmin accounts cannot be impersonated" });
      return;
    }

    const [msp] = linkage?.mspId != null
      ? await db.select({ slug: mspsTable.slug, name: mspsTable.name }).from(mspsTable).where(eq(mspsTable.id, linkage.mspId)).limit(1)
      : [];

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + IMPERSONATION_TOKEN_TTL_MS);
    await db.insert(impersonationTokensTable).values({
      token,
      clientUserId: target.id,
      adminUserId: actor.id,
      expiresAt,
    });

    // Same MSP-audit shape /msp/:mspId/customers/:customerId/impersonate writes.
    try {
      await db.insert(mspAuditLogsTable).values({
        actorUserId: actor.id,
        actorRole: actor.mspRole ?? "PlatformAdmin",
        mspId: linkage?.mspId ?? null,
        customerId: linkage?.customerId ?? null,
        actionType: "IMPERSONATION_TOKEN_ISSUED",
        entityType: "user",
        entityId: String(target.id),
        entityLabel: target.email,
        correlationId: getRequestContext()?.traceId ?? randomUUID(),
        ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        outcome: "success",
        metadata: { targetUserId: target.id, targetEmail: target.email, source: "admin.active-directory" },
      });
    } catch {
      // Audit log is non-fatal — never interrupt the impersonation flow
    }

    void createAuditLog({
      actorUserId: actor.id,
      actorName: actor.name ?? actor.email,
      actorRole: "admin",
      actionType: "admin_impersonation_started",
      entityType: "user",
      entityId: target.id,
      entityLabel: target.name ?? target.email,
      metadata: {
        targetMspRole: linkage?.mspRole ?? null,
        targetSlug: msp?.slug ?? null,
        expiresAt: expiresAt.toISOString(),
        source: "admin.active-directory",
      },
    });

    auditLog.info(
      {
        actionType: "admin_impersonation_started",
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetUserId: target.id,
        targetEmail: target.email,
        targetMspRole: linkage?.mspRole ?? null,
        targetSlug: msp?.slug ?? null,
        expiresAt: expiresAt.toISOString(),
        occurredAt: new Date().toISOString(),
      },
      "audit: PlatformAdmin started an impersonation session",
    );

    authLog.info(
      { actorUserId: actor.id, targetUserId: target.id, targetSlug: msp?.slug ?? null },
      "impersonation token issued from Active Directory",
    );

    res.json({
      token,
      targetSlug: msp?.slug ?? null,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: target.id,
        email: target.email,
        name: target.name,
        mspRole: linkage?.mspRole ?? null,
        mspName: msp?.name ?? null,
        isActive: linkage?.isActive ?? null,
      },
    });
  } catch (err) {
    log.error({ err, userId }, "Failed to issue impersonation token");
    res.status(500).json({ error: "Failed to start impersonation" });
  }
});

// ─── DELETE /admin/active-directory/user/:id — Phase 9 (Issue #69) ───────────
// Dev-environment-only cascading hard delete of a user account: a true full
// wipe (Shane's decision, recorded on Issue #69, 2026-07-28 — "no
// exceptions"), executed as ONE all-or-nothing database transaction. Any
// failure anywhere rolls the whole thing back — no partial state.
//
// ══ TABLE FOOTPRINT — audited fresh against lib/db/src/schema on 2026-07-29 ══
// (grep: references(() => usersTable.id) — 54 FK columns; matches the
// refreshed post-#92 audit on Issue #69 exactly: 18 RESTRICT columns,
// 21 cascade, 15 set-null.)
//
// A. EXPLICITLY DELETED in this route's transaction, in dependency-safe order
//    (children referencing other listed tables go first):
//
//    Blocking business tables (no onDelete on their users FK → RESTRICT).
//    Where a table also carries a projects/client_services FK, rows attached
//    to the target's projects are deleted too — otherwise the projects
//    delete below would be blocked by rows not keyed to the target user:
//      1. workflow_steps        (projectId → projects, clientServiceId → client_services; RESTRICT.
//                                NOT keyed to users at all — absent from Issue #69's users-FK
//                                audit but REQUIRED: it blocks deleting the user's projects/services)
//      2. kanban_tasks          (projectId → projects; RESTRICT. Same second-order case as above)
//      3. status_reports        (clientUserId; + projectId → projects)
//      4. project_updates       (authorUserId; + projectId → projects)
//      5. messages              (clientUserId, senderUserId)
//      6. notifications         (userId)
//      7. reports               (clientUserId; + projectId → projects)
//      8. client_documents      (uploadedBy RESTRICT; clientUserId already cascades)
//      9. documents             (uploadedBy; + projectId → projects)
//     10. invoices              (clientUserId; + projectId → projects)
//     11. contracts             (userId; + projectId → projects)
//     12. emails                (linkedUserId; linkedProjectId is set-null — DB handles)
//     13. email_domain_rules    (linkedUserId)
//     14. password_reset_tokens (userId)
//     15. impersonation_tokens  (clientUserId, adminUserId)
//     16. client_services       (clientUserId; + projectId → projects — before projects)
//     17. projects              (clientUserId, signedOffBy — after every project child above)
//
//    Original AD-era list (Issue #69). Five of these now carry onDelete:
//    "cascade" on their users FK (mfa_enrollments, mfa_challenges,
//    mfa_bypass_codes, user_sessions, user_entitlement_overrides) — they are
//    still deleted explicitly here, per the issue's final decision, so the
//    wipe is explicit and auditable rather than implicit:
//     18. mfa_enrollments             (userId)
//     19. mfa_challenges              (userId)
//     20. mfa_bypass_codes            (userId; createdByUserId elsewhere is set-null — DB handles)
//     21. user_sessions               (userId)
//     22. user_entitlement_overrides  (userId; grantedByUserId elsewhere set-null — DB handles)
//
//    Tenant-scoped wipe (post-#92 these carry NO users FK — loose integer/
//    text columns; "delete removes everything about them including consent,
//    and any tenant telemetry we have" per Shane. Keyed by the target's
//    owning tenants row; skipped when the account has no tenant linkage):
//     23. consent_invite_tokens       (clientUserId; tenant customerId/tenantId)
//     24. insights_generated_documents(customerId = users.id owner; mspCustomerId = tenant)
//     25. tenant_monitor_profiles     (tenantId = the tenant's AAD GUID)
//     26. msp_diagnostic_findings     (runId of the runs below; customerId = tenant)
//     27. msp_diagnostic_runs         (triggeredByUserId; customerId = tenant)
//     28. msp_customer_clickwraps     (customerUserId; customerId = tenant)
//     29. msp_agreement_acceptances   (userId — loose column, no FK)
//     30. msp_impersonation_tokens    (actorUserId, targetUserId — loose columns)
//     31. users — the account row itself, last.
//
// B. DB AUTO-CASCADE (onDelete: "cascade" — counted in the pre-delete census,
//    NOT deleted here; the users delete removes them): customer_notification_
//    preferences, account_setup_tokens, client_m365_profiles,
//    client_app_registrations, webauthn_credentials, webauthn_challenges,
//    client_health_history, client_callback_tokens, client_scores,
//    client_automation_runs, assessment_sow_agreements, push_subscriptions,
//    quick_win_presentations, quick_win_result_shares,
//    msp_staff_customer_scopes (+ the five overlap tables in A).
//
// C. DB AUTO-SET-NULL (onDelete: "set null" — reference nulled, row SURVIVES;
//    deliberately untouched per Issue #69's decision, e.g. audit-log actor
//    references must survive as "[deleted user]"): project_closures.signer_
//    user_id, audit_logs.actor_user_id, audit_logs.client_id,
//    mfa_bypass_codes.created_by_user_id, azure_tenant_credentials.client_
//    user_id, inbox_message_links.customer_id, script_run_results.customer_id,
//    script_download_tokens.customer_id + .client_user_id,
//    insights_generated_documents.customer_id, insights_automations.customer_
//    id, sales_offers.customer_id, sales_offer_events.actor_user_id,
//    user_entitlement_overrides.granted_by_user_id,
//    msp_staff_customer_scopes.created_by_user_id.
//
// The FULL pre-delete state (row counts for every table in A, B and C) is
// logged to the `audit` channel BEFORE the transaction commits, and the
// route is gated server-side to non-production environments — fail closed.

/**
 * Hard server-side non-production check for the Phase 9 delete. Reuses the
 * codebase's real environment convention (process.env.NODE_ENV — the same
 * signal logger.ts/auth.ts/sharepoint-connector.ts key off; the dev script
 * sets NODE_ENV=development, vitest sets NODE_ENV=test). Nothing
 * client-controlled. FAILS CLOSED: only an affirmative "development" or
 * "test" value unlocks the route — production, unset, or any other value
 * blocks it. Returns null when the delete may proceed, else the refusal.
 */
export function assertNonProductionEnvironment(): string | null {
  const env = process.env.NODE_ENV;
  if (env === "development" || env === "test") return null;
  return `Hard delete is available only in a dev environment. NODE_ENV is ${
    env === undefined ? "unset" : `"${env}"`
  } — requires "development" or "test". Failing closed; nothing was deleted.`;
}

/** The transaction parameter type `db.transaction()`'s callback receives — extracted so the per-user cascade below can be typed without importing drizzle's internal transaction type directly. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type UserHardDeleteResult =
  | { notFound: true }
  | {
      notFound: false;
      target: {
        id: number;
        email: string;
        name: string | null;
        mspRole: string;
        mspId: number | null;
        tenantId: number | null;
      };
      tenant: { id: number; tenantGuid: string } | null;
      explicitCounts: Record<string, number>;
      cascadeCounts: Record<string, number>;
      setNullCounts: Record<string, number>;
    };

/**
 * The full Phase 9 per-user cascade (table footprint documented on the
 * DELETE /user/:id route below), extracted so it has exactly ONE
 * implementation shared by that route and the customer-level hard delete
 * further down — "what deleting one user means" must not exist twice and
 * drift. Must run inside an already-open transaction; the caller owns
 * commit/rollback. Emits the same `auditLog.info(...)` pre-state line the
 * original single-user route always has, once per user, so a tenant-wide
 * delete produces one such line per user it removes.
 */
async function hardDeleteUserWithinTx(
  tx: Tx,
  userId: number,
  actor: { id: number; email: string },
): Promise<UserHardDeleteResult> {
  const [target] = await tx
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: usersTable.mspRole,
          mspId: usersTable.mspId,
          tenantId: usersTable.tenantId,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!target) return { notFound: true as const };

      // The owning tenants row keys the tenant-scoped wipe (section A,
      // 23-28). tenants.id is the integer "customerId" successor id-space;
      // tenants.tenantId is the AAD GUID text key telemetry rows carry.
      const tenant =
        target.tenantId != null
          ? ((
              await tx
                .select({ id: tenantsTable.id, tenantGuid: tenantsTable.tenantId })
                .from(tenantsTable)
                .where(eq(tenantsTable.id, target.tenantId))
                .limit(1)
            )[0] ?? null)
          : null;

      const projectIds = (
        await tx
          .select({ id: projectsTable.id })
          .from(projectsTable)
          .where(or(eq(projectsTable.clientUserId, userId), eq(projectsTable.signedOffBy, userId)))
      ).map((r) => r.id);

      const clientServiceIds = (
        await tx
          .select({ id: clientServicesTable.id })
          .from(clientServicesTable)
          .where(
            or(
              eq(clientServicesTable.clientUserId, userId),
              projectIds.length ? inArray(clientServicesTable.projectId, projectIds) : undefined,
            ),
          )
      ).map((r) => r.id);

      const diagnosticRunIds = (
        await tx
          .select({ runId: mspDiagnosticRunsTable.runId })
          .from(mspDiagnosticRunsTable)
          .where(
            or(
              eq(mspDiagnosticRunsTable.triggeredByUserId, userId),
              tenant ? eq(mspDiagnosticRunsTable.customerId, tenant.id) : undefined,
            ),
          )
      ).map((r) => r.runId);

      // or() over the real conditions only; null means "no rows can match —
      // skip this table entirely" (e.g. tenant-scoped tables for an account
      // with no tenant linkage). NEVER pass an undefined where to delete().
      const anyOf = (...conds: (SQL | undefined)[]): SQL | null => {
        const real = conds.filter((c): c is SQL => c !== undefined);
        return real.length ? (or(...real) as SQL) : null;
      };

      // Section A of the header comment, in that exact order.
      const explicitDeletes: Array<{ name: string; table: PgTable; where: SQL | null }> = [
        {
          name: "workflow_steps",
          table: workflowStepsTable,
          where: anyOf(
            projectIds.length ? inArray(workflowStepsTable.projectId, projectIds) : undefined,
            clientServiceIds.length ? inArray(workflowStepsTable.clientServiceId, clientServiceIds) : undefined,
          ),
        },
        {
          name: "kanban_tasks",
          table: kanbanTasksTable,
          where: anyOf(projectIds.length ? inArray(kanbanTasksTable.projectId, projectIds) : undefined),
        },
        {
          name: "status_reports",
          table: statusReportsTable,
          where: anyOf(
            eq(statusReportsTable.clientUserId, userId),
            projectIds.length ? inArray(statusReportsTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "project_updates",
          table: projectUpdatesTable,
          where: anyOf(
            eq(projectUpdatesTable.authorUserId, userId),
            projectIds.length ? inArray(projectUpdatesTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "messages",
          table: messagesTable,
          where: anyOf(eq(messagesTable.clientUserId, userId), eq(messagesTable.senderUserId, userId)),
        },
        { name: "notifications", table: notificationsTable, where: anyOf(eq(notificationsTable.userId, userId)) },
        {
          name: "reports",
          table: reportsTable,
          where: anyOf(
            eq(reportsTable.clientUserId, userId),
            projectIds.length ? inArray(reportsTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "client_documents",
          table: clientDocumentsTable,
          where: anyOf(eq(clientDocumentsTable.clientUserId, userId), eq(clientDocumentsTable.uploadedBy, userId)),
        },
        {
          name: "documents",
          table: documentsTable,
          where: anyOf(
            eq(documentsTable.uploadedBy, userId),
            projectIds.length ? inArray(documentsTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "invoices",
          table: invoicesTable,
          where: anyOf(
            eq(invoicesTable.clientUserId, userId),
            projectIds.length ? inArray(invoicesTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "contracts",
          table: contractsTable,
          where: anyOf(
            eq(contractsTable.userId, userId),
            projectIds.length ? inArray(contractsTable.projectId, projectIds) : undefined,
          ),
        },
        { name: "emails", table: emailsTable, where: anyOf(eq(emailsTable.linkedUserId, userId)) },
        { name: "email_domain_rules", table: emailDomainRulesTable, where: anyOf(eq(emailDomainRulesTable.linkedUserId, userId)) },
        { name: "password_reset_tokens", table: passwordResetTokensTable, where: anyOf(eq(passwordResetTokensTable.userId, userId)) },
        {
          name: "impersonation_tokens",
          table: impersonationTokensTable,
          where: anyOf(eq(impersonationTokensTable.clientUserId, userId), eq(impersonationTokensTable.adminUserId, userId)),
        },
        {
          name: "client_services",
          table: clientServicesTable,
          where: anyOf(
            eq(clientServicesTable.clientUserId, userId),
            projectIds.length ? inArray(clientServicesTable.projectId, projectIds) : undefined,
          ),
        },
        {
          name: "projects",
          table: projectsTable,
          where: anyOf(eq(projectsTable.clientUserId, userId), eq(projectsTable.signedOffBy, userId)),
        },
        { name: "mfa_enrollments", table: mfaEnrollmentsTable, where: anyOf(eq(mfaEnrollmentsTable.userId, userId)) },
        { name: "mfa_challenges", table: mfaChallengesTable, where: anyOf(eq(mfaChallengesTable.userId, userId)) },
        { name: "mfa_bypass_codes", table: mfaBypassCodesTable, where: anyOf(eq(mfaBypassCodesTable.userId, userId)) },
        { name: "user_sessions", table: userSessionsTable, where: anyOf(eq(userSessionsTable.userId, userId)) },
        {
          name: "user_entitlement_overrides",
          table: userEntitlementOverridesTable,
          where: anyOf(eq(userEntitlementOverridesTable.userId, userId)),
        },
        {
          name: "consent_invite_tokens",
          table: consentInviteTokensTable,
          where: anyOf(
            eq(consentInviteTokensTable.clientUserId, userId),
            tenant ? eq(consentInviteTokensTable.customerId, tenant.id) : undefined,
            tenant ? eq(consentInviteTokensTable.tenantId, tenant.tenantGuid) : undefined,
          ),
        },
        {
          name: "insights_generated_documents",
          table: insightsGeneratedDocumentsTable,
          where: anyOf(
            eq(insightsGeneratedDocumentsTable.customerId, userId),
            tenant ? eq(insightsGeneratedDocumentsTable.mspCustomerId, tenant.id) : undefined,
          ),
        },
        {
          name: "tenant_monitor_profiles",
          table: tenantMonitorProfilesTable,
          where: anyOf(tenant ? eq(tenantMonitorProfilesTable.tenantId, tenant.tenantGuid) : undefined),
        },
        {
          name: "msp_diagnostic_findings",
          table: mspDiagnosticFindingsTable,
          where: anyOf(
            diagnosticRunIds.length ? inArray(mspDiagnosticFindingsTable.runId, diagnosticRunIds) : undefined,
            tenant ? eq(mspDiagnosticFindingsTable.customerId, tenant.id) : undefined,
          ),
        },
        {
          name: "msp_diagnostic_runs",
          table: mspDiagnosticRunsTable,
          where: anyOf(
            eq(mspDiagnosticRunsTable.triggeredByUserId, userId),
            tenant ? eq(mspDiagnosticRunsTable.customerId, tenant.id) : undefined,
          ),
        },
        {
          name: "msp_customer_clickwraps",
          table: mspCustomerClickwrapsTable,
          where: anyOf(
            eq(mspCustomerClickwrapsTable.customerUserId, userId),
            tenant ? eq(mspCustomerClickwrapsTable.customerId, tenant.id) : undefined,
          ),
        },
        { name: "msp_agreement_acceptances", table: mspAgreementAcceptancesTable, where: anyOf(eq(mspAgreementAcceptancesTable.userId, userId)) },
        {
          name: "msp_impersonation_tokens",
          table: mspImpersonationTokensTable,
          where: anyOf(eq(mspImpersonationTokensTable.actorUserId, userId), eq(mspImpersonationTokensTable.targetUserId, userId)),
        },
      ];

      // Section B — rows the users delete will cascade away (census only).
      const cascadeCensus: Array<{ name: string; table: PgTable; where: SQL }> = [
        { name: "customer_notification_preferences", table: customerNotificationPreferencesTable, where: eq(customerNotificationPreferencesTable.userId, userId) },
        { name: "account_setup_tokens", table: accountSetupTokensTable, where: eq(accountSetupTokensTable.userId, userId) },
        { name: "client_m365_profiles", table: clientM365ProfilesTable, where: eq(clientM365ProfilesTable.clientId, userId) },
        { name: "client_app_registrations", table: clientAppRegistrationsTable, where: eq(clientAppRegistrationsTable.clientUserId, userId) },
        { name: "webauthn_credentials", table: webauthnCredentialsTable, where: eq(webauthnCredentialsTable.userId, userId) },
        { name: "webauthn_challenges", table: webauthnChallengesTable, where: eq(webauthnChallengesTable.userId, userId) },
        { name: "client_health_history", table: clientHealthHistoryTable, where: eq(clientHealthHistoryTable.clientId, userId) },
        { name: "client_callback_tokens", table: clientCallbackTokensTable, where: eq(clientCallbackTokensTable.clientUserId, userId) },
        { name: "client_scores", table: clientScoresTable, where: eq(clientScoresTable.clientId, userId) },
        { name: "client_automation_runs", table: clientAutomationRunsTable, where: eq(clientAutomationRunsTable.clientUserId, userId) },
        { name: "assessment_sow_agreements", table: assessmentSowAgreementsTable, where: eq(assessmentSowAgreementsTable.clientUserId, userId) },
        { name: "push_subscriptions", table: pushSubscriptionsTable, where: eq(pushSubscriptionsTable.userId, userId) },
        { name: "quick_win_presentations", table: quickWinPresentationsTable, where: eq(quickWinPresentationsTable.clientUserId, userId) },
        { name: "quick_win_result_shares", table: quickWinResultSharesTable, where: eq(quickWinResultSharesTable.clientUserId, userId) },
        { name: "msp_staff_customer_scopes", table: mspStaffCustomerScopesTable, where: eq(mspStaffCustomerScopesTable.staffUserId, userId) },
      ];

      // Section C — references the users delete will null out; rows survive.
      const setNullCensus: Array<{ name: string; table: PgTable; where: SQL }> = [
        { name: "project_closures.signer_user_id", table: projectClosuresTable, where: eq(projectClosuresTable.signerUserId, userId) },
        { name: "audit_logs.actor_user_id", table: auditLogsTable, where: eq(auditLogsTable.actorUserId, userId) },
        { name: "audit_logs.client_id", table: auditLogsTable, where: eq(auditLogsTable.clientId, userId) },
        { name: "mfa_bypass_codes.created_by_user_id", table: mfaBypassCodesTable, where: eq(mfaBypassCodesTable.createdByUserId, userId) },
        { name: "azure_tenant_credentials.client_user_id", table: azureTenantCredentialsTable, where: eq(azureTenantCredentialsTable.clientUserId, userId) },
        { name: "inbox_message_links.customer_id", table: inboxMessageLinksTable, where: eq(inboxMessageLinksTable.customerId, userId) },
        { name: "script_run_results.customer_id", table: scriptRunResultsTable, where: eq(scriptRunResultsTable.customerId, userId) },
        { name: "script_download_tokens.customer_id", table: scriptDownloadTokensTable, where: eq(scriptDownloadTokensTable.customerId, userId) },
        { name: "script_download_tokens.client_user_id", table: scriptDownloadTokensTable, where: eq(scriptDownloadTokensTable.clientUserId, userId) },
        { name: "insights_automations.customer_id", table: insightsAutomationsTable, where: eq(insightsAutomationsTable.customerId, userId) },
        { name: "sales_offers.customer_id", table: salesOffersTable, where: eq(salesOffersTable.customerId, userId) },
        { name: "sales_offer_events.actor_user_id", table: salesOfferEventsTable, where: eq(salesOfferEventsTable.actorUserId, userId) },
        { name: "user_entitlement_overrides.granted_by_user_id", table: userEntitlementOverridesTable, where: eq(userEntitlementOverridesTable.grantedByUserId, userId) },
        { name: "msp_staff_customer_scopes.created_by_user_id", table: mspStaffCustomerScopesTable, where: eq(mspStaffCustomerScopesTable.createdByUserId, userId) },
      ];

      const countWhere = async (table: PgTable, where: SQL): Promise<number> => {
        const [row] = await tx.select({ n: count() }).from(table).where(where);
        return Number(row?.n ?? 0);
      };

      const explicitCounts: Record<string, number> = {};
      for (const entry of explicitDeletes) {
        explicitCounts[entry.name] = entry.where ? await countWhere(entry.table, entry.where) : 0;
      }
      const cascadeCounts: Record<string, number> = {};
      for (const entry of cascadeCensus) {
        cascadeCounts[entry.name] = await countWhere(entry.table, entry.where);
      }
      const setNullCounts: Record<string, number> = {};
      for (const entry of setNullCensus) {
        setNullCounts[entry.name] = await countWhere(entry.table, entry.where);
      }

      // The FULL pre-delete state, to the audit channel, BEFORE anything is
      // deleted and therefore before the transaction can possibly commit.
      auditLog.info(
        {
          actionType: "user.hard_delete.pre_state",
          actorUserId: actor.id,
          actorEmail: actor.email,
          targetUserId: target.id,
          targetEmail: target.email,
          targetMspRole: target.mspRole,
          targetMspId: target.mspId,
          targetTenantId: target.tenantId,
          tenantGuid: tenant?.tenantGuid ?? null,
          projectIds,
          clientServiceIds,
          diagnosticRunIds,
          explicitDeleteCounts: explicitCounts,
          dbCascadeCounts: cascadeCounts,
          dbSetNullCounts: setNullCounts,
          occurredAt: new Date().toISOString(),
        },
        "audit: FULL pre-delete state for dev-only hard delete (logged before commit)",
      );

      for (const entry of explicitDeletes) {
        if (entry.where) await tx.delete(entry.table).where(entry.where);
      }

      // Last: the account row itself. The DB cascades section B and nulls
      // section C as part of this statement.
      await tx.delete(usersTable).where(eq(usersTable.id, userId));

  return { notFound: false, target, tenant, explicitCounts, cascadeCounts, setNullCounts };
}

router.delete("/admin/active-directory/user/:id", requireAdmin, async (req: Request, res: Response) => {
  // FIRST executed line: the hard non-production gate, before anything else.
  const envRefusal = assertNonProductionEnvironment();
  if (envRefusal) {
    auditLog.warn(
      { actionType: "user.hard_delete.refused_env", actorUserId: req.user?.id ?? null, path: req.originalUrl },
      "audit: dev-only hard delete refused by non-production gate",
    );
    res.status(403).json({ error: envRefusal });
    return;
  }

  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const actor = req.user!;
  if (userId === actor.id) {
    // Same convention as Phase 8's self-impersonation refusal: an admin
    // hard-deleting the very account they are acting as is never intended.
    res.status(400).json({ error: "You cannot hard-delete your own account" });
    return;
  }

  try {
    const result = await db.transaction((tx) => hardDeleteUserWithinTx(tx, userId, { id: actor.id, email: actor.email }));

    if (result.notFound) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { target, explicitCounts, cascadeCounts, setNullCounts } = result;

    void createAuditLog({
      actorUserId: actor.id,
      actorName: actor.name ?? actor.email,
      actorRole: "admin",
      actionType: "user.hard_delete",
      entityType: "user",
      entityId: target.id,
      entityLabel: target.name ?? target.email,
      metadata: {
        targetEmail: target.email,
        explicitDeleteCounts: explicitCounts,
        dbCascadeCounts: cascadeCounts,
        dbSetNullCounts: setNullCounts,
        source: "admin.active-directory",
      },
    });

    auditLog.info(
      {
        actionType: "user.hard_delete",
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetUserId: target.id,
        targetEmail: target.email,
        occurredAt: new Date().toISOString(),
      },
      "audit: dev-only hard delete committed",
    );
    log.info({ userId: target.id, email: target.email }, "PlatformAdmin hard-deleted an account (dev environment)");

    res.json({
      ok: true,
      deletedUserId: target.id,
      deletedEmail: target.email,
      tables: explicitCounts,
      dbCascaded: cascadeCounts,
      dbSetNull: setNullCounts,
    });
  } catch (err) {
    log.error({ err, userId }, "Hard delete failed — transaction rolled back, no rows were deleted");
    res.status(500).json({ error: "Hard delete failed — the transaction was rolled back; nothing was deleted." });
  }
});

// ─── DELETE /admin/active-directory/customer/:id — customer hard delete ─────
// Dev-environment-only cascading hard delete of an entire tenant. Same
// `assertNonProductionEnvironment()` gate as the Phase 9 user route above —
// if anything, "no exceptions" matters MORE here: this can remove dozens of
// accounts and every tenant-scoped record in one call.
//
// TWO PHASES, deliberately NOT one transaction:
//
//   Phase A (must be atomic — one `db.transaction()`, all-or-nothing):
//     1. Revoke consent — all three grants (graph/writeBack/sharepoint)
//        explicitly stamped "revoked" via the SAME `mergeConsentKey()`
//        graph.ts's real PATCH /admin/consent/:tenantId/revoke route uses.
//     2. Every user under the tenant, via `hardDeleteUserWithinTx()` — the
//        EXACT SAME per-user cascade the Phase 9 single-user route runs.
//        Also clears the one real FK pointing at `tenants.id`
//        (`users.tenant_id`, RESTRICT) — step 3 fails if any user remains.
//     3. The `tenants` row itself, last.
//     This is the part that actually matters: no login, no consent, no
//     tenant left in the tree.
//
//   Phase B (best-effort, run AFTER Phase A commits, table-by-table):
//     Every remaining tenant-only `customerId`/`tenantId` column with no
//     `userId` column of its own (Phase A's per-user cascade never reaches
//     these). This list spans ~30 auxiliary/analytics tables whose manual
//     migrations (`lib/db/migrations/manual/`) are Shane's to run by hand —
//     several were written before the Tenant/User Refactor (#92) dropped
//     `msp_customers` and, if never actually run since, simply do not exist
//     in a given database (confirmed live: `m365_service_health_samples` and
//     `msp_message_center_items`'s own migrations still referenced the
//     dropped table, so `CREATE TABLE` could never have succeeded post-
//     refactor — fixed in those .sql files, but there is no way for this
//     route to know which migrations any given deployment has actually run).
//     A table that doesn't exist (or errors for any other reason) is
//     recorded as skipped and the loop moves on — Phase A already committed,
//     so an obscure analytics table's migration gap must never block the
//     tenant from actually being gone. `msp_audit_logs.customer_id` is
//     NULLED here too, not deleted — audit history survives its subject
//     being removed, same convention as the user route's own Section C.
//
// The FULL pre-delete state (every table's row count, where countable) is
// logged to the `audit` channel before Phase A commits.
router.delete("/admin/active-directory/customer/:id", requireAdmin, async (req: Request, res: Response) => {
  // FIRST executed line: the hard non-production gate, before anything else.
  const envRefusal = assertNonProductionEnvironment();
  if (envRefusal) {
    auditLog.warn(
      { actionType: "customer.hard_delete.refused_env", actorUserId: req.user?.id ?? null, path: req.originalUrl },
      "audit: dev-only customer hard delete refused by non-production gate",
    );
    res.status(403).json({ error: envRefusal });
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId)) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }

  const actor = req.user!;
  const CONSENT_KEYS = ["graph", "writeBack", "sharepoint"] as const;

  let phaseAResult:
    | { notFound: true }
    | {
        notFound: false;
        tenant: { id: number; tenantGuid: string; name: string; mspId: number };
        userCount: number;
        deletedUsers: Array<{ userId: number; email: string }>;
      };

  try {
    phaseAResult = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ id: tenantsTable.id, tenantGuid: tenantsTable.tenantId, name: tenantsTable.customerName, mspId: tenantsTable.mspId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      if (!tenant) return { notFound: true as const };

      // ── 1. Revoke every consent grant, explicitly, before anything else ──
      for (const key of CONSENT_KEYS) {
        await tx
          .update(tenantsTable)
          .set({ consent: mergeConsentKey(key, { status: "revoked", revokedAt: new Date().toISOString() }), updatedAt: new Date() })
          .where(eq(tenantsTable.id, customerId));
      }
      auditLog.info(
        { actionType: "customer.hard_delete.consent_revoked", actorUserId: actor.id, actorEmail: actor.email, customerId, tenantGuid: tenant.tenantGuid, occurredAt: new Date().toISOString() },
        "audit: revoked all consent ahead of a customer hard delete",
      );

      // ── 2. Every user under this tenant, via the shared per-user cascade ──
      const userRows = await tx.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.tenantId, customerId));

      const perUserResults: Array<{ userId: number; email: string }> = [];
      for (const u of userRows) {
        const userResult = await hardDeleteUserWithinTx(tx, u.id, { id: actor.id, email: actor.email });
        if (!userResult.notFound) perUserResults.push({ userId: u.id, email: u.email });
      }

      auditLog.info(
        {
          actionType: "customer.hard_delete.phase_a_pre_state",
          actorUserId: actor.id,
          actorEmail: actor.email,
          customerId: tenant.id,
          customerName: tenant.name,
          tenantGuid: tenant.tenantGuid,
          mspId: tenant.mspId,
          userCount: userRows.length,
          userIds: userRows.map((u) => u.id),
          occurredAt: new Date().toISOString(),
        },
        "audit: pre-delete state for the atomic phase of a dev-only customer hard delete (logged before commit)",
      );

      // ── 3. The tenant row itself, last — succeeds only once every
      //      users.tenant_id FK pointing at it (RESTRICT) is gone. ──
      await tx.delete(tenantsTable).where(eq(tenantsTable.id, customerId));

      return { notFound: false as const, tenant, userCount: userRows.length, deletedUsers: perUserResults };
    });
  } catch (err) {
    log.error({ err, customerId }, "Customer hard delete failed — transaction rolled back, no rows were deleted");
    res.status(500).json({ error: "Hard delete failed — the transaction was rolled back; nothing was deleted." });
    return;
  }

  if (phaseAResult.notFound) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const { tenant, userCount, deletedUsers } = phaseAResult;

  // ── Phase B — best-effort tenant-only cleanup, run only after Phase A has
  //    genuinely committed. Each table gets its own try/catch outside any
  //    transaction: a missing table must never look like the customer was
  //    not actually deleted, and must never poison a shared transaction for
  //    the tables after it. ──
  const tenantOnlyTargets: Array<{ name: string; table: PgTable; where: SQL }> = [
    { name: "msp_event_store", table: mspEventStoreTable, where: eq(mspEventStoreTable.customerId, customerId) },
    { name: "msp_dlq_store", table: mspDlqStoreTable, where: eq(mspDlqStoreTable.customerId, customerId) },
    { name: "msp_documents", table: mspDocumentsTable, where: eq(mspDocumentsTable.customerId, customerId) },
    { name: "fulfillment_queue", table: fulfillmentQueueTable, where: eq(fulfillmentQueueTable.customerId, customerId) },
    { name: "outbound_webhooks", table: outboundWebhooksTable, where: eq(outboundWebhooksTable.customerId, customerId) },
    { name: "portal_wf_runs", table: portalWfRunsTable, where: eq(portalWfRunsTable.customerId, customerId) },
    { name: "portal_wf_operator_tasks", table: portalWfOperatorTasksTable, where: eq(portalWfOperatorTasksTable.customerId, customerId) },
    { name: "ai_usage_events", table: aiUsageEventsTable, where: eq(aiUsageEventsTable.customerId, customerId) },
    {
      name: "tenant_check_item_details",
      table: tenantCheckItemDetailsTable,
      where: or(eq(tenantCheckItemDetailsTable.customerId, customerId), eq(tenantCheckItemDetailsTable.tenantId, tenant.tenantGuid)) as SQL,
    },
    { name: "simulator_check_runs", table: simulatorCheckRunsTable, where: eq(simulatorCheckRunsTable.customerId, customerId) },
    { name: "msp_message_center_items", table: mspMessageCenterItemsTable, where: eq(mspMessageCenterItemsTable.customerId, customerId) },
    { name: "m365_service_health_samples", table: m365ServiceHealthSamplesTable, where: eq(m365ServiceHealthSamplesTable.customerId, customerId) },
    { name: "msp_report_definitions", table: mspReportDefinitionsTable, where: eq(mspReportDefinitionsTable.customerId, customerId) },
    { name: "msp_report_runs", table: mspReportRunsTable, where: eq(mspReportRunsTable.customerId, customerId) },
    { name: "msp_sales_bundle_assignments", table: mspSalesBundleAssignmentsTable, where: eq(mspSalesBundleAssignmentsTable.customerId, customerId) },
    {
      name: "activity_subscriptions",
      table: activitySubscriptionsTable,
      where: or(eq(activitySubscriptionsTable.customerId, customerId), eq(activitySubscriptionsTable.tenantId, tenant.tenantGuid)) as SQL,
    },
    { name: "msp_sows", table: mspSowsTable, where: eq(mspSowsTable.customerId, customerId) },
    { name: "break_glass_pending_secrets", table: breakGlassPendingSecretsTable, where: eq(breakGlassPendingSecretsTable.customerId, customerId) },
    { name: "break_glass_override_audit", table: breakGlassOverrideAuditTable, where: eq(breakGlassOverrideAuditTable.customerId, customerId) },
    { name: "dashboard_executive_summaries", table: dashboardExecutiveSummariesTable, where: eq(dashboardExecutiveSummariesTable.customerId, customerId) },
    { name: "msp_change_requests", table: mspChangeRequestsTable, where: eq(mspChangeRequestsTable.tenantId, tenant.tenantGuid) },
    { name: "msp_sop_runs", table: mspSopRunsTable, where: eq(mspSopRunsTable.tenantId, tenant.tenantGuid) },
    { name: "msp_risk_decisions", table: mspRiskDecisionsTable, where: eq(mspRiskDecisionsTable.tenantId, tenant.tenantGuid) },
    { name: "tenant_signal_history", table: tenantSignalHistoryTable, where: eq(tenantSignalHistoryTable.customerId, customerId) },
    { name: "tenant_engine_snapshots", table: tenantEngineSnapshotsTable, where: eq(tenantEngineSnapshotsTable.customerId, customerId) },
    { name: "engine_score_daily_rollup", table: engineScoreDailyRollupTable, where: eq(engineScoreDailyRollupTable.customerId, customerId) },
    { name: "policy_rule_firings", table: policyRuleFiringsTable, where: eq(policyRuleFiringsTable.customerId, customerId) },
    { name: "policy_rule_incidents", table: policyRuleIncidentsTable, where: eq(policyRuleIncidentsTable.customerId, customerId) },
    { name: "policy_rule_suppressions", table: policyRuleSuppressionsTable, where: eq(policyRuleSuppressionsTable.customerId, customerId) },
    { name: "engine_baseline_history", table: engineBaselineHistoryTable, where: eq(engineBaselineHistoryTable.customerId, customerId) },
    { name: "platform_log_stream", table: platformLogStreamTable, where: eq(platformLogStreamTable.customerId, customerId) },
    { name: "exception_occurrences", table: exceptionOccurrencesTable, where: eq(exceptionOccurrencesTable.customerId, customerId) },
    { name: "checkout_sessions", table: checkoutSessionsTable, where: eq(checkoutSessionsTable.tenantId, tenant.tenantGuid) },
    // Junction row only — the staff account itself is untouched; it just
    // loses its scope onto a tenant that no longer exists.
    { name: "msp_staff_customer_scopes.customer_id", table: mspStaffCustomerScopesTable, where: eq(mspStaffCustomerScopesTable.customerId, customerId) },
  ];

  const tenantOnlyCounts: Record<string, number> = {};
  const tenantOnlySkipped: Record<string, string> = {};
  for (const entry of tenantOnlyTargets) {
    try {
      const deletedRows = await db.delete(entry.table).where(entry.where).returning({ id: sql<number>`1` });
      tenantOnlyCounts[entry.name] = deletedRows.length;
    } catch (err) {
      tenantOnlySkipped[entry.name] = err instanceof Error ? err.message : String(err);
      log.warn({ err, customerId, table: entry.name }, "customer hard delete: tenant-only table skipped (likely an unrun manual migration)");
    }
  }

  let mspAuditLogsDetached = 0;
  try {
    const detached = await db.update(mspAuditLogsTable).set({ customerId: null }).where(eq(mspAuditLogsTable.customerId, customerId)).returning({ id: mspAuditLogsTable.id });
    mspAuditLogsDetached = detached.length;
  } catch (err) {
    log.warn({ err, customerId }, "customer hard delete: msp_audit_logs detach skipped");
  }

  void createAuditLog({
    actorUserId: actor.id,
    actorName: actor.name ?? actor.email,
    actorRole: "admin",
    actionType: "customer.hard_delete",
    entityType: "customer",
    entityId: tenant.id,
    entityLabel: tenant.name,
    metadata: {
      tenantGuid: tenant.tenantGuid,
      mspId: tenant.mspId,
      userCount,
      deletedUserEmails: deletedUsers.map((u) => u.email),
      tenantOnlyCounts,
      tenantOnlySkipped,
      mspAuditLogsDetached,
      source: "admin.active-directory",
    },
  });

  auditLog.info(
    {
      actionType: "customer.hard_delete",
      actorUserId: actor.id,
      actorEmail: actor.email,
      customerId: tenant.id,
      customerName: tenant.name,
      userCount,
      tenantOnlySkippedCount: Object.keys(tenantOnlySkipped).length,
      occurredAt: new Date().toISOString(),
    },
    "audit: dev-only customer hard delete committed",
  );
  log.info({ customerId: tenant.id, name: tenant.name, userCount }, "PlatformAdmin hard-deleted a customer/tenant (dev environment)");

  res.json({
    ok: true,
    deletedCustomerId: tenant.id,
    deletedCustomerName: tenant.name,
    usersDeleted: userCount,
    tenantOnlyTables: tenantOnlyCounts,
    tenantOnlySkipped,
    mspAuditLogsDetached,
  });
});

export default router;
