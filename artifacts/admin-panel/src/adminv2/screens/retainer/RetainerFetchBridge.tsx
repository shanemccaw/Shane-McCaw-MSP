/**
 * RetainerFetchBridge — always mounted in AdminV2.tsx.
 *
 * Wires the platform-admin authenticated fetch into the retainer store and warm
 * loads the customer list so the Money-tab ribbon group / gallery have live
 * buckets before /retainer has ever been opened.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureRetainerFetch, warmRetainer } from "./retainerStore";

export function RetainerFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureRetainerFetch(adminFetch);
    warmRetainer();
  }, [adminFetch]);

  return null;
}
