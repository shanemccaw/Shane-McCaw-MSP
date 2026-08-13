/**
 * admin-m365-scripts.ts
 *
 * App Registration requirements aggregator.
 *
 * GET /api/admin/appreg/requirements?serviceId=X
 *   Returns an empty permission set. The service_script_sets join table was
 *   dropped in the services catalog cleanup; app-reg requirements are now
 *   derived from the service's requiredAppPermissions column directly.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/appreg/requirements", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = req.query.serviceId ? parseInt(String(req.query.serviceId)) : NaN;
  if (isNaN(serviceId)) {
    res.status(400).json({ error: "serviceId query parameter is required" });
    return;
  }

  try {
    // Read requiredAppPermissions from the service record itself (the old
    // service_script_sets join table was dropped in the catalog schema cleanup)
    const [service] = await db
      .select({ requiredAppPermissions: servicesTable.requiredAppPermissions })
      .from(servicesTable)
      .where(eq(servicesTable.id, serviceId))
      .limit(1);

    const applicationPermissions: string[] = [];
    const delegatedPermissions: string[] = [];

    if (service?.requiredAppPermissions) {
      for (const p of service.requiredAppPermissions) {
        if (typeof p === "object" && "scope" in p && p.scope) {
          applicationPermissions.push(p.scope);
        }
      }
    }

    res.json({ applicationPermissions, delegatedPermissions });
  } catch (err: unknown) {
    req.log?.error({ err }, "Failed to load app reg requirements");
    res.status(500).json({ error: "Failed to load requirements" });
  }
});

export default router;
