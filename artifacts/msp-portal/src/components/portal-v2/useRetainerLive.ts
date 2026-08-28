/**
 * useRetainerLive.ts — the real-data seam for "My Architect" (#1285).
 *
 * Reads `GET /api/portal/retainer` (`routes/portal-retainer.ts`, Git #1293's
 * ledger) — the caller's own retainer settings + this month's hour bucket +
 * the full work-log ledger, plus (Git #1410) the caller's own SENT
 * `status_reports` rows. The month bucket and the work-log entries are real
 * off `retainer_settings`/`retainer_work_log`; `weeklyReports`/`outcomes`/
 * `documents` are now also real, off `status_reports` — the old CRM Status
 * Reports table, which survived the CRM frontend's decommission and is
 * admin-authored via `admin-status-reports.ts`.
 *
 * ── weeklyReports / outcomes / documents (Git #1410) ───────────────────────
 * `status_reports` doesn't carry every field the design's fixture shape
 * assumes, so each mapping below is only as real as the column behind it —
 * see `toWeeklyReport`/`toOutcome`/`toDocument`:
 *   - `hours` (the week tab's "X h" chip and the per-log-line hours) has NO
 *     column on `status_reports` — retainer hours are tracked separately, per
 *     work-log entry, with no FK back to a report. Real absence of data, not
 *     fixture: rendered as `0` rather than invented.
 *   - `author` comes from the SAME retainer_settings.architectName this hook
 *     already reads for the header — `status_reports` has no author column of
 *     its own, and this IS who the report is from.
 *   - `deliverables` ("Produced this week") has no matching column — reports
 *     carry `completedActivities` (title+description, mapped to `log`
 *     instead) and `nextSteps` (used by admin's push-to-Kanban, not a
 *     customer-facing deliverable list) — left `[]` rather than reusing
 *     either as a mismatched stand-in.
 *   - `asks` prefers the structured `replyThread` (real sender + timestamp);
 *     falls back to the legacy single `clientQuestion`/`adminReply` pair
 *     (pre-dates threading, so genuinely has no per-message timestamp — left
 *     blank rather than invented) only when `replyThread` is empty.
 * `outcomes` — one entry per report with a non-empty `keyOutcomes`, tone
 * "blue" (no tone classification exists on the table, so none is invented).
 * `documents` — one entry per sent report (a status report IS a document).
 * The ask box / accept button / PDF-open buttons stay visual-only (#1407) —
 * this issue is the read side, not the reply-write side, which has no
 * customer-facing route yet.
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
import type { RetDoc, RetOutcome, RetTerm, RetWeek, RetWeekAsk, RetWorkItem, RetWorkState } from "./retainerData";

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

/** The wire shape of one `status_reports` row, as `portal-retainer.ts` sends it (Git #1410). */
interface StatusReportWire {
  readonly id: number;
  readonly title: string;
  readonly period: string;
  readonly executiveSummary: string | null;
  readonly completedActivities: readonly { title: string; description: string }[];
  readonly keyOutcomes: string | null;
  readonly reportDate: string | null;
  readonly sentAt: string | null;
  readonly clientStatus: string;
  readonly clientQuestion: string | null;
  readonly adminReply: string | null;
  readonly replyThread: readonly { sender: "client" | "admin"; content: string; timestamp: string }[];
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
  statusReports: StatusReportWire[];
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
   * Git #1410 — real off the caller's own SENT `status_reports` rows (see the
   * header note for what each field is and isn't backed by). Genuinely `[]`
   * for a customer with no sent reports yet — an honest empty, not a fixture
   * fallback — same as `entries` above.
   */
  readonly weeklyReports: readonly RetWeek[];
  readonly outcomes: readonly RetOutcome[];
  readonly documents: readonly RetDoc[];
  /**
   * `terms` ("How the retainer works") is static policy copy — no table backs
   * it (it isn't per-customer data), so it stays the design fixture's shape,
   * always `[]` here; the page renders the fixture directly for this section.
   */
  readonly terms: readonly RetTerm[];
}

// Git #1407/#1410: `terms` has no backing table (policy copy, not per-customer
// data) — the honest empty source the page renders off, shared frozen
// reference, never the retainerData.ts fixture used as data.
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

/** "17 Aug" / "2026" — short-date pieces of an ISO string, UTC, for report labels. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Weekly report" / "Monthly report" / etc — a report's period, titlecased. */
function periodLabel(period: string): string {
  const word = period.replace(/_/g, " ");
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} report`;
}

/**
 * `status_reports` → `RetWeek` (Git #1410). See the header note for which
 * fields have a real column behind them and which are honestly `0`/`[]` for
 * lack of one — `hours` and `deliverables` have no backing column at all.
 */
function toWeeklyReport(r: StatusReportWire, architectName: string | null, current: boolean): RetWeek {
  const asks: RetWeekAsk[] =
    r.replyThread.length > 0
      ? r.replyThread.map((m) => ({
          who: m.sender === "client" ? "you" : "them",
          when: shortDate(m.timestamp),
          text: m.content,
        }))
      : [
          ...(r.clientQuestion ? [{ who: "you" as const, when: "", text: r.clientQuestion }] : []),
          ...(r.adminReply ? [{ who: "them" as const, when: "", text: r.adminReply }] : []),
        ];

  return {
    key: String(r.id),
    label: r.reportDate ? shortDate(r.reportDate) : r.title,
    range: periodLabel(r.period),
    hours: 0, // no hours column on status_reports — honest absence, not fabricated.
    current,
    author: architectName ?? "Your architect",
    published: r.sentAt ? `Published ${shortDate(r.sentAt)}` : "Draft",
    summary: r.executiveSummary ?? "",
    log: r.completedActivities.map((a) => ({
      what: a.description ? `${a.title}: ${a.description}` : a.title,
      hours: 0,
    })),
    deliverables: [], // no matching column — see header note.
    asks,
  };
}

/** `status_reports.keyOutcomes` → `RetOutcome` (Git #1410) — one per report that has one. */
function toOutcome(r: StatusReportWire): RetOutcome | null {
  if (!r.keyOutcomes) return null;
  return { what: r.title, detail: r.keyOutcomes, tone: "blue" };
}

/** A sent status report IS a document (Git #1410) — one `RetDoc` per report. */
function toDocument(r: StatusReportWire): RetDoc {
  return { name: r.title, when: r.sentAt ? shortDate(r.sentAt) : "", kind: "Status report" };
}

const LOADING_STATE: RetainerLiveState = {
  configured: false,
  bucket: null,
  entries: [],
  loaded: false,
  dataState: "loading",
  settings: null,
  weeklyReports: [],
  outcomes: [],
  documents: [],
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
        const architectName = configured && data.settings ? data.settings.architectName : null;
        // Git #1410: real, off the caller's own sent status_reports — independent
        // of `configured`, since a customer can have sent reports without an
        // active retainer row (or an active row with none sent yet).
        const statusReports = data.statusReports ?? [];
        setState({
          configured,
          bucket: configured ? data.bucket : null,
          entries,
          loaded: true,
          dataState: !configured ? "unconfigured" : entries.length > 0 ? "live" : "empty",
          settings: configured && data.settings
            ? { architectName: data.settings.architectName, hourlyRateCents: data.settings.hourlyRateCents }
            : null,
          weeklyReports: statusReports.map((r, i) => toWeeklyReport(r, architectName, i === 0)),
          outcomes: statusReports.map(toOutcome).filter((o): o is RetOutcome => o !== null),
          documents: statusReports.map(toDocument),
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
          weeklyReports: [],
          outcomes: [],
          documents: [],
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
