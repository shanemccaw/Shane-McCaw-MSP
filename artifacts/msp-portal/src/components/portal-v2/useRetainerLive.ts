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
 * ── dataState (Git #1398) ────────────────────────────────────────────────
 * The old two-state `"live" | "fixture"` model conflated three genuinely
 * different situations under `"fixture"`: the first read still in flight, a
 * customer with an active retainer row but nothing logged yet this month, and
 * a customer who was never enrolled at all. All three rendered identically —
 * the full design fixture — which is exactly the silent fixture-fallback
 * Shane's standing rule forbids. `dataState` now names all four real cases:
 *   - "loading"      — first read in flight.
 *   - "live"          — an active retainer row AND at least one logged entry.
 *   - "empty"         — an active retainer row, genuinely zero entries this
 *                       month — real data, just nothing logged yet.
 *   - "unconfigured"  — no active retainer row. The customer was never
 *                       enrolled; there is nothing real to show.
 *   - "error"         — the read failed. Distinct from "unconfigured" so the
 *                       page never tells a customer "you're not enrolled"
 *                       when the truth is "the request failed."
 * The page renders its honest empty/unconfigured/error state for whichever
 * of these it actually is — never the design fixture — for the bucket and
 * work-log sections this hook backs.
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

/**
 * "loading" — first read in flight. "live" — configured, real entries exist.
 * "empty" — configured, genuinely zero entries this month. "unconfigured" —
 * no active retainer row. "error" — the read itself failed.
 */
export type RetainerDataState = "loading" | "live" | "empty" | "unconfigured" | "error";

export interface RetainerLiveState {
  /** True once the caller has an active retainer row — only then is data live. */
  readonly configured: boolean;
  readonly bucket: RetainerLiveBucket | null;
  readonly entries: readonly RetWorkItem[];
  /** True once a first real response (success or failure) has arrived. */
  readonly loaded: boolean;
  readonly dataState: RetainerDataState;
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

const LOADING_STATE: RetainerLiveState = {
  configured: false,
  bucket: null,
  entries: [],
  loaded: false,
  dataState: "loading",
};

export function useRetainerLive(): RetainerLiveState {
  const { fetchWithAuth } = useAuth();
  const [state, setState] = useState<RetainerLiveState>(LOADING_STATE);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/portal/retainer", {}, { silent: true });
        if (!res.ok) throw new Error(`retainer ${res.status}`);
        const data = (await res.json()) as RetainerApiResponse;
        if (cancelled) return;
        const configured = data.configured === true;
        const entries = configured ? data.entries.map(toWorkItem) : [];
        setState({
          configured,
          bucket: configured ? data.bucket : null,
          entries,
          loaded: true,
          dataState: !configured ? "unconfigured" : entries.length > 0 ? "live" : "empty",
        });
      } catch {
        if (cancelled) return;
        setState({
          configured: false,
          bucket: null,
          entries: [],
          loaded: true,
          dataState: "error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return state;
}
