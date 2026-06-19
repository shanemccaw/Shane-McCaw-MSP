import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/services", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const services = await db.select().from(servicesTable).orderBy(servicesTable.createdAt);
    res.json(services);
  } catch {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

router.get("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, id)).limit(1);
    if (!service) { res.status(404).json({ error: "Service not found" }); return; }
    res.json(service);
  } catch {
    res.status(500).json({ error: "Failed to fetch service" });
  }
});

router.put("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { name, description, category, deliverables, price, durationDays, turnaround, billingType, isPublic, slug } =
      req.body as Record<string, string | number | boolean | null>;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [updated] = await db
      .update(servicesTable)
      .set({
        name: name as string,
        description: description as string | null ?? null,
        category: category as string | null ?? null,
        deliverables: deliverables as string | null ?? null,
        price: price != null ? String(price) : null,
        durationDays: durationDays != null ? Number(durationDays) : null,
        turnaround: turnaround as string | null ?? null,
        billingType: (billingType as "one_time" | "recurring_monthly") ?? "one_time",
        isPublic: isPublic != null ? Boolean(isPublic) : true,
        slug: slug as string | null ?? null,
      })
      .where(eq(servicesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Service not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update service" });
  }
});

export default router;
