/**
 * portal-customer-search.ts
 *
 * Customer-facing cross-domain search (Cmd+K). Real substring matching across
 * the customer's own data — no AI/semantic matching in this pass (flagged as
 * a real future layer, not built here).
 *
 * Sources searched, each scoped to the caller so no cross-tenant data can leak:
 *   - diagnostic findings (msp_diagnostic_findings)      — scoped by mspCustomerId
 *   - generated documents (insights_generated_documents) — scoped by usersTable.id,
 *     delivered/approved only (drafts/internal docs excluded)
 *   - sales offers (sales_offers)                        — scoped by usersTable.id,
 *     sent/accepted/rejected/expired only (drafts excluded)
 *   - marketplace items (services)                       — public catalog, narrowed
 *     to the caller's role-appropriate serviceType set (same convention as
 *     portal-marketplace.ts — Assessment-tier sees the narrower catalog)
 *
 * These are the same tables/status filters portal-customer-timeline.ts already
 * reads (aggregated there for recency; here filtered for substring match) — the
 * status/scoping logic is reused rather than re-invented, without importing the
 * timeline's recency-sort aggregator, whose shape doesn't fit a keyword search.
 *
 * NOT searched: generated document HTML content (full-text). Titles carry
 * enough signal for way-finding search; matching inside potentially large HTML
 * blobs with a plain ILIKE has no index to lean on and would be materially
 * slower. Flagged as a real follow-up (needs a pg_trgm/tsvector index), not
 * built in this pass.
 *
 * Static nav targets ("go to Billing", "go to Team") are cheap and handled
 * entirely client-side in command-palette.tsx — no backend round-trip needed
 * for those.
 *
 * Auth: requireRole("Assessment") — the lowest portal floor, matching
 * portal-marketplace.ts, so both Assessment-tier and CustomerUser-tier callers
 * reach it; each source query is scoped to the caller's own ids only.
 *
 * Routes:
 *   GET /api/portal/customer/search?q=...
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole } from "../middlewares/requireAuth";
import {
  db,
  mspDiagnosticFindingsTable,
  insightsGeneratedDocumentsTable,
  salesOffersTable,
  servicesTable,
  type MspRole,
} from "@workspace/db";
import { and, eq, ilike, inArray, or, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const RESULTS_PER_SOURCE = 5;

const ASSESSMENT_SERVICE_TYPES = ["assessment", "monitoring_tier"] as const;
const CUSTOMER_SERVICE_TYPES = ["assessment", "monitoring_tier", "micro_offer", "retainer"] as const;

function effectiveRole(req: Request): MspRole | undefined {
  const user = req.user as { role?: string; mspRole?: MspRole } | undefined;
  if (!user) return undefined;
  if (user.role === "admin") return "PlatformAdmin";
  return user.mspRole;
}

function serviceTypesForRole(role: MspRole | undefined): readonly string[] {
  return role === "Assessment" ? ASSESSMENT_SERVICE_TYPES : CUSTOMER_SERVICE_TYPES;
}

type SearchResultType = "finding" | "document" | "offer" | "marketplace";

interface SearchResultDto {
  type: SearchResultType;
  id: string;
  title: string;
  description?: string;
  href: string;
  badge?: string;
}

router.get(
  "/portal/customer/search",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = req.user!.customerId;
    const userId = req.user!.id;
    const q = String(req.query.q ?? "").trim();

    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const like = `%${q}%`;
    const role = effectiveRole(req);
    const allowedServiceTypes = [...serviceTypesForRole(role)];

    try {
      const [findings, documents, offers, services] = await Promise.all([
        db
          .select({
            findingId: mspDiagnosticFindingsTable.findingId,
            title: mspDiagnosticFindingsTable.title,
            description: mspDiagnosticFindingsTable.description,
            severity: mspDiagnosticFindingsTable.severity,
            createdAt: mspDiagnosticFindingsTable.createdAt,
          })
          .from(mspDiagnosticFindingsTable)
          .where(
            and(
              eq(mspDiagnosticFindingsTable.customerId, customerId),
              or(ilike(mspDiagnosticFindingsTable.title, like), ilike(mspDiagnosticFindingsTable.description, like)),
            ),
          )
          .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
          .limit(RESULTS_PER_SOURCE),

        db
          .select({
            id: insightsGeneratedDocumentsTable.id,
            title: insightsGeneratedDocumentsTable.title,
            docType: insightsGeneratedDocumentsTable.docType,
            status: insightsGeneratedDocumentsTable.status,
            createdAt: insightsGeneratedDocumentsTable.createdAt,
          })
          .from(insightsGeneratedDocumentsTable)
          .where(
            and(
              eq(insightsGeneratedDocumentsTable.customerId, userId),
              inArray(insightsGeneratedDocumentsTable.status, ["delivered", "approved"]),
              ilike(insightsGeneratedDocumentsTable.title, like),
            ),
          )
          .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
          .limit(RESULTS_PER_SOURCE),

        db
          .select({
            id: salesOffersTable.id,
            title: salesOffersTable.title,
            state: salesOffersTable.state,
            createdAt: salesOffersTable.createdAt,
          })
          .from(salesOffersTable)
          .where(
            and(
              eq(salesOffersTable.customerId, userId),
              inArray(salesOffersTable.state, ["sent", "accepted", "rejected", "expired"]),
              ilike(salesOffersTable.title, like),
            ),
          )
          .orderBy(desc(salesOffersTable.createdAt))
          .limit(RESULTS_PER_SOURCE),

        db
          .select({
            id: servicesTable.id,
            slug: servicesTable.slug,
            name: servicesTable.name,
            tagline: servicesTable.tagline,
          })
          .from(servicesTable)
          .where(
            and(
              eq(servicesTable.visibility, "public"),
              inArray(servicesTable.serviceType, allowedServiceTypes),
              or(ilike(servicesTable.name, like), ilike(servicesTable.tagline, like)),
            ),
          )
          .orderBy(desc(servicesTable.sortOrder))
          .limit(RESULTS_PER_SOURCE),
      ]);

      const results: SearchResultDto[] = [
        ...findings.map((f): SearchResultDto => ({
          type: "finding",
          id: `finding-${f.findingId}`,
          title: f.title,
          description: f.description ?? undefined,
          href: "/customer-diagnostics",
          badge: f.severity,
        })),
        ...documents.map((d): SearchResultDto => ({
          type: "document",
          id: `document-${d.id}`,
          title: d.title,
          description: d.docType ?? undefined,
          href: "/customer-documents",
        })),
        ...offers.map((o): SearchResultDto => ({
          type: "offer",
          id: `offer-${o.id}`,
          title: o.title,
          href: "/customer-offers",
          badge: o.state,
        })),
        ...services.map((s): SearchResultDto => ({
          type: "marketplace",
          id: `marketplace-${s.id}`,
          title: s.name,
          description: s.tagline ?? undefined,
          href: "/marketplace",
        })),
      ];

      res.json({ results });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-search: search failed");
      res.status(500).json({ error: "Search is unavailable right now. Please try again shortly." });
    }
  },
);

export default router;
