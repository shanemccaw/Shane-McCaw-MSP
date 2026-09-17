/**
 * FreeScanRecoveryFetchBridge — always mounted in AdminV2.tsx.
 *
 * Wires the platform-admin authenticated fetch into the Free Scan account
 * recovery store and warm-loads the queue, so the Watch-tab count of pending
 * second-factor resets is live before the screen is opened. See #4483.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureFreeScanRecoveryFetch, warmFreeScanRecovery } from "./freeScanRecoveryStore";

export function FreeScanRecoveryFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureFreeScanRecoveryFetch(adminFetch);
    warmFreeScanRecovery();
  }, [adminFetch]);

  return null;
}
