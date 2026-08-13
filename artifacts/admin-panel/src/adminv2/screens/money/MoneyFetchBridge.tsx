/**
 * Hands `moneyStore` a live `adminFetch` and warms the summary once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `CrmFetchBridge` is:
 * the Money tab's own ribbon label shows real profit (design convention,
 * `SHELL.md`), so the number has to be loaded whether or not `/money` has
 * ever been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureMoneyFetch, warmSummary } from "./moneyStore";

export function MoneyFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureMoneyFetch(adminFetch);
    warmSummary();
  }, [adminFetch]);

  return null;
}
