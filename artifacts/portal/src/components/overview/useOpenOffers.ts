import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { OfferSummaryWire, OffersResponseWire } from "./types";

const OFFERS_URL = "/api/portal/offers";

export interface OpenOffersState {
  readonly offers: readonly OfferSummaryWire[];
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: boolean;
}

/**
 * The real `GET /api/portal/offers` read backing the Overview "Open Offers"
 * card (#4129) — filtered client-side to `state === "sent"`, matching the
 * design's own `openOffers` (Overview.dc.html: real offers, not a fixture).
 */
export function useOpenOffers(): OpenOffersState {
  const { fetchWithAuth, user } = useAuth();
  const [offers, setOffers] = useState<OfferSummaryWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    void fetchWithAuth(OFFERS_URL, undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(`offers ${res.status}`);
        return (await res.json()) as OffersResponseWire;
      })
      .then((body) => {
        if (cancelled) return;
        setOffers(body.offers.filter((o) => o.state === "sent"));
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth]);

  return { offers, loading, loaded, error };
}
