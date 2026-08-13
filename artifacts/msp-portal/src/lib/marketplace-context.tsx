/**
 * marketplace-context.tsx
 *
 * Lets Marketplace open as a real overlay dialog on top of whatever page the
 * user was already on, instead of navigating to /marketplace as a full page.
 * Provided once at the app root; MarketplaceModalHost (mounted alongside it)
 * renders MarketplaceModal in a Dialog whenever isOpen is true. In-app trigger
 * points (sidebar nav item, avatar dropdown, command palette) call open()
 * rather than navigating. The real /marketplace route stays wired to
 * MarketplacePage for direct links/bookmarks, unrelated to this context.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface MarketplaceContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <MarketplaceContext.Provider value={{ isOpen, open, close }}>
      {children}
    </MarketplaceContext.Provider>
  );
}

export function useMarketplace(): MarketplaceContextValue {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) throw new Error("useMarketplace must be used within a MarketplaceProvider");
  return ctx;
}
