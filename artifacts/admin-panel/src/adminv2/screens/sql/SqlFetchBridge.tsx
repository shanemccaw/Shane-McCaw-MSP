/**
 * Hands `sqlStore` a live `adminFetch` and warms scripts/migrations/schema once.
 *
 * Always mounted (see `AdminV2.tsx`), same reason `MoneyFetchBridge` is: the
 * `run` tab's "Saved scripts" gallery is built at `registerScreen()`
 * module-load time and needs real rows whether or not `/sql` has ever been
 * the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureSqlFetch, warmSql } from "./sqlStore";

export function SqlFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureSqlFetch(adminFetch);
    warmSql();
  }, [adminFetch]);

  return null;
}
