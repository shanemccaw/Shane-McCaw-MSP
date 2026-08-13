/**
 * Hands `observabilityStore` a live `adminFetch` and warms the four counts once.
 *
 * Always mounted (see `AdminV2.tsx`), regardless of the active screen, for the
 * same reason `CrmFetchBridge` is: this screen contributes groups to the fixed
 * `watch` tab, which is reachable from anywhere, and `registerScreen()`'s
 * `ribbon`/`peeks`/`commands` closures are built at module-load time with no
 * component to call `useAdminFetch()` from.
 *
 * Warming matters more here than elsewhere. `watch` is the "what needs me" tab
 * (SHELL.md section 1) and its `?` palette answers are the numbers that say
 * whether anything is wrong — a `?` row that reads zero because nothing has
 * been fetched yet is worse than no row at all, because it actively tells you
 * the platform is fine. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureObservabilityFetch, warmAll } from "./observabilityStore";

export function ObservabilityFetchBridge() {
  const { adminFetch } = useAdminFetch();

  // Re-bound whenever useAuth() hands back a new adminFetch, so a token
  // refresh never leaves the store holding a stale closure.
  useEffect(() => {
    configureObservabilityFetch(adminFetch);
  }, [adminFetch]);

  // Once. The screen and the ribbon's Refresh re-read explicitly.
  useEffect(() => {
    warmAll();
  }, []);

  return null;
}
