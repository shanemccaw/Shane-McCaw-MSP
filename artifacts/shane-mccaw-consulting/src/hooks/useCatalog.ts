import { useState, useEffect } from "react";
import { fetchServices, resolvePublicServicePriceCents, type PublicService, type PublicAssociatedDocument } from "./useServices";

export type { PublicService };

export interface MonitoringTier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
  billingType: "one_time" | "recurring_monthly";
  tier: string | null;
  sortOrder: number;
  pageHref: string | null;
  fulfillmentTypeKey: string | null;
  seatMin: number | null;
  seatMax: number | null;
  serviceType: string | null;
  typeAttributes: Record<string, unknown> | null;
}

export interface RetainerTier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  hoursPerMonth: string | null;
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
  billingType: "one_time" | "recurring_monthly";
  tier: string | null;
  sortOrder: number;
  pageHref: string | null;
  fulfillmentTypeKey: string | null;
  serviceType: string | null;
  typeAttributes: Record<string, unknown> | null;
}

export interface MspTier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
  billingType: "one_time" | "recurring_monthly";
  tier: string | null;
  sortOrder: number;
  pageHref: string | null;
  fulfillmentTypeKey: string | null;
  serviceType: string | null;
  typeAttributes: Record<string, unknown> | null;
  // Free platform tiers (e.g. the seeded $0 Starter) must skip Stripe entirely.
  // Checkout's tierToService() only ever found `isFree` on AssessmentOffer, so
  // before MSP tiers resolved at all this was unreachable; now that they do,
  // a $0 tier would otherwise be sent to Stripe as a $0 subscription.
  isFree: boolean;
}

export interface ConfigPackTier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
  billingType: "one_time" | "recurring_monthly";
  tier: string | null;
  sortOrder: number;
  pageHref: string | null;
  fulfillmentTypeKey: string | null;
  serviceType: string | null;
  typeAttributes: Record<string, unknown> | null;
}

export interface AssessmentOffer {
  id: number;
  slug: string | null;
  name: string;
  tagline: string | null;
  description: string | null;
  badge: string | null;
  highlighted: boolean;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  sortOrder: number;
  features: string[] | null;
  deliverables: string[] | null;
  inclusions: string[] | null;
  turnaround: string | null;
  targetAudience: string | null;
  durationDays: number | null;
  category: string | null;
  fulfillmentTypeKey: string | null;
  isPublic: boolean;
  isFree: boolean;
  /** Pre-filtered to customerVisible entries only — see public-services.ts. */
  associatedDocuments: PublicAssociatedDocument[];
}

export interface CatalogState {
  monitoringTiers: MonitoringTier[];
  retainerTiers: RetainerTier[];
  mspTiers: MspTier[];
  configPackTiers: ConfigPackTier[];
  assessmentOffers: AssessmentOffer[];
  loading: boolean;
  error: string | null;
}

function toMonitoringTier(s: PublicService): MonitoringTier {
  const ta = (s.typeAttributes ?? {}) as {
    pricePerUserMonth?: string | null;
    seatMin?: number | null;
    seatMax?: number | null;
    includedFeatures?: string[];
  };
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    tagline: s.tagline,
    price: ta.pricePerUserMonth ?? s.price,
    basePrice: s.basePrice,
    maxPrice: s.maxPrice,
    features: (ta.includedFeatures?.length ? ta.includedFeatures : null) ?? s.features,
    inclusions: s.inclusions,
    badge: s.badge,
    highlighted: s.highlighted,
    billingType: s.billingType,
    tier: s.tier,
    sortOrder: s.sortOrder,
    pageHref: s.pageHref,
    fulfillmentTypeKey: s.fulfillmentTypeKey,
    seatMin: ta.seatMin ?? null,
    seatMax: ta.seatMax ?? null,
    serviceType: s.serviceType,
    typeAttributes: s.typeAttributes,
  };
}

function toRetainerTier(s: PublicService): RetainerTier {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    tagline: s.tagline,
    price: s.price,
    basePrice: s.basePrice,
    maxPrice: s.maxPrice,
    hoursPerMonth: s.hoursPerMonth,
    features: s.features,
    inclusions: s.inclusions,
    badge: s.badge,
    highlighted: s.highlighted,
    billingType: s.billingType,
    tier: s.tier,
    sortOrder: s.sortOrder,
    pageHref: s.pageHref,
    fulfillmentTypeKey: s.fulfillmentTypeKey,
    serviceType: s.serviceType,
    typeAttributes: s.typeAttributes,
  };
}

