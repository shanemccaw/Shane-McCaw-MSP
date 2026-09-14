/**
 * React Query hooks for the customer-facing POA&Ms module (#4037, Feature
 * #1935 — the sibling exit to the Risk Register: "we ARE fixing this, here is
 * the plan" vs. "we accept the consequence").
 *
 * Wired to the real, live routes in `artifacts/api-server/src/routes/portal-poams.ts`
 * (`docs/portal/poams-contract-pack.md`):
 *   GET    /api/portal/poams
 *   GET    /api/portal/poams/:poamId
 *   POST   /api/portal/poams
 *   POST   /api/portal/poams/:poamId/sign
 *   DELETE /api/portal/poams/:poamId
 *   POST   /api/portal/poams/:poamId/request-acceleration
 *
 * The two READ routes are tier-gated (#3104, `requireTierFeature(poams)`) and
 * currently 402 for every real tenant — no Monitoring tier bundles the module
 * yet, a pricing decision still open on #3104. `useListPoams` surfaces that as
 * `tierGated`, same shape `useSops` already established for the same 402, so
 * this page can draw the honest "you can raise a plan anyway, you just can't
 * read it back" state the design calls for rather than a generic error.
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading/gated state the page itself
 * renders honestly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  CreatePoamRequest,
  CreatePoamResponse,
  DeletePoamRequest,
  DeletePoamResponse,
  RequestAccelerationRequest,
  RequestAccelerationResponse,
  SignPoamRequest,
  SignPoamResponse,
  WirePoam,
} from "@/lib/poams-types";

const POAMS_URL = "/api/portal/poams";
const POAMS_QUERY_KEY = ["portal", "poams"] as const;

function errorMessageFrom(body: unknown, status: number): string {
  const b = body as Partial<ApiErrorBody> & { error?: unknown };
  if (b && typeof b.error === "string") return b.error;
  if (b && b.error && typeof b.error === "object" && "message" in b.error) {
    const message = (b.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return `Request failed (${status})`;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.clone().json();
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(errorMessageFrom(body, res.status)) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return (await res.json()) as T;
}

export interface ListPoamsResult {
  readonly poams: readonly WirePoam[] | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
  /** True on a 402 `TIER_UPGRADE_REQUIRED` — a plan gap, not a read failure. */
  readonly tierGated: boolean;
  readonly refetch: () => void;
  readonly isRefetching: boolean;
}

/**
 * Every POA&M for the calling customer's own tenant. A 402 resolves to
 * `tierGated: true` with an empty result rather than an error state — the
 * READ gate is a pricing decision (#3104), not a fault.
 */
export function useListPoams(): ListPoamsResult {
  const { fetchWithAuth } = useAuth();
  const query = useQuery({
    queryKey: POAMS_QUERY_KEY,
    queryFn: async (): Promise<{ poams: readonly WirePoam[]; tierGated: false } | { poams: null; tierGated: true }> => {
      const res = await fetchWithAuth(POAMS_URL, undefined, { silent: true });
      if (res.status === 402) return { poams: null, tierGated: true };
      const data = await parseJsonOrThrow<{ poams: WirePoam[] }>(res);
      return { poams: data.poams, tierGated: false };
    },
  });

  return {
    poams: query.data?.poams ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    tierGated: query.data?.tierGated === true,
    refetch: () => void query.refetch(),
    isRefetching: query.isRefetching,
  };
}

export function useCreatePoam() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePoamRequest) => {
      const res = await fetchWithAuth(POAMS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<CreatePoamResponse>(res);
    },
    onSettled: () => {
      // A creating customer may be tier-gated on the read (402) — the create
      // still succeeds (creation is unconditional per #1168), so refetch
      // rather than optimistically patch a list this session may not be able
      // to read back at all.
      void queryClient.invalidateQueries({ queryKey: POAMS_QUERY_KEY });
    },
  });
}

export function useSignPoam() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ poamId, body }: { poamId: string; body: SignPoamRequest }) => {
      const res = await fetchWithAuth(`${POAMS_URL}/${encodeURIComponent(poamId)}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<SignPoamResponse>(res);
    },
    onSettled: () => {
      // Same reasoning as the Risk Register's accept route: a 409 (already
      // signed, no holder) means our local view was stale — refetch rather
      // than optimistically patch.
      void queryClient.invalidateQueries({ queryKey: POAMS_QUERY_KEY });
    },
  });
}

export function useDeletePoam() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ poamId, body }: { poamId: string; body: DeletePoamRequest }) => {
      const res = await fetchWithAuth(`${POAMS_URL}/${encodeURIComponent(poamId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<DeletePoamResponse>(res);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: POAMS_QUERY_KEY });
    },
  });
}

export function useRequestPoamAcceleration() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async ({ poamId, body }: { poamId: string; body: RequestAccelerationRequest }) => {
      const res = await fetchWithAuth(`${POAMS_URL}/${encodeURIComponent(poamId)}/request-acceleration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<RequestAccelerationResponse>(res);
    },
  });
}
