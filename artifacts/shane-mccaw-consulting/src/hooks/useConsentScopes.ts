import { useEffect, useState } from "react";

/**
 * Fetches the real Graph application permissions requested by the multi-tenant
 * App Registration (single source of truth: api-server's REQUIRED_MT_SCOPES),
 * so the marketing site's consent-scopes list can never drift from what the
 * app registration actually requests (#433). Returns an empty array while
 * loading or on failure — callers should render a graceful empty/loading state
 * rather than falling back to a second hardcoded copy of the list.
 */
export function useConsentScopes(): { scopes: string[]; loading: boolean } {
  const [scopes, setScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/consent-scopes")
      .then((r) => (r.ok ? (r.json() as Promise<string[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setScopes(data);
      })
      .catch(() => {
        // keep the empty list; caller shows a graceful fallback
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { scopes, loading };
}
