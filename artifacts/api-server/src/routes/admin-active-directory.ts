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
} from "../lib/active-directory";

const router: IRouter = Router();
const log = logger.child({ channel: "admin.active-directory" });

// ─── GET /admin/active-directory/tree ────────────────────────────────────────
// OU=MSPs (every real MSP, each with its real customers nested underneath) +
// Groups (one node per RBAC role, with a live count).
router.get("/admin/active-directory/tree", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [msps, customers, roleCountRows] = await Promise.all([
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
    ]);

    res.json({
      msps: buildMspTree(msps, customers),
      groups: buildGroupNodes(roleCountRows.map((r) => ({ role: r.role, count: Number(r.count) }))),
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

export default router;
