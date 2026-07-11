import React, { createContext, useContext, useEffect } from "react";

const SESSION_SLUG_KEY = "msp_last_slug";

const MspSlugContext = createContext<string | null>(null);

export function SlugProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (slug) sessionStorage.setItem(SESSION_SLUG_KEY, slug);
  }, [slug]);

  return (
    <MspSlugContext.Provider value={slug}>{children}</MspSlugContext.Provider>
  );
}

/** Returns the MSP slug currently in context, or null when outside slug scope. */
export function useMspSlug(): string | null {
  return useContext(MspSlugContext);
}

/** Returns the last slug stored in sessionStorage (for flat-login fallback). */
export function getStoredSlug(): string | null {
  try {
    return sessionStorage.getItem(SESSION_SLUG_KEY);
  } catch {
    return null;
  }
}
