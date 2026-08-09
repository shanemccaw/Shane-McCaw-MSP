/**
 * Hands `marketingStore` a live `adminFetch` and warms campaigns + articles
 * once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `EnginesFetchBridge` and
 * `ServicesFetchBridge` are: the Home tab's "Browse campaigns" gallery and the
 * Watch tab's "Waiting on you" count are both built from store state at
 * ribbon render time, so they have to be loaded whether or not `/marketing`
 * has ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureMarketingFetch, warmMarketing } from "./marketingStore";

export function MarketingFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureMarketingFetch(adminFetch);
    warmMarketing();
  }, [adminFetch]);

  return null;
}
