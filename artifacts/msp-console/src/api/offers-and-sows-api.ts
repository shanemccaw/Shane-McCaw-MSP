/**
 * React Query hooks for the MSP Console's per-tenant "Offers & SOWs" module
 * (Git #4014, Feature #2568), README screen 66
 * (`Design/MSP_Console/design_handoff_msp_console/SOWs.dc.html`), wired
 * against the contract pack at
 * `docs/msp-console/offers-and-sow-acceptance-msp-console-contract-pack.md`.
 *
 * Distinct from `sales-api.ts` (Git #2643, the MSP-wide Sales module at
 * `/ops/sales`): this file adds the customer-scoped reads/writes that
 * `/ops/sales` never needed — the whole-book-for-one-customer SOW list, the
 * authenticated sign route, and the clickwrap GET/POST pair — while reusing
 * `sales-api.ts`'s wire types and its already-correct offer-accept /
 * charge / expire / open-document mutations rather than duplicating them.
 *
 *   artifacts/api-server/src/routes/msp-sales-offers.ts
 *     GET  /api/msp/:mspId/sales-offers?customerId=&state=   (customerId filter, new use here)
 *   artifacts/api-server/src/routes/msp-sow.ts
 *     GET  /api/msp/sows?customerId=&status=                 (the whole-book list, new use here)
 *     POST /api/msp/sows                                      (standalone SOW creation, no offerId — Git #4024)
 *     POST /api/msp/sows/:sowId/sign                          (authenticated sign, not wired anywhere until now)
 *     GET  /api/msp/customers/:customerId/clickwrap
 *     POST /api/msp/customers/:customerId/clickwrap
 *
 * Real, load-bearing asymmetries the module surfaces rather than hides
 * (contract pack §6a, §1.6, §1.10):
 *   - The clickwrap POST route performs no ownership check at all — filed
 *     upstream as #2725 (bug + security). This module still calls it (it is
 *     the only real write path), labels the action plainly, and keeps it
 *     behind an explicit confirmation-shaped button rather than silently
 *     working around a server-side gap it cannot fix from here.
 *   - Signing in an authenticated session (this module's only path — there is
 *     no public-share-link flow inside the console) starts a 72-hour MSP
 *     approval workflow before any charge fires; it never auto-charges the
 *     way the customer's own public-link signature does.
 *   - The clickwrap GET/POST pair is keyed to the *calling* login
 *     (`req.user.id`), not to a specific customer-side login chosen from this
 *     screen — an MSP operator's own acceptance check here reflects the
 *     operator's own login, not any one customer contact's.
 *
 * No fixture module, no fabricated row — every read either resolves to a
 * real server response or surfaces as a failed/loading/empty state the
 * module renders honestly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { MspSow, MspSowStatus, SalesOffer, SalesOfferState } from "./sales-api";

interface ApiErrorBody {
  error?: string;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (typeof body?.error === "string" && body.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ── Query keys ────────────────────────────────────────────────────────────────

const customerOffersKey = (mspId: number, customerId: number) => ["msp", "sales-offers", mspId, "customer", customerId] as const;
const sowsForCustomerKey = (mspId: number, customerId: number, status: string) =>
  ["msp", "sows", "customer", mspId, customerId, status] as const;
const sowDetailKey = (sowId: string) => ["msp", "sows", "detail", sowId] as const;
const clickwrapKey = (customerId: number) => ["msp", "clickwrap", customerId] as const;

// ── Offers, scoped to one customer ───────────────────────────────────────────

export function useCustomerOffers(mspId: number | null, customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: customerOffersKey(mspId ?? 0, customerId),
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "200", customerId: String(customerId) });
      const res = await fetchWithAuth(`/api/msp/${mspId}/sales-offers?${qs.toString()}`);
      return parseJsonOrThrow<{ offers: SalesOffer[]; limit: number; offset: number }>(res);
    },
    enabled: mspId != null,
  });
}

/** The one real accept path (see sales-api.ts's own header for the full state-
 * machine rationale) — reimplemented here only to invalidate this module's
 * own customer-scoped offers + SOWs query keys instead of sales-api.ts's
 * MSP-wide ones. */
export function useAcceptOfferForCustomer(mspId: number | null, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (offerId: number) => {
      const res = await fetchWithAuth(`/api/msp/offers/${offerId}/accept`, { method: "POST" });
      return parseJsonOrThrow<import("./sales-api").AcceptOfferResult>(res);
    },
    onSuccess: () => {
      if (mspId == null) return;
      void queryClient.invalidateQueries({ queryKey: customerOffersKey(mspId, customerId) });
      void queryClient.invalidateQueries({ queryKey: ["msp", "sows", "customer", mspId, customerId] });
    },
  });
}

