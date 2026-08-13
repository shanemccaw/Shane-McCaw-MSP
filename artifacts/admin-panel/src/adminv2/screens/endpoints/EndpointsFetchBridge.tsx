/**
 * Hands `endpointsStore` a live `adminFetch` and warms the catalog once.
 *
 * Always mounted (see `AdminV2.tsx`), for the same reason `MoneyFetchBridge`
 * and `CrmFetchBridge` are: three of this screen's surfaces live OUTSIDE the
 * screen and are reachable before `/endpoints` has ever been opened —
 *
 *   • the Home tab's "Browse endpoints" gallery, whose rows carry real data
 *     (`SHELL.md` section 5: "Rows carry real data, not labels");
 *   • the Watch tab's "In no package" button, which carries a live count —
 *     `handoff.md` section 3 names unpackaged endpoints as a Watch item;
 *   • the `endpoint` peek, whose resolver is synchronous (`registry/types.ts`)
 *     and so can only ever read state that was already fetched.
 *
 * Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureEndpointsFetch, warmCatalog } from "./endpointsStore";

export function EndpointsFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureEndpointsFetch(adminFetch);
    warmCatalog();
  }, [adminFetch]);

  return null;
}
