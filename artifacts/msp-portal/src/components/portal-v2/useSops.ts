/**
 * useSops.ts — the one data seam for `/portal-v2/sops` and its three sub-views.
 *
 * Wraps the two customer-scoped endpoints added alongside this file:
 *
 *   GET /api/portal/sops       — the library, its filter vocabulary, the stats
 *   GET /api/portal/sop-runs   — the live execution queue and the audit history
 *
 * plus the hold-window summary the banner needs, which is NOT a third SOP
 * endpoint: it is `GET /api/portal/runbooks`, the real hold source Active
 * Runbooks already owns. The fixture this replaces said in as many words that a
 * later pass should point the banner there rather than keeping a second copy of
 * the counts; this is that pass, so the banner and Active Runbooks can no longer
 * disagree about how many windows are open.
 *
 * ── Three requests, one loading state ──────────────────────────────────────
 * The page draws one screen, so it gets one `loaded` and one `error` rather than
 * three that can tear. The library and the runs are fetched together because the
 * sub-views share a header (the stat cards and the filter bar are above the
 * view switch), so arriving at `/portal-v2/sops/queue` still needs the library
 * for the counts. The hold summary is allowed to fail on its own: a missing
 * banner is a far better failure than an error state over a working library, so
 * its rejection resolves to null and the banner simply does not render.
 *
 * ── fetchWithAuth in a ref ─────────────────────────────────────────────────
 * BUILD_PLAN §5.4: it is rebuilt on every 13-minute silent token refresh, so
 * holding it in a dependency array tears down the polling loop mid-flight. Every
 * existing polling hook in this codebase holds it in a ref; this one does too.
 *
 * ── Why it polls at all ────────────────────────────────────────────────────
 * The execution queue is the only live thing on this page — a run advances a
 * step server-side and the row's percentage moves. The library changes on the
 * MSP's publishing cadence, which is days. One interval covers both because the
 * queue is the shorter of the two and re-reading the library alongside it is a
 * few rows; splitting them into two cadences would double the request count to
 * save almost nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  EMPTY_SOPS_PAYLOAD,
  EMPTY_SOP_RUNS_PAYLOAD,
  type SopHoldCounts,
  type SopRunsPayload,
  type SopsPayload,
} from "./sopHubData";

const SOPS_URL = "/api/portal/sops";
const SOP_RUNS_URL = "/api/portal/sop-runs";
const RUNBOOKS_URL = "/api/portal/runbooks";

/** How often the payload is re-read. The execution queue is what makes it move. */
export const SOPS_REFETCH_MS = 60_000;

export interface SopsState {
  readonly sops: SopsPayload;
  readonly runs: SopRunsPayload;
  /** Null when the hold source could not be read — the banner then stays off. */
  readonly holds: SopHoldCounts | null;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

interface RunbooksSummaryBody {
  readonly summary?: {
    readonly running?: number;
    readonly closing?: number;
    readonly due?: number;
    readonly early?: number;
    readonly openCount?: number;
  };
}

export function useSops(): SopsState {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const [sops, setSops] = useState<SopsPayload>(EMPTY_SOPS_PAYLOAD);
  const [runs, setRuns] = useState<SopRunsPayload>(EMPTY_SOP_RUNS_PAYLOAD);
  const [holds, setHolds] = useState<SopHoldCounts | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [sopsRes, runsRes] = await Promise.all([
          fetchRef.current(SOPS_URL, {}, { silent: true }),
          fetchRef.current(SOP_RUNS_URL, {}, { silent: true }),
        ]);
        if (!active) return;

        if (!sopsRes.ok || !runsRes.ok) {
          setError("Your procedure library could not be loaded.");
          setLoaded(true);
          return;
        }

        const sopsBody = (await sopsRes.json()) as SopsPayload;
        const runsBody = (await runsRes.json()) as SopRunsPayload;
        if (!active) return;

        setSops({
          library: Array.isArray(sopsBody.library) ? sopsBody.library : [],
          meta: sopsBody.meta ?? {},
          catOptions: Array.isArray(sopsBody.catOptions) ? sopsBody.catOptions : ["All"],
          tagOptions: Array.isArray(sopsBody.tagOptions) ? sopsBody.tagOptions : ["All tags"],
          stats: sopsBody.stats ?? EMPTY_SOPS_PAYLOAD.stats,
        });
        setRuns({
          queue: Array.isArray(runsBody.queue) ? runsBody.queue : [],
          audit: Array.isArray(runsBody.audit) ? runsBody.audit : [],
        });
        setError(null);
        setLoaded(true);
      } catch {
        if (!active) return;
        setError("Your procedure library could not be loaded.");
        setLoaded(true);
      }
    };

    // Separate and deliberately failure-tolerant — see the header.
    const loadHolds = async () => {
      try {
        const res = await fetchRef.current(RUNBOOKS_URL, {}, { silent: true });
        if (!active || !res.ok) return;
        const body = (await res.json()) as RunbooksSummaryBody;
        if (!active) return;
        const s = body.summary;
        if (!s) return;
        setHolds({
          total: s.openCount ?? 0,
          due: s.due ?? 0,
          closing: s.closing ?? 0,
          early: s.early ?? 0,
        });
      } catch {
        /* No banner. See the header. */
      }
    };

    void load();
    void loadHolds();
    const id = setInterval(() => {
      void load();
      void loadHolds();
    }, SOPS_REFETCH_MS);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { sops, runs, holds, loaded, error, reload };
}
