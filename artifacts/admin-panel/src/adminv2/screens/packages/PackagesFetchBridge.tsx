/**
 * Hands `packagesStore` a live `adminFetch` and warms the catalog once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `MoneyFetchBridge` and
 * `CrmFetchBridge` are: this screen contributes a Home-tab gallery of packages
 * and a Watch-tab count of packages that resolve no runnable check, both built
 * at `registerScreen()` module-load time. Neither can carry a real number
 * unless the catalog is loaded whether or not `/packages` has ever been the
 * active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configurePackagesFetch, warmCatalog } from "./packagesStore";

export function PackagesFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configurePackagesFetch(adminFetch);
    void warmCatalog();
  }, [adminFetch]);

  return null;
}
