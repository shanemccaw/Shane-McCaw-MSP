import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, clientServicesTable, contractsTable, workflowTemplatesTable, contractTemplatesTable, projectsTable, workflowStepsTable, workflowTemplateStepsTable, workflowTemplateStepTasksTable, kanbanTasksTable, clientAppRegistrationsTable, type ServiceAssociatedDocument } from "@workspace/db";
import { eq, and, inArray, sql, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { generateServiceOverviewPdf } from "../lib/service-overview-pdf";
import { resolveCatalogPricing } from "../lib/catalog-pricing";
import { detectProductType, PRODUCT_TYPE_IMPORT_FIELDS, PRODUCT_TYPE_EXPORT_FIELDS, PRODUCT_TYPE_TEMPLATES, PRODUCT_TYPE_DEFAULT_FULFILLMENT_KEYS, type ProductTypeKey } from "../lib/productTypeConfig";
import { logger } from "../lib/logger.ts";
import { getSecretValue } from "../lib/azure-keyvault";
import { probeGraphPermissions } from "../lib/probe-graph-permissions";
import { createAuditLog } from "../lib/audit";
import { resolveTemplateTaskMetadata } from "../lib/template-task-metadata";
import { getDefaultSteps, seedDefaultWorkflowSteps } from "../lib/default-workflow-steps";
import { createNotification } from "../lib/notification-center";

const log = logger.child({ channel: "admin.content" });

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
  const filename = `service-${serviceId}-${Date.now()}.pdf`;
  const fullPath = path.join(SERVICE_PDF_DIR, filename);
  fs.writeFileSync(fullPath, pdfBuffer);
  return `service-pdfs/${filename}`;
}

const stringArraySchema = z.array(z.string()).nullish();

function parseStringArray(v: unknown): string[] | null {
  const result = stringArraySchema.safeParse(v);
  if (!result.success || result.data == null) return null;
  const trimmed = result.data.map((s) => s.trim()).filter((s) => s.length > 0);
  return trimmed.length > 0 ? trimmed : null;
}

// Associated documents — structured mapping that drives the Assessment document-
// generation workflow (docType + category select the generator path; customerVisible
// controls presentation inclusion). Distinct from the marketing `deliverables` array.
const associatedDocumentsSchema = z
  .array(
    z.object({
      docType: z.string().trim().min(1).max(120),
      category: z.enum(["report", "consulting"]),
      title: z.string().trim().min(1).max(300),
      customerVisible: z.boolean(),
    }),
  )
  .nullish();

function parseAssociatedDocuments(v: unknown): ServiceAssociatedDocument[] | null {
  const result = associatedDocumentsSchema.safeParse(v);
  if (!result.success || result.data == null) return null;
  return result.data.length > 0 ? result.data : null;
}

const router: IRouter = Router();

