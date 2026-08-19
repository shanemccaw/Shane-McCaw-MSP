/**
 * usePortalV2Pillars.ts — the single data seam for the Customer Portal v2 pages.
 *
 * This deliberately owns NO fetching, NO retry policy and NO scoring. It wraps
 * `useWarRoomPillarStats()` — the existing hook that already:
 *   • calls `GET /api/portal/assessment/war-room-pillars` (the real health
 *     engine's per-pillar display score plus the tenant's real findings),
 *   • holds `fetchWithAuth` in a ref so a mid-run token refresh cannot tear the
 *     request machinery down,
 *   • re-fetches when a run reaches its terminal state (the first moment that
 *     run's findings exist to read),
 *   • clears on a newly triggered run so a re-scan cannot leave stale numbers,
 *   • retries with backoff rather than sitting on nothing.
 *
 * Reimplementing any of that here would have produced a second, drifting copy
 * of behaviour that took several issues (#251, #277, #320) to get right.
 *
 * The one thing this adds is the narrowing seam described in portalV2Model.ts:
 * the shared payload mirror is a subset of what the server sends, and these
 * pages need `evaluation` and `trend`.
 */

import { useMemo } from "react";

import { useScanStatus } from "@/lib/scan-status-context";
import { useWarRoomPillarStats } from "@/components/war-room/useWarRoomPillarStats";

import {
  buildPortalV2View,
  type PortalV2Payload,
  type PortalV2View,
} from "./portalV2Model";

export interface PortalV2PillarsState {
  readonly view: PortalV2View;
  /** True once a first real payload has arrived. */
  readonly loaded: boolean;
  /** True while a scan is genuinely running right now. */
  readonly scanning: boolean;
  /** True once this tenant has any completed scan at all. */
  readonly everScanned: boolean;
}

export function usePortalV2Pillars(): PortalV2PillarsState {
  const { payload, loaded } = useWarRoomPillarStats();
  const scanStatus = useScanStatus();

  // The shared mirror types a subset of the real response. The server sends the
  // richer shape (api-server lib/war-room-pillar-stats.ts, `WarRoomPillarCard`),
  // so this narrows rather than invents — see portalV2Model.ts for why the
  // shared mirror is not widened instead.
  const view = useMemo(
    () => buildPortalV2View((payload as unknown as PortalV2Payload | null) ?? null),
    [payload],
  );

  return {
    view,
    loaded,
    scanning: Boolean(scanStatus.data?.active ?? null),
    everScanned: scanStatus.data?.everScanned === true,
  };
}
