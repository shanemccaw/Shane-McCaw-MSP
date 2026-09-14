/**
 * React Query hooks + real fetch actions for the customer-facing Offers and
 * SOW Acceptance surface (#3997, Feature #1657), wired against the real,
 * live endpoints documented in
 * `Design/portal/design_handoff_full_site/docs/offers-and-sow-acceptance-contract-pack.md`:
 *
 *   GET  /api/portal/offers
 *   GET  /api/portal/offers/sse
 *   POST /api/portal/offers/:id/accept
 *   POST /api/portal/offers/:id/reject
 *   GET  /api/portal/presentations/latest
 *   GET  /api/portal/presentations/:id
 *   POST /api/portal/presentations/:id/sign
 *
 * `GET /api/portal/offers/:id` and `GET /api/portal/presentations/:id/sow-document`
 * are not wired here: the list response already carries the full customer-safe
 * offer shape (no separate detail fetch is needed), and the SOW document route
 * returns raw HTML meant to open directly in a new tab (see `openSowDocumentUrl`).
 *
 * `GET /api/platform/agreement/current` is deliberately NOT wired — per the
 * contract pack's own Finding (§9b) that endpoint is Shane's platform MSA/DPA
 * that an MSP accepts once per account, not a customer-facing "accept these
 * offer terms" concept. No customer terms-acceptance record exists to write,
 * so none is faked here.
 *
 * No fixture module, no fallback data. Empty lists are real (`[]` from the
 * route, not a placeholder).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  OfferSSEEvent,
  WireCustomerOffer,
  WireLatestPresentation,
  WirePresentationDetail,
  WireSignResult,
} from "@/lib/offers-sow-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const QK = {
  offers: ["portal", "offers"] as const,
  latestPresentation: ["portal", "presentations", "latest"] as const,
  presentation: (id: number) => ["portal", "presentations", id] as const,
};

export function useOffers() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.offers,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/offers", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ offers: WireCustomerOffer[] }>(res);
      return data.offers;
    },
  });
}

/** Real-time offer changes over the canonical event bus, falling back to a
 * 30s poll when SSE is unavailable — same shape as the retired portal-v2 page. */
export function useOffersLiveUpdates(onChange: () => void) {
  const { accessToken } = useAuth();
  const sseRef = useRef<EventSource | null>(null);
  const [connected, setConnected] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!accessToken) return;
    const url = `/api/portal/offers/sse?token=${encodeURIComponent(accessToken)}`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as OfferSSEEvent;
        if (data.type === "offer_changed") onChangeRef.current();
      } catch {
        // ignore malformed frames
      }
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      sseRef.current = null;
    };

    sseRef.current = es;
    return () => {
      es.close();
      sseRef.current = null;
      setConnected(false);
    };
  }, [accessToken]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!sseRef.current || sseRef.current.readyState === EventSource.CLOSED) {
        onChangeRef.current();
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  return { connected };
}

export function useAcceptOffer() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (offerId: number) => {
      const res = await fetchWithAuth(`/api/portal/offers/${offerId}/accept`, { method: "POST" }, { silent: true });
      const data = await parseJsonOrThrow<{ offer: WireCustomerOffer }>(res);
      return data.offer;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.offers });
    },
  });
}

export function useRejectOffer() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, rejectionReason }: { offerId: number; rejectionReason?: string }) => {
      const res = await fetchWithAuth(
        `/api/portal/offers/${offerId}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rejectionReason: rejectionReason || undefined }),
        },
        { silent: true },
      );
      const data = await parseJsonOrThrow<{ offer: WireCustomerOffer }>(res);
      return data.offer;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.offers });
    },
  });
}

/** Resolves which presentation id to load for the SOW tab. `null` presentation is real — no SOW exists yet. */
export function useLatestPresentation() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.latestPresentation,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/presentations/latest", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ presentation: WireLatestPresentation | null }>(res);
      return data.presentation;
    },
  });
}

export function usePresentation(id: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.presentation(id ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/portal/presentations/${id}`, undefined, { silent: true });
      return parseJsonOrThrow<WirePresentationDetail>(res);
    },
    enabled: id != null,
  });
}

export function useSignPresentation(id: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ signatureData, signerName }: { signatureData: string; signerName: string }) => {
      const res = await fetchWithAuth(
        `/api/portal/presentations/${id}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData, signerName }),
        },
        { silent: true },
      );
      return parseJsonOrThrow<WireSignResult>(res);
    },
    onSuccess: () => {
      if (id != null) void queryClient.invalidateQueries({ queryKey: QK.presentation(id) });
      void queryClient.invalidateQueries({ queryKey: QK.latestPresentation });
    },
  });
}

/**
 * Opens the full SOW document in a new tab — raw HTML, not JSON (contract pack
 * §6). The route authenticates via the `Authorization` header, which a plain
 * `window.open(url)` can't attach, so this fetches the HTML through
 * `fetchWithAuth` first and opens it as a blob URL instead.
 */
export function useOpenSowDocument() {
  const { fetchWithAuth } = useAuth();
  return useCallback(
    async (presentationId: number): Promise<string | null> => {
      try {
        const res = await fetchWithAuth(`/api/portal/presentations/${presentationId}/sow-document`, undefined, {
          silent: true,
        });
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        // Revoke after a delay long enough for the new tab to load it.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    [fetchWithAuth],
  );
}
