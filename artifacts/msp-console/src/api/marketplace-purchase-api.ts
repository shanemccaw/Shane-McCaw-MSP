/**
 * marketplace-purchase-api.ts — the data seam for the MSP Console's
 * Marketplace Purchase module (Git #3819, README screen 47), wiring the real
 * two-route surface in
 * `artifacts/api-server/src/routes/msp-marketplace-purchase.ts`:
 *
 *   GET  /api/msp/customers/:customerId/marketplace/catalog
 *   POST /api/msp/customers/:customerId/marketplace/checkout
 *
 * See `docs/msp-console/marketplace-purchase-msp-console-contract-pack.md`
 * for the full wire contract and its live-data findings (#3400, #3403,
 * #3404, #3405).
 *
 * Honest departures from `Marketplace Purchase.dc.html`'s own mock, verified
 * against the real route on 2026-09-12 (Git #3819):
 *
 * - **#3400 (accepted-before-charged) and #3403 (retainers billed once) are
 *   both genuinely fixed.** The route no longer writes the `sales_offers` row
 *   until a free item is activated or a paid charge actually succeeds, and
 *   every live retainer row (`billingType === "recurring_monthly"`) now opens
 *   a real Stripe Subscription instead of a one-time PaymentIntent. This
 *   module does not reproduce the design's "accepted before the card is
 *   charged" banner or its "a monthly item that will only ever bill once"
 *   warning — both would be false today.
 * - **#3404 (silent fulfillment no-op) is still real and still open.** 20
 *   `assessment`-fulfillmentTypeKey rows and 6 `retainer`-fulfillmentTypeKey
 *   rows match no real `fulfillment_types` row, so a purchase charges the
 *   card and accepts the offer while provisioning nothing. The customer-safe
 *   `MarketplaceService` shape this route's GET normally returns doesn't
 *   carry enough to show that *before* checkout, so the GET route was
 *   extended (same Git #3819 commit) to also return `serviceClass`,
 *   `fulfillmentTypeKey`, `fulfillmentKnown` (computed against the real,
 *   live `fulfillment_types` table — never guessed) and `internalCostCents`
 *   — staff-only fields, safe on this staff-scoped route. This module reads
 *   `fulfillmentKnown` to warn plainly before the operator spends the MSP's
 *   card, and reads the checkout response's own `fulfillmentStatus` (also
 *   newly returned, not just logged) to report what genuinely happened
 *   afterward.
 * - **#3405 (free path ignores `services.allow_free_checkout`) is also still
 *   open** but has no live-affected row today (every real $0 item already
 *   has the flag `true`) — noted in this module's own info panel, not built
 *   around with a warning banner that would be inert for every real item.
 * - The design's card-on-file toggle is a review-only affordance for
 *   simulating a declined/no-card checkout; it has nothing to simulate in
 *   the real app; this module does not reproduce it. The real "no card on
 *   file" / "card declined" outcomes below are the route's own genuine 400 /
 *   402 responses, surfaced honestly when they happen — not a fake switch.
 * - Per the design README's own "Screen mount" note ("In the rebuild, both
 *   props disappear: the real app renders one page header from the route,
 *   and real data decides whether a list is empty"), this module — like
 *   every other rebuilt module in this console — takes no `embedded` /
 *   `forceEmpty` props. The shell's own `ScreenSlot` already renders the
 *   page header, and there is no case where this screen's real catalog data
 *   is empty (38 live public catalog rows).
 *
 * No fixture module, no fabricated row — every read either resolves to a
 * real server response or surfaces as a failed/loading state the module
 * renders honestly.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

// ── Wire types ────────────────────────────────────────────────────────────────

/** The customer-safe shape (`portal-marketplace.ts`'s toMarketplaceService)
 * plus the staff-only classification fields this route's GET adds. */
export interface MarketplaceCatalogItem {
  id: number;
  slug: string | null;
  name: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  serviceType: string | null;
  /** Customer-facing price in cents. null when priced on consultation. */
  priceCents: number | null;
  /** true when priceCents is a per-user/month figure (e.g. monitoring tiers). */
  perSeat: boolean;
  billingType: "one_time" | "recurring_monthly";
  deliverables: string[];
  badge: string | null;
  highlighted: boolean;
  /** Real `services.service_class` — a plain text column, no DB CHECK constraint. */
  serviceClass: string;
  fulfillmentTypeKey: string | null;
  /** True only when fulfillmentTypeKey matches a real, active fulfillment_types row. */
  fulfillmentKnown: boolean;
  /** The platform's own recorded cost for this item, if any (null falls back to 70% of retail server-side). */
  internalCostCents: number | null;
}

export interface CatalogResponse {
  services: MarketplaceCatalogItem[];
}

export type FulfillmentStatus = "emitted" | "duplicate" | "unknown_type" | "not_applicable";

export interface FreeActivatedResult {
  outcome: "free_activated";
  offerId: number | null;
  message: string;
  fulfillmentStatus: FulfillmentStatus;
}

export interface PaymentProcessedResult {
  outcome: "payment_processed";
  offerId: number | null;
  message: string;
  subscriptionId: string | null;
  paymentIntentId: string | null;
  /** Present on the real success path; absent only on the rare "charge succeeded, offer row failed to record" reconciliation branch. */
  wholesaleCostCents?: number;
  retailPriceCents?: number;
  fulfillmentStatus?: FulfillmentStatus;
}

export type CheckoutResult = FreeActivatedResult | PaymentProcessedResult;

/** A failed checkout reports the real HTTP status and the route's own
 * `{ error }` message text, so the UI shows the exact wire response — the
 * three real 422 gates, the 400/402/503 billing failures, or a bare 500 —
 * rather than a generic failure. */
export class MarketplacePurchaseApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function requestJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithAuth(url, init);
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error.length > 0) message = body.error;
    } catch { /* body wasn't JSON — keep the generic message */ }
    throw new MarketplacePurchaseApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ── GET catalog ──────────────────────────────────────────────────────────────

export function useMarketplaceCatalog(customerId: number): UseQueryResult<CatalogResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "marketplace", "catalog", customerId],
    queryFn: () =>
      requestJson<CatalogResponse>(fetchWithAuth, `/api/msp/customers/${customerId}/marketplace/catalog`),
    enabled: !isLoading && !!accessToken && Number.isFinite(customerId),
    staleTime: 30_000,
  });
}

// ── POST checkout ────────────────────────────────────────────────────────────

export function useMarketplaceCheckout(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: number) =>
      requestJson<CheckoutResult>(fetchWithAuth, `/api/msp/customers/${customerId}/marketplace/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId }),
      }),
    onSuccess: () => {
      // The directory's per-customer counts (seats, open signals) don't move
      // from a purchase, but a subscription-class buy does change this
      // customer's real billing state elsewhere in the console — invalidate
      // the one query this module itself reads from so a re-open shows the
      // catalog fresh rather than a stale 30s cache.
      void queryClient.invalidateQueries({ queryKey: ["msp", "marketplace", "catalog", customerId] });
    },
  });
}
