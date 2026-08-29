/**
 * portal-settings-departments.ts — the Settings page's "Departments" section,
 * persisted (Git #1592).
 *
 *   GET    /api/portal/settings/departments
 *   PUT    /api/portal/settings/departments/:name/mapping
 *   DELETE /api/portal/settings/departments/:name/mapping
 *
 * ── Why this route exists at all ─────────────────────────────────────────────
 * `portal-v2-settings.tsx`'s Departments section was 100% client-only React
 * state (`DEPT_ROWS` fixture, "Set by group" a no-op stub) — flagged honestly
 * by #1463's `pv2-set-dept-nodata` badge. This is that backend.
 *
 * ── Real headcounts, real overlay ────────────────────────────────────────────
 * The department LIST and its `n` counts are computed live from
 * `users.department` for this tenant's active users — the same column and the
 * same scoping `portal-ownership.ts` already reads. Nothing about that is
 * stored here; storing a headcount would go stale the moment a user changes.
 * `portal_department_mappings` stores only the durable choice: read a named
 * department from a security group instead of the Entra attribute. A mapped
 * department's live count is not corrected by the mapping (this platform has
 * no facility yet to read live security-group membership from Microsoft
 * Graph) — GET returns the mapping's own fields alongside the attribute-based
 * count so the eventual UI can show BOTH the source it is configured to use
 * and what the attribute currently reports.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, portalDepartmentMappingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId } from "../lib/portal-customer-scope";
import { logger } from "../lib/logger";
import { groupByDepartment, isPortalDepartmentSource, isPortalDepartmentUnmappedFallback } from "../lib/portal-settings-departments";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

interface WireDepartmentRow {
  readonly name: string;
  readonly n: number;
  readonly src: "attribute" | "group";
  readonly group: string;
  readonly unmappedFallback: "unmapped" | "attribute_fallback";
}

interface WireDepartmentsPayload {
  readonly departments: readonly WireDepartmentRow[];
  readonly unmapped: number;
}

router.get(
  "/portal/settings/departments",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [userRows, mappingRows] = await Promise.all([
        db
          .select({ department: usersTable.department })
          .from(usersTable)
          .where(and(eq(usersTable.tenantId, customerId), eq(usersTable.isActive, true))),
        db
          .select()
          .from(portalDepartmentMappingsTable)
          .where(eq(portalDepartmentMappingsTable.customerId, customerId)),
      ]);

      const { counts, unmapped } = groupByDepartment(userRows);
      const mappingByName = new Map(mappingRows.map((m) => [m.departmentName, m]));

      // Every real department the attribute reports, PLUS every department a
      // customer has mapped by group even if it currently has zero attribute
      // members (a group-mapped department is a real settings object the
      // moment it is saved, not only once someone's attribute matches it).
      const names = new Set<string>([...counts.map((c) => c.name), ...mappingRows.map((m) => m.departmentName)]);
      const countByName = new Map(counts.map((c) => [c.name, c.n]));

      const departments: WireDepartmentRow[] = Array.from(names)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => {
          const mapping = mappingByName.get(name);
          return {
            name,
            n: countByName.get(name) ?? 0,
            src: mapping?.source ?? "attribute",
            group: mapping?.securityGroupName ?? mapping?.securityGroupId ?? "Not set",
            unmappedFallback: mapping?.unmappedFallback ?? "attribute_fallback",
          };
        });

      const payload: WireDepartmentsPayload = { departments, unmapped };

      log.info({ customerId, departments: departments.length, unmapped }, "portal settings departments served");
      res.json(payload);
    } catch (err) {
      log.error({ customerId, err: err instanceof Error ? err.message : String(err) }, "portal settings departments read failed");
      res.status(500).json({ error: "Departments could not be loaded." });
    }
  },
);

router.put(
  "/portal/settings/departments/:name/mapping",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const departmentName = req.params.name as string;
    if (!departmentName) {
      res.status(400).json({ error: "A department name is required" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const source = isPortalDepartmentSource(body.source) ? body.source : "group";
    const securityGroupId = typeof body.securityGroupId === "string" && body.securityGroupId ? body.securityGroupId : null;
    const securityGroupName = typeof body.securityGroupName === "string" && body.securityGroupName ? body.securityGroupName : null;
    const unmappedFallback = isPortalDepartmentUnmappedFallback(body.unmappedFallback) ? body.unmappedFallback : "attribute_fallback";

    if (source === "group" && !securityGroupId) {
      res.status(400).json({ error: "securityGroupId is required to map by group" });
      return;
    }

    try {
      await db
        .insert(portalDepartmentMappingsTable)
        .values({ customerId, departmentName, source, securityGroupId, securityGroupName, unmappedFallback })
        .onConflictDoUpdate({
          target: [portalDepartmentMappingsTable.customerId, portalDepartmentMappingsTable.departmentName],
          set: { source, securityGroupId, securityGroupName, unmappedFallback, updatedAt: new Date() },
        });

      log.info({ customerId, departmentName, source }, "portal settings department mapping saved");
      res.json({ ok: true, name: departmentName, src: source, group: securityGroupName ?? securityGroupId ?? "Not set", unmappedFallback });
    } catch (err) {
      log.error({ customerId, departmentName, err: err instanceof Error ? err.message : String(err) }, "portal settings department mapping save failed");
      res.status(500).json({ error: "That department mapping could not be saved." });
    }
  },
);

/** Reverts a department to reading from the Entra attribute (the default) by
 *  removing its mapping overlay row entirely — the reciprocal of PUT above,
 *  which the design's own drawer had no way to undo. */
router.delete(
  "/portal/settings/departments/:name/mapping",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const departmentName = req.params.name as string;
    try {
      const deleted = await db
        .delete(portalDepartmentMappingsTable)
        .where(and(eq(portalDepartmentMappingsTable.customerId, customerId), eq(portalDepartmentMappingsTable.departmentName, departmentName)))
        .returning({ id: portalDepartmentMappingsTable.id });

      log.info({ customerId, departmentName, removed: deleted.length > 0 }, "portal settings department mapping cleared");
      res.json({ ok: true, removed: deleted.length > 0 });
    } catch (err) {
      log.error({ customerId, departmentName, err: err instanceof Error ? err.message : String(err) }, "portal settings department mapping clear failed");
      res.status(500).json({ error: "That department mapping could not be cleared." });
    }
  },
);

export default router;
