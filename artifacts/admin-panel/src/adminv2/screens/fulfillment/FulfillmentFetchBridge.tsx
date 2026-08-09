/**
 * Hands `fulfillmentStore` a live `adminFetch` and warms the queue once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `ServicesFetchBridge`
 * and `PackagesFetchBridge` are: the Home tab's queue gallery and the Watch
 * tab's live "overdue" count are built from this store before `/fulfillment`
 * has ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureFulfillmentFetch, warmFulfillment } from "./fulfillmentStore";

export function FulfillmentFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureFulfillmentFetch(adminFetch);
    void warmFulfillment();
  }, [adminFetch]);

  return null;
}
