/**
 * Hands `workflowStore` a live `adminFetch` and warms the definitions list +
 * pending approvals once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `FulfillmentFetchBridge`
 * and `EnginesFetchBridge` are: the Home tab's "Workflows" gallery and the
 * Watch tab's live "pending approvals" count are built from this store before
 * `/workflows` has ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureWorkflowFetch, warmWorkflows } from "./workflowStore";

export function WorkflowFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureWorkflowFetch(adminFetch);
    void warmWorkflows();
  }, [adminFetch]);

  return null;
}
