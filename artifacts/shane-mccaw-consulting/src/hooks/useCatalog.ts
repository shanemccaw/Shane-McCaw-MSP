import { useState, useEffect } from "react";
import { fetchServices, type PublicService, type PublicAssociatedDocument } from "./useServices";

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

/** GET /api/msp/signup/tiers row shape — see api-server/src/routes/msp-signup.ts. */
interface RawMspTier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  priceCents: number | null;
  billingType: "one_time" | "recurring_monthly";
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
  tier: string | null;
  sortOrder: number;
  pageHref: string | null;
  fulfillmentTypeKey: string | null;
  serviceType: string | null;
  isFreeOffering?: boolean | null;
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean>;
  typeAttributes: Record<string, unknown> | null;
}

export interface MspTier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  priceCents: number | null;
  billingType: "one_time" | "recurring_monthly";
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
  tier: string | null;
  sortOrder: number;
  pageHref: string | null;
  fulfillmentTypeKey: string | null;
  serviceType: string | null;
  // Free platform tiers (e.g. the seeded $0 Starter) must skip Stripe entirely.
  isFree: boolean;
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean>;
  typeAttributes: Record<string, unknown> | null;
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

function toMspTier(t: RawMspTier): MspTier {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    tagline: t.tagline,
    price: t.price,
    priceCents: t.priceCents,
    billingType: t.billingType,
    features: t.features,
    inclusions: t.inclusions,
    badge: t.badge,
    highlighted: t.highlighted,
    tier: t.tier,
    sortOrder: t.sortOrder,
    pageHref: t.pageHref,
    fulfillmentTypeKey: t.fulfillmentTypeKey,
    serviceType: t.serviceType,
    isFree: t.isFreeOffering === true || t.priceCents === 0,
    tenantAllowance: t.tenantAllowance ?? null,
    aiCreditAllowance: t.aiCreditAllowance ?? null,
    overageRateCents: t.overageRateCents ?? null,
    tierCapabilities: t.tierCapabilities ?? {},
    typeAttributes: t.typeAttributes ?? null,
  };
}

// MSP platform tiers come from the same endpoint the /msp signup flow lists
// them from (GET /api/msp/signup/tiers), not from fetchServices() — the
// modern tier model resolves price/tenantAllowance/tierCapabilities
// server-side from services.typeAttributes, which fetchServices()'s
// PublicService shape doesn't expose.
async function fetchMspTiers(): Promise<MspTier[]> {
  const res = await fetch("/api/msp/signup/tiers");
  if (!res.ok) throw new Error("msp/signup/tiers fetch failed");
  const data = (await res.json()) as { tiers: RawMspTier[] };
  return data.tiers.map(toMspTier);
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
        setMspTiers(mspRaw);
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
