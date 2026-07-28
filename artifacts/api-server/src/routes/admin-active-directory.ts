// artifacts/api-server/src/routes/admin-active-directory.ts
//
// Active Directory admin surface (initiative: active-directory,
// docs/build-plans/active-directory.md). Phase 1 (Issue #61): read-only tree
// + universal search over real msps/msp_customers/msp_users/users rows.
// Phase 2 (Issue #62): MSP Object detail pane. No write actions — those are
// Phases 7-9.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspsTable,
  mspCustomersTable,
  mspUsersTable,
  usersTable,
  mspSubscriptionsTable,
  servicesTable,
  platformAgreementsTable,
  mspAgreementAcceptancesTable,
  tenantConsentTable,
  tenantSharePointConsentTable,
  tenantWriteConsentTable,
  clientServicesTable,
  mspDiagnosticRunsTable,
  activeDirectoryOusTable,
} from "@workspace/db";
import { eq, asc, inArray, count, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
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
} from "../lib/active-directory";
import { resolveCustomerUserIds } from "../lib/tenant-signals";

// Most recent N diagnostic runs shown in the Customer Object pane's summary —
// a run-history preview, not a full diagnostics browser (Issue #63 scope).
const RECENT_DIAGNOSTIC_RUN_LIMIT = 10;

