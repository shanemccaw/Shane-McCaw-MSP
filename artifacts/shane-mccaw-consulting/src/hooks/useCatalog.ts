import { useState, useEffect } from "react";
import { fetchServices, type PublicService } from "./useServices";

export type { PublicService };

export interface MonitoringTier {
  id: number;
  slug: string | null;
  name: string;
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
}

export interface RetainerTier {
  id: number;
  slug: string | null;
  name: string;
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
}

export interface MspTier {
  id: number;
  slug: string | null;
  name: string;
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
}

export interface CatalogState {
  monitoringTiers: MonitoringTier[];
  retainerTiers: RetainerTier[];
  mspTiers: MspTier[];
  loading: boolean;
  error: string | null;
}

function toMonitoringTier(s: PublicService): MonitoringTier {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
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
  };
}

function toRetainerTier(s: PublicService): RetainerTier {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
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
  };
}

function toMspTier(s: PublicService): MspTier {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
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
  };
}

export function useCatalog(): CatalogState {
  const [monitoringTiers, setMonitoringTiers] = useState<MonitoringTier[]>([]);
  const [retainerTiers, setRetainerTiers] = useState<RetainerTier[]>([]);
  const [mspTiers, setMspTiers] = useState<MspTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchServices("monitoring"),
      fetchServices("retainer"),
      fetchServices("msp"),
    ])
      .then(([monRaw, retRaw, mspRaw]) => {
        if (cancelled) return;
        setMonitoringTiers(monRaw.map(toMonitoringTier));
        setRetainerTiers(retRaw.map(toRetainerTier));
        setMspTiers(mspRaw.map(toMspTier));
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

  return { monitoringTiers, retainerTiers, mspTiers, loading, error };
}
