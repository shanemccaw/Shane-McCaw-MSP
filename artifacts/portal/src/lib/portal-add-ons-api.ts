/**
 * portal-add-ons-api.ts — React Query hooks for the real, live add-on
 * purchase endpoints (Git #4462, Feature #1486):
 *
 *   GET  /api/portal/add-ons
 *   POST /api/portal/add-ons/checkout-session
 *   POST /api/portal/add-ons/checkout-confirmed
 *
 * served by `artifacts/api-server/src/routes/portal-add-ons.ts`. No fixture
 * module — offers, price and entitlement all come from the real `services`
 * catalogue and `tenant_add_on_entitlements` rows.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";

export interface WireAddOnOffer {
  readonly serviceId: number;
  readonly slug: string | null;
  readonly name: string;
  readonly priceCents: number;
  readonly billingType: string;
  readonly bracketLabel: string | null;
  readonly seatMin: number | null;
  readonly seatMax: number | null;
}

export type AddOnEntitlementSource = "tier" | "purchase" | null;

export interface WireAddOnEntry {
  readonly featureKey: string;
  readonly entitled: boolean;
  readonly source: AddOnEntitlementSource;
  readonly offers: readonly WireAddOnOffer[];
}

export interface WireAddOnsResponse {
  readonly currentTier: string | null;
  readonly includesAllAddOns: boolean;
  readonly addOns: readonly WireAddOnEntry[];
}

export interface CheckoutSessionResult {
  readonly url: string;
  readonly stripeSessionId: string;
  readonly amountCents: number;
  readonly featureKey: string;
}

export interface CheckoutConfirmedResult {
  readonly ok: true;
  readonly featureKey: string;
  readonly reason: "provisioned" | "reactivated" | "already_active";
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let body: unknown;
    try {
      body = await res.clone().json();
      const parsedBody = body as { error?: string };
      if (parsedBody?.error) message = parsedBody.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return (await res.json()) as T;
}

const ADD_ONS_KEY = ["portal", "add-ons"] as const;

/** What the caller's tenant already holds, and the real, priced offers for everything sellable. */
export function useAddOnOffers(enabled = true) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ADD_ONS_KEY,
    queryFn: async (): Promise<WireAddOnsResponse> => {
      const res = await fetchWithAuth("/api/portal/add-ons", undefined, { silent: true });
      return parseJsonOrThrow<WireAddOnsResponse>(res);
    },
    enabled,
  });
}

/** Starts a real Stripe Checkout Session for one add-on service row. */
export function useStartAddOnCheckout() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (input: { serviceSlug: string; returnPath: string }): Promise<CheckoutSessionResult> => {
      const res = await fetchWithAuth("/api/portal/add-ons/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<CheckoutSessionResult>(res);
    },
  });
}

/** Server-verifies a returned Stripe Checkout Session and provisions the entitlement it paid for. */
export function useConfirmAddOnCheckout() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stripeSessionId: string): Promise<CheckoutConfirmedResult> => {
      const res = await fetchWithAuth("/api/portal/add-ons/checkout-confirmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripeSessionId }),
      });
      return parseJsonOrThrow<CheckoutConfirmedResult>(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADD_ONS_KEY });
    },
  });
}