const router: IRouter = Router();
const log = logger.child({ channel: "admin.active-directory" });

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
          id: mspCustomersTable.id,
          mspId: mspCustomersTable.mspId,
          name: mspCustomersTable.name,
          domain: mspCustomersTable.domain,
          tenantId: mspCustomersTable.tenantId,
          status: mspCustomersTable.status,
        })
        .from(mspCustomersTable)
        .orderBy(asc(mspCustomersTable.name)),
      db
        .select({ role: mspUsersTable.mspRole, count: count() })
        .from(mspUsersTable)
        .where(inArray(mspUsersTable.mspRole, [...DIRECTORY_GROUP_ROLES]))
        .groupBy(mspUsersTable.mspRole),
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
          id: mspCustomersTable.id,
          mspId: mspCustomersTable.mspId,
          name: mspCustomersTable.name,
          domain: mspCustomersTable.domain,
          tenantId: mspCustomersTable.tenantId,
          status: mspCustomersTable.status,
        })
        .from(mspCustomersTable),
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: mspUsersTable.mspRole,
          mspId: mspUsersTable.mspId,
          customerId: mspUsersTable.customerId,
        })
        .from(mspUsersTable)
        .innerJoin(usersTable, eq(mspUsersTable.userId, usersTable.id)),
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
          id: mspCustomersTable.id,
          name: mspCustomersTable.name,
          domain: mspCustomersTable.domain,
          tenantId: mspCustomersTable.tenantId,
          status: mspCustomersTable.status,
        })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.mspId, mspId))
        .orderBy(asc(mspCustomersTable.name)),
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: mspUsersTable.mspRole,
          isActive: mspUsersTable.isActive,
          lastLoginAt: mspUsersTable.lastLoginAt,
        })
        .from(mspUsersTable)
        .innerJoin(usersTable, eq(mspUsersTable.userId, usersTable.id))
        .where(eq(mspUsersTable.mspId, mspId))
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
// role (source-of-truth column is mspUsersTable.mspRole, same column Phase
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
        mspId: mspUsersTable.mspId,
        customerId: mspUsersTable.customerId,
        isActive: mspUsersTable.isActive,
        lastLoginAt: mspUsersTable.lastLoginAt,
      })
      .from(mspUsersTable)
      .innerJoin(usersTable, eq(mspUsersTable.userId, usersTable.id))
      .where(eq(mspUsersTable.mspRole, role))
      .orderBy(asc(usersTable.email));

    const mspIds = [...new Set(memberRows.map((m) => m.mspId).filter((id): id is number => id != null))];
    const customerIds = [...new Set(memberRows.map((m) => m.customerId).filter((id): id is number => id != null))];

    const [mspRows, customerRows] = await Promise.all([
      mspIds.length
        ? db.select({ id: mspsTable.id, name: mspsTable.name }).from(mspsTable).where(inArray(mspsTable.id, mspIds))
        : Promise.resolve([]),
      customerIds.length
        ? db
            .select({ id: mspCustomersTable.id, name: mspCustomersTable.name })
            .from(mspCustomersTable)
            .where(inArray(mspCustomersTable.id, customerIds))
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
// consent status, purchased services (client_services, reached via the
// msp_users -> users.id bridge since client_services has no msp_customers FK
// of its own), and a summary of the most recent diagnostic runs. Read-only —
// no customer-level edit actions here (those live on the User Object phases).
router.get("/admin/active-directory/customer/:id", requireAdmin, async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId)) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }

  try {
    const [customerRow] = await db
      .select({
        id: mspCustomersTable.id,
        mspId: mspCustomersTable.mspId,
        name: mspCustomersTable.name,
        domain: mspCustomersTable.domain,
        industry: mspCustomersTable.industry,
        tenantId: mspCustomersTable.tenantId,
        status: mspCustomersTable.status,
        ownerType: mspCustomersTable.ownerType,
        isTestbed: mspCustomersTable.isTestbed,
        createdAt: mspCustomersTable.createdAt,
      })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);

    if (!customerRow) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const customerUserIds = await resolveCustomerUserIds(customerId);

    const [
      [owningMsp],
      userRows,
      [graphConsent],
      [sharePointConsent],
      [writeConsent],
      purchasedServiceRows,
      diagnosticRunRows,
    ] = await Promise.all([
      db.select({ id: mspsTable.id, name: mspsTable.name, slug: mspsTable.slug }).from(mspsTable).where(eq(mspsTable.id, customerRow.mspId)).limit(1),
      db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          mspRole: mspUsersTable.mspRole,
          isActive: mspUsersTable.isActive,
          lastLoginAt: mspUsersTable.lastLoginAt,
        })
        .from(mspUsersTable)
        .innerJoin(usersTable, eq(mspUsersTable.userId, usersTable.id))
        .where(eq(mspUsersTable.customerId, customerId))
        .orderBy(asc(usersTable.email)),
      db
        .select({
          tenantId: tenantConsentTable.tenantId,
          consentStatus: tenantConsentTable.consentStatus,
          consentedAt: tenantConsentTable.consentedAt,
          revokedAt: tenantConsentTable.revokedAt,
          adminEmail: tenantConsentTable.adminEmail,
        })
        .from(tenantConsentTable)
        .where(eq(tenantConsentTable.customerId, customerId))
        .limit(1),
      db
        .select({
          tenantId: tenantSharePointConsentTable.tenantId,
          consentStatus: tenantSharePointConsentTable.consentStatus,
          consentedAt: tenantSharePointConsentTable.consentedAt,
          revokedAt: tenantSharePointConsentTable.revokedAt,
          adminEmail: tenantSharePointConsentTable.adminEmail,
        })
        .from(tenantSharePointConsentTable)
        .where(eq(tenantSharePointConsentTable.customerId, customerId))
        .limit(1),
      db
        .select({
          tenantId: tenantWriteConsentTable.tenantId,
          consentStatus: tenantWriteConsentTable.consentStatus,
          consentedAt: tenantWriteConsentTable.consentedAt,
          revokedAt: tenantWriteConsentTable.revokedAt,
          adminEmail: tenantWriteConsentTable.adminEmail,
        })
        .from(tenantWriteConsentTable)
        .where(eq(tenantWriteConsentTable.customerId, customerId))
        .limit(1),
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
        customer: customerRow,
        owningMsp: owningMsp ?? null,
        users: userRows,
        graphConsent: graphConsent ?? null,
        sharePointConsent: sharePointConsent ?? null,
        writeConsent: writeConsent ?? null,
        purchasedServices: purchasedServiceRows,
        recentDiagnosticRuns: diagnosticRunRows,
      }),
    );
  } catch (err) {
    log.error({ err, customerId }, "Failed to build Customer Object detail pane");
    res.status(500).json({ error: "Failed to load Customer detail" });
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

export default router;
