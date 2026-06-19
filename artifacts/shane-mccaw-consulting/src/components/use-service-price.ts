import { useState, useEffect } from "react";

interface ServiceRecord {
  id: number;
  slug: string;
  name: string;
  price: string | null;
  billingType: string;
}

function formatPrice(price: string | null): string | null {
  if (!price) return null;
  const num = parseFloat(price);
  if (isNaN(num)) return null;
  return "$" + num.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

let _cache: ServiceRecord[] | null = null;
let _promise: Promise<ServiceRecord[]> | null = null;

function fetchServices(): Promise<ServiceRecord[]> {
  if (_cache) return Promise.resolve(_cache);
  if (!_promise) {
    _promise = fetch("/api/portal/onboarding/services")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch services");
        return r.json() as Promise<ServiceRecord[]>;
      })
      .then((data) => {
        _cache = data;
        return data;
      })
      .catch((err) => {
        _promise = null;
        throw err;
      });
  }
  return _promise;
}

export function useServicePrice(slug: string, fallback: string): string {
  const [price, setPrice] = useState<string>(fallback);

  useEffect(() => {
    let cancelled = false;
    fetchServices()
      .then((services) => {
        if (cancelled) return;
        const svc = services.find((s) => s.slug === slug);
        if (svc?.price) {
          const formatted = formatPrice(svc.price);
          if (formatted) setPrice(formatted);
        }
      })
      .catch(() => {
        // Keep fallback on error — no-op
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return price;
}
