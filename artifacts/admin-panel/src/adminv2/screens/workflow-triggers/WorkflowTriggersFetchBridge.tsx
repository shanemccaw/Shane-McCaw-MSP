/**
 * Hands `triggersStore` a live `adminFetch` and warms the trigger list +
 * definition picker once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `WorkflowFetchBridge`
 * is: the Home tab's "All triggers" gallery and the Watch tab's live
 * "trigger errors" count are built from this store before `/triggers` has
 * ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureTriggersFetch, warmTriggers } from "./triggersStore";

export function WorkflowTriggersFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureTriggersFetch(adminFetch);
    void warmTriggers();
  }, [adminFetch]);

  return null;
}
