/**
 * React Query hook for the customer-facing Ownership / RACI read surface
 * (#3040, Feature #1491).
 *
 * Wired to the real, live endpoint documented in
 * `docs/ownership-raci-contract-pack.md` §1a:
 *   GET /api/portal/ownership
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page itself
 * renders honestly. Writing to this module (assign/reorder/accept/decline/
 * delegate/add-row, contract pack §1b) is sibling issue #3041's scope, not
 * wired here.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { ApiErrorBody, WireOwnershipPayload } from "@/lib/ownership-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      const err = body?.error;
      if (typeof err === "string") message = err;
      else if (err?.message) message = err.message;
      code = body?.code;
    } catch {
      // non-JSON error body — keep the generic message
    }
    // `requireTierFeature` (portal-tier-features.ts) answers 402 with
    // code: "TIER_UPGRADE_REQUIRED" when this customer's plan doesn't bundle
    // Ownership/RACI — a distinct, honest state from a failed read, not a
    // generic error (contract pack §1a's requireTierFeature gate).
    const httpErr = new Error(message) as Error & { status?: number; code?: string };
    httpErr.status = res.status;
    httpErr.code = code;
    throw httpErr;
  }
  return (await res.json()) as T;
}

export function useOwnership() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "ownership"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/ownership", undefined, { silent: true });
      return parseJsonOrThrow<WireOwnershipPayload>(res);
    },
  });
}