router.get("/admin/services", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const services = await db.select().from(servicesTable).orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt));
    res.json(services.map(s => ({
      ...s,
      ...resolveCatalogPricing({
        priceCents: s.priceCents ?? 0,
        internalCostCents: s.internalCostCents,
      })
    })));
  } catch (err) {
    log.error({ err }, "Error fetching services");
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

router.get("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, id)).limit(1);
    if (!service) { res.status(404).json({ error: "Service not found" }); return; }
    res.json({
      ...service,
      ...resolveCatalogPricing({
        priceCents: service.priceCents ?? 0,
        internalCostCents: service.internalCostCents,
      })
    });
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
      serviceClass, deliveryType, fulfillmentType,
      typeAttributes, associatedDocuments,
      priceCents, internalCostCents, annualPriceCents,
      bestFor, allowFreeCheckout,
    } = body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const validVisibilities = ["public", "private", "landing_page_only"] as const;
    const resolvedVisibility = validVisibilities.includes(visibility as typeof validVisibilities[number])
      ? (visibility as "public" | "private" | "landing_page_only")
      : isPublic != null
        ? (Boolean(isPublic) ? "public" : "private")
        : undefined;
    const validServiceClasses = ["project", "add_on", "subscription"] as const;
    const resolvedServiceClass = validServiceClasses.includes(serviceClass as typeof validServiceClasses[number])
      ? (serviceClass as "project" | "add_on" | "subscription")
      : null;
    const validDeliveryTypes = ["assessment", "bundle_subscription", "retainer", "document_generation", "none"] as const;
    const resolvedDeliveryType = validDeliveryTypes.includes(deliveryType as typeof validDeliveryTypes[number])
      ? (deliveryType as "assessment" | "bundle_subscription" | "retainer" | "document_generation" | "none")
      : null;
    const validFulfillmentTypes = ["standard", "msp_monthly_subscription"] as const;
    const resolvedFulfillmentType = validFulfillmentTypes.includes(fulfillmentType as typeof validFulfillmentTypes[number])
      ? (fulfillmentType as "standard" | "msp_monthly_subscription")
      : undefined;
    // ── Canonical cents columns: absent key means "leave unchanged" ───────────
    // Every other field on this handler is set unconditionally, so a key missing
    // from the body is written as NULL. That is wrong for the three integer-cents
    // columns, because the admin catalog editor's form schema does not contain
    // them (ServiceEditorShell.tsx `serviceSchema` carries price/basePrice/
    // maxPrice only) and neither does the duplicate-service payload
    // (CatalogProductList.tsx handleDuplicate). Every save through the catalog
    // editor therefore NULLed price_cents, internal_cost_cents and
    // annual_price_cents — silently destroying the canonical price written by
    // POST /admin/services (which writes ONLY price_cents), the MSP wholesale
    // cost, and an MSP tier's annual price. This is a primary producer of the
    // platform-wide "price lives only in the legacy decimal column, price_cents
    // NULL" rows (see lib/db/migrations/manual/2026-07-23-price-cents-backfill.sql).
    //
    // Presence-based, not value-based: an explicit `"priceCents": null` in the
    // body still clears the column, so deliberately unsetting a price still
    // works. Callers that do send the field (PlanManagement.tsx round-trips the
    // full GET payload) are unaffected.
    const centsColumnUpdates: {
      priceCents?: number | null;
      internalCostCents?: number | null;
      annualPriceCents?: number | null;
    } = {};
    if ("priceCents" in body) centsColumnUpdates.priceCents = priceCents != null ? Number(priceCents) : null;
    if ("internalCostCents" in body) centsColumnUpdates.internalCostCents = internalCostCents != null ? Number(internalCostCents) : null;
    if ("annualPriceCents" in body) centsColumnUpdates.annualPriceCents = annualPriceCents != null ? Number(annualPriceCents) : null;
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
        billingType: ((billingType as string) === "recurring_monthly" ? "recurring_monthly" : "one_time") as "one_time" | "recurring_monthly",
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
        fulfillmentTypeKey: (fulfillmentTypeKey as string | null)
          || (serviceType ? (PRODUCT_TYPE_DEFAULT_FULFILLMENT_KEYS[serviceType as string] ?? null) : null),
        triggeringSignalKeys: parseStringArray(triggeringSignalKeys),
        serviceClass: resolvedServiceClass,
        deliveryType: resolvedDeliveryType,
        ...(resolvedFulfillmentType !== undefined ? { fulfillmentType: resolvedFulfillmentType } : {}),
        typeAttributes: typeAttributes != null ? (typeAttributes as Record<string, unknown>) : undefined,
        associatedDocuments: parseAssociatedDocuments(associatedDocuments),
        bestFor: (bestFor as string | null) ?? null,
        ...(allowFreeCheckout != null ? { allowFreeCheckout: Boolean(allowFreeCheckout) } : {}),
        ...centsColumnUpdates,
        updatedAt: new Date(),
      })
      .where(eq(servicesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Service not found" }); return; }
    res.json({
      ...updated,
      ...resolveCatalogPricing({
        priceCents: updated.priceCents ?? 0,
        internalCostCents: updated.internalCostCents,
      })
    });
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(500).json({ error: "Failed to update service" });
  }
});

