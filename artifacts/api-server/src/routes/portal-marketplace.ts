/**
 * portal-marketplace.ts
 *
 * Authenticated, in-portal "browse and buy more" catalog surface. This is the
 * shared-across-roles marketplace read layer — one endpoint, RBAC controls the
 * catalog scope per role (matching the shared-page pattern used elsewhere in the
 * portal: Sharing, Account Basics, GDPR self-service).
 *
 * Auth: requireCapability("ladder.free") — the LOWEST portal role floor, so BOTH
 *   the pre-payment Free tier and Customer-tier (and higher) callers can browse.
 *   A customer capability then narrows WHICH services are returned.
 *
 * Catalog scoping (Deliverable 1) reuses the codebase's existing catalog
 * convention — `visibility = "public"` + a per-surface `serviceType` allow-set
 * (exactly how portal.ts /portal/onboarding/services, public-services.ts
 * /catalog/assessments, and useCatalog.ts already scope catalogs). No new
 * servicesTable column is introduced; there is no per-service role column in the
 * schema today (confirmed). Which allow-set applies is decided by the
 * `customer:marketplace.browse-full` capability (#3590, lib/marketplace-catalog-scope.ts),
 * not by comparing the caller's role string:
 *
 *   without it (Free) → assessment/governance/security/Copilot-readiness/
 *                       remediation packages (serviceType "assessment") + the
 *                       monitoring upsell ("monitoring_tier"). NOT the full
 *                       monitoring/automation catalog.
 *   with it (Customer+) → the fuller catalog (assessments + monitoring +
 *                       micro-offers/projects + retainers).
 *
 * Purchase is intentionally NOT handled here — see routes/portal-checkout.ts
 * (offer checkout, Customer floor) and routes/portal-assessment.ts (SOW
 * checkout, Free floor). This router is read-only catalog browsing.
 *
 * Routes:
 *   GET /api/portal/marketplace/catalog — role-scoped purchasable catalog
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { effectiveMspRole, requireCapability } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveCatalogScope } from "../lib/marketplace-catalog-scope";

// Re-exported: msp-marketplace-purchase.ts and its tests read the full set from here.
export { CUSTOMER_SERVICE_TYPES } from "../lib/marketplace-catalog-scope";

const log = logger.child({ channel: "growth.marketplace" });

const router: IRouter = Router();

// ── Customer-safe catalog shape ────────────────────────────────────────────────
// Only fields a customer needs to browse and decide. Internal cost, wholesale
// pricing, workflow templates, triggering signals, etc. are never exposed here.

export interface MarketplaceService {
  id: number;
  slug: string | null;
  name: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  serviceType: string | null;
  /** Customer-facing price in cents. null when priced on consultation. */
  priceCents: number | null;
  /** true when priceCents is a per-user/month figure (e.g. monitoring tiers). */
  perSeat: boolean;
  billingType: "one_time" | "recurring_monthly";
  deliverables: string[];
  badge: string | null;
  highlighted: boolean;
}

type ServiceRow = typeof servicesTable.$inferSelect;

export function toMarketplaceService(row: ServiceRow): MarketplaceService {
  // Prefer the explicit integer cents column; fall back to the legacy decimal
  // dollar columns; finally fall back to a per-seat monthly figure carried in
  // typeAttributes (how monitoring tiers express price). null = "on consultation".
  //
  // BOTH legacy columns must be read, in the canonical `price ?? basePrice`
  // precedence that catalog-pricing.ts's resolveServicePriceCents already uses
  // everywhere else. Reading `price` alone made this the odd resolver out: the
  // catalog import path writes an assessment's price to base_price ONLY
  // (`price` is not even in that type's import allow-list — productTypeConfig.ts
  // PRODUCT_TYPE_IMPORT_FIELDS.assessment), and it never writes price_cents at
  // all. Every such row therefore resolved to null here and was reported as
  // "priced on consultation" — which the MSP-staff checkout below turns into a
  // hard 422, making real, publicly-listed, really-priced assessments
  // unpurchasable on a customer's behalf.
  //
  // This widens coverage only; it cannot weaken a price gate. null (no price
  // field populated at all) still means "on consultation" and still 422s, and
  // an explicit 0 still means free — only a real positive price in the other
  // legacy column newly resolves. Non-numeric junk resolves to null rather than
  // NaN, which would previously have flowed straight into a Stripe unit_amount.
  const ta = (row.typeAttributes ?? {}) as { pricePerUserMonth?: string | number | null };
  const legacyDollars = row.price ?? row.basePrice;
  const legacyCents =
    legacyDollars != null && legacyDollars !== "" && Number.isFinite(Number(legacyDollars))
      ? Math.round(Number(legacyDollars) * 100)
      : null;
  let priceCents: number | null = row.priceCents ?? legacyCents;
  let perSeat = false;
  if (priceCents === null && ta.pricePerUserMonth != null && ta.pricePerUserMonth !== "") {
    const perUser = Number(ta.pricePerUserMonth);
    if (!Number.isNaN(perUser)) {
      priceCents = Math.round(perUser * 100);
      perSeat = true;
    }
  }

  // First non-empty of the customer-facing list fields.
  const deliverables =
    (row.deliverables && row.deliverables.length > 0 && row.deliverables) ||
    (row.inclusions && row.inclusions.length > 0 && row.inclusions) ||
    (row.features && row.features.length > 0 && row.features) ||
    [];

  return {
    id: row.id,
    slug: row.slug ?? null,
    name: row.name,
    tagline: row.tagline ?? null,
    description: row.description ?? null,
    category: row.category ?? null,
    serviceType: row.serviceType ?? null,
    priceCents,
    perSeat,
    billingType: row.billingType,
    deliverables,
    badge: row.badge ?? null,
    highlighted: row.highlighted,
  };
}

// ── GET /api/portal/marketplace/catalog ────────────────────────────────────────

router.get(
  "/portal/marketplace/catalog",
  requireCapability("ladder.free"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const role = effectiveMspRole(req.user!);
      const scope = await resolveCatalogScope(req.user!);
      if (scope.kind === "unavailable") {
        // Not a denial: the model could not be read (typically an environment the
        // #3590 migration has not reached). Serving the narrow catalog would silently
        // hide a paying customer's options behind a configuration fault.
        log.error({ reason: scope.reason }, "portal-marketplace: catalog scope could not be resolved — failing closed");
        res.status(503).json({ error: "Authorization is temporarily unavailable" });
        return;
      }
      const allowedTypes = [...scope.serviceTypes];

      const rows = await db
        .select()
        .from(servicesTable)
        .where(
          and(
            eq(servicesTable.visibility, "public"),
            inArray(servicesTable.serviceType, allowedTypes),
          ),
        )
        .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.name));

      const services = rows.map(toMarketplaceService);
      log.debug(
        { role, count: services.length, allowedTypes },
        "portal-marketplace: catalog served",
      );
      res.json({ role: role ?? null, services });
    } catch (err) {
      log.error({ err }, "GET /api/portal/marketplace/catalog failed");
      res.status(500).json({ error: "Failed to load marketplace catalog" });
    }
  },
);

export default router;
