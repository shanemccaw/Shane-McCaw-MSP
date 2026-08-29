/**
 * oversharingItemsLive.ts — the Overshared SharePoint bulk page's real data
 * (#1275, decisions signed off on #1262).
 *
 *   GET /api/portal/oversharing/items?checkKey=...&grantKind=...&q=...&cursor=...&limit=...
 *
 * served by `artifacts/api-server/src/routes/portal-oversharing-items.ts`,
 * reading the real `overshared_items` table (one row per site x grant),
 * populated on every scan by `item-detail-collector.ts` and backfilled from
 * history by the #1275 migration.
 *
 * ── Real server-side pages, not a client-side slice ─────────────────────────
 * `portal-v2-gov-oversharing-all.tsx`'s own header calls out that its rows
 * were synthesized per page rather than sliced from a held array, "stating
 * that this page is a server-side query." This hook honours that: each page
 * turn is a real fetch using the endpoint's own keyset `cursor`, not a client
 * slice of one big fetched array. `pageCursors` remembers the cursor that
 * reached each page already visited so "Prev" can go back without the
 * endpoint needing to support reverse pagination.
 *
 * Same shape as `complianceObligationsLive.ts` / `riskRegisterLive.ts`: a
 * plain fetch behind `fetchWithAuth`, no retry/scan-status coupling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const ITEMS_URL = "/api/portal/oversharing/items";

export interface OversharingWireItem {
  readonly itemId: string;
  readonly checkKey: string;
  readonly scope: string;
  readonly site: {
    readonly id: string;
    readonly name: string | null;
    readonly url: string | null;
    readonly visibility: string | null;
    readonly isPersonalSite: boolean;
  };
  readonly item: { readonly path: string | null; readonly webUrl: string | null; readonly name: string | null } | null;
  readonly grant: {
    readonly kind: string;
    readonly principal: string | null;
    readonly upn: string | null;
    readonly loginName: string | null;
    readonly roles: readonly string[];
    readonly linkScope: string | null;
    readonly inherited: boolean;
  };
  readonly severity: string | null;
  readonly sharingLevel: string | null;
  readonly remediationState: string;
  readonly collectedAt: string;
}

interface OversharingItemsResponse {
  readonly items: readonly OversharingWireItem[];
  readonly nextCursor: string | null;
  readonly total: number;
  readonly runId: string | null;
}

export interface UseOversharingItemsLiveOpts {
  readonly checkKey?: string;
  /** Restrict to these grant kinds (e.g. the "Anyone with the link" kinds). */
  readonly grantKinds?: readonly string[];
  readonly pageSize?: number;
}

export interface OversharingItemsLiveState {
  readonly rows: readonly OversharingWireItem[];
  readonly total: number;
  readonly page: number;
  readonly totalPages: number;
  readonly search: string;
  readonly setSearch: (q: string) => void;
  readonly goNext: () => void;
  readonly goPrev: () => void;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
  readonly loading: boolean;
  /** "live" once a real response has landed (even if it's genuinely empty). */
  readonly dataState: "live" | "fixture";
}

export function useOversharingItemsLive(opts: UseOversharingItemsLiveOpts = {}): OversharingItemsLiveState {
  const { checkKey = "compliance:eeeu-site-sharing", grantKinds, pageSize = 12 } = opts;
  const { fetchWithAuth } = useAuth();

  const [rows, setRows] = useState<readonly OversharingWireItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearchState] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataState, setDataState] = useState<"live" | "fixture">("fixture");
  /** pageCursors[p - 1] is the cursor that fetches page p; pageCursors[0] is always null. */
  const pageCursors = useRef<Array<string | null>>([null]);

  const grantKindParam = useMemo(() => (grantKinds && grantKinds.length > 0 ? grantKinds.join(",") : undefined), [grantKinds]);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ checkKey, limit: String(pageSize) });
        if (grantKindParam) params.set("grantKind", grantKindParam);
        if (search.trim()) params.set("q", search.trim());
        if (cursor) params.set("cursor", cursor);

        const res = await fetchWithAuth(`${ITEMS_URL}?${params.toString()}`, undefined, { silent: true });
        if (!res.ok) throw new Error(`oversharing items ${res.status}`);
        const body = (await res.json()) as OversharingItemsResponse;
        setRows(body.items ?? []);
        setTotal(body.total ?? 0);
        setNextCursor(body.nextCursor ?? null);
        setDataState("live");
      } catch {
        setRows([]);
        setTotal(0);
        setNextCursor(null);
        setDataState("fixture");
      } finally {
        setLoading(false);
      }
    },
    [checkKey, grantKindParam, pageSize, search, fetchWithAuth],
  );

  // A new query invalidates every cursor captured under the old one — reset to page 1.
  useEffect(() => {
    pageCursors.current = [null];
    setPage(1);
    void fetchPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey, grantKindParam, search]);

  const goNext = useCallback(() => {
    if (!nextCursor) return;
    const targetPage = page + 1;
    pageCursors.current[targetPage - 1] = nextCursor;
    setPage(targetPage);
    void fetchPage(nextCursor);
  }, [nextCursor, page, fetchPage]);

  const goPrev = useCallback(() => {
    if (page <= 1) return;
    const targetPage = page - 1;
    const cursor = pageCursors.current[targetPage - 1] ?? null;
    setPage(targetPage);
    void fetchPage(cursor);
  }, [page, fetchPage]);

  return useMemo(
    () => ({
      rows,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      search,
      setSearch: setSearchState,
      goNext,
      goPrev,
      hasNext: nextCursor !== null,
      hasPrev: page > 1,
      loading,
      dataState,
    }),
    [rows, total, page, pageSize, search, goNext, goPrev, nextCursor, loading, dataState],
  );
}
