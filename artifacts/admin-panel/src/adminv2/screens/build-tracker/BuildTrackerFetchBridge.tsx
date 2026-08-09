/**
 * BuildTrackerFetchBridge — always mounted in AdminV2.tsx.
 *
 * Same pattern as MarketingFetchBridge / EndpointsFetchBridge: wires
 * adminFetch into the store and loads data on mount so the Build-tab ribbon
 * groups have live counts before /build-tracker has ever been opened.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { loadAll, wireAdminFetch } from "./buildTrackerStore";

export function BuildTrackerFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    wireAdminFetch(adminFetch);
    void loadAll();
    // Mount only — data is refreshed explicitly by the screen.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
