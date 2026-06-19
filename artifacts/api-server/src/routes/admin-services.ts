import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, clientServicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/services", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const services = await db.select().from(servicesTable).orderBy(servicesTable.sortOrder, servicesTable.createdAt);
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
    const body = req.body as Record<string, unknown>;
    const {
      name, description, category, deliverables, price, durationDays, turnaround,
      billingType, isPublic, slug,
      serviceType, tagline, targetAudience, inclusions, features, badge,
      highlighted, hoursPerMonth, iconName, pageHref, sortOrder,
    } = body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [updated] = await db
      .update(servicesTable)
      .set({
        name: name as string,
        description: (description as string | null) ?? null,
        category: (category as string | null) ?? null,
        deliverables: (deliverables as string | null) ?? null,
        price: price != null ? String(price) : null,
        durationDays: durationDays != null ? Number(durationDays) : null,
        turnaround: (turnaround as string | null) ?? null,
        billingType: ((billingType as string) ?? "one_time") as "one_time" | "recurring_monthly",
        isPublic: isPublic != null ? Boolean(isPublic) : true,
        slug: (slug as string | null) ?? null,
        serviceType: (serviceType as string | null) ?? null,
        tagline: (tagline as string | null) ?? null,
        targetAudience: (targetAudience as string | null) ?? null,
        inclusions: Array.isArray(inclusions) ? (inclusions as string[]) : null,
        features: Array.isArray(features) ? (features as string[]) : null,
        badge: (badge as string | null) ?? null,
        highlighted: highlighted != null ? Boolean(highlighted) : false,
        hoursPerMonth: (hoursPerMonth as string | null) ?? null,
        iconName: (iconName as string | null) ?? null,
        pageHref: (pageHref as string | null) ?? null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
      })
      .where(eq(servicesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Service not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update service" });
  }
});

router.post("/admin/services", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const { name, slug, billingType } = body;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" }); return;
    }
    if (!slug || typeof slug !== "string" || !slug.trim()) {
      res.status(400).json({ error: "slug is required" }); return;
    }
    const [created] = await db
      .insert(servicesTable)
      .values({
        name: name.trim(),
        slug: slug.trim(),
        billingType: ((billingType as string) === "recurring_monthly" ? "recurring_monthly" : "one_time") as "one_time" | "recurring_monthly",
      })
      .returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({ error: "A service with that slug already exists." }); return;
    }
    res.status(500).json({ error: "Failed to create service" });
  }
});

router.delete("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const linked = await db
      .select({ id: clientServicesTable.id })
      .from(clientServicesTable)
      .where(eq(clientServicesTable.serviceId, id))
      .limit(1);

    if (linked.length > 0) {
      res.status(409).json({ error: "This service is assigned to one or more clients and cannot be deleted." });
      return;
    }

    const [deleted] = await db
      .delete(servicesTable)
      .where(eq(servicesTable.id, id))
      .returning({ id: servicesTable.id });

    if (!deleted) { res.status(404).json({ error: "Service not found" }); return; }
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete service" });
  }
});

export default router;
