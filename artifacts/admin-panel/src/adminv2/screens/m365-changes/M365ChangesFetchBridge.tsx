/**
 * M365ChangesFetchBridge — always mounted in AdminV2.tsx.
 *
 * Wires the platform-admin authenticated fetch into the Microsoft Changes store
 * and warm-loads the interpretation library so the Watch-tab "n proposed,
 * awaiting you" count and the palette answers have live numbers before
 * /m365-changes is opened. See #1532.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureM365ChangesFetch, warmM365Changes } from "./m365ChangesStore";

export function M365ChangesFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureM365ChangesFetch(adminFetch);
    warmM365Changes();
  }, [adminFetch]);

  return null;
}
