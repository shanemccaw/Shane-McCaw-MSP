import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, clientServicesTable, contractsTable, workflowTemplatesTable, contractTemplatesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { generateServiceOverviewPdf } from "../lib/service-overview-pdf";

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const SERVICE_PDF_DIR = path.join(UPLOADS_BASE, "service-pdfs");

/**
 * Persists a PDF buffer to disk under a deterministic key derived from the
 * service ID (service-pdfs/{serviceId}.pdf) and returns the storage key.
 * Re-uses the same local-disk pattern as invoice PDF storage in portal.ts.
 */
function storePdfToDisk(serviceId: number, pdfBuffer: Buffer): string {
  if (!fs.existsSync(SERVICE_PDF_DIR)) {
    fs.mkdirSync(SERVICE_PDF_DIR, { recursive: true });
  }
  const filename = `${serviceId}.pdf`;
  const filePath = path.join(SERVICE_PDF_DIR, filename);
  fs.writeFileSync(filePath, pdfBuffer);
  return `service-pdfs/${filename}`;
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
      billingType, isPublic, visibility, slug,
      serviceType, tagline, targetAudience, inclusions, features, badge,
      highlighted, hoursPerMonth, iconName, pageHref, sortOrder, workflowTemplateId, tier,
      requiredAppPermissions,
      categoryPath, tags, customerAgreementTemplate, isFreeOffering,
      fulfillmentTypeKey, triggeringSignalKeys,
    } = body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const validVisibilities = ["public", "private", "landing_page_only"] as const;
    const resolvedVisibility = validVisibilities.includes(visibility as typeof validVisibilities[number])
      ? (visibility as "public" | "private" | "landing_page_only")
      : isPublic != null
        ? (Boolean(isPublic) ? "public" : "private")
        : undefined;
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
        isPublic: resolvedVisibility != null ? resolvedVisibility === "public" : (isPublic != null ? Boolean(isPublic) : false),
        visibility: resolvedVisibility ?? "private",
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
        requiredAppPermissions: Array.isArray(requiredAppPermissions)
          ? (requiredAppPermissions as { scope: string; reason: string }[])
          : null,
        categoryPath: (categoryPath as string | null) ?? null,
        tags: parseStringArray(tags),
        customerAgreementTemplate: (customerAgreementTemplate as string | null) ?? null,
        isFreeOffering: isFreeOffering != null ? Boolean(isFreeOffering) : false,
        fulfillmentTypeKey: (fulfillmentTypeKey as string | null) ?? null,
        triggeringSignalKeys: parseStringArray(triggeringSignalKeys),
        updatedAt: new Date(),
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
    const { name, slug, billingType, visibility, isPublic, deliverables, inclusions, features } = body;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" }); return;
    }
    if (!slug || typeof slug !== "string" || !slug.trim()) {
      res.status(400).json({ error: "slug is required" }); return;
    }
    const validVisibilitiesCreate = ["public", "private", "landing_page_only"] as const;
    const resolvedCreateVisibility = validVisibilitiesCreate.includes(visibility as typeof validVisibilitiesCreate[number])
      ? (visibility as "public" | "private" | "landing_page_only")
      : isPublic != null
        ? (Boolean(isPublic) ? "public" : "private")
        : "private";
    const [created] = await db
      .insert(servicesTable)
      .values({
        name: name.trim(),
        slug: slug.trim(),
        billingType: ((billingType as string) === "recurring_monthly" ? "recurring_monthly" : "one_time") as "one_time" | "recurring_monthly",
        visibility: resolvedCreateVisibility,
        isPublic: resolvedCreateVisibility === "public",
        deliverables: parseStringArray(deliverables),
        inclusions: parseStringArray(inclusions),
        features: parseStringArray(features),
      })
      .returning();
    res.status(201).json(created);
  } catch (err: unknown) {
    req.log?.error(err);
    const e = err as { code?: string; cause?: { code?: string }; message?: string };
    const isDupe = e.code === "23505" || e.cause?.code === "23505" || (typeof e.message === "string" && e.message.includes("services_slug_unique"));
    if (isDupe) {
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

router.patch("/admin/services/bulk-category", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { ids, categoryPath } = (req.body ?? {}) as { ids?: unknown; categoryPath?: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array" }); return;
    }
    const numIds = ids.map(Number).filter(n => !isNaN(n));
    const resolved = typeof categoryPath === "string" && categoryPath.trim() ? categoryPath.trim() : null;
    await db
      .update(servicesTable)
      .set({ categoryPath: resolved, updatedAt: new Date() })
      .where(inArray(servicesTable.id, numIds));
    res.json({ ok: true, updated: numIds.length });
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(500).json({ error: "Failed to bulk update category" });
  }
});

