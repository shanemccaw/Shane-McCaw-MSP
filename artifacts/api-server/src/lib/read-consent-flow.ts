/**
 * Read-consent flow generalization for purchase sessions (Git #1311, Epic #1309 Phase 2).
 *
 * The marketing site's read-consent grant flow — mint an admin-consent URL whose
 * OAuth `state` is the checkout-session UUID, let GET /api/consent/callback
 * stamp the grant and mark the session consented — was built for the assessment
 * funnel (#434) but is genuinely product-agnostic: the session row carries the
 * productSlug and the callback never branches on it. What Buy.tsx's three
 * products add is a REQUIREMENT axis the flow never had to name before:
 *
 *   - Monitoring (serviceType "monitoring_tier"): read consent is REQUIRED —
 *     seats are billed from what the tenant reports, so there is no purchase
 *     without a connection (Buy.tsx's `connectRequired`).
 *   - Quick-Start Packs ("config_pack"): REQUIRED — the pack's dry-run preview
 *     reads the tenant before the separate write consent ever runs.
 *   - Retainer ("retainer"): OPTIONAL — the retainer runs with or without a
 *     scan (Buy.tsx's `connectOffered`/`scanSkipped`), and skipping is a real
 *     recorded decision (checkout_sessions.consent_skipped_at), not a UI state.
 *
 * This module deliberately reuses the existing mechanism end to end — the same
 * buildAdminConsentUrl, the same /api/consent/callback, the same session-UUID
 * state the callback already recognises (consent.ts's UUID_RE branch). It is
 * NOT a second consent mechanism; it only names which products may decline it.
 *
 * Fail-closed default: any serviceType this module does not explicitly mark
 * optional — including an unknown slug, a services row with serviceType NULL,
 * or a product added later — REQUIRES consent. Skipping is the privileged
 * branch and has to be granted per product type, never inferred.
 */
import { db, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildAdminConsentUrl } from "./graph.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "auth" });

/** Whether a product's purchase flow may proceed without the read-only grant. */
export type ReadConsentRequirement = "required" | "optional";

/**
 * The one place the product-type → consent-requirement mapping lives.
 * Values are real services.service_type keys (confirmed against the live
 * catalog): only "retainer" purchases may skip the read-only connection.
 */
export function readConsentRequirementForServiceType(
  serviceType: string | null | undefined,
): ReadConsentRequirement {
  return serviceType === "retainer" ? "optional" : "required";
}

/**
 * Resolve a checkout session's productSlug to its consent requirement via the
 * services catalog. An unknown slug (no services row) is logged and treated as
 * "required" — a product the catalog cannot vouch for never gets the skip.
 */
export async function getReadConsentRequirementForProduct(
  productSlug: string,
): Promise<{ requirement: ReadConsentRequirement; serviceType: string | null }> {
  const [svc] = await db
    .select({ serviceType: servicesTable.serviceType })
    .from(servicesTable)
    .where(eq(servicesTable.slug, productSlug))
    .limit(1);

  if (!svc) {
    log.warn(
      { productSlug },
      "read-consent: product slug has no services row — treating read consent as required (fail closed)",
    );
  }
  return {
    requirement: readConsentRequirementForServiceType(svc?.serviceType),
    serviceType: svc?.serviceType ?? null,
  };
}

/**
 * The session-state read-consent URL: OAuth `state` is the checkout-session
 * UUID itself, which GET /api/consent/callback recognises (UUID_RE) as the
 * self-service popup path — no invite token row is minted for it. tenantHint is
 * always "common": the buyer's tenant GUID is unknown until the callback.
 *
 * `hostBase` is the caller's forwarded-header-derived origin (consent.ts's
 * getHostBase shape) — the resulting redirect_uri must be the exact
 * /api/consent/callback URI registered in the Azure App Registration.
 */
export function buildSessionReadConsentUrl(
  hostBase: string,
  sessionId: string,
  clientId: string,
): string {
  return buildAdminConsentUrl("common", sessionId, `${hostBase}/api/consent/callback`, clientId);
}
