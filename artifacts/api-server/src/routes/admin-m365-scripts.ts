/**
 * admin-m365-scripts.ts
 *
 * App Registration requirements aggregator for M365 service script sets.
 *
 * GET /api/admin/appreg/requirements?serviceId=X
 *   Returns the union of all app_reg_permissions across all script packages
 *   linked to the given service via the service_script_sets join table.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, serviceScriptSetsTable, scriptPackagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── App Registration Requirements ─────────────────────────────────────────────

router.get("/admin/appreg/requirements", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = req.query.serviceId ? parseInt(String(req.query.serviceId)) : NaN;
  if (isNaN(serviceId)) {
    res.status(400).json({ error: "serviceId query parameter is required" });
    return;
  }

  try {
    const rows = await db
      .select({ permissions: scriptPackagesTable.permissions })
      .from(serviceScriptSetsTable)
      .innerJoin(scriptPackagesTable, eq(serviceScriptSetsTable.scriptPackageId, scriptPackagesTable.id))
      .where(eq(serviceScriptSetsTable.serviceId, serviceId));

    const seenApp = new Set<string>();
    const seenDel = new Set<string>();
    const applicationPermissions: string[] = [];
    const delegatedPermissions: string[] = [];

    for (const row of rows) {
      const perms = row.permissions;
      if (!perms) continue;
      for (const p of perms.appPermissions ?? []) {
        if (!seenApp.has(p)) { seenApp.add(p); applicationPermissions.push(p); }
      }
      for (const p of perms.delegatedPermissions ?? []) {
        if (!seenDel.has(p)) { seenDel.add(p); delegatedPermissions.push(p); }
      }
    }

    const totalPermissions = applicationPermissions.length + delegatedPermissions.length;

    res.json({
      serviceId,
      totalPackages: rows.length,
      totalPermissions,
      applicationPermissions,
      delegatedPermissions,
      instructions: totalPermissions === 0
        ? "No App Registration permissions are required for script packages linked to this service."
        : [
            "In Azure AD, navigate to: App Registrations → [your app] → API permissions → Add a permission → Microsoft Graph.",
            "Grant the following permissions, then click 'Grant admin consent':",
            ...applicationPermissions.map(p => `  [Application] ${p}`),
            ...delegatedPermissions.map(p => `  [Delegated]   ${p}`),
          ],
    });
  } catch (err) {
    logger.error({ err, serviceId }, "admin-m365-scripts: failed to build appreg requirements");
    res.status(500).json({ error: "Failed to build App Registration requirements" });
  }
});

export default router;