router.patch("/admin/services/reparent-category", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { fromPath, toParentPath } = (req.body ?? {}) as { fromPath?: unknown; toParentPath?: unknown };
    if (typeof fromPath !== "string" || !fromPath.trim()) {
      res.status(400).json({ error: "fromPath is required" }); return;
    }
    const from = fromPath.trim();
    const lastName = from.includes("/") ? from.split("/").pop()! : from;
    const toParent = typeof toParentPath === "string" && toParentPath.trim() ? toParentPath.trim() : null;
    const newPath = toParent ? `${toParent}/${lastName}` : lastName;

    if (newPath === from) { res.json({ ok: true, updated: 0 }); return; }

    // Escape LIKE special chars in fromPath for the prefix scan
    const escapedFrom = from.replace(/[%_\\]/g, (c) => `\\${c}`);

    await db.execute(sql`
      UPDATE services
      SET
        category_path = CASE
          WHEN category_path = ${from} THEN ${newPath}
          ELSE ${newPath} || SUBSTRING(category_path FROM ${from.length + 1})
        END,
        updated_at = NOW()
      WHERE
        category_path = ${from}
        OR category_path LIKE ${escapedFrom + "/%"}
    `);

    res.json({ ok: true, updated: null, newPath });
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(500).json({ error: "Failed to reparent category" });
  }
});

router.post("/admin/services/generate-all-pdfs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const allServices = await db.select({ id: servicesTable.id, name: servicesTable.name }).from(servicesTable);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    res.write(JSON.stringify({ type: "start", total: allServices.length }) + "\n");

    let succeeded = 0;
    let failed = 0;
    const failures: string[] = [];

    for (let i = 0; i < allServices.length; i++) {
      const service = allServices[i];
      if (!service) continue;
      try {
        const pdfBuffer = await generateServiceOverviewPdf(service.name);
        if (!pdfBuffer) throw new Error("No PDF generated");
        const pdfKey = storePdfToDisk(service.id, pdfBuffer);
        const generatedAt = new Date();
        await db.update(servicesTable).set({ overviewPdfKey: pdfKey, overviewPdfGeneratedAt: generatedAt }).where(eq(servicesTable.id, service.id));
        succeeded++;
        res.write(JSON.stringify({ type: "progress", done: i + 1, total: allServices.length, name: service.name, success: true }) + "\n");
      } catch (err) {
        failed++;
        failures.push(service.name);
        req.log.warn({ err, serviceId: service.id }, "bulk PDF: failed for service");
        res.write(JSON.stringify({ type: "progress", done: i + 1, total: allServices.length, name: service.name, success: false }) + "\n");
      }
    }

    res.write(JSON.stringify({ type: "done", succeeded, failed, failures }) + "\n");
    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed to bulk generate service overview PDFs");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDFs" });
    } else {
      res.write(JSON.stringify({ type: "error", message: "Unexpected error during bulk generation" }) + "\n");
      res.end();
    }
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

    const pdfKey = storePdfToDisk(id, pdfBuffer);
    const generatedAt = new Date();

    const [updated] = await db
      .update(servicesTable)
      .set({ overviewPdfKey: pdfKey, overviewPdfGeneratedAt: generatedAt })
      .where(eq(servicesTable.id, id))
      .returning();

    const pdfUrl = `/api/admin/services/${id}/overview-pdf`;
    req.log.info({ serviceId: id, pdfKey }, "Service overview PDF generated");
    res.json({ overviewPdfKey: updated.overviewPdfKey, overviewPdfGeneratedAt: updated.overviewPdfGeneratedAt, pdfUrl });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to generate service overview PDF");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.get("/admin/services/:id/pdf-url", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [service] = await db
      .select({ id: servicesTable.id, overviewPdfKey: servicesTable.overviewPdfKey })
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

    res.json({ url: `/api/admin/services/${id}/overview-pdf` });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to look up service overview PDF URL");
    res.status(500).json({ error: "Failed to retrieve PDF URL" });
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

// ─── POST /api/admin/services/publish-to-prod ────────────────────────────────
// Syncs all service catalog rows from dev to prod. Matches by slug (when present)
// then by name. Deletes prod services not matched by any dev service.
// Intentionally skips workflow_template_id (FK IDs differ between envs) and
// overview_pdf_key / overview_pdf_generated_at (disk-local file references).

