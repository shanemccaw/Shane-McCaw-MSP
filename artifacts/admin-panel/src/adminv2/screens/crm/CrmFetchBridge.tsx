/**
 * Hands `crmStore` a live `adminFetch` and warms leads/deals once.
 *
 * Always mounted (see `AdminV2.tsx`), regardless of the active screen: the
 * CRM screen contributes buttons to the fixed `home` tab, which is reachable
 * from any screen, and `registerScreen()`'s `ribbon`/`peeks`/`commands`
 * closures are built at module-load time with no component to call
 * `useAdminFetch()` from — the same problem `FloatingDeployConsole` solves
 * for the Git tab. Warming leads/deals here (not just inside `CrmBody`)
 * means a `#` lead command or a `lead` peek resolves correctly even if
 * `/crm` itself has never been opened. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureCrmFetch, loadDeals, loadLeads } from "./crmStore";

export function CrmFetchBridge() {
  const { adminFetch } = useAdminFetch();

  // Re-bound whenever useAuth() hands back a new adminFetch (matches
  // FloatingDeployConsole's own deploy-fetch wiring), so a token refresh
  // never leaves crmStore holding a stale closure.
  useEffect(() => {
    configureCrmFetch(adminFetch);
  }, [adminFetch]);

  // The warm load itself only runs once — CrmBody re-loads explicitly when
  // the user asks, this is just so a `#` lead command or a `lead` peek can
  // resolve before /crm has ever been opened.
  useEffect(() => {
    void loadLeads();
    void loadDeals();
  }, []);

  return null;
}
