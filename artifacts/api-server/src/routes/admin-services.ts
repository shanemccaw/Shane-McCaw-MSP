import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, clientServicesTable, contractsTable, workflowTemplatesTable, contractTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { generateServiceOverviewPdf } from "../lib/service-overview-pdf";

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const SERVICE_PDF_DIR = path.join(UPLOADS_BASE, "service-pdfs");

function ensureServicePdfDir() {
  if (!fs.existsSync(SERVICE_PDF_DIR)) {
    fs.mkdirSync(SERVICE_PDF_DIR, { recursive: true });
  }
}

const stringArraySchema = z.array(z.string()).nullish();

function parseStringArray(v: unknown): string[] | null {
  const result = stringArraySchema.safeParse(v);
  if (!result.success || result.data == null) return null;
  const trimmed = result.data.map((s) => s.trim()).filter((s) => s.length > 0);
  return trimmed.length > 0 ? trimmed : null;
}

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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const {
      name, description, category, deliverables, price, basePrice, maxPrice, durationDays, turnaround,
      billingType, isPublic, slug,
      serviceType, tagline, targetAudience, inclusions, features, badge,
      highlighted, hoursPerMonth, iconName, pageHref, sortOrder, workflowTemplateId, tier,
    } = body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [updated] = await db
      .update(servicesTable)
      .set({
        name: name as string,
        description: (description as string | null) ?? null,
        category: (category as string | null) ?? null,
        deliverables: parseStringArray(deliverables),
        price: price != null ? String(price) : null,
        basePrice: basePrice != null ? String(basePrice) : null,
        maxPrice: maxPrice != null ? String(maxPrice) : null,
        durationDays: durationDays != null ? Number(durationDays) : null,
        turnaround: (turnaround as string | null) ?? null,
        billingType: ((billingType as string) ?? "one_time") as "one_time" | "recurring_monthly",
        isPublic: isPublic != null ? Boolean(isPublic) : true,
        slug: (slug as string | null) ?? null,
        serviceType: (serviceType as string | null) ?? null,
        tagline: (tagline as string | null) ?? null,
        targetAudience: (targetAudience as string | null) ?? null,
        inclusions: parseStringArray(inclusions),
        features: parseStringArray(features),
        badge: (badge as string | null) ?? null,
        highlighted: highlighted != null ? Boolean(highlighted) : false,
        hoursPerMonth: (hoursPerMonth as string | null) ?? null,
        iconName: (iconName as string | null) ?? null,
        pageHref: (pageHref as string | null) ?? null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        tier: (tier as string | null) ?? null,
        workflowTemplateId: workflowTemplateId != null ? Number(workflowTemplateId) : null,
      })
      .where(eq(servicesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Service not found" }); return; }
    res.json(updated);
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(500).json({ error: "Failed to update service" });
  }
});

router.post("/admin/services", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { name, slug, billingType, deliverables, inclusions, features } = body;
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
        deliverables: parseStringArray(deliverables),
        inclusions: parseStringArray(inclusions),
        features: parseStringArray(features),
      })
      .returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    req.log?.error(err);
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

    const blockers: string[] = [];

    const [clientSvc, contract, workflowTpl, contractTpl] = await Promise.all([
      db.select({ id: clientServicesTable.id }).from(clientServicesTable).where(eq(clientServicesTable.serviceId, id)).limit(1),
      db.select({ id: contractsTable.id }).from(contractsTable).where(eq(contractsTable.serviceId, id)).limit(1),
      db.select({ id: workflowTemplatesTable.id }).from(workflowTemplatesTable).where(eq(workflowTemplatesTable.serviceId, id)).limit(1),
      db.select({ id: contractTemplatesTable.id }).from(contractTemplatesTable).where(eq(contractTemplatesTable.serviceId, id)).limit(1),
    ]);

    if (clientSvc.length > 0) blockers.push("active client service assignments");
    if (contract.length > 0) blockers.push("contracts");
    if (workflowTpl.length > 0) blockers.push("workflow templates");
    if (contractTpl.length > 0) blockers.push("contract templates");

    if (blockers.length > 0) {
      res.status(409).json({
        error: `This service cannot be deleted because it is referenced by: ${blockers.join(", ")}. Remove those links first.`,
      });
      return;
    }

    const [deleted] = await db
      .delete(servicesTable)
      .where(eq(servicesTable.id, id))
      .returning({ id: servicesTable.id });

    if (!deleted) { res.status(404).json({ error: "Service not found" }); return; }
    res.status(204).end();
  } catch (err: unknown) {
    req.log?.error(err);
    const pg = err as { code?: string };
    if (pg.code === "23503") {
      res.status(409).json({ error: "This service is referenced by other records and cannot be deleted." });
      return;
    }
    res.status(500).json({ error: "Failed to delete service" });
  }
});

router.post("/admin/services/:id/generate-pdf", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, id)).limit(1);
    if (!service) { res.status(404).json({ error: "Service not found" }); return; }

    const pdfBuffer = await generateServiceOverviewPdf(service.name);
    if (!pdfBuffer) {
      res.status(422).json({ error: "Could not generate PDF — service data may be incomplete" });
      return;
    }

    ensureServicePdfDir();
    const filename = `${id}.pdf`;
    const filePath = path.join(SERVICE_PDF_DIR, filename);
    fs.writeFileSync(filePath, pdfBuffer);

    const pdfKey = `service-pdfs/${filename}`;
    const generatedAt = new Date();

    const [updated] = await db
      .update(servicesTable)
      .set({ overviewPdfKey: pdfKey, overviewPdfGeneratedAt: generatedAt })
      .where(eq(servicesTable.id, id))
      .returning();

    req.log.info({ serviceId: id, pdfKey }, "Service overview PDF generated");
    res.json({ overviewPdfKey: updated.overviewPdfKey, overviewPdfGeneratedAt: updated.overviewPdfGeneratedAt });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to generate service overview PDF");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.get("/admin/services/:id/overview-pdf", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [service] = await db
      .select({ id: servicesTable.id, name: servicesTable.name, overviewPdfKey: servicesTable.overviewPdfKey })
      .from(servicesTable)
      .where(eq(servicesTable.id, id))
      .limit(1);

    if (!service) { res.status(404).json({ error: "Service not found" }); return; }
    if (!service.overviewPdfKey) { res.status(404).json({ error: "No PDF generated yet" }); return; }

    const filePath = path.join(UPLOADS_BASE, service.overviewPdfKey);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "PDF file not found on disk — regenerate it" });
      return;
    }

    const safeName = service.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    res.download(filePath, `${safeName}-overview.pdf`);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to serve service overview PDF");
    res.status(500).json({ error: "Failed to serve PDF" });
  }
});

export default router;
