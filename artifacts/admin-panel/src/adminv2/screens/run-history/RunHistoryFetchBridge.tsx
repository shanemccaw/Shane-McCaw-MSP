/**
 * Hands `runHistoryStore` a live `adminFetch` and warms the log once.
 *
 * Always mounted (see `AdminV2.tsx`), for two reasons rather than the usual
 * one: the Watch tab's "Runs that failed" count and the `run` tab's "Recent
 * runs" gallery are both built at `registerScreen()` module-load time, so they
 * need real rows whether or not `/run-history` has ever been the active
 * screen; and `deployStore`/`sqlStore` call `runHistoryChanged()` the moment a
 * run finishes, which can only refresh anything if a fetch has been handed
 * over by then. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureRunHistoryFetch, warmRunHistory } from "./runHistoryStore";

export function RunHistoryFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureRunHistoryFetch(adminFetch);
    warmRunHistory();
  }, [adminFetch]);

  return null;
}
