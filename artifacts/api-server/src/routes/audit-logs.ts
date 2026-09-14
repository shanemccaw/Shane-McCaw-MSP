import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  auditLogsTable,
  usersTable,
  tenantsTable,
  AUDIT_ACTION_CATEGORIES,
  AUDIT_ACTOR_ROLES,
  type AuditActionCategory,
  type AuditActorRole,
} from "@workspace/db";
import { eq, and, desc, count, gte, lte, isNull, isNotNull, type SQL } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth.ts";

const router: IRouter = Router();

const PAGE_SIZE = 25;

const ACTION_CATEGORY_SET = new Set<string>(AUDIT_ACTION_CATEGORIES);
const ACTOR_ROLE_SET = new Set<string>(AUDIT_ACTOR_ROLES);

// Cross-tenant visibility for this route is a hard boundary enforced by the
// requireAdmin gate itself, not a UI filter: there is no per-tenant
// restriction below unless the caller explicitly asks for one via
// `tenantId` (an admin choosing to narrow their own view, not a customer
// escaping a boundary they're inside).
router.get("/audit-logs", requireAdmin, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const offset = (page - 1) * PAGE_SIZE;

  const limit = req.query.limit
    ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10)))
    : PAGE_SIZE;

  const conditions: SQL[] = [];

  if (req.query.clientId) {
    const cid = parseInt(String(req.query.clientId), 10);
    if (!isNaN(cid)) conditions.push(eq(auditLogsTable.clientId, cid));
  }

  if (req.query.projectId) {
    const pid = parseInt(String(req.query.projectId), 10);
    if (!isNaN(pid)) conditions.push(eq(auditLogsTable.projectId, pid));
  }

  if (req.query.tenantId) {
    const tid = parseInt(String(req.query.tenantId), 10);
    if (!isNaN(tid)) conditions.push(eq(auditLogsTable.tenantId, tid));
  }

  if (req.query.entityType && req.query.entityType !== "all") {
    conditions.push(eq(auditLogsTable.entityType, String(req.query.entityType)));
  }

  const actorRoleRaw = req.query.actorRole ? String(req.query.actorRole) : undefined;
  if (actorRoleRaw && actorRoleRaw !== "all" && ACTOR_ROLE_SET.has(actorRoleRaw)) {
    conditions.push(eq(auditLogsTable.actorRole, actorRoleRaw as AuditActorRole));
  }

  const actionCategoryRaw = req.query.actionCategory ? String(req.query.actionCategory) : undefined;
  let actionCategoryFilter: SQL | undefined;
  if (actionCategoryRaw === "uncategorized") {
    actionCategoryFilter = isNull(auditLogsTable.actionCategory);
  } else if (actionCategoryRaw && actionCategoryRaw !== "all" && ACTION_CATEGORY_SET.has(actionCategoryRaw)) {
    actionCategoryFilter = eq(auditLogsTable.actionCategory, actionCategoryRaw as AuditActionCategory);
  }
  if (actionCategoryFilter) conditions.push(actionCategoryFilter);

  if (req.query.from) {
    const d = new Date(String(req.query.from));
    if (!isNaN(d.getTime())) conditions.push(gte(auditLogsTable.createdAt, d));
  }

  if (req.query.to) {
    const d = new Date(String(req.query.to));
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogsTable.createdAt, d));
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Coverage caveat: categorized/uncategorized counts over the same filtered
  // scope, EXCLUDING the actionCategory filter itself (filtering by category
  // and then reporting category coverage would be circular).
  const coverageConditions = conditions.filter((c) => c !== actionCategoryFilter);
  const coverageWhere = coverageConditions.length > 0 ? and(...coverageConditions) : undefined;

  const [[totalRow], [categorizedRow], [uncategorizedRow], entries] = await Promise.all([
    db.select({ count: count() }).from(auditLogsTable).where(where),
    db.select({ count: count() }).from(auditLogsTable).where(coverageWhere ? and(coverageWhere, isNotNull(auditLogsTable.actionCategory)) : isNotNull(auditLogsTable.actionCategory)),
    db.select({ count: count() }).from(auditLogsTable).where(coverageWhere ? and(coverageWhere, isNull(auditLogsTable.actionCategory)) : isNull(auditLogsTable.actionCategory)),
    db.select().from(auditLogsTable)
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const categorizedRows = categorizedRow?.count ?? 0;
  const uncategorizedRows = uncategorizedRow?.count ?? 0;
  const coverageTotal = categorizedRows + uncategorizedRows;

  res.json({
    entries,
    total: totalRow?.count ?? 0,
    page,
    pageSize: limit,
    coverage: {
      totalRows: coverageTotal,
      categorizedRows,
      uncategorizedRows,
      categorizedPercent: coverageTotal > 0 ? Math.round((categorizedRows / coverageTotal) * 1000) / 10 : null,
    },
    coverageNote:
      "Rows shown are the real audited trail. Entries from before the action-category system " +
      "(rolled out 2026-09-14) appear as Uncategorized rather than being reinterpreted. An action " +
      "with no row here has not been instrumented yet, not confirmed absent.",
  });
});

router.get("/audit-logs/catalogue", requireAdmin, (_req: Request, res: Response) => {
  res.json({ actionCategories: AUDIT_ACTION_CATEGORIES, actorRoles: AUDIT_ACTOR_ROLES });
});

router.get("/audit-logs/tenants", requireAdmin, async (_req: Request, res: Response) => {
  const tenants = await db.select({ id: tenantsTable.id, name: tenantsTable.customerName })
    .from(tenantsTable)
    .orderBy(tenantsTable.customerName);
  res.json(tenants);
});

router.get("/audit-logs/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const offset = (page - 1) * PAGE_SIZE;

  const where = eq(auditLogsTable.clientId, userId);

  const [totalRow] = await db.select({ count: count() }).from(auditLogsTable).where(where);
  const entries = await db.select().from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  res.json({ entries, total: totalRow?.count ?? 0, page, pageSize: PAGE_SIZE });
});

router.get("/audit-logs/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.role, "client"))
    .orderBy(usersTable.name);
  res.json(clients);
});

export default router;
