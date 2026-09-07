/**
 * React Query hooks for the customer-facing Risk Register (#2993, #3058).
 *
 * Wired to the real, live endpoints documented in
 * `docs/risk-register-contract-pack.md`:
 *   GET  /api/portal/risk-register
 *   GET  /api/portal/policy-decisions
 *   POST /api/portal/risk-register/:rbdId/accept
 *   GET  /api/portal/risk-register/rbd/:rbdId/versions
 *   GET  /api/portal/risk-register/rbd/:rbdId/versions/:versionUid/document (#3058)
 *   POST /api/portal/risk-register/rbd/:rbdId/versions/:versionUid/sign (#3058)
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page itself
 * renders honestly (contract pack §8, the honest-empty contract).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  AcceptRiskRequest,
  AcceptRiskResponse,
  ApiErrorBody,
  SignRbdDocumentRequest,
  SignRbdDocumentResponse,
  WirePolicyDecision,
  WireRbdDocument,
  WireRbdVersionSummary,
  WireRisk,
} from "@/lib/risk-register-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    try {
      err.body = await res.clone().json();
    } catch {
      // no JSON body to attach
    }
    throw err;
  }
  return (await res.json()) as T;
}

export function useRiskRegister() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "risk-register"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/risk-register", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ risks: WireRisk[] }>(res);
      return data.risks;
    },
  });
}

export function usePolicyDecisionsFromRiskRegister() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "policy-decisions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/policy-decisions", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ decisions: WirePolicyDecision[] }>(res);
      return data.decisions;
    },
  });
}

export function useRbdVersions(rbdId: string, enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "risk-register", "rbd-versions", rbdId],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/portal/risk-register/rbd/${encodeURIComponent(rbdId)}/versions`,
        undefined,
        { silent: true },
      );
      const data = await parseJsonOrThrow<{ rbdId: string; versions: WireRbdVersionSummary[] }>(res);
      return data.versions;
    },
    enabled,
  });
}

/**
 * The already-rendered document for one version (§1.5, #3058). Never renders
 * on demand — a 404 here means the MSP genuinely hasn't prepared it yet, so
 * that case resolves to `null` rather than throwing, letting the panel render
 * the contract pack's own honest-empty copy instead of an error state.
 */
export function useRbdDocument(rbdId: string, versionUid: string | null, enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "risk-register", "rbd-document", rbdId, versionUid],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/portal/risk-register/rbd/${encodeURIComponent(rbdId)}/versions/${encodeURIComponent(versionUid as string)}/document`,
        undefined,
        { silent: true },
      );
      if (res.status === 404) return null;
      const data = await parseJsonOrThrow<{ document: WireRbdDocument }>(res);
      return data.document;
    },
    enabled: enabled && versionUid !== null,
  });
}

export function useSignRbdDocument() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rbdId,
      versionUid,
      body,
    }: {
      rbdId: string;
      versionUid: string;
      body: SignRbdDocumentRequest;
    }) => {
      const res = await fetchWithAuth(
        `/api/portal/risk-register/rbd/${encodeURIComponent(rbdId)}/versions/${encodeURIComponent(versionUid)}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return parseJsonOrThrow<SignRbdDocumentResponse>(res);
    },
    onSettled: (_data, _err, variables) => {
      // Same reasoning as useAcceptRisk's onSettled — a 409 (superseded,
      // already signed elsewhere) means our local view was stale, so refetch
      // the version list rather than optimistically patch it.
      void queryClient.invalidateQueries({
        queryKey: ["portal", "risk-register", "rbd-versions", variables.rbdId],
      });
    },
  });
}

export function useAcceptRisk() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rbdId, body }: { rbdId: string; body: AcceptRiskRequest }) => {
      const res = await fetchWithAuth(`/api/portal/risk-register/${encodeURIComponent(rbdId)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<AcceptRiskResponse>(res);
    },
    onSettled: () => {
      // Whatever happened — signed, already-accepted-by-another-tab, authority
      // changed underneath us — the register is the source of truth. Refetch
      // rather than optimistically patch, since a 409/403 means our local view
      // of isAccepted/authority was stale.
      void queryClient.invalidateQueries({ queryKey: ["portal", "risk-register"] });
    },
  });
}