// ── SOWs, scoped to one customer ─────────────────────────────────────────────

export function useSowsForCustomer(mspId: number | null, customerId: number, status: MspSowStatus | "all" = "all") {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: sowsForCustomerKey(mspId ?? 0, customerId, status),
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "100", customerId: String(customerId) });
      if (status !== "all") qs.set("status", status);
      const res = await fetchWithAuth(`/api/msp/sows?${qs.toString()}`);
      return parseJsonOrThrow<{ items: import("./sales-api").MspSowSummary[]; total: number }>(res);
    },
    enabled: mspId != null,
  });
}

/** Standalone SOW creation — no offerId, "used for manual project SOWs" per
 * the route's own comment (Git #4024). Writes straight into `draft`, with no
 * document-generation step in this call; the operator opens/sends it after. */
export function useCreateStandaloneSow(mspId: number | null, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; description?: string; amountCents: number }) => {
      if (mspId == null) throw new Error("No MSP context available.");
      const res = await fetchWithAuth(`/api/msp/sows`, {
        method: "POST",
        body: JSON.stringify({
          mspId,
          customerId,
          title: input.title,
          description: input.description || undefined,
          amountCents: input.amountCents,
        }),
      });
      return parseJsonOrThrow<MspSow>(res);
    },
    onSuccess: () => {
      if (mspId != null) void queryClient.invalidateQueries({ queryKey: ["msp", "sows", "customer", mspId, customerId] });
    },
  });
}

export function useSowDetail(sowId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: sowDetailKey(sowId ?? ""),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}`);
      return parseJsonOrThrow<MspSow>(res);
    },
    enabled: sowId != null,
  });
}

function invalidateSow(queryClient: ReturnType<typeof useQueryClient>, mspId: number | null, customerId: number, sowId: string) {
  void queryClient.invalidateQueries({ queryKey: sowDetailKey(sowId) });
  if (mspId != null) void queryClient.invalidateQueries({ queryKey: ["msp", "sows", "customer", mspId, customerId] });
}

/** Authenticated-session sign (README's "Sign it in an authenticated
 * session" panel) — the operator or the one assigned customer login can call
 * this; there is no public-share-link flow reachable from the console. */
export function useSignSow(mspId: number | null, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sowId: string; signerName: string; signatureData: string }) => {
      const res = await fetchWithAuth(`/api/msp/sows/${input.sowId}/sign`, {
        method: "POST",
        body: JSON.stringify({ signerName: input.signerName, signatureData: input.signatureData }),
      });
      return parseJsonOrThrow<{ ok: boolean; status: string; message: string }>(res);
    },
    onSuccess: (_data, vars) => invalidateSow(queryClient, mspId, customerId, vars.sowId),
  });
}

export function useTriggerSowCharge(mspId: number | null, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sowId: string) => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}/charge`, { method: "POST" });
      return parseJsonOrThrow<{ success: boolean; status: string; stripePaymentIntentId?: string; error?: string }>(res);
    },
    onSuccess: (_data, sowId) => invalidateSow(queryClient, mspId, customerId, sowId),
  });
}

export function useExpireSow(mspId: number | null, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sowId: string) => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}/expire`, { method: "POST" });
      return parseJsonOrThrow<{ ok: boolean }>(res);
    },
    onSuccess: (_data, sowId) => invalidateSow(queryClient, mspId, customerId, sowId),
  });
}

/** Opens the real generated SOW document (GET .../document, auth-gated — so a
 * plain <a href> can't carry the bearer token) in a new tab. */
export function useOpenSowDocument() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (sowId: string) => {
      const res = await fetchWithAuth(`/api/msp/sows/${sowId}/document`);
      if (!res.ok) {
        let message = `Failed to load document (${res.status})`;
        try {
          const body = (await res.clone().json()) as ApiErrorBody;
          if (typeof body?.error === "string" && body.error) message = body.error;
        } catch { /* non-JSON error body */ }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
}

// ── Customer agreement clickwrap ─────────────────────────────────────────────

export interface ClickwrapStatus {
  required: boolean;
  accepted: boolean;
  acceptedAt?: string | null;
  agreementText?: string;
}

export function useClickwrapStatus(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: clickwrapKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/clickwrap`);
      return parseJsonOrThrow<ClickwrapStatus>(res);
    },
  });
}

export function useRecordClickwrap(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/clickwrap`, { method: "POST" });
      return parseJsonOrThrow<{ ok: boolean; message: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: clickwrapKey(customerId) }),
  });
}

export type { MspSow, MspSowStatus, SalesOffer, SalesOfferState };
