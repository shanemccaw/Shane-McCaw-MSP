/**
 * webhooksLive.ts — the Webhooks page's real data (Git #1249).
 *
 *   GET /api/portal/webhooks
 *   GET /api/portal/webhooks/:webhookId/deliveries
 *
 * both served by `artifacts/api-server/src/routes/webhooks.ts`, which already
 * scopes rows to the caller's msp/customer ownership. Same shape as
 * `complianceObligationsLive.ts`'s `useComplianceObligationsLive`: a plain
 * fetch behind `fetchWithAuth`, fixture until a real (possibly empty) response
 * lands, no retry/scan-status coupling.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { WEBHOOKS } from "./webhooksData";
import { whEventChips, whEventCount } from "./webhooksModel";
import { toLiveEndpoint, type LiveEndpoint, type WireDelivery, type WireWebhook } from "./webhooksWire";

const WEBHOOKS_URL = "/api/portal/webhooks";
const RECENT_DELIVERIES_LIMIT = 20;

const FIXTURE_ENDPOINTS: readonly LiveEndpoint[] = WEBHOOKS.map((w) => ({
  webhook: w,
  chips: whEventChips(w.events),
  eventCountLabel: whEventCount(w.events),
}));

export interface WebhooksLiveState {
  /** Real endpoints once loaded; the design fixture until then or on error. */
  readonly endpoints: readonly LiveEndpoint[];
  /** "live" once a real (possibly empty) webhooks response has landed. */
  readonly dataState: "live" | "fixture";
  readonly loading: boolean;
  /**
   * Re-fetch the list + each endpoint's recent deliveries. Called after a
   * mutation (rotate / edit / delete, Git #1605) succeeds so the page reflects
   * the real post-write state rather than a locally-guessed one.
   */
  readonly refresh: () => void;
}

export function useWebhooksLive(): WebhooksLiveState {
  const { fetchWithAuth } = useAuth();
  const [endpoints, setEndpoints] = useState<readonly LiveEndpoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetchWithAuth(WEBHOOKS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`webhooks ${res.status}`);
        const body = (await res.json()) as { webhooks?: readonly WireWebhook[] };
        const rows = body?.webhooks ?? [];

        const mapped = await Promise.all(
          rows.map(async (row) => {
            try {
              const dres = await fetchWithAuth(
                `${WEBHOOKS_URL}/${row.webhookId}/deliveries?limit=${RECENT_DELIVERIES_LIMIT}`,
                undefined,
                { silent: true },
              );
              if (!dres.ok) return toLiveEndpoint(row, []);
              const dbody = (await dres.json()) as { deliveries?: readonly WireDelivery[] };
              return toLiveEndpoint(row, dbody?.deliveries ?? []);
            } catch {
              return toLiveEndpoint(row, []);
            }
          }),
        );

        if (cancelled) return;
        setEndpoints(mapped);
      } catch {
        if (!cancelled) setEndpoints(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, reloadToken]);

  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  return useMemo(
    () => ({
      endpoints: endpoints ?? FIXTURE_ENDPOINTS,
      dataState: endpoints !== null ? "live" : "fixture",
      loading,
      refresh,
    }),
    [endpoints, loading, refresh],
  );
}
