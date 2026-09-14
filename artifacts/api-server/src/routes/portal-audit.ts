/**
 * portal-audit.ts (#4047, Step 4 of 4 of #1946 Feature: Full Audit Log)
 *
 * Customer-facing read surface over the real `audit_logs` table (#4044's
 * widened schema) — everything that happened in the caller's own tenant,
 * including what the MSP did on their behalf. Real product transparency,
 * not a compliance checkbox.
 *
 * Tenant scoping is a hard boundary enforced in the query layer: `tenantId`
 * is always taken from the caller's own JWT (`req.user.customerId`, the
 * frozen claim name carrying `users.tenantId` → `tenants.id`), never from a
 * query param — there is no way for a caller to request another tenant's
 * rows.
 *
 * The coverage caveat (#1946's own architecture requirement) is real and
 * computed from the data, not fabricated: `action_category` is NULL on rows
 * written before the #4044 catalogue landed (2026-09-14) and is NOT
 * backfilled, so "categorized vs. uncategorized" is an honest, queryable
 * split. There is no source of truth anywhere in this codebase for "every
 * real action that should have been audited" (confirmed by search — no
 * route/workflow-step manifest exists), so this surface does NOT claim an
 * "X% of all actions" figure — that would be fabricated. It states plainly
 * that only instrumented actions appear here.
 *
 * Routes:
 *   GET /api/portal/audit            — list, cursor-paginated
 *   GET /api/portal/audit/catalogue  — real actionCategory/actorRole values for filter UIs
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireCapability } from "../middlewares/requireAuth.ts";
import {
  db,
  auditLogsTable,
  AUDIT_ACTION_CATEGORIES,
  AUDIT_ACTOR_ROLES,
  type AuditActionCategory,
  type AuditActorRole,
} from "@workspace/db";
import { eq, and, desc, lt, isNull, isNotNull, count, type SQL } from "drizzle-orm";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.audit" });

const router: IRouter = Router();

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

const ACTION_CATEGORY_SET = new Set<string>(AUDIT_ACTION_CATEGORIES);
const ACTOR_ROLE_SET = new Set<string>(AUDIT_ACTOR_ROLES);

router.get(
  "/portal/audit",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const tenantId = req.user!.customerId;
    if (!tenantId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    const beforeValid = before && !isNaN(before.getTime()) ? before : undefined;

    const actionCategoryRaw = req.query.actionCategory ? String(req.query.actionCategory) : undefined;
    const actionCategory: AuditActionCategory | undefined =
      actionCategoryRaw && ACTION_CATEGORY_SET.has(actionCategoryRaw) ? (actionCategoryRaw as AuditActionCategory) : undefined;

    const actorRoleRaw = req.query.actorRole ? String(req.query.actorRole) : undefined;
    const actorRole: AuditActorRole | undefined =
      actorRoleRaw && ACTOR_ROLE_SET.has(actorRoleRaw) ? (actorRoleRaw as AuditActorRole) : undefined;

    const entityType = req.query.entityType && req.query.entityType !== "all" ? String(req.query.entityType) : undefined;

    try {
      // The hard tenant boundary: this condition is never conditional and
      // never derived from client input.
      const tenantScope = eq(auditLogsTable.tenantId, tenantId);

      const listConditions: SQL[] = [tenantScope];
      if (actionCategory) listConditions.push(eq(auditLogsTable.actionCategory, actionCategory));
      if (actorRole) listConditions.push(eq(auditLogsTable.actorRole, actorRole));
      if (entityType) listConditions.push(eq(auditLogsTable.entityType, entityType));
      if (beforeValid) listConditions.push(lt(auditLogsTable.createdAt, beforeValid));

      const [entries, [categorizedRow], [uncategorizedRow]] = await Promise.all([
        db
          .select()
          .from(auditLogsTable)
          .where(and(...listConditions))
          .orderBy(desc(auditLogsTable.createdAt))
          .limit(limit),
        // Coverage is computed over the tenant's whole trail (tenant boundary
        // only), independent of the list filters above, so the caveat always
        // describes the real state of the tenant's data, not a filtered slice.
        db.select({ n: count() }).from(auditLogsTable).where(and(tenantScope, isNotNull(auditLogsTable.actionCategory))),
        db.select({ n: count() }).from(auditLogsTable).where(and(tenantScope, isNull(auditLogsTable.actionCategory))),
      ]);

      const categorizedRows = categorizedRow?.n ?? 0;
      const uncategorizedRows = uncategorizedRow?.n ?? 0;
      const totalRows = categorizedRows + uncategorizedRows;

      const nextCursor = entries.length >= limit ? entries[entries.length - 1]!.createdAt.toISOString() : null;

      res.json({
        entries,
        nextCursor,
        coverage: {
          totalRows,
          categorizedRows,
          uncategorizedRows,
          categorizedPercent: totalRows > 0 ? Math.round((categorizedRows / totalRows) * 1000) / 10 : null,
        },
        coverageNote:
          "This shows every audited action for your organization. Actions from before the current " +
          "categorization system (rolled out 2026-09-14) appear as Uncategorized rather than being " +
          "reinterpreted. Audit instrumentation is still expanding across the platform — an action " +
          "with no entry here means it has not been instrumented yet, not that nothing happened.",
      });
    } catch (err) {
      log.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err, tenantId }, "portal-audit: failed to load audit trail");
      res.status(500).json({ error: "Unable to load your audit trail right now. Please try again shortly." });
    }
  },
);

router.get(
  "/portal/audit/catalogue",
  requireCapability("ladder.customer-user"),
  (_req: Request, res: Response) => {
    res.json({ actionCategories: AUDIT_ACTION_CATEGORIES, actorRoles: AUDIT_ACTOR_ROLES });
  },
);

export default router;
