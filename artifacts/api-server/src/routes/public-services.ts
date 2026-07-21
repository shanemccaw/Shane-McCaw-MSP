import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  workflowTemplateStepsTable,
  checkoutSessionsTable,
  type ServiceAssociatedDocument,
} from "@workspace/db";
import { and, asc, eq, inArray, gte } from "drizzle-orm";
import { z } from "zod";
import { resolveCatalogPricing } from "../lib/catalog-pricing";
import { ensureAssessmentFunnelLead } from "../lib/crm-pipeline";

const router: IRouter = Router();

// Strips associatedDocuments down to only the customer-visible entries, and to
// only the fields a public response needs (title + category) — docType is an
// internal generator key and customerVisible is redundant once filtered.
// customerVisible === false entries ground the SOW's accuracy but are never
// meant for customers; they must never reach a public route's response.
function toPublicAssociatedDocuments(
  docs: ServiceAssociatedDocument[] | null,
): { title: string; category: "report" | "consulting" }[] {
  if (!docs) return [];
  return docs
    .filter((d) => d.customerVisible === true)
    .map((d) => ({ title: d.title, category: d.category }));
}

router.get("/services", async (req: Request, res: Response) => {
  try {
    const { type, category } = req.query as { type?: string; category?: string };
    const conditions = [eq(servicesTable.visibility, "public")];
    if (type) {
      conditions.push(eq(servicesTable.serviceType, type));
    }
    if (category) {
      conditions.push(eq(servicesTable.category, category));
    }
    // Explicit column list (mirrors /catalog/assessments below) rather than a
    // bare .select() — a bare select pulls every column declared on
    // servicesTable, including admin-only columns added via a manual/ SQL
    // migration that may not have been run against this DB yet. This public
    // storefront route shouldn't 500 the entire catalogue when one of those
    // columns is pending a manual migration. associatedDocuments IS safe to
    // include here (its migration has landed) but every entry is filtered to
    // customerVisible below before the response is sent — the rest are
    // internal-only (they exist to ground the SOW's accuracy) and must never
    // reach this public route's response.
    const services = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        description: servicesTable.description,
        category: servicesTable.category,
        deliverables: servicesTable.deliverables,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        maxPrice: servicesTable.maxPrice,
        priceCents: servicesTable.priceCents,
        internalCostCents: servicesTable.internalCostCents,
        turnaround: servicesTable.turnaround,
        durationDays: servicesTable.durationDays,
        billingType: servicesTable.billingType,
        serviceType: servicesTable.serviceType,
        tagline: servicesTable.tagline,
        targetAudience: servicesTable.targetAudience,
        inclusions: servicesTable.inclusions,
        features: servicesTable.features,
        badge: servicesTable.badge,
        highlighted: servicesTable.highlighted,
        hoursPerMonth: servicesTable.hoursPerMonth,
        iconName: servicesTable.iconName,
        pageHref: servicesTable.pageHref,
        pageSlug: servicesTable.pageSlug,
        sortOrder: servicesTable.sortOrder,
        tier: servicesTable.tier,
        workflowTemplateId: servicesTable.workflowTemplateId,
        overviewPdfKey: servicesTable.overviewPdfKey,
        bestFor: servicesTable.bestFor,
        triggers: servicesTable.triggers,
        fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
        isFreeOffering: servicesTable.isFreeOffering,
        typeAttributes: servicesTable.typeAttributes,
        associatedDocuments: servicesTable.associatedDocuments,
      })
      .from(servicesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt));

    // Collect unique workflow template IDs that have linked services
    const templateIds = services
      .map((s) => s.workflowTemplateId)
      .filter((id): id is number => id != null);

    // workflowTasks: top-level steps (phases) per template, ordered by step order
    const workflowTasksByTemplateId = new Map<
      number,
      Array<{ title: string; description: string | null; order: number }>
    >();

    if (templateIds.length > 0) {
      const steps = await db
        .select({
          workflowTemplateId: workflowTemplateStepsTable.workflowTemplateId,
          title: workflowTemplateStepsTable.title,
          description: workflowTemplateStepsTable.description,
          order: workflowTemplateStepsTable.order,
        })
        .from(workflowTemplateStepsTable)
        .where(inArray(workflowTemplateStepsTable.workflowTemplateId, templateIds))
        .orderBy(asc(workflowTemplateStepsTable.order));

      for (const step of steps) {
        const list = workflowTasksByTemplateId.get(step.workflowTemplateId) ?? [];
        list.push({ title: step.title, description: step.description, order: step.order });
        workflowTasksByTemplateId.set(step.workflowTemplateId, list);
      }
    }

    res.json(
      services.map((s) => {
        const wfSteps = s.workflowTemplateId
          ? (workflowTasksByTemplateId.get(s.workflowTemplateId) ?? [])
          : [];
        return {
          ...s,
          hasPdf: s.overviewPdfKey != null,
          workflowTasks: wfSteps,
          workflowSummary: wfSteps.map(({ title, description }) => ({ title, description })),
          associatedDocuments: toPublicAssociatedDocuments(s.associatedDocuments),
          ...resolveCatalogPricing({
            priceCents: s.priceCents ?? 0,
            internalCostCents: s.internalCostCents,
          }),
        };
      })
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

// ── UUID detector (checkout session IDs are v4 UUIDs) ─────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── POST /api/public/checkout-session ─────────────────────────────────────────
// Creates a server-side checkout session; returns only the sessionId.
// The client stores only the UUID so PII survives origin-crossing redirects.

const createSessionSchema = z.object({
  productSlug: z.string().min(1, "productSlug is required"),
  fullName: z.string().min(1, "fullName is required"),
  email: z.string().email("email must be a valid email address"),
  seats: z.number().int().min(1).default(1),
});

router.post("/public/checkout-session", async (req: Request, res: Response) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const { productSlug, fullName, email, seats } = parsed.data;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(checkoutSessionsTable)
    .values({ productSlug, fullName, email, seats, expiresAt })
    .returning({ id: checkoutSessionsTable.id });

  // Top-of-funnel lead capture: the visitor has entered a real name + email. Record
  // it as a real Lead now, before they proceed to (or bounce from) M365 consent —
  // a bounced lead is still trackable, remarketable data. Converts to a Prospect
  // account at consent time (see provisionProspectAccount / convertLeadForClient).
  // Fire-and-forget, non-fatal — must never block session creation.
  void ensureAssessmentFunnelLead(email, fullName);

  res.json({ sessionId: row.id });
});

