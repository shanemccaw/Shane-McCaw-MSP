/**
 * Cross-tenant Activity Timeline (#4011, Feature #3750).
 *
 * Wraps `GET /api/msp/timeline` (artifacts/api-server/src/routes/msp-customer-timeline.ts).
 * Staff scoping (`resolveStaffScopedCustomerIds`) is applied server-side —
 * the response already reflects only what the caller's session can see, so
 * nothing here re-derives or narrows scope client-side.
 */
import { useInfiniteQuery, type UseInfiniteQueryResult, type InfiniteData } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type TimelineEventType = "scan_completed" | "scan_failed" | "finding" | "score_change" | "document" | "offer";
export type TimelineStatus = "default" | "success" | "warning" | "error" | "info";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  description?: string;
  status: TimelineStatus;
  timestamp: string;
  customerId: number | null;
  customerName: string | null;
  deepLink: string | null;
}

export interface TimelinePage {
  events: TimelineEvent[];
  nextCursor: string | null;
}

async function getJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", signal });
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const PAGE_LIMIT = 30;

export function useTimeline(customerId: number | null): UseInfiniteQueryResult<InfiniteData<TimelinePage>, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: ["msp", "timeline", customerId],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_LIMIT));
      if (customerId != null) params.set("customerId", String(customerId));
      if (pageParam) params.set("before", pageParam);
      return getJson<TimelinePage>(fetchWithAuth, `/api/msp/timeline?${params.toString()}`, signal);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}
