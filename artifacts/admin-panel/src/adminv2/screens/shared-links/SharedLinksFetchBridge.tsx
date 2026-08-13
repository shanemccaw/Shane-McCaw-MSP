/**
 * Hands `sharedLinksStore` a live `adminFetch` and warms the list once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `ServicesFetchBridge`
 * and `FulfillmentFetchBridge` are: the Home tab's gallery and the Watch
 * tab's live "expiring soon" count are built from this store before
 * `/shared-links` has ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureSharedLinksFetch, warmShares } from "./sharedLinksStore";

export function SharedLinksFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureSharedLinksFetch(adminFetch);
    warmShares();
  }, [adminFetch]);

  return null;
}