router.post("/admin/services", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { name, slug, description, billingType, visibility, isPublic, deliverables, inclusions, features, serviceClass, deliveryType, fulfillmentType, typeAttributes, serviceType, fulfillmentTypeKey, priceCents, internalCostCents, annualPriceCents, category, basePrice, maxPrice, sortOrder, tagline, bestFor, isFreeOffering, allowFreeCheckout } = body;
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
    const validServiceClassesCreate = ["project", "add_on", "subscription"] as const;
    const resolvedCreateServiceClass = validServiceClassesCreate.includes(serviceClass as typeof validServiceClassesCreate[number])
      ? (serviceClass as "project" | "add_on" | "subscription")
      : null;
    const validDeliveryTypesCreate = ["assessment", "bundle_subscription", "retainer", "document_generation", "none"] as const;
    const resolvedCreateDeliveryType = validDeliveryTypesCreate.includes(deliveryType as typeof validDeliveryTypesCreate[number])
      ? (deliveryType as "assessment" | "bundle_subscription" | "retainer" | "document_generation" | "none")
      : null;
    const resolvedBillingType: "one_time" | "recurring_monthly" =
      (billingType as string) === "recurring_monthly" ? "recurring_monthly" : "one_time";
    const [created] = await db
      .insert(servicesTable)
      .values({
        name: name.trim(),
        slug: slug.trim(),
        description: (description as string | null) ?? null,
        billingType: resolvedBillingType,
        visibility: resolvedCreateVisibility,
        isPublic: resolvedCreateVisibility === "public",
        deliverables: parseStringArray(deliverables),
        inclusions: parseStringArray(inclusions),
        features: parseStringArray(features),
        serviceClass: resolvedCreateServiceClass,
        deliveryType: resolvedCreateDeliveryType,
        fulfillmentType: (["standard", "msp_monthly_subscription"] as const).includes(fulfillmentType as "standard" | "msp_monthly_subscription")
          ? (fulfillmentType as "standard" | "msp_monthly_subscription")
          : "standard",
        serviceType: (serviceType as string | null) ?? null,
        fulfillmentTypeKey: (fulfillmentTypeKey as string | null)
          || (serviceType ? (PRODUCT_TYPE_DEFAULT_FULFILLMENT_KEYS[serviceType as string] ?? null) : null),
        typeAttributes: (typeAttributes != null && typeof typeAttributes === "object" && !Array.isArray(typeAttributes))
          ? (typeAttributes as Record<string, unknown>)
          : undefined,
        priceCents: priceCents != null ? Number(priceCents) : null,
        internalCostCents: internalCostCents != null ? Number(internalCostCents) : null,
        annualPriceCents: annualPriceCents != null ? Number(annualPriceCents) : null,
        category: (category as string | null) ?? null,
        basePrice: basePrice != null ? String(basePrice) : null,
        maxPrice: maxPrice != null ? String(maxPrice) : null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        tagline: (tagline as string | null) ?? null,
        bestFor: (bestFor as string | null) ?? null,
        isFreeOffering: isFreeOffering != null ? Boolean(isFreeOffering) : false,
        ...(allowFreeCheckout != null ? { allowFreeCheckout: Boolean(allowFreeCheckout) } : {}),
      })
      .returning();
    res.status(201).json({
      ...created,
      ...resolveCatalogPricing({
        priceCents: created.priceCents ?? 0,
        internalCostCents: created.internalCostCents,
      })
    });
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
          s.deliverables != null ? JSON.stringify(s.deliverables) : null,
          s.price, s.basePrice, s.maxPrice,
          s.durationDays, s.turnaround, s.billingType,
          s.isPublic, s.visibility, s.serviceType, s.tagline, s.targetAudience,
          s.inclusions != null ? JSON.stringify(s.inclusions) : null,
          s.features != null ? JSON.stringify(s.features) : null,
          s.badge, s.highlighted, s.hoursPerMonth, s.iconName,
          s.pageHref, s.sortOrder, s.tier,
          s.tags != null ? JSON.stringify(s.tags) : null,
          s.categoryPath, s.isFreeOffering, s.serviceClass, s.deliveryType,
          s.fulfillmentType ?? "standard",
          s.typeAttributes != null ? JSON.stringify(s.typeAttributes) : null,
          s.fulfillmentTypeKey,
          s.triggeringSignalKeys != null ? JSON.stringify(s.triggeringSignalKeys) : null,
        ];

        if (prodId != null) {
          await client.query(`
            UPDATE services SET
              slug=$1, name=$2, description=$3, category=$4,
              deliverables=$5::jsonb, price=$6, base_price=$7, max_price=$8,
              duration_days=$9, turnaround=$10,
              billing_type=$11, is_public=$12, visibility=$13,
              service_type=$14, tagline=$15, target_audience=$16,
              inclusions=$17::jsonb, features=$18::jsonb,
              badge=$19, highlighted=$20, hours_per_month=$21, icon_name=$22,
              page_href=$23, sort_order=$24, tier=$25,
              tags=$26::jsonb, category_path=$27,
              is_free_offering=$28, service_class=$29, delivery_type=$30,
              fulfillment_type=$31,
              type_attributes=$32::jsonb,
              fulfillment_type_key=$33,
              triggering_signal_keys=$34::jsonb,
              updated_at=now()
            WHERE id=$35`,
            [...cols, prodId]
          );
          touchedProdIds.add(prodId);
        } else {
          const result = await client.query(`
            INSERT INTO services (
              slug, name, description, category,
              deliverables, price, base_price, max_price,
              duration_days, turnaround, billing_type,
              is_public, visibility, service_type, tagline, target_audience,
              inclusions, features, badge, highlighted, hours_per_month, icon_name,
              page_href, sort_order, tier,
              tags, category_path, is_free_offering, service_class, delivery_type,
              fulfillment_type, type_attributes,
              fulfillment_type_key, triggering_signal_keys
            ) VALUES (
              $1, $2, $3, $4,
              $5::jsonb, $6, $7, $8,
              $9, $10, $11,
              $12, $13, $14, $15, $16,
              $17::jsonb, $18::jsonb, $19, $20, $21, $22,
              $23, $24, $25,
              $26::jsonb, $27, $28, $29, $30,
              $31, $32::jsonb, $33, $34::jsonb
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

// ── Export catalog as JSON (type-scoped) ──────────────────────────────────────

router.get("/admin/catalog/export", requireAdmin, async (req: Request, res: Response) => {
  try {
    const typeFilter = req.query.type as ProductTypeKey | undefined;
    const services = await db.select().from(servicesTable).orderBy(servicesTable.sortOrder, servicesTable.createdAt);
    const records = services
      .filter(s => {
        if (!typeFilter) return true;
        return detectProductType(s.serviceClass, s.deliveryType, s.billingType, s.fulfillmentType) === typeFilter;
      })
      .map(s => {
        const pType = detectProductType(s.serviceClass, s.deliveryType, s.billingType, s.fulfillmentType);
        const allowedFields = new Set(PRODUCT_TYPE_EXPORT_FIELDS[pType]);
        const raw: Record<string, unknown> = {
          slug: s.slug,
          name: s.name,
          label: s.name,
          description: s.description,
          category: s.category,
          categoryPath: s.categoryPath,
          tagline: s.tagline,
          serviceType: s.serviceType,
          billingType: s.billingType,
          price: s.price,
          basePrice: s.basePrice,
          maxPrice: s.maxPrice,
          durationDays: s.durationDays,
          turnaround: s.turnaround,
          isPublic: s.isPublic,
          isActive: s.isPublic,
          visibility: s.visibility,
          tier: s.tier,
          highlighted: s.highlighted,
          badge: s.badge,
          iconName: s.iconName,
          hoursPerMonth: s.hoursPerMonth,
          sortOrder: s.sortOrder,
          deliverables: s.deliverables,
          inclusions: s.inclusions,
          features: s.features,
          targetAudience: s.targetAudience,
          tags: s.tags,
          requiredAppPermissions: s.requiredAppPermissions,
          fulfillmentTypeKey: s.fulfillmentTypeKey,
          triggeringSignalKeys: s.triggeringSignalKeys,
          customerAgreementTemplate: s.customerAgreementTemplate,
          isFreeOffering: s.isFreeOffering,
          serviceClass: s.serviceClass,
          deliveryType: s.deliveryType,
          fulfillmentType: s.fulfillmentType,
          typeAttributes: s.typeAttributes ?? {},
        };
        const record: Record<string, unknown> = { _productType: pType };
        for (const [k, v] of Object.entries(raw)) {
          if (k === "label") { record.label = v; continue; }
          if (allowedFields.has(k)) record[k] = v;
        }
        return record;
      });
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      typeFilter: typeFilter ?? null,
      records,
      services: records,
    };
    const filename = typeFilter ? `services-${typeFilter}-export.json` : "services-export.json";
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Export failed" });
  }
});

// ── Import template (all 5 types) ─────────────────────────────────────────────

router.get("/admin/catalog/import-template", requireAdmin, (req: Request, res: Response) => {
  const typeFilter = req.query.type as ProductTypeKey | undefined;
  const allKeys: ProductTypeKey[] = ["credit_pack", "assessment", "project", "retainer", "monitoring_tier", "recurring_addon", "document_product", "platform_subscription_tier"];
  const keys = typeFilter && allKeys.includes(typeFilter) ? [typeFilter] : allKeys;
  const services = keys.map(k => ({ _productType: k, ...PRODUCT_TYPE_TEMPLATES[k] }));
  const template = { version: 1, services };
  const filename = typeFilter ? `services-${typeFilter}-template.json` : "services-import-template.json";
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(template);
});

// ── Import catalog from JSON (type-scoped validation) ─────────────────────────

router.post("/admin/catalog/import", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { version?: number; services?: unknown[]; records?: unknown[] };
    if (body.version !== undefined && body.version !== 1) {
      res.status(400).json({ error: `Unsupported export version: ${body.version}. Only version 1 is supported.` });
      return;
    }
    const serviceList = Array.isArray(body.records) ? body.records : body.services;
    if (!Array.isArray(serviceList)) {
      res.status(400).json({ error: "Body must contain a 'services' or 'records' array" });
      return;
    }
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of serviceList as Record<string, unknown>[]) {
      // Accept `label` as an alias for `name` to match the documented export schema.
      const name = String(item.name ?? item.label ?? "").trim();
      if (!name) { errors.push(`Record missing name/label — skipped`); skipped++; continue; }
      // Auto-derive slug from name if not provided so files using the minimal schema still import.
      const rawSlug = String(item.slug ?? "").trim();
      const slug = rawSlug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      // Detect product type and reject foreign fields.
      const pType = detectProductType(
        item.serviceClass as string | null,
        item.deliveryType as string | null,
        item.billingType as string | null,
        item.fulfillmentType as string | null,
      );
      const allowedFields = PRODUCT_TYPE_IMPORT_FIELDS[pType];
      const foreignFields = Object.keys(item).filter(k => {
        if (k === "_productType" || k === "label") return false;
        return !allowedFields.has(k);
      });
      if (foreignFields.length > 0) {
        errors.push(`Slug "${slug}" (${pType}): foreign fields not allowed for this type — ${foreignFields.join(", ")}. Skipped.`);
        skipped++;
        continue;
      }

      const resolvedBillingTypeImport: "one_time" | "recurring_monthly" =
        (item.billingType as string) === "recurring_monthly" ? "recurring_monthly" : "one_time";

      // ── Derive the canonical price_cents from the legacy decimal input ──────
      // No product type's import allow-list contains `priceCents`
      // (PRODUCT_TYPE_IMPORT_FIELDS, productTypeConfig.ts) — types carry `price`
      // and/or `basePrice` in dollars — and this INSERT did not list the
      // price_cents column at all. Every imported product therefore landed with
      // its real price in a legacy decimal column and price_cents NULL, which is
      // the primary source of the platform-wide NULL-price_cents population that
      // 2026-07-23-price-cents-backfill.sql repairs. Deriving it here stops the
      // import re-creating the problem on the next catalog load.
      //
      // Precedence is `price ?? basePrice`, identical to the canonical
      // resolveServicePriceCents (catalog-pricing.ts) — so the derived value can
      // never disagree with what checkout actually charges for the same row.
      // Non-numeric input derives NULL rather than NaN.
      const importLegacyDollars = item.price ?? item.basePrice;
      const importPriceCents =
        importLegacyDollars != null &&
        importLegacyDollars !== "" &&
        Number.isFinite(Number(importLegacyDollars))
          ? Math.round(Number(importLegacyDollars) * 100)
          : null;
      try {
        await db.execute(sql`
          INSERT INTO services (
            slug, name, description, category, category_path, tagline, service_type,
            billing_type, price, base_price, max_price, price_cents, duration_days, turnaround,
            is_public, visibility, tier, highlighted, badge, icon_name, hours_per_month,
            sort_order, deliverables, inclusions, features, target_audience, tags,
            required_app_permissions, fulfillment_type_key, triggering_signal_keys,
            customer_agreement_template, is_free_offering,
            service_class, delivery_type, fulfillment_type,
            type_attributes
          ) VALUES (
            ${slug}, ${name}, ${item.description ?? null}, ${item.category ?? null},
            ${item.categoryPath ?? null}, ${item.tagline ?? null}, ${item.serviceType ?? null},
            ${resolvedBillingTypeImport}, ${item.price ?? null}, ${item.basePrice ?? null},
            ${item.maxPrice ?? null}, ${importPriceCents},
            ${item.durationDays ?? null}, ${item.turnaround ?? null},
            ${item.isPublic ?? item.isActive ?? false}, ${item.visibility ?? "private"}, ${item.tier ?? null},
            ${item.highlighted ?? false}, ${item.badge ?? null}, ${item.iconName ?? null},
            ${item.hoursPerMonth ?? null}, ${item.sortOrder ?? 0},
            ${item.deliverables ? JSON.stringify(item.deliverables) : null}::jsonb,
            ${item.inclusions ? JSON.stringify(item.inclusions) : null}::jsonb,
            ${item.features ? JSON.stringify(item.features) : null}::jsonb,
            ${item.targetAudience ?? null},
            ${item.tags ? JSON.stringify(item.tags) : null}::jsonb,
            ${item.requiredAppPermissions ? JSON.stringify(item.requiredAppPermissions) : null}::jsonb,
            ${item.fulfillmentTypeKey ?? null},
            ${item.triggeringSignalKeys ? JSON.stringify(item.triggeringSignalKeys) : null}::jsonb,
            ${item.customerAgreementTemplate ?? null},
            ${item.isFreeOffering ?? false},
            ${item.serviceClass ?? null}, ${item.deliveryType ?? null},
            ${item.fulfillmentType ?? "standard"},
            ${item.typeAttributes ? JSON.stringify(item.typeAttributes) : null}::jsonb
          )
          ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            category_path = EXCLUDED.category_path,
            tagline = EXCLUDED.tagline,
            service_type = EXCLUDED.service_type,
            billing_type = EXCLUDED.billing_type,
            price = EXCLUDED.price,
            base_price = EXCLUDED.base_price,
            max_price = EXCLUDED.max_price,
            -- COALESCE, not a bare overwrite: a re-import of a record whose type
            -- carries no price field at all (e.g. monitoring_tier, priced entirely
            -- in type_attributes) derives NULL, and must not wipe a canonical
            -- price_cents that is already correct on the existing row.
            price_cents = COALESCE(EXCLUDED.price_cents, services.price_cents),
            duration_days = EXCLUDED.duration_days,
            turnaround = EXCLUDED.turnaround,
            is_public = EXCLUDED.is_public,
            visibility = EXCLUDED.visibility,
            tier = EXCLUDED.tier,
            highlighted = EXCLUDED.highlighted,
            badge = EXCLUDED.badge,
            icon_name = EXCLUDED.icon_name,
            hours_per_month = EXCLUDED.hours_per_month,
            sort_order = EXCLUDED.sort_order,
            deliverables = EXCLUDED.deliverables,
            inclusions = EXCLUDED.inclusions,
            features = EXCLUDED.features,
            target_audience = EXCLUDED.target_audience,
            tags = EXCLUDED.tags,
            required_app_permissions = EXCLUDED.required_app_permissions,
            fulfillment_type_key = EXCLUDED.fulfillment_type_key,
            triggering_signal_keys = EXCLUDED.triggering_signal_keys,
            customer_agreement_template = EXCLUDED.customer_agreement_template,
            is_free_offering = EXCLUDED.is_free_offering,
            service_class = EXCLUDED.service_class,
            delivery_type = EXCLUDED.delivery_type,
            fulfillment_type = EXCLUDED.fulfillment_type,
            type_attributes = EXCLUDED.type_attributes,
            updated_at = now()
        `);
        imported++;
      } catch (e) {
        errors.push(`Slug "${slug}": ${e instanceof Error ? e.message : String(e)}`);
        skipped++;
      }
    }
    res.json({ imported, skipped, errors });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

// ─── Relocated from portal.ts (#175 decommission) ────────────────────────────

/**
 * Aggregates the union of appPermissions across all script packages linked
 * to the client's active service(s) via the service_script_sets join table.
 */
async function getRequiredPermissionsForClient(clientUserId: number): Promise<string[]> {
  const activeServices = await db
    .select({ serviceId: clientServicesTable.serviceId })
    .from(clientServicesTable)
    .where(
      and(
        eq(clientServicesTable.clientUserId, clientUserId),
        eq(clientServicesTable.status, "active"),
      ),
    );

  if (activeServices.length === 0) return [];

  const serviceIds = activeServices.map(s => s.serviceId);

  // Aggregate required App Registration scopes from services.requiredAppPermissions (jsonb).
  // This replaced the old service_required_scripts join table (dropped in migration 0177).
  const serviceRows = await db
    .select({ requiredAppPermissions: servicesTable.requiredAppPermissions })
    .from(servicesTable)
    .where(inArray(servicesTable.id, serviceIds));

  const seen = new Set<string>();
  const result: string[] = [];
  for (const svc of serviceRows) {
    for (const p of svc.requiredAppPermissions ?? []) {
      const scope = p.scope;
      if (!seen.has(scope)) { seen.add(scope); result.push(scope); }
    }
  }
  return result;
}

/**
 * Re-probes Graph permissions for a client in the background after their active
 * services change. Uses the credentials already stored in Key Vault — never asks
 * the client to re-enter them.
 *
 * Safe to call fire-and-forget (never throws; all errors are logged as warnings).
 */
async function reProbeClientPermissionsInBackground(clientUserId: number): Promise<void> {
  try {
    // 1. Only proceed if the client has a verified App Registration
    const [appReg] = await db
      .select()
      .from(clientAppRegistrationsTable)
      .where(
        and(
          eq(clientAppRegistrationsTable.clientUserId, clientUserId),
          eq(clientAppRegistrationsTable.status, "verified"),
        ),
      );
    if (!appReg) return;

    // 2. Gather permissions required by all active services
    const requiredPermissions = await getRequiredPermissionsForClient(clientUserId);
    if (requiredPermissions.length === 0) return;

    // 3. Retrieve the stored client secret from Key Vault
    let clientSecret: string;
    try {
      clientSecret = await getSecretValue(appReg.keyVaultSecretName);
    } catch (kvErr) {
      log.warn(
        { kvErr, clientUserId },
        "re-probe: could not retrieve client secret from Key Vault — skipping permission re-check",
      );
      return;
    }

    // 4. Run the permission probe (never throws)
    const probeResult = await probeGraphPermissions(
      appReg.tenantId,
      appReg.azureClientId,
      clientSecret,
      requiredPermissions,
    );

    // 5. Persist the fresh result
    await db
      .update(clientAppRegistrationsTable)
      .set({ permissionCheck: probeResult, updatedAt: new Date() })
      .where(eq(clientAppRegistrationsTable.clientUserId, clientUserId));

    log.info(
      {
        clientUserId,
        granted: probeResult.granted.length,
        missing: probeResult.missing.length,
        unverifiable: probeResult.unverifiable.length,
      },
      "re-probe: permission_check refreshed after service change",
    );

    // 6. Notify the client if newly required permissions are missing
    if (probeResult.missing.length > 0) {
      await createNotification({
        title: "Action required: App Registration permissions",
        body: `Your services have been updated and your Microsoft 365 App Registration is now missing ${probeResult.missing.length} required permission${probeResult.missing.length === 1 ? "" : "s"}. Please visit the App Registration page to grant them.`,
        notifType: "general",
        category: "system",
        linkPath: "/portal/app-registration",
        recipient: { type: "customer_user", userId: clientUserId },
      });
    }
  } catch (err) {
    log.warn({ err, clientUserId }, "re-probe: background permission re-check failed (non-fatal)");
  }
}

// ─── ADMIN: Services ─────────────────────────────────────────────────────────
router.get("/admin/services", requireAdmin, async (_req: Request, res: Response) => {
  const services = await db.select().from(servicesTable).orderBy(asc(servicesTable.name));
  res.json(services);
});

router.post("/admin/services", requireAdmin, async (req: Request, res: Response) => {
  const { name, description, category, deliverables, price, basePrice, maxPrice, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string;
    price?: string; basePrice?: string; maxPrice?: string; durationDays?: number;
  };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [service] = await db.insert(servicesTable).values({
    name, description: description ?? null, category: category ?? null,
    deliverables: deliverables ? deliverables.split(",").map(s => s.trim()) : null,
    price: price ?? null,
    basePrice: basePrice ?? null, maxPrice: maxPrice ?? null,
    durationDays: durationDays ?? null,
  }).returning();
  res.status(201).json(service);
});

router.patch("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { name, description, category, deliverables, price, basePrice, maxPrice, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string;
    price?: string; basePrice?: string; maxPrice?: string; durationDays?: number;
  };
  const updates: Partial<typeof servicesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (deliverables !== undefined) updates.deliverables = deliverables.split(",").map(s => s.trim());
  if (price !== undefined) updates.price = price;
  if (basePrice !== undefined) updates.basePrice = basePrice;
  if (maxPrice !== undefined) updates.maxPrice = maxPrice;
  if (durationDays !== undefined) updates.durationDays = durationDays;
  const [updated] = await db.update(servicesTable).set(updates).where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ─── ADMIN: Get/set order workflow for a service ──────────────────────────────
router.get("/admin/services/:id/workflow", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [service] = await db.select({ orderWorkflow: servicesTable.orderWorkflow })
    .from(servicesTable).where(eq(servicesTable.id, id));
  if (!service) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ workflow: service.orderWorkflow ?? [] });
});

router.put("/admin/services/:id/workflow", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { workflow } = req.body as { workflow: unknown };
  if (!Array.isArray(workflow)) { res.status(400).json({ error: "workflow must be a non-empty array of steps" }); return; }

  // Validate each step and its options
  const stepIds = new Set<string>();
  for (let si = 0; si < workflow.length; si++) {
    const step = workflow[si] as Record<string, unknown>;
    if (typeof step !== "object" || step === null) {
      res.status(400).json({ error: `step[${si}] must be an object` }); return;
    }
    if (typeof step.id !== "string" || step.id.trim() === "") {
      res.status(400).json({ error: `step[${si}].id must be a non-empty string` }); return;
    }
    if (stepIds.has(step.id)) {
      res.status(400).json({ error: `duplicate step id "${step.id}"` }); return;
    }
    stepIds.add(step.id);
    if (typeof step.title !== "string" || step.title.trim() === "") {
      res.status(400).json({ error: `step[${si}].title must be a non-empty string` }); return;
    }
    if (!Array.isArray(step.options) || step.options.length === 0) {
      res.status(400).json({ error: `step[${si}].options must be a non-empty array` }); return;
    }
    const optionIds = new Set<string>();
    for (let oi = 0; oi < step.options.length; oi++) {
      const opt = step.options[oi] as Record<string, unknown>;
      if (typeof opt !== "object" || opt === null) {
        res.status(400).json({ error: `step[${si}].options[${oi}] must be an object` }); return;
      }
      if (typeof opt.id !== "string" || opt.id.trim() === "") {
        res.status(400).json({ error: `step[${si}].options[${oi}].id must be a non-empty string` }); return;
      }
      if (optionIds.has(opt.id)) {
        res.status(400).json({ error: `step[${si}] has duplicate option id "${opt.id}"` }); return;
      }
      optionIds.add(opt.id);
      if (typeof opt.label !== "string" || opt.label.trim() === "") {
        res.status(400).json({ error: `step[${si}].options[${oi}].label must be a non-empty string` }); return;
      }
      if (typeof opt.priceAdjustment !== "number" || !isFinite(opt.priceAdjustment)) {
        res.status(400).json({ error: `step[${si}].options[${oi}].priceAdjustment must be a finite number` }); return;
      }
    }
  }

  const [updated] = await db.update(servicesTable)
    .set({ orderWorkflow: workflow as never })
    .where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ workflow: updated.orderWorkflow ?? [] });
});

// ─── ADMIN: Assign service to client ─────────────────────────────────────────
router.post("/admin/client-services", requireAdmin, async (req: Request, res: Response) => {
  const { clientUserId, serviceId, projectId, startDate, nextMilestone, nextMilestoneDate } = req.body as {
    clientUserId?: number; serviceId?: number; projectId?: number; startDate?: string; nextMilestone?: string; nextMilestoneDate?: string;
  };
  if (!clientUserId || !serviceId) { res.status(400).json({ error: "clientUserId and serviceId are required" }); return; }

  const [cs] = await db.insert(clientServicesTable).values({
    clientUserId, serviceId, projectId: projectId ?? null,
    startDate: startDate ? new Date(startDate) : null,
    nextMilestone: nextMilestone ?? null,
    nextMilestoneDate: nextMilestoneDate ? new Date(nextMilestoneDate) : null,
  }).returning();

  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId));
  if (service) {
    await createNotification({
      title: `Service activated: ${service.name}`,
      body: undefined,
      notifType: "general",
      category: "project",
      linkPath: "/portal/services",
      recipient: { type: "customer_user", userId: clientUserId },
    });

    // Auto-generate project from the service's directly linked workflow template (if any)
    const resolvedWorkflowTemplateId = service.workflowTemplateId ?? null;
    let templateWorkflowSteps: Array<{ id: number; title: string; description: string | null; order: number }> = [];
    if (resolvedWorkflowTemplateId) {
      templateWorkflowSteps = await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, resolvedWorkflowTemplateId))
        .orderBy(asc(workflowTemplateStepsTable.order));
    }

    let resolvedProjectId: number | null = projectId ?? null;
    let templateStepsSeeded = false;

    if (templateWorkflowSteps.length > 0) {
      const [autoProject] = await db.insert(projectsTable).values({
        title: service.name,
        description: service.description ?? `Auto-generated from service: ${service.name}`,
        status: "active",
        clientUserId,
        progress: 0,
        startDate: new Date(),
      }).returning();

      resolvedProjectId = autoProject.id;

      // Link the client service to this project
      await db.update(clientServicesTable)
        .set({ projectId: autoProject.id })
        .where(eq(clientServicesTable.id, cs.id));

      // Seed workflow steps from the workflow template; first step auto-starts
      const createdSteps = await db.insert(workflowStepsTable).values(
        templateWorkflowSteps.map((s, idx) => ({
          clientServiceId: cs.id,
          projectId: autoProject.id,
          title: s.title,
          description: s.description ?? "",
          status: idx === 0 ? ("in_progress" as const) : ("pending" as const),
          order: idx + 1,
          workflowTemplateStepId: s.id,
        }))
      ).returning();

      // Seed kanban tasks for the first step from workflow_template_step_tasks (via workflowTemplateStepId)
      const firstCreatedStep = createdSteps[0];
      if (firstCreatedStep?.workflowTemplateStepId) {
        const step1Tasks = await db
          .select()
          .from(workflowTemplateStepTasksTable)
          .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, firstCreatedStep.workflowTemplateStepId))
          .orderBy(asc(workflowTemplateStepTasksTable.order));
        if (step1Tasks.length > 0) {
          const resolvedMetadata = await resolveTemplateTaskMetadata(step1Tasks);
          await db.insert(kanbanTasksTable).values(
            step1Tasks.map((t, idx) => ({
              projectId: autoProject.id,
              workflowStepId: firstCreatedStep.id,
              groupName: t.groupName ?? null,
              title: t.title,
              description: t.description ?? null,
              column: (t.isCustomerTask ? "waiting_on_customer" : "backlog") as "backlog" | "waiting_on_customer",
              order: idx,
              taskType: t.taskType ?? null,
              taskMetadata: resolvedMetadata[idx],
            }))
          );
        }
      }

      templateStepsSeeded = true;

      // Notify client about the new project
      await createNotification({
        title: `Your project is ready: ${autoProject.title}`,
        body: undefined,
        notifType: "project_update",
        category: "project",
        linkPath: `/portal/projects/${autoProject.id}`,
        recipient: { type: "customer_user", userId: clientUserId },
      });
    }

    // If no template steps were seeded, fall back to default slug-based steps
    // so the Dashboard tracker always has live data rather than showing mock content.
    if (!templateStepsSeeded) {
      await seedDefaultWorkflowSteps(cs.id, resolvedProjectId, service.slug ?? "");
    }
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "service_activated",
    entityType: "service",
    entityId: cs.id,
    entityLabel: service?.name ?? String(serviceId),
    clientId: clientUserId,
  });

  res.status(201).json(cs);

  // Re-probe the client's App Registration permissions in the background now that
  // their active services have changed. This keeps permission_check current without
  // requiring the client to re-submit their credentials.
  void reProbeClientPermissionsInBackground(clientUserId);
});

export default router;
