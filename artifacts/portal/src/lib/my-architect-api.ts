/**
 * React Query hook for the customer-facing "My Architect" (retainer) surface,
 * #1746 (Feature #1569).
 *
 * Wired to the one real, live, GET-only endpoint documented in
 * `Design/portal/design_handoff_full_site/docs/my-architect-contract-pack.md`:
 *   GET /api/portal/retainer — settings + this month's bucket + the full
 *   ledger + the caller's own sent status reports, all in one payload.
 *
 * No fixture module, no fallback data. `400` (no customer scope on this
 * session) and a thrown/`5xx` read are both real, distinct failure states the
 * page renders honestly rather than folding into one generic error.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { ApiErrorBody, WireRetainerPayload } from "@/lib/my-architect-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const QK = {
  retainer: ["portal", "retainer"] as const,
};

export function useMyArchitectRetainer() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.retainer,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/retainer", undefined, { silent: true });
      return parseJsonOrThrow<WireRetainerPayload>(res);
    },
  });
}
