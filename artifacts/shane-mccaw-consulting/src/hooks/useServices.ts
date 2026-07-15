import { useState, useEffect } from "react";

export interface PublicService {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string[] | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  turnaround: string | null;
  durationDays: number | null;
  billingType: "one_time" | "recurring_monthly";
  serviceType: string | null;
  tagline: string | null;
  targetAudience: string | null;
  inclusions: string[] | null;
  features: string[] | null;
  badge: string | null;
  highlighted: boolean;
  hoursPerMonth: string | null;
  iconName: string | null;
  pageHref: string | null;
  pageSlug: string | null;
  sortOrder: number;
  tier: string | null;
  hasPdf: boolean;
  bestFor: string | null;
  triggers: string[] | null;
  fulfillmentTypeKey: string | null;
  workflowTasks: { title: string; description: string | null; order: number }[];
  workflowSummary: { title: string; description: string | null }[];
  isFreeOffering?: boolean | null;
  typeAttributes: Record<string, unknown> | null;
}

export function formatPrice(price: string | null): string | null {
  if (!price) return null;
  const num = parseFloat(price);
  if (isNaN(num)) return null;
  return "$" + num.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatPriceDisplay(service: PublicService): string {
  const fmt = (v: string | null) => {
    if (!v) return null;
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const base = fmt(service.basePrice);
  const max = fmt(service.maxPrice);
  if (base && max) return `${base}–${max}`;
  if (base) return base;
  const single = fmt(service.price);
  if (single) return single;
  return "Contact for pricing";
}

const _cache: Record<string, PublicService[]> = {};
const _pending: Record<string, Promise<PublicService[]>> = {};

export function fetchServices(params?: string | { type?: string; category?: string }): Promise<PublicService[]> {
  const type = typeof params === "string" ? params : params?.type;
  const category = typeof params === "string" ? undefined : params?.category;
  const key = type ? `type:${type}` : category ? `category:${category}` : "__all__";

  if (_cache[key]) return Promise.resolve(_cache[key]);
  if (!_pending[key]) {
    const urlParts = [];
    if (type) urlParts.push(`type=${encodeURIComponent(type)}`);
    if (category) urlParts.push(`category=${encodeURIComponent(category)}`);
    const url = urlParts.length > 0 ? `/api/services?${urlParts.join("&")}` : "/api/services";

    _pending[key] = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch services");
        return r.json() as Promise<PublicService[]>;
      })
      .then((data) => {
        _cache[key] = data;
        delete _pending[key];
        return data;
      })
      .catch((err) => {
        delete _pending[key];
        throw err;
      });
  }
  return _pending[key];
}

/**
 * Returns true when any service whose `pageHref` exactly matches the given
 * path has a pre-generated PDF brochure available.
 *
 * Pass the page's own route (e.g. "/services/microsoft-365"). Using pageHref
 * for the lookup avoids the fragile name-matching that plagued the previous
 * approach — the DB value is stable and unique per service page.
 */
export function useServiceHasPdf(pageHref: string): boolean {
  const { services } = useServices();
  const match = services.find((s) => s.pageHref === pageHref);
  return match?.hasPdf ?? false;
}

export function useServices(params?: string | { type?: string; category?: string }): {
  services: PublicService[];
  loading: boolean;
  error: string | null;
} {
  const type = typeof params === "string" ? params : params?.type;
  const category = typeof params === "string" ? undefined : params?.category;
  const key = type ? `type:${type}` : category ? `category:${category}` : "__all__";

  const [services, setServices] = useState<PublicService[]>(_cache[key] ?? []);
  const [loading, setLoading] = useState<boolean>(!_cache[key]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_cache[key]) {
      setServices(_cache[key]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchServices(params)
      .then((data) => {
        if (!cancelled) {
          setServices(data);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load services");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, params]);

  return { services, loading, error };
}
