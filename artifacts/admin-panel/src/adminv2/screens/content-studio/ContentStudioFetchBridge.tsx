/**
 * Hands `contentStudioStore` a live `adminFetch` and warms the post list
 * once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `MarketingFetchBridge`
 * is: the Queue gallery and the Watch tab's "Failed posts" count are both
 * built from store state at ribbon render time, so they have to be loaded
 * whether or not `/content-studio` has ever been the active screen. Renders
 * nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureContentStudioFetch, warmContentStudio } from "./contentStudioStore";

export function ContentStudioFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureContentStudioFetch(adminFetch);
    warmContentStudio();
  }, [adminFetch]);

  return null;
}
