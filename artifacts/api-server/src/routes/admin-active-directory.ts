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
  userSessionsTable,
  mfaEnrollmentsTable,
  passwordResetTokensTable,
  accountSetupTokensTable,
  impersonationTokensTable,
  mspAuditLogsTable,
  type TenantConsentRecord,
} from "@workspace/db";
import { eq, asc, and, inArray, count, desc } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { revokeAllOtherSessions } from "../lib/session-tracking";
import { createAuditLog } from "../lib/audit";
import { adminResetMfa, isMfaMethod, MFA_METHODS } from "./mfa";
import { sendEmailFromTemplate, passwordResetEmail } from "../lib/mailer.ts";
import { getMspPortalBaseUrl, buildAccountSetupUrl } from "../lib/portal-url.ts";
import { getRequestContext } from "../lib/request-context.ts";
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
    const [msps, customers, roleCountRows, ous] = await Promise.all([
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
      db
        .select({ role: usersTable.mspRole, count: count() })
        .from(usersTable)
        .where(inArray(usersTable.mspRole, [...DIRECTORY_GROUP_ROLES]))
        .groupBy(usersTable.mspRole),
      db
        .select({
          id: activeDirectoryOusTable.id,
          name: activeDirectoryOusTable.name,
          createdAt: activeDirectoryOusTable.createdAt,
          updatedAt: activeDirectoryOusTable.updatedAt,
        })
        .from(activeDirectoryOusTable),
    ]);

    res.json({
      msps: buildMspTree(msps, customers),
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

router.post("/admin/active-directory/ou", requireAdmin, async (req: Request, res: Response) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "OU name is required" });
    return;
  }

  try {
    const [created] = await db.insert(activeDirectoryOusTable).values({ name }).returning();
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

  try {
    const [updated] = await db
      .update(activeDirectoryOusTable)
      .set({ name, updatedAt: new Date() })
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

export default router;
