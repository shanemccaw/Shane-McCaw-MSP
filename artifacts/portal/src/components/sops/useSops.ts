/**
 * useSops.ts — the one data seam for the SOPs page (#2994, carried forward
 * from #1730/#1493).
 *
 * Wraps the two real reads (`GET /api/portal/sops`, `GET /api/portal/sop-runs`
 * — api-server `routes/portal-sops.ts`) and the two real writes (`POST
 * /api/portal/sops`, `POST /api/portal/sops/:sopId/custom-steps`). Typed
 * independently from the server package rather than imported across the
 * `artifacts/*` boundary — same pattern as `shell/useSopRuns.ts` and
 * `holds/useRunbooks.ts`.
 *
 * Both GETs are fetched together because the page shows Library, Queue and
 * History as tabs of one screen, not three separate loads a user has to wait
 * through one at a time.
 *
 * `reload()` re-fetches both after a write, the same "the stored state is the
 * record, not what was clicked" rule `useRunbooks.ts` documents for its own
 * optimistic-then-reload steps.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const SOPS_URL = "/api/portal/sops";
const SOP_RUNS_URL = "/api/portal/sop-runs";

export type SopOrigin = "policy" | "lifecycle" | "remediation" | "manual";
export type SopSource = "baseline" | "ours";

export interface SopOwner {
  readonly init: string;
  readonly name: string;
  readonly tone: string;
  readonly unassigned: boolean;
}

export interface SopStep {
  readonly text: string;
  readonly isCustom: boolean;
}

export interface SopRunSummary {
  readonly when: string;
  readonly who: string;
  readonly outcome: string;
  readonly state: string;
  readonly origin: SopOrigin;
  readonly sopVersion: string;
}

export interface SopLibraryItem {
  readonly id: string;
  readonly title: string;
  readonly source: SopSource;
  readonly category: string;
  readonly purpose: string;
  readonly forWho: string;
  readonly updated: string;
  readonly author: string;
  readonly reviewCadence: string;
  readonly runnable: boolean;
  readonly finding: string | null;
  readonly steps: readonly SopStep[];
  readonly runs: readonly SopRunSummary[];
  readonly owner: SopOwner;
}

export interface SopMeta {
  readonly code: string;
  readonly level: string;
  readonly tags: readonly string[];
  readonly avg: string;
  readonly execs: number;
  readonly auto: Readonly<Record<number, string>>;
}

export interface SopStats {
  readonly totalCount: number;
  readonly baselineCount: number;
  readonly oursCount: number;
  readonly automatedCount: number;
  readonly totalExecs: number;
  readonly avgExecTime: string;
  readonly execsThisMonth: string;
}

export interface SopsPayload {
  readonly library: readonly SopLibraryItem[];
  readonly meta: Readonly<Record<string, SopMeta>>;
  readonly catOptions: readonly string[];
  readonly tagOptions: readonly string[];
  readonly stats: SopStats;
}

export interface SopQueueStep {
  readonly t: string;
  readonly s: "done" | "now" | "todo";
  readonly by: string;
}

export interface SopQueueItem {
  readonly code: string;
  readonly title: string;
  readonly mode: string;
  readonly step: string;
  readonly pct: number;
  readonly started: string;
  readonly who: string;
  readonly state: "Running" | "Queued";
  readonly owner: SopOwner;
  readonly cr: string;
  readonly svc: string;
  readonly origin: SopOrigin;
  readonly sopVersion: string;
  readonly steps: readonly SopQueueStep[];
}

export interface SopAuditItem {
  readonly when: string;
  readonly code: string;
  readonly action: string;
  readonly actor: string;
  readonly detail: string;
  readonly result: "Success" | "Partial" | "Failure";
  readonly hash: string;
}

export interface SopRunsPayload {
  readonly queue: readonly SopQueueItem[];
  readonly audit: readonly SopAuditItem[];
}

export interface NewSopInput {
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly steps: readonly { readonly title: string; readonly description?: string }[];
  readonly estimatedMinutes?: number;
}

export interface SopsState {
  readonly sops: SopsPayload | null;
  readonly runs: SopRunsPayload | null;
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: string | null;
  /** True on a 402 `TIER_UPGRADE_REQUIRED` — a plan gap, not a read failure. */
  readonly tierGated: boolean;
  readonly reload: () => void;
  readonly createSop: (input: NewSopInput) => Promise<{ id: number; sopId: string; code: string } | null>;
  readonly addCustomStep: (
    sopId: string,
    input: { title: string; description?: string },
  ) => Promise<{ position: number; title: string; basedOnVersion: string } | null>;
}

export function useSops(): SopsState {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const [sops, setSops] = useState<SopsPayload | null>(null);
  const [runs, setRuns] = useState<SopRunsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tierGated, setTierGated] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const load = async () => {
      try {
        const [sopsRes, runsRes] = await Promise.all([
          fetchRef.current(SOPS_URL, {}, { silent: true }),
          fetchRef.current(SOP_RUNS_URL, {}, { silent: true }),
        ]);
        if (!active) return;

        if (sopsRes.status === 402 || runsRes.status === 402) {
          setTierGated(true);
          setError(null);
          setLoaded(true);
          return;
        }
        if (!sopsRes.ok || !runsRes.ok) {
          setError("Your procedure library could not be loaded.");
          setLoaded(true);
          return;
        }

        const sopsBody = (await sopsRes.json()) as SopsPayload;
        const runsBody = (await runsRes.json()) as SopRunsPayload;
        if (!active) return;

        setSops(sopsBody);
        setRuns(runsBody);
        setError(null);
        setTierGated(false);
        setLoaded(true);
      } catch {
        if (!active) return;
        setError("Your procedure library could not be loaded.");
        setLoaded(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const createSop = useCallback(
    async (input: NewSopInput): Promise<{ id: number; sopId: string; code: string } | null> => {
      try {
        const res = await fetchRef.current(SOPS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { id: number; sopId: string; code: string };
        setReloadKey((k) => k + 1);
        return body;
      } catch {
        return null;
      }
    },
    [],
  );

  const addCustomStep = useCallback(
    async (
      sopId: string,
      input: { title: string; description?: string },
    ): Promise<{ position: number; title: string; basedOnVersion: string } | null> => {
      try {
        const res = await fetchRef.current(`${SOPS_URL}/${encodeURIComponent(sopId)}/custom-steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { position: number; title: string; basedOnVersion: string };
        setReloadKey((k) => k + 1);
        return body;
      } catch {
        return null;
      }
    },
    [],
  );

  return { sops, runs, loading, loaded, error, tierGated, reload, createSop, addCustomStep };
}
