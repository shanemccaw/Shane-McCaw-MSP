/**
 * useRetainerLive.ts — the real-data seam for "My Architect" (#1285).
 *
 * Reads `GET /api/portal/retainer` (`routes/portal-retainer.ts`, Git #1293's
 * ledger) — the caller's own retainer settings + this month's hour bucket +
 * the full work-log ledger. Only the month bucket (retained/rolled/used) and
 * the work-log entries are real.
 *
 * ── The lower-half sections have NO backend (Git #1407) ────────────────────
 * The weekly narrative report (summary, per-line log, deliverables, the
 * question/answer asks thread), the "What the retainer has produced" outcomes
 * card, the documents rail, and the "How the retainer works" terms have NO
 * backend source anywhere in the schema — `GET /api/portal/retainer` returns
 * none of them, and no `retainer_report` / `retainer_outcome` / `retainer_doc`
 * table exists. Per the standing hard rule, this hook therefore exposes them as
 * genuinely EMPTY arrays (`weeklyReports`/`outcomes`/`documents`/`terms`),
 * NEVER the `retainerData.ts` design fixture. The page renders an honest "no
 * reports yet" state off these; the UI shape it drives is preserved so that the
 * moment a real weekly-report backend is architected and this hook parses it,
 * the section lights up with real data and nothing else has to change. Until
 * then these stay `[]` — the previous behaviour, where the whole lower half
 * rendered the fixture unconditionally next to an honest "not enrolled" banner
 * (Git #1407), is exactly the silent fixture-fallback the rule forbids.
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
import type { RetDoc, RetOutcome, RetTerm, RetWeek, RetWorkItem, RetWorkState } from "./retainerData";

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
  /** "YYYY-MM" — the real bucket period, e.g. "2026-08" (Git #1401). */
  readonly period: string;
}

/** Real retainer settings (Git #1401) — the customer's own retainer_settings row. */
export interface RetainerLiveSettings {
  readonly architectName: string | null;
  readonly hourlyRateCents: number;
}

interface RetainerApiResponse {
  configured: boolean;
  settings: {
    retainedHours: number;
    hourlyRateCents: number;
    architectName: string | null;
    active: boolean;
  } | null;
  bucket: {
    retainedHours: number;
    rolledHours: number;
    usedHours: number;
    period: string;
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
  /** Real retainer_settings row (architect, hourly rate) — null when unconfigured. */
  readonly settings: RetainerLiveSettings | null;
  /**
   * Git #1407 — the lower-half sections. There is NO backend for any of these
   * yet (see the header note), so they are ALWAYS empty here, never the design
   * fixture. The page shows an honest "no reports yet" state off them and keeps
   * the UI shape ready for a future real source.
   */
  readonly weeklyReports: readonly RetWeek[];
  readonly outcomes: readonly RetOutcome[];
  readonly documents: readonly RetDoc[];
  readonly terms: readonly RetTerm[];
}

// Git #1407: no backend exists for the weekly report / outcomes / documents /
// terms, so these are the honest empty source the page renders off — shared
// frozen references, never the retainerData.ts fixture.
const NO_WEEKLY_REPORTS: readonly RetWeek[] = [];
const NO_OUTCOMES: readonly RetOutcome[] = [];
const NO_DOCUMENTS: readonly RetDoc[] = [];
const NO_TERMS: readonly RetTerm[] = [];

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
  settings: null,
  weeklyReports: NO_WEEKLY_REPORTS,
  outcomes: NO_OUTCOMES,
  documents: NO_DOCUMENTS,
  terms: NO_TERMS,
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
          settings:
            configured && data.settings
              ? { architectName: data.settings.architectName, hourlyRateCents: data.settings.hourlyRateCents }
              : null,
          // Git #1407: no backend for these — honestly empty, never fixture.
          weeklyReports: NO_WEEKLY_REPORTS,
          outcomes: NO_OUTCOMES,
          documents: NO_DOCUMENTS,
          terms: NO_TERMS,
        });
      } catch {
        if (cancelled) return;
        setState({
          configured: false,
          bucket: null,
          entries: [],
          loaded: true,
          dataState: "error",
          settings: null,
          weeklyReports: NO_WEEKLY_REPORTS,
          outcomes: NO_OUTCOMES,
          documents: NO_DOCUMENTS,
          terms: NO_TERMS,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return state;
}
