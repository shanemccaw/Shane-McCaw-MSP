/**
 * receiptLive.ts — the Receipt page's real data (Git #1242).
 *
 *   GET /api/portal/billing/stripe-receipts
 *
 * served by `artifacts/api-server/src/routes/portal-billing.ts`. Same shape as
 * `complianceObligationsLive.ts`'s `useComplianceObligationsLive`: a plain
 * fetch behind `fetchWithAuth`, falling back to the design fixture
 * (`receiptModel.ts`'s `receiptView`) when the route id has no live match —
 * preserving the page's existing receiptId-from-route-with-fallback pattern.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { receiptView, type ReceiptView } from "./receiptModel";
import { receiptViewFromStripe, stripeReceiptMatches, type StripeReceiptWire } from "./receiptWire";

const STRIPE_RECEIPTS_URL = "/api/portal/billing/stripe-receipts";

export interface ReceiptLiveState {
  readonly view: ReceiptView;
  /** "live" once the route id matched a real Stripe invoice; "fixture" otherwise. */
  readonly dataState: "live" | "fixture";
  readonly loading: boolean;
  /** The real Stripe-hosted PDF for a live match, if Stripe has one on file. */
  readonly livePdfUrl: string | null;
}

export function useReceiptLive(routeId: string | undefined): ReceiptLiveState {
  const { fetchWithAuth } = useAuth();
  const [receipts, setReceipts] = useState<readonly StripeReceiptWire[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(STRIPE_RECEIPTS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`stripe receipts ${res.status}`);
        const body = (await res.json()) as readonly StripeReceiptWire[];
        if (cancelled) return;
        setReceipts(body ?? []);
      } catch {
        if (!cancelled) setReceipts(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return useMemo(() => {
    const match = routeId ? receipts?.find((r) => stripeReceiptMatches(r, routeId)) : undefined;
    if (match) {
      return { view: receiptViewFromStripe(match), dataState: "live" as const, loading, livePdfUrl: match.invoicePdf };
    }
    return { view: receiptView(routeId), dataState: "fixture" as const, loading, livePdfUrl: null };
  }, [receipts, routeId, loading]);
}