router.post("/admin/services/publish-to-prod", requireAdmin, async (_req: Request, res: Response) => {
  const { isProdDbConfigured, buildProdDb } = await import("../lib/prod-db.ts");
  if (!isProdDbConfigured()) {
    res.status(503).json({ error: "Production database is not configured. Set DATABASE_URL_PROD in Replit Secrets." });
    return;
  }

  try {
    const devServices = await db.select().from(servicesTable).orderBy(servicesTable.sortOrder);

    const { pool: prodPool } = buildProdDb();
    const client = await prodPool.connect();
    let upserted = 0;
    let removed = 0;

    try {
      await client.query("BEGIN");

      // Index prod services by slug and name for matching
      const prodRows = await client.query("SELECT id, slug, name FROM services");
      const prodBySlug = new Map<string, number>();
      const prodByName = new Map<string, number>();
      for (const r of prodRows.rows as Array<{ id: number; slug: string | null; name: string }>) {
        if (r.slug) prodBySlug.set(r.slug, r.id);
        prodByName.set(r.name, r.id);
      }

      const touchedProdIds = new Set<number>();

      for (const s of devServices) {
        const prodId: number | undefined =
          (s.slug ? prodBySlug.get(s.slug) : undefined) ?? prodByName.get(s.name);

        const cols = [
          s.slug, s.name, s.description, s.category,
          JSON.stringify(s.deliverables ?? []),
          s.price, s.basePrice, s.maxPrice,
          s.orderWorkflow != null ? JSON.stringify(s.orderWorkflow) : null,
          s.durationDays, s.turnaround, s.billingType,
          s.isPublic, s.visibility, s.serviceType, s.tagline, s.targetAudience,
          s.inclusions != null ? JSON.stringify(s.inclusions) : null,
          s.features != null ? JSON.stringify(s.features) : null,
          s.badge, s.highlighted, s.hoursPerMonth, s.iconName,
          s.pageHref, s.pageSlug, s.sortOrder, s.tier, s.bestFor,
          s.triggers != null ? JSON.stringify(s.triggers) : null,
        ];

        if (prodId != null) {
          await client.query(`
            UPDATE services SET
              slug=$1, name=$2, description=$3, category=$4,
              deliverables=$5::jsonb, price=$6, base_price=$7, max_price=$8,
              order_workflow=$9::jsonb, duration_days=$10, turnaround=$11,
              billing_type=$12, is_public=$13, visibility=$14,
              service_type=$15, tagline=$16, target_audience=$17,
              inclusions=$18::jsonb, features=$19::jsonb,
              badge=$20, highlighted=$21, hours_per_month=$22, icon_name=$23,
              page_href=$24, page_slug=$25, sort_order=$26, tier=$27,
              best_for=$28, triggers=$29::jsonb, updated_at=now()
            WHERE id=$30`,
            [...cols, prodId]
          );
          touchedProdIds.add(prodId);
        } else {
          const result = await client.query(`
            INSERT INTO services (
              slug, name, description, category,
              deliverables, price, base_price, max_price,
              order_workflow, duration_days, turnaround, billing_type,
              is_public, visibility, service_type, tagline, target_audience,
              inclusions, features, badge, highlighted, hours_per_month, icon_name,
              page_href, page_slug, sort_order, tier, best_for, triggers
            ) VALUES (
              $1, $2, $3, $4,
              $5::jsonb, $6, $7, $8,
              $9::jsonb, $10, $11, $12,
              $13, $14, $15, $16, $17,
              $18::jsonb, $19::jsonb, $20, $21, $22, $23,
              $24, $25, $26, $27, $28, $29::jsonb
            ) RETURNING id`,
            cols
          );
          touchedProdIds.add((result.rows[0] as { id: number }).id);
        }
        upserted++;
      }

      // Delete prod services not matched to any dev service
      if (touchedProdIds.size > 0) {
        const ids = [...touchedProdIds];
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        const del = await client.query(`DELETE FROM services WHERE id NOT IN (${placeholders})`, ids);
        removed = del.rowCount ?? 0;
      } else {
        const del = await client.query("DELETE FROM services");
        removed = del.rowCount ?? 0;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
      await prodPool.end();
    }

    res.json({ ok: true, upserted, removed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to publish to production" });
  }
});

export default router;
