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

import { useEffect, useMemo, useState } from "react";

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
}

export function useWebhooksLive(): WebhooksLiveState {
  const { fetchWithAuth } = useAuth();
  const [endpoints, setEndpoints] = useState<readonly LiveEndpoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
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
  }, [fetchWithAuth]);

  return useMemo(
    () => ({
      endpoints: endpoints ?? FIXTURE_ENDPOINTS,
      dataState: endpoints !== null ? "live" : "fixture",
      loading,
    }),
    [endpoints, loading],
  );
}
