/**
 * useRetainerLive.ts — the real-data seam for "My Architect" (#1285).
 *
 * Reads `GET /api/portal/retainer` (`routes/portal-retainer.ts`, Git #1293's
 * ledger) — the caller's own retainer settings + this month's hour bucket +
 * the full work-log ledger. Only the month bucket (retained/rolled/used) and
 * the work-log entries are real; the weekly report content (summary, work-log
 * line items, deliverables, asks) has no backend source yet and stays on
 * `retainerData.ts`'s fixture — same honest-fixture boundary
 * `useLivePillarHero.ts` documents for its own dashboards.
 *
 * `configured` is false whenever the customer has no active retainer row —
 * the page overlays live data only when `configured` is true, and falls back
 * to the design fixture otherwise, rather than rendering a manufactured zero
 * for a customer who was never enrolled.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import type { RetWorkItem, RetWorkState } from "./retainerData";

export interface RetainerLiveEntry {
  readonly id: number;
  readonly item: string;
  readonly hours: number;
  readonly pillar: string | null;
  readonly pillarColor: string;
  readonly finding: string | null;
  readonly outcome: string | null;
  readonly state: string;
  readonly week: string | null;
}

export interface RetainerLiveBucket {
  readonly retainedHours: number;
  readonly rolledHours: number;
  readonly usedHours: number;
}

interface RetainerApiResponse {
  configured: boolean;
  bucket: {
    retainedHours: number;
    rolledHours: number;
    usedHours: number;
  };
  entries: RetainerLiveEntry[];
}

export interface RetainerLiveState {
  /** True once the caller has an active retainer row — only then is data live. */
  readonly configured: boolean;
  readonly bucket: RetainerLiveBucket | null;
  readonly entries: readonly RetWorkItem[];
  /** True once a first real response (success or failure) has arrived. */
  readonly loaded: boolean;
  /** "live" once real, configured data is on screen; "fixture" otherwise. */
  readonly dataState: "live" | "fixture";
}

const KNOWN_STATES: readonly RetWorkState[] = ["In progress", "Closed", "In review", "Scheduled"];

function asWorkState(state: string): RetWorkState {
  return (KNOWN_STATES as readonly string[]).includes(state) ? (state as RetWorkState) : "In progress";
}

function toWorkItem(e: RetainerLiveEntry): RetWorkItem {
  return {
    item: e.item,
    hours: e.hours,
    pillar: e.pillar ?? "",
    finding: e.finding ?? "",
    color: e.pillarColor,
    outcome: e.outcome ?? "",
    state: asWorkState(e.state),
    week: e.week ?? "",
  };
}

const EMPTY_STATE: RetainerLiveState = {
  configured: false,
  bucket: null,
  entries: [],
  loaded: false,
  dataState: "fixture",
};

export function useRetainerLive(): RetainerLiveState {
  const { fetchWithAuth } = useAuth();
  const [state, setState] = useState<RetainerLiveState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/portal/retainer", {}, { silent: true });
        if (!res.ok) return; // honest fixture fallback
        const data = (await res.json()) as RetainerApiResponse;
        if (cancelled) return;
        setState({
          configured: data.configured === true,
          bucket: data.configured ? data.bucket : null,
          entries: data.configured ? data.entries.map(toWorkItem) : [],
          loaded: true,
          dataState: data.configured ? "live" : "fixture",
        });
      } catch {
        // best-effort — the page renders its honest fixture fallback
      } finally {
        if (!cancelled) setState((s) => ({ ...s, loaded: true }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return state;
}