function toMspTier(s: PublicService): MspTier {
  // Canonical free detection (catalog-pricing mirror) — never a raw
  // parseFloat(price) read, which is NULL on modern cents-only tier rows.
  // /msp/signup/tiers already serialises the resolved price into `price`.
  const cents = resolvePublicServicePriceCents(s);
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    tagline: s.tagline,
    price: s.price,
    basePrice: s.basePrice,
    maxPrice: s.maxPrice,
    isFree: s.isFreeOffering === true || cents === 0,
    features: s.features,
    inclusions: s.inclusions,
    badge: s.badge,
    highlighted: s.highlighted,
    billingType: s.billingType,
    tier: s.tier,
    sortOrder: s.sortOrder,
    pageHref: s.pageHref,
    fulfillmentTypeKey: s.fulfillmentTypeKey,
    serviceType: s.serviceType,
    typeAttributes: s.typeAttributes,
  };
}

function toConfigPackTier(s: PublicService): ConfigPackTier {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    tagline: s.tagline,
    price: s.price,
    basePrice: s.basePrice,
    maxPrice: s.maxPrice,
    features: s.features,
    inclusions: s.inclusions,
    badge: s.badge,
    highlighted: s.highlighted,
    billingType: s.billingType,
    tier: s.tier,
    sortOrder: s.sortOrder,
    pageHref: s.pageHref,
    fulfillmentTypeKey: s.fulfillmentTypeKey,
    serviceType: s.serviceType,
    typeAttributes: s.typeAttributes,
  };
}

// MSP platform tiers MUST come from the same endpoint the /msp page lists them
// from, or the storefront and the checkout resolver drift apart.
//
// This previously called fetchServices("msp") → GET /api/services?type=msp,
// which filters on `service_type = 'msp'`. That is not a real product-type key
// (the canonical value is 'platform_subscription_tier' — see
// PRODUCT_TYPE_DEFAULT_FULFILLMENT_KEYS), and `service_type` is a free-text
// column, so the filter matched ZERO rows silently instead of erroring.
// mspTiers was therefore always [], and every MSP tier slug the /msp page
// handed to /checkout/:slug fell through to "Service not found" — for free and
// paid tiers alike.
//
// /api/services also filters `visibility = 'public'` while /msp/signup/tiers
// does not, so even the corrected service_type could still list a tier that
// checkout refused to resolve. Sharing one endpoint closes both gaps.
async function fetchMspTiers(): Promise<PublicService[]> {
  const res = await fetch("/api/msp/signup/tiers");
  if (!res.ok) throw new Error("msp/signup/tiers fetch failed");
  const data = (await res.json()) as { tiers?: PublicService[] } | PublicService[];
  return Array.isArray(data) ? data : data.tiers ?? [];
}

export function useCatalog(): CatalogState {
  const [monitoringTiers, setMonitoringTiers] = useState<MonitoringTier[]>([]);
  const [retainerTiers, setRetainerTiers] = useState<RetainerTier[]>([]);
  const [mspTiers, setMspTiers] = useState<MspTier[]>([]);
  const [configPackTiers, setConfigPackTiers] = useState<ConfigPackTier[]>([]);
  const [assessmentOffers, setAssessmentOffers] = useState<AssessmentOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchServices("monitoring_tier"),
      fetchServices("retainer"),
      fetchMspTiers(),
      fetchServices("config_pack"),
      fetch("/api/catalog/assessments").then((r) => {
        if (!r.ok) throw new Error("catalog/assessments fetch failed");
        return r.json() as Promise<AssessmentOffer[]>;
      }),
    ])
      .then(([monRaw, retRaw, mspRaw, packRaw, assessRaw]) => {
        if (cancelled) return;
        setMonitoringTiers(monRaw.map(toMonitoringTier));
        setRetainerTiers(retRaw.map(toRetainerTier));
        setMspTiers(mspRaw.map(toMspTier));
        setConfigPackTiers(packRaw.map(toConfigPackTier));
        setAssessmentOffers(assessRaw);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load service catalogue");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { monitoringTiers, retainerTiers, mspTiers, configPackTiers, assessmentOffers, loading, error };
}
