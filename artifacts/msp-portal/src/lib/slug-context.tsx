import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

const SESSION_SLUG_KEY = "msp_last_slug";

type MspSlugContextValue = {
  slug: string;
  mspId: number | null;
};

const MspSlugContext = createContext<MspSlugContextValue | null>(null);

export function SlugProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const { fetchWithAuth, accessToken } = useAuth();
  const [mspId, setMspId] = useState<number | null>(null);

  useEffect(() => {
    if (slug) sessionStorage.setItem(SESSION_SLUG_KEY, slug);
  }, [slug]);

  // Resolve the numeric mspId once per (slug, login) so path-based
  // /msps/:mspId/... routes don't each need their own slug lookup.
  useEffect(() => {
    setMspId(null);
    if (!slug || !accessToken) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/msp/resolve-slug/${encodeURIComponent(slug)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { mspId: number };
        if (!cancelled) setMspId(data.mspId ?? null);
      } catch {
        // ignore — callers treat null mspId as "not yet resolved"
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, accessToken, fetchWithAuth]);

  return (
    <MspSlugContext.Provider value={{ slug, mspId }}>
      {children}
    </MspSlugContext.Provider>
  );
}

/** Returns the MSP slug currently in context, or null when outside slug scope. */
export function useMspSlug(): string | null {
  return useContext(MspSlugContext)?.slug ?? null;
}

/** Returns the numeric mspId resolved for the current slug, or null until resolved
 *  (or when outside slug scope). Use for path-based /msps/:mspId/... API calls. */
export function useMspId(): number | null {
  return useContext(MspSlugContext)?.mspId ?? null;
}

/** Returns the last slug stored in sessionStorage (for flat-login fallback). */
export function getStoredSlug(): string | null {
  try {
    return sessionStorage.getItem(SESSION_SLUG_KEY);
  } catch {
    return null;
  }
}

/** Persist a slug to sessionStorage so future flat-login visits resolve instantly. */
export function storeSlug(slug: string): void {
  try {
    sessionStorage.setItem(SESSION_SLUG_KEY, slug);
  } catch {
    // ignore — sessionStorage unavailable
  }
}
