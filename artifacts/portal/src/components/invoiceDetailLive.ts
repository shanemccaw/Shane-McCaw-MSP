/**
 * invoiceDetailLive.ts — the invoice detail page's real data (#4116).
 *
 *   GET /api/portal/invoices/:id
 *   GET /api/portal/invoices/:id/versions
 *
 * served by `artifacts/api-server/src/routes/portal-billing.ts`, scoped by
 * `billingScopeUserIds()` the same way the Billing page's own list is.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { toInvoiceDetail, toInvoiceVersions, type InvoiceDetail, type InvoiceVersion, type WireInvoiceDetail } from "./invoiceDetailWire";

export type InvoiceDetailDataState = "loading" | "live" | "not-found" | "error";

export interface InvoiceDetailLiveState {
  readonly detail: InvoiceDetail | null;
  readonly versions: readonly InvoiceVersion[];
  readonly dataState: InvoiceDetailDataState;
  readonly error: string | null;
  readonly refetch: () => void;
}

export function useInvoiceDetailLive(invoiceId: number | null): InvoiceDetailLiveState {
  const { fetchWithAuth } = useAuth();
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [versions, setVersions] = useState<readonly InvoiceVersion[]>([]);
  const [dataState, setDataState] = useState<InvoiceDetailDataState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (invoiceId == null || !Number.isFinite(invoiceId)) {
      setDataState("not-found");
      return;
    }
    let cancelled = false;
    setDataState("loading");
    void (async () => {
      try {
        const [detailRes, versionsRes] = await Promise.all([
          fetchWithAuth(`/api/portal/invoices/${invoiceId}`, undefined, { silent: true }),
          fetchWithAuth(`/api/portal/invoices/${invoiceId}/versions`, undefined, { silent: true }),
        ]);
        if (cancelled) return;

        if (detailRes.status === 404) {
          setDataState("not-found");
          return;
        }
        if (!detailRes.ok) throw new Error(`invoice ${detailRes.status}`);
        const detailBody = (await detailRes.json()) as WireInvoiceDetail;
        const parsedDetail = toInvoiceDetail(detailBody);
        if (!parsedDetail) {
          setDataState("not-found");
          return;
        }
        setDetail(parsedDetail);

        if (versionsRes.ok) {
          const versionsBody = await versionsRes.json();
          setVersions(toInvoiceVersions(versionsBody));
        } else {
          // Version history is a "see what changed" affordance, not the core
          // read — a failed fetch here degrades to "no history shown" rather
          // than failing the whole detail page.
          setVersions([]);
        }
        setError(null);
        setDataState("live");
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setDataState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, invoiceId, attempt]);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  return useMemo(
    () => ({ detail, versions, dataState, error, refetch }),
    [detail, versions, dataState, error, refetch],
  );
}
