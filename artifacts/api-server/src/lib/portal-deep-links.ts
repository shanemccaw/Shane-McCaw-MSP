/**
 * Portal Deep-Link Resolution (#1827)
 *
 * `customer_tenant_alert_rules.deep_link_path` (23 seeded rows — see
 * lib/db/migrations/manual/2026-08-25-customer-tenant-alert-rules-1278.sql)
 * carries 8 distinct `/portal-v2/*` paths. `artifacts/msp-portal` (portal-v2)
 * was deleted wholesale under #1673 (157 pages, ~940 files); its replacement,
 * `artifacts/portal`, is being rebuilt one page at a time under #1485 and
 * today has only a placeholder index route — none of the 8 destinations
 * below exist yet (`Design/portal/` has no export for any of them).
 *
 * Rewriting the 23 DB rows to a guessed new path (e.g. `/portal-v2/health`
 * -> `/health`) would just trade one dead link for another, since the
 * destination page doesn't exist under that path either (see #1827's own
 * body). Instead, every live surface that turns a `deep_link_path` into an
 * actual href — today: the immediate customer-alert email
 * (customer-alert-delivery.ts) and the digest-drain email
 * (customer-alert-digest.ts); later: the #1821 alerts dropdown — resolves it
 * through this one map. As each destination ships under #1485, flip its
 * `livePath` here and every surface picks up the real link with no other
 * change required.
 */

export interface PortalDeepLinkDestination {
  /** The raw path currently stored on customer_tenant_alert_rules.deep_link_path. */
  rawPath: string;
  /** Human label for the destination, shown on the honest "not built yet" fallback. */
  label: string;
  /** Canonical display-pillar key (docs/pillarmapping.md §2), where one applies. */
  pillar?: string;
  /** Set once the real page ships under #1485. null = not yet built. */
  livePath: string | null;
}

// The 8 distinct destinations across the 23 seeded rules — verified 2026-09-03
// against customer_tenant_alert_rules.deep_link_path (build-journal/1827.md).
export const PORTAL_DEEP_LINK_DESTINATIONS: PortalDeepLinkDestination[] = [
  { rawPath: "/portal-v2/health", label: "Health", pillar: "architecture", livePath: null },
  { rawPath: "/portal-v2/billing", label: "Billing", livePath: null },
  { rawPath: "/portal-v2/projects", label: "Projects", livePath: null },
  { rawPath: "/portal-v2/support", label: "Support", livePath: null },
  { rawPath: "/portal-v2/risk-register", label: "Risk Register", pillar: "governance", livePath: null },
  { rawPath: "/portal-v2/governance", label: "Governance", pillar: "governance", livePath: null },
  { rawPath: "/portal-v2/governance/oversharing", label: "Oversharing", pillar: "governance", livePath: null },
  { rawPath: "/portal-v2/compliance-obligations", label: "Compliance Obligations", pillar: "compliance", livePath: null },
];

const BY_RAW_PATH = new Map(PORTAL_DEEP_LINK_DESTINATIONS.map((d) => [d.rawPath, d]));

export interface ResolvedPortalDeepLink {
  /** Portal-relative path (no leading base) to actually send the user to. Always real, never a guessed 404. */
  href: string;
  /** True only once the destination has a real, shipped page. */
  available: boolean;
  /** Human label for the destination — used by the honest fallback and by link text. */
  label: string;
}

/**
 * Resolve a raw `deep_link_path` to somewhere real. `null`/unknown paths and
 * paths whose destination hasn't shipped yet resolve to the portal's
 * `/coming-soon` route rather than a dead `/portal-v2/*` link — see
 * artifacts/portal/src/pages/coming-soon.tsx. Never returns a path that
 * doesn't actually resolve to a mounted route.
 */
export function resolvePortalDeepLink(rawPath: string | null | undefined): ResolvedPortalDeepLink {
  if (!rawPath) return { href: "/", available: true, label: "Portal" };

  const dest = BY_RAW_PATH.get(rawPath);
  if (!dest) {
    return { href: `/coming-soon?feature=${encodeURIComponent(rawPath)}`, available: false, label: rawPath };
  }
  if (dest.livePath) {
    return { href: dest.livePath, available: true, label: dest.label };
  }
  return { href: `/coming-soon?feature=${encodeURIComponent(dest.label)}`, available: false, label: dest.label };
}
