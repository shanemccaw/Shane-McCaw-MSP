/**
 * portal-marketplace.ts
 *
 * Authenticated, in-portal "browse and buy more" catalog surface. This is the
 * shared-across-roles marketplace read layer — one endpoint, RBAC controls the
 * catalog scope per role (matching the shared-page pattern used elsewhere in the
 * portal: Sharing, Account Basics, GDPR self-service).
 *
 * Auth: requireRole("Assessment") — the LOWEST portal role floor, so BOTH
 *   Assessment-tier and CustomerUser-tier (and higher) customers can browse.
 *   The caller's effective role then narrows WHICH services are returned.
 *
 * Catalog scoping (Deliverable 1) reuses the codebase's existing catalog
 * convention — `visibility = "public"` + a per-surface `serviceType` allow-set
 * (exactly how portal.ts /portal/onboarding/services, public-services.ts
 * /catalog/assessments, and useCatalog.ts already scope catalogs). No new
 * servicesTable column is introduced; there is no per-service role column in the
 * schema today (confirmed), so the established serviceType convention is keyed on
 * the authenticated mspRole rather than inventing a role gate per product.
 *
 *   Assessment-tier   → assessment/governance/security/Copilot-readiness/
 *                       remediation packages (serviceType "assessment") + the
 *                       monitoring upsell ("monitoring_tier"). NOT the full
 *                       monitoring/automation catalog.
 *   CustomerUser+     → the fuller catalog (assessments + monitoring +
 *                       micro-offers/projects + retainers).
 *
 * Purchase is intentionally NOT handled here — see routes/portal-checkout.ts
 * (offer checkout, CustomerUser floor) and routes/portal-assessment.ts (SOW
 * checkout, Assessment floor). This router is read-only catalog browsing.
 *
 * Routes:
 *   GET /api/portal/marketplace/catalog — role-scoped purchasable catalog
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, type MspRole } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "growth.marketplace" });

const router: IRouter = Router();

// ── Role → serviceType allow-set ───────────────────────────────────────────────
// Uses the existing serviceType catalog convention. Assessment-tier sees the
// assessment family + the monitoring upsell only; CustomerUser and above see the
// fuller purchasable catalog. Anything not in the caller's set is not returned.

const ASSESSMENT_SERVICE_TYPES = ["assessment", "monitoring_tier"] as const;
export const CUSTOMER_SERVICE_TYPES = [
  "assessment",
  "monitoring_tier",
  "micro_offer",
  "retainer",
] as const;

/** Resolve the caller's effective portal role (admin JWT === PlatformAdmin). */
function effectiveRole(req: Request): MspRole | undefined {
  const user = req.user as { role?: string; mspRole?: MspRole } | undefined;
  if (!user) return undefined;
  if (user.role === "admin") return "PlatformAdmin";
  return user.mspRole;
}

/** The serviceType set this role is allowed to browse. */
function serviceTypesForRole(role: MspRole | undefined): readonly string[] {
  // Assessment-tier is the only role that gets the narrowed catalog. Every other
  // role that clears the requireRole("Assessment") floor (CustomerUser and up)
  // gets the fuller purchasable catalog.
  return role === "Assessment" ? ASSESSMENT_SERVICE_TYPES : CUSTOMER_SERVICE_TYPES;
}

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
  // Prefer the explicit integer cents column; fall back to the numeric dollar
  // price; finally fall back to a per-seat monthly figure carried in
  // typeAttributes (how monitoring tiers express price). null = "on consultation".
  const ta = (row.typeAttributes ?? {}) as { pricePerUserMonth?: string | number | null };
  let priceCents: number | null =
    row.priceCents ?? (row.price != null ? Math.round(Number(row.price) * 100) : null);
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
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const role = effectiveRole(req);
      const allowedTypes = [...serviceTypesForRole(role)];

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
