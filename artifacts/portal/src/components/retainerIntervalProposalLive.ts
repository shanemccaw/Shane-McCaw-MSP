/**
 * retainerIntervalProposalLive.ts — the Billing page's real MSP-proposed
 * interval-switch state (#4112).
 *
 *   GET  /api/portal/billing/retainer-intervals
 *   POST /api/portal/billing/subscriptions/:id/approve-interval-proposal
 *   POST /api/portal/billing/subscriptions/:id/reject-interval-proposal
 *
 * all served by `artifacts/api-server/src/routes/portal-retainer-billing.ts`,
 * scoped the same way `subscriptionsLive.ts` / `billingLive.ts` are (every
 * `client_services` row the caller's `billing.view`/`billing.manage`
 * capability can see).
 *
 * No fixture fallback, same discipline as `subscriptionsLive.ts`: a tenant
 * with no pending proposal is a genuinely empty `proposals: []`, distinct
 * from a failed read (`dataState: "error"`). This surface is deliberately
 * narrow — it only ever shows a row while `hasPendingProposal` is true, never
 * a general plan/interval picker (that stays out of scope, same as this
 * page's own documented "no interval/tier-switch toggles" boundary — an
 * operator-proposed approve/reject decision is not the hypothetical
 * repricing calculator that boundary excludes).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";

const RETAINER_INTERVALS_URL = "/api/portal/billing/retainer-intervals";

export type RetainerBillingInterval = "month" | "year";

export interface RetainerIntervalProposal {
  readonly clientServiceId: number;
  readonly billingInterval: RetainerBillingInterval;
  readonly proposedBillingInterval: RetainerBillingInterval;
  readonly proposedAt: string | null;
  readonly proposedByName: string | null;
}

interface WireRetainerInterval {
  clientServiceId: number;
  billingInterval: RetainerBillingInterval;
  hasPendingProposal: boolean;
  proposedBillingInterval: RetainerBillingInterval | null;
  proposedAt: string | null;
  proposedByName: string | null;
}

export type ProposalDataState = "loading" | "live" | "error";

export interface RetainerIntervalProposalLiveState {
  readonly proposals: readonly RetainerIntervalProposal[];
  readonly dataState: ProposalDataState;
  readonly actionPending: boolean;
  readonly actionError: string | null;
  readonly approve: (clientServiceId: number) => Promise<void>;
  readonly reject: (clientServiceId: number) => Promise<void>;
}

function toProposals(rows: readonly WireRetainerInterval[]): RetainerIntervalProposal[] {
  return rows
    .filter((r) => r.hasPendingProposal && r.proposedBillingInterval != null)
    .map((r) => ({
      clientServiceId: r.clientServiceId,
      billingInterval: r.billingInterval,
      proposedBillingInterval: r.proposedBillingInterval as RetainerBillingInterval,
      proposedAt: r.proposedAt,
      proposedByName: r.proposedByName,
    }));
}

export function useRetainerIntervalProposalLive(): RetainerIntervalProposalLiveState {
  const { fetchWithAuth } = useAuth();
  const [rows, setRows] = useState<readonly WireRetainerInterval[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetchWithAuth(RETAINER_INTERVALS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`retainer-intervals ${res.status}`);
        const body = (await res.json()) as readonly WireRetainerInterval[];
        if (cancelled) return;
        setRows(body);
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
  }, [fetchWithAuth, reloadTick]);

  const runAction = useCallback(
    async (clientServiceId: number, action: "approve" | "reject") => {
      setActionError(null);
      setActionPending(true);
      try {
        const res = await fetchWithAuth(
          `/api/portal/billing/subscriptions/${clientServiceId}/${action}-interval-proposal`,
          { method: "POST" },
        );
        if (!res.ok) {
          let message = `Request failed: ${res.status}`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) message = data.error;
          } catch { /* body wasn't JSON */ }
          throw new Error(message);
        }
        setReloadTick((t) => t + 1);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionPending(false);
      }
    },
    [fetchWithAuth],
  );

  const approve = useCallback((clientServiceId: number) => runAction(clientServiceId, "approve"), [runAction]);
  const reject = useCallback((clientServiceId: number) => runAction(clientServiceId, "reject"), [runAction]);

  return useMemo<RetainerIntervalProposalLiveState>(() => {
    const dataState: ProposalDataState = loading ? "loading" : rows !== null ? "live" : "error";
    return { proposals: rows ? toProposals(rows) : [], dataState, actionPending, actionError, approve, reject };
  }, [rows, loading, actionPending, actionError, approve, reject]);
}
