/**
 * React Query hooks for the customer-facing Security Plan (#3027, Feature #1495).
 *
 * Wired to the real, live endpoints documented in
 * `docs/security-plan-contract-pack.md`:
 *   GET  /api/portal/security-plan                             — plan of record (last signed)
 *   GET  /api/portal/security-plan/versions                     — full seal chain
 *   GET  /api/portal/security-plan/versions/current              — current version, signed or not
 *   POST /api/portal/security-plan/versions/:versionUid/sign     — the customer signs it
 *   GET  /api/portal/security-plan/drift                         — live vs last-signed drift (#3027)
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page itself
 * renders honestly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  SignSecurityPlanVersionRequest,
  WireSecurityPlanDrift,
  WireSecurityPlanPayload,
  WireSecurityPlanVersionDetail,
  WireSecurityPlanVersionSummary,
} from "@/lib/security-plan-types";

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

const QK = {
  plan: ["portal", "security-plan"] as const,
  versions: ["portal", "security-plan", "versions"] as const,
  current: ["portal", "security-plan", "current"] as const,
  drift: ["portal", "security-plan", "drift"] as const,
};

/** The plan of record — the last SIGNED version, or `null` if nothing has ever
 * been signed. Kept separate from `useCurrentSecurityPlanVersion` because it
 * answers a different question ("what is the plan of record" vs "what is
 * there for me to review and act on right now" — contract pack §2.3). */
export function useSecurityPlanOfRecord() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.plan,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/security-plan", undefined, { silent: true });
      const data = await parseJsonOrThrow<WireSecurityPlanPayload>(res);
      return data.assembledPlan;
    },
  });
}

/** The current (unsuperseded) version — signed or not. 404 (no version ever
 * sealed) is treated as a real "never sealed" state, not an error. */
export function useCurrentSecurityPlanVersion() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.current,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/security-plan/versions/current", undefined, { silent: true });
      if (res.status === 404) return null;
      const data = await parseJsonOrThrow<{ version: WireSecurityPlanVersionDetail }>(res);
      return data.version;
    },
  });
}

/** The full seal chain, newest first. */
export function useSecurityPlanVersions(enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.versions,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/security-plan/versions", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ versions: WireSecurityPlanVersionSummary[] }>(res);
      return data.versions;
    },
    enabled,
  });
}

/** The live view's drift from the last signed version. `hasLastSignedVersion:
 * false` means nothing has ever been signed — there is no baseline yet, which
 * is distinct from "signed, and nothing has moved since." */
export function useSecurityPlanDrift(enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.drift,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/security-plan/drift", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ drift: WireSecurityPlanDrift }>(res);
      return data.drift;
    },
    enabled,
  });
}

export function useSignSecurityPlanVersion() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ versionUid, body }: { versionUid: string; body: SignSecurityPlanVersionRequest }) => {
      const res = await fetchWithAuth(`/api/portal/security-plan/versions/${encodeURIComponent(versionUid)}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ version: WireSecurityPlanVersionDetail }>(res);
    },
    onSettled: () => {
      // Whatever happened — signed, already-signed-by-another-tab, version
      // superseded underneath us — the server is the source of truth. Refetch
      // rather than optimistically patch, since a 409 means our local view of
      // "current, unsigned" was stale.
      void queryClient.invalidateQueries({ queryKey: QK.current });
      void queryClient.invalidateQueries({ queryKey: QK.versions });
      void queryClient.invalidateQueries({ queryKey: QK.plan });
      void queryClient.invalidateQueries({ queryKey: QK.drift });
    },
  });
}
