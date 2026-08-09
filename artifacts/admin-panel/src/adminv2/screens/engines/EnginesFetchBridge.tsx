/**
 * Hands `enginesStore` a live `adminFetch` and warms the engine registry once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `MoneyFetchBridge` is:
 * the Run tab's "One engine" gallery lists the real twelve engines with their
 * real configuration modes, and that list is built from store state at ribbon
 * render time — so it has to be loaded whether or not `/engines` has ever
 * been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureEnginesFetch, warmEngines } from "./enginesStore";

export function EnginesFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureEnginesFetch(adminFetch);
    warmEngines();
  }, [adminFetch]);

  return null;
}
