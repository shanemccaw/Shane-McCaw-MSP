/**
 * MSP Console — Consent and Onboarding (Git #2627, Feature #2563, under
 * #1571 EPIC: Portal Admin). Mounts at `/ops/consent` (Operations, MSP-wide —
 * README "Where they sit in the tree", screen 64:
 * `Design/MSP_Console/design_handoff_msp_console/Consent and Onboarding.dc.html`).
 * Wired against the real, live, mounted backend documented in
 * `docs/msp-console/consent-and-onboarding-msp-console-contract-pack.md`:
 *
 *   GET   /api/msp/consent
 *   GET   /api/msp/customers/:customerId/consent
 *   POST  /api/msp/customers/:customerId/consent/invite-link
 *   GET   /api/msp/customers/:customerId/write-consent/start
 *   GET   /api/msp/customers/:customerId/sharepoint-consent/start
 *   PATCH /api/msp/customers/:customerId/consent/revoke
 *   GET   /api/msp/onboarding/links
 *
 * **The contract pack (written 2026-09-04, for #2625) and the design export
 * built from it are both stale on one real point, confirmed live against
 * `msp-consent.ts` on `main` in this build**, the same kind of drift
 * `console/modules/Dlq.tsx`'s own header documents for its design: the pack's
 * Finding 2 (#2818) said there was no MSP-scoped route to start a `writeBack`
 * or `sharepoint` consent flow, and the design's own copy repeats that
 * ("No MSP-scoped route starts this flow ... Filed upstream"). Both routes
 * now exist — `GET .../write-consent/start` and `GET .../sharepoint-consent/
 * start` — and both routes' own header comments name #2818 as the issue they
 * close. This build wires all three grant types as real, working mint
 * actions rather than reproducing the design's now-incorrect disabled state.
 * Finding 1 (#2818) — `adminEmail`/`adminDisplayName` dropped from the MSP
 * wire — is also stale: `consentRow()` (`consent.ts`) now projects both, so
 * "APPROVED BY" renders the real value instead of the design's "not on this
 * wire" placeholder.
 *
 * The list route's own honest-empty contract (§1.1/§6 of the pack): a tenant
 * with no activity across all three grants is silently absent from
 * `GET /api/msp/consent`, not returned with three null grants — the detail
 * route is the only way to distinguish "not your customer" from "never
 * consented." The empty state below says exactly that, not a generic
 * "no data" message (Git #2627's own dispatch).
 *
 * The onboarding links list (`GET /api/msp/onboarding/links`) returns bare
 * `serviceId`/`createdByUserId` with no name joined on (contract pack §2) —
 * this file does not invent a join; the UI renders the raw id.
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const wrapped = new Error(message) as Error & { status?: number };
    wrapped.status = res.status;
    throw wrapped;
  }
  return (await res.json()) as T;
}

// ── Shared shapes ──────────────────────────────────────────────────────────

export type ConsentStatus = "pending" | "granted" | "declined" | "revoked";
export type ConsentKey = "graph" | "writeBack" | "sharepoint";

export interface ConsentGrant {
  consentStatus: ConsentStatus;
  consentedAt: string | null;
  revokedAt: string | null;
  adminEmail: string | null;
  adminDisplayName: string | null;
  grants: string[];
}

export interface ConsentTenantRow {
  customerId: number;
  tenantId: string;
  customerName: string;
  updatedAt: string;
  graph: ConsentGrant | null;
  writeBack: ConsentGrant | null;
  sharepoint: ConsentGrant | null;
}

export interface OnboardingLink {
  token: string;
  customerEmail: string;
  serviceId: number | null;
  note: string | null;
  redirectPortalUrl: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdByUserId: number | null;
  createdAt: string;
  status: "used" | "expired" | "pending";
}

// ── Consent grants ───────────────────────────────────────────────────────────

const consentListKey = ["msp", "consent"] as const;
const consentDetailKey = (customerId: number) => ["msp", "consent", customerId] as const;

export function useConsentList(): UseQueryResult<ConsentTenantRow[], Error> {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: consentListKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/consent");
      return parseJsonOrThrow<ConsentTenantRow[]>(res);
    },
  });
}

export function useConsentDetail(customerId: number | null): UseQueryResult<ConsentTenantRow, Error> {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: consentDetailKey(customerId ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/consent`);
      return parseJsonOrThrow<ConsentTenantRow>(res);
    },
    enabled: customerId != null,
  });
}

export interface ReadConsentInviteResult {
  consentUrl: string;
  token: string;
  expiresAt: string;
  scopes: string[];
}

/** Mints a `graph` (read) consent invite — the only grant with a caller-chosen TTL. */
export function useCreateReadConsentInvite(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ttlHours: number) => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/consent/invite-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlHours }),
      });
      return parseJsonOrThrow<ReadConsentInviteResult>(res);
    },
    onSuccess: () => {
      if (customerId == null) return;
      void queryClient.invalidateQueries({ queryKey: consentDetailKey(customerId) });
      void queryClient.invalidateQueries({ queryKey: consentListKey });
    },
  });
}

export interface WriteConsentStartResult {
  consentUrl: string;
  expiresAt: string;
}

/** Mints a `writeBack` consent invite. Fixed 72-hour TTL — the route accepts no ttlHours. */
export function useStartWriteConsent(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/write-consent/start`);
      return parseJsonOrThrow<WriteConsentStartResult>(res);
    },
    onSuccess: () => {
      if (customerId == null) return;
      void queryClient.invalidateQueries({ queryKey: consentDetailKey(customerId) });
      void queryClient.invalidateQueries({ queryKey: consentListKey });
    },
  });
}

export interface SharepointConsentStartResult {
  consentUrl: string;
  expiresAt: string;
  permissions: string[];
}

/** Mints a `sharepoint` consent invite. Fixed 72-hour TTL — the route accepts no ttlHours. */
export function useStartSharepointConsent(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/sharepoint-consent/start`);
      return parseJsonOrThrow<SharepointConsentStartResult>(res);
    },
    onSuccess: () => {
      if (customerId == null) return;
      void queryClient.invalidateQueries({ queryKey: consentDetailKey(customerId) });
      void queryClient.invalidateQueries({ queryKey: consentListKey });
    },
  });
}

export function useRevokeConsent(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: ConsentKey) => {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/consent/revoke`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      return parseJsonOrThrow<{ ok: boolean; customerId: number; key: ConsentKey }>(res);
    },
    onSuccess: () => {
      if (customerId == null) return;
      void queryClient.invalidateQueries({ queryKey: consentDetailKey(customerId) });
      void queryClient.invalidateQueries({ queryKey: consentListKey });
    },
  });
}

// ── Onboarding links ──────────────────────────────────────────────────────────

export function useOnboardingLinks(): UseQueryResult<OnboardingLink[], Error> {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "onboarding", "links"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/onboarding/links");
      return parseJsonOrThrow<OnboardingLink[]>(res);
    },
  });
}
