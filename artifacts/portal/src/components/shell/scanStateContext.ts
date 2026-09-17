import { createContext, useContext } from "react";
import type { ScanState } from "./useScanState";

/**
 * Shares the single `useScanState()` value `PortalShell` already computes
 * (real SSE + adaptive-poll phase, Git #1824) with a route page mounted
 * below it — e.g. `pillar.tsx` — so that page can react to a scan's real
 * `complete`/`partial` transition without opening a second poll/SSE
 * connection to the same run (#4557).
 */
export const ScanStateContext = createContext<ScanState | null>(null);

export function useScanStateContext(): ScanState | null {
  return useContext(ScanStateContext);
}
