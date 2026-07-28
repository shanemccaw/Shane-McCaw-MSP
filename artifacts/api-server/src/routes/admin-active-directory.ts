// artifacts/api-server/src/routes/admin-active-directory.ts
//
// Phase 1 of the Active Directory admin surface (initiative: active-directory,
// docs/build-plans/active-directory.md, Issue #61): read-only tree + universal
// search over real msps/msp_customers/msp_users/users rows. No write actions —
// those are Phases 7-9.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspsTable, mspCustomersTable, mspUsersTable, usersTable } from "@workspace/db";
import { eq, asc, inArray, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { buildMspTree, buildGroupNodes, searchDirectory, DIRECTORY_GROUP_ROLES } from "../lib/active-directory";

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

export default router;
