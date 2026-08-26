/**
 * RiskDecisionsFetchBridge — always mounted in AdminV2.tsx.
 *
 * Wires the platform-admin authenticated fetch into the risk-decisions store and
 * warm-loads the customer list + linked-check catalog so the Watch-tab count and
 * the palette answers have live numbers before /risk-decisions is opened. See
 * #1294.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureRbdFetch, warmRbd } from "./riskDecisionsStore";

export function RiskDecisionsFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureRbdFetch(adminFetch);
    warmRbd();
  }, [adminFetch]);

  return null;
}
