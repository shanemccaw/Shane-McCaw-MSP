/**
 * Hands `servicesStore` a live `adminFetch` and warms the catalog once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `MoneyFetchBridge` and
 * `EndpointsFetchBridge` are: the Home tab's catalog gallery and the Watch
 * tab's "no price set" live count are built from this store before `/services`
 * has ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureServicesFetch, warmCatalog } from "./servicesStore";

export function ServicesFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureServicesFetch(adminFetch);
    warmCatalog();
  }, [adminFetch]);

  return null;
}
