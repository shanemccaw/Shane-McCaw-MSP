/**
 * Escape hatch for the two Active Directory ribbon buttons that live on the
 * fixed Home tab ("New MSP", "New organizational unit") and therefore must
 * work even when the "ad" screen itself is not the mounted one — Home-tab
 * groups render from every registered screen regardless of current route
 * (SHELL.md section 1). A `RibbonGroup`'s `onSelect` closures are built once
 * at `registerScreen()` module-load time, outside any component, so they
 * cannot call `useAuth()` directly.
 *
 * Same shape as `getShellApi()` in `shell/ShellContext.tsx`: a module-level
 * singleton, written by an always-mounted component's effect, read only at
 * click time — by which point `<AdAuthBridge>` (mounted unconditionally in
 * AdminV2.tsx, the same way `<FloatingDeployConsole>` is for the git screen)
 * has always run at least once.
 */

import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { AdminFetch } from "./adApi";

let adminFetchSingleton: AdminFetch | null = null;

/** Null only in the impossible case this ran before `<AdAuthBridge>` ever mounted. */
export function getAdAdminFetch(): AdminFetch | null {
  return adminFetchSingleton;
}

export function AdAuthBridge() {
  const { fetchWithAuth } = useAuth();

  useEffect(() => {
    adminFetchSingleton = fetchWithAuth;
    return () => {
      adminFetchSingleton = null;
    };
  }, [fetchWithAuth]);

  return null;
}