// ── GET /api/public/checkout-session/:id ──────────────────────────────────────
// Returns only non-PII fields: productSlug and status.
// The client caches name/email in localStorage alongside the sessionId so
// they survive cross-origin redirects without the server ever exposing PII on
// this public endpoint.
// Returns 404 if not found or expired.

router.get("/public/checkout-session/:id", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const now = new Date();
  const [row] = await db
    .select({
      productSlug: checkoutSessionsTable.productSlug,
      status: checkoutSessionsTable.status,
      seats: checkoutSessionsTable.seats,
    })
    .from(checkoutSessionsTable)
    .where(and(eq(checkoutSessionsTable.id, id), gte(checkoutSessionsTable.expiresAt, now)))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(row);
});

// ── GET /api/public/consent-url ───────────────────────────────────────────────
// Returns the Microsoft admin-consent URL.
// Optional ?sessionId=<uuid> — if present and the session resolves, the UUID is
// passed as the OAuth `state` parameter so the callback can reconnect the session.

router.get("/public/consent-url", async (req: Request, res: Response) => {
  const clientId = process.env.MT_APP_CLIENT_ID;
  if (!clientId) {
    res.json({ url: null });
    return;
  }

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const redirectUri = `${proto}://${host}/api/consent/callback`;

  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });

  // Thread the checkout session ID through as OAuth `state` if provided and valid.
  const rawSessionId = req.query.sessionId as string | undefined;
  if (rawSessionId) {
    if (!UUID_RE.test(rawSessionId)) {
      req.log?.warn?.({ sessionId: rawSessionId }, "consent-url: sessionId is not a valid UUID — building URL without state");
    } else {
      const now = new Date();
      const [sessionRow] = await db
        .select({ id: checkoutSessionsTable.id })
        .from(checkoutSessionsTable)
        .where(
          and(
            eq(checkoutSessionsTable.id, rawSessionId),
            gte(checkoutSessionsTable.expiresAt, now),
          ),
        )
        .limit(1);

      if (sessionRow) {
        params.set("state", rawSessionId);
      } else {
        req.log?.warn?.({ sessionId: rawSessionId }, "consent-url: checkout session not found or expired — building URL without state");
      }
    }
  }

  const url = `https://login.microsoftonline.com/common/adminconsent?${params.toString()}`;
  res.json({ url });
});

// ── GET /api/catalog/assessments ──────────────────────────────────────────────
// Public endpoint — no auth required. Returns services where serviceType =
// 'assessment' AND isPublic = true, ordered by sortOrder ASC.

router.get("/catalog/assessments", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        tagline: servicesTable.tagline,
        description: servicesTable.description,
        badge: servicesTable.badge,
        highlighted: servicesTable.highlighted,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        maxPrice: servicesTable.maxPrice,
        sortOrder: servicesTable.sortOrder,
        features: servicesTable.features,
        deliverables: servicesTable.deliverables,
        inclusions: servicesTable.inclusions,
        turnaround: servicesTable.turnaround,
        targetAudience: servicesTable.targetAudience,
        durationDays: servicesTable.durationDays,
        category: servicesTable.category,
        fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
        isPublic: servicesTable.isPublic,
        isFreeOffering: servicesTable.isFreeOffering,
        priceCents: servicesTable.priceCents,
        internalCostCents: servicesTable.internalCostCents,
        associatedDocuments: servicesTable.associatedDocuments,
      })
      .from(servicesTable)
      .where(
        and(
          eq(servicesTable.serviceType, "assessment"),
          eq(servicesTable.isPublic, true),
        ),
      )
      .orderBy(asc(servicesTable.sortOrder));

    const assessmentOffers = rows.map((r) => {
      const priceVal = r.price ?? r.basePrice;
      const isFree = r.isFreeOffering || priceVal == null || Number(priceVal) === 0;
      return {
        ...r,
        isFree,
        associatedDocuments: toPublicAssociatedDocuments(r.associatedDocuments),
        ...resolveCatalogPricing({
          priceCents: r.priceCents ?? 0,
          internalCostCents: r.internalCostCents,
        }),
      };
    });

    res.json(assessmentOffers);
  } catch {
    res.status(500).json({ error: "Failed to fetch assessments" });
  }
});

export default router;
