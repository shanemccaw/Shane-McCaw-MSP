/**
 * billingLive.ts — the Billing page's real data (Git #1237).
 *
 *   GET  /api/portal/invoices
 *   POST /api/portal/billing/customer-portal
 *
 * served by `artifacts/api-server/src/routes/portal-billing.ts`, scoped to the
 * calling customer's own account.
 *
 * ── Why only Receipts + "Manage payment in Stripe" ───────────────────────────
 * portal-billing.ts's endpoint set is real and rich, but most of this page's
 * surface can't honestly be pointed at it yet:
 *
 *  - The Monitoring-plan tier cards and their prices are still blocked on the
 *    #1128 Premier discrepancy (1980 vs 2350) — the catalog's real Foundation/
 *    Growth/Premier rows (services.slug `monitoring-{tier}-{size}`) carry NO
 *    flat price at all (price/price_cents both null; they're seat-metered via
 *    typeAttributes), so there is no live number to resolve it with, let alone
 *    wire the cards to. They stay on billingData.ts's fixture, unchanged.
 *  - The interval/tier-switch/add-on toggles are the design's own interactive
 *    hypothetical-repricing calculator (see portal-v2-billing.tsx's header
 *    comment) — "what would this cost if I picked X", not "what does this
 *    tenant pay today". There is also, today, no client_services row anywhere
 *    in recurring_monthly billing for any tenant to compute a real one from.
 *    Reusing GET /portal/billing/subscriptions here would either sit empty or
 *    require inventing a monitoring/retainer/add-on categorisation the schema
 *    doesn't carry — left alone rather than fabricated.
 *
 * Receipts and the Stripe billing-portal link are different: `invoicesTable`
 * is the platform's one real billing-history ledger (real rows exist for real
 * tenants today), and the customer-portal endpoint is a real, already-built
 * Stripe action. Both are wired here; everything else keeps its fixture.
 *
 * The wire shape + normalisation live in `billingWire.ts` — pure functions, no
 * React, so they're unit-tested directly. This file is only the fetching.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { toBillingReceipts, type BillingReceiptRow, type WireInvoice } from "./billingWire";

const INVOICES_URL = "/api/portal/invoices";
const CUSTOMER_PORTAL_URL = "/api/portal/billing/customer-portal";

/** Which of the two sources the Receipts section is currently rendering. */
export type BillingDataState = "loading" | "live" | "fixture";

export interface BillingLiveState {
  /** Real invoice rows, newest first. Empty until a live read resolves with
   *  at least one row — the page falls back to BILL_RECEIPTS otherwise. */
  readonly receipts: readonly BillingReceiptRow[];
  readonly dataState: BillingDataState;
  readonly loading: boolean;
  readonly error: string | null;
  /**
   * Opens the tenant's real Stripe billing-portal session in a new tab.
   * Resolves to null on success, or the reason it failed (e.g. no active
   * Stripe subscription to resolve a customer from) so the page can say so
   * instead of a dead click.
   */
  readonly openStripePortal: () => Promise<string | null>;
  readonly openingPortal: boolean;
  /**
   * Downloads a live receipt's real PDF (GET /api/portal/invoices/:id/download)
   * as a browser file-save rather than a plain link — the route is
   * Bearer-token gated, so a bare `<a href>` would 401. Resolves to null on
   * success, or the reason it failed.
   */
  readonly downloadReceipt: (invoiceId: number) => Promise<string | null>;
}

/**
 * The Billing page's real invoice history, falling back to the design's
 * BILL_RECEIPTS fixture for a customer with no invoices yet or a failed read.
 */
export function useBillingLive(): BillingLiveState {
  const { fetchWithAuth } = useAuth();
  const [rows, setRows] = useState<readonly BillingReceiptRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(INVOICES_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`invoices ${res.status}`);
        const body = (await res.json()) as readonly WireInvoice[];
        if (cancelled) return;
        setRows(toBillingReceipts(body));
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const openStripePortal = useCallback(async (): Promise<string | null> => {
    setOpeningPortal(true);
    try {
      const res = await fetchWithAuth(
        CUSTOMER_PORTAL_URL,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        { silent: true },
      );
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) return body?.error ?? `Could not open the Stripe billing portal (${res.status})`;
      window.open(body.url, "_blank", "noopener,noreferrer");
      return null;
    } catch (err: unknown) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      setOpeningPortal(false);
    }
  }, [fetchWithAuth]);

  const downloadReceipt = useCallback(
    async (invoiceId: number): Promise<string | null> => {
      try {
        const res = await fetchWithAuth(`${INVOICES_URL}/${invoiceId}/download`, undefined, { silent: true });
        if (!res.ok) return `Could not download the receipt (${res.status})`;
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `invoice-${invoiceId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    [fetchWithAuth],
  );

  return useMemo<BillingLiveState>(() => {
    const dataState: BillingDataState = rows && rows.length > 0 ? "live" : loading ? "loading" : "fixture";
    return { receipts: rows ?? [], dataState, loading, error, openStripePortal, openingPortal, downloadReceipt };
  }, [rows, loading, error, openStripePortal, openingPortal, downloadReceipt]);
}
