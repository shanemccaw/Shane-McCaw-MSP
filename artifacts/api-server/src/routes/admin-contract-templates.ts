import { Router, type IRouter, type Request, type Response } from "express";
import { db, contractTemplatesTable, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/contract-templates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(contractTemplatesTable);
    res.json(templates);
  } catch {
    res.status(500).json({ error: "Failed to fetch contract templates" });
  }
});

router.get("/admin/contract-templates/:serviceId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const serviceId = Number(req.params.serviceId);
    if (isNaN(serviceId)) { res.status(400).json({ error: "Invalid serviceId" }); return; }

    const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId)).limit(1);
    if (!service) { res.status(404).json({ error: "Service not found" }); return; }

    const [template] = await db
      .select()
      .from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.serviceId, serviceId))
      .limit(1);

    if (!template) {
      res.json({ serviceId, body: "", version: "v1", updatedAt: null });
      return;
    }

    res.json(template);
  } catch {
    res.status(500).json({ error: "Failed to fetch contract template" });
  }
});

router.put("/admin/contract-templates/:serviceId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const serviceId = Number(req.params.serviceId);
    if (isNaN(serviceId)) { res.status(400).json({ error: "Invalid serviceId" }); return; }

    const { body } = req.body as { body?: string };
    if (body === undefined) { res.status(400).json({ error: "body is required" }); return; }

    const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId)).limit(1);
    if (!service) { res.status(404).json({ error: "Service not found" }); return; }

    const [existing] = await db
      .select()
      .from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.serviceId, serviceId))
      .limit(1);

    const now = new Date();

    if (existing) {
      const versionNum = parseInt(existing.version.replace("v", ""), 10);
      const newVersion = `v${(isNaN(versionNum) ? 1 : versionNum) + 1}`;
      const [updated] = await db
        .update(contractTemplatesTable)
        .set({ body, version: newVersion, updatedAt: now })
        .where(eq(contractTemplatesTable.serviceId, serviceId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(contractTemplatesTable)
        .values({ serviceId, body, version: "v1", updatedAt: now })
        .returning();
      res.status(201).json(created);
    }
  } catch {
    res.status(500).json({ error: "Failed to save contract template" });
  }
});

export default router;
