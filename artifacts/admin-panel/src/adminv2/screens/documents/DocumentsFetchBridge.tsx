/**
 * Hands `documentsStore` a live `adminFetch` and warms the history once.
 *
 * Always mounted (see `AdminV2.tsx`), for the same reason as
 * `RunHistoryFetchBridge`: the Watch tab's "Generations that failed" count and
 * the Home tab's "Recent documents" gallery are both built at
 * `registerScreen()` module-load time, so they need real rows whether or not
 * `/documents` has ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureDocumentsFetch, warmDocuments } from "./documentsStore";

export function DocumentsFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureDocumentsFetch(adminFetch);
    warmDocuments();
  }, [adminFetch]);

  return null;
}
