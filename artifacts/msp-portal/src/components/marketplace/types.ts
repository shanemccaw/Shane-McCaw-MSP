// Shape returned by GET /api/portal/marketplace/catalog (portal-marketplace.ts,
// MarketplaceService). Kept in sync with that endpoint's real servicesTable-backed
// response — not a fabricated/local shape.
export interface Product {
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
  billingType: 'one_time' | 'recurring_monthly';
  deliverables: string[];
  badge: string | null;
  highlighted: boolean;
}

/** "All Products" plus whatever real category values the catalog returns. */
export type CategoryFilter = 'All Products' | string;
