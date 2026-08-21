/**
 * ccChangeControlWire.ts — the seam between `GET /api/portal/change-control`
 * and the Change Control page's own `ChangeRequest` shape.
 *
 * Part 4 rebuilt this page from `Change Control.dc.html` with every value in
 * `ccPageData.ts`, and left a note at `App.tsx` saying the endpoint "remains
 * for the later wiring pass". This module is that pass. It is deliberately a
 * SEPARATE file from `ccPageData.ts`: the fixtures there are a verbatim
 * transcription of the design's logic class and stay that way, because they are
 * still the fallback and still the thing the design-fidelity audit reads.
 *
 * ── The two vocabulary mismatches, which is the whole reason a mapper exists ──
 * The server and the design do not use the same words for the same things, and
 * a naive `state: wire.status` would have shipped a page whose filters silently
 * match nothing. Both were found by reading the two vocabularies against each
 * other, not by running the page — a dead <select> looks identical to a filter
 * that legitimately found no rows.
 *
 *  1. STATUS. The server's `CHANGE_REQUEST_DISPLAY_STATUSES`
 *     (`lib/portal-change-control.ts`) is the prototype's SERVER-side list:
 *     "Pending approval" | "Approved" | "Scheduled" | "In window" |
 *     "Implemented" | "Rejected" | "Rolled back". The page's State filter offers
 *     the MODULE's list: "Draft" | "Awaiting approval" | "In test" |
 *     "Rolled back" | "Emergency · retro approval due", and `apprState()` in
 *     ccPageData.ts switches on those exact strings to pick a label and a tone.
 *     "Pending approval" is not among them, so all seven of the testbed
 *     tenant's real change requests — every one of which is `pending_approval`
 *     — would have rendered with the fall-through "Approved" label in green.
 *     Not merely a dead filter: a change nobody has signed, shown as approved.
 *
 *  2. WORKLOAD. The server derives `workload` from the stored category through
 *     its own eight-value list ("Exchange / mail", "Identity", "Teams", ...).
 *     The page's Workload filter offers "Exchange Online", "Microsoft Teams",
 *     "SharePoint", "Entra ID". Only SharePoint is spelled the same in both.
 *
 * Both maps below are TOTAL over the server's vocabulary — every value it can
 * send has a design-side spelling — so an unmapped value cannot fall through to
 * a wrong-but-plausible label. Anything genuinely outside both lists is passed
 * through unchanged rather than coerced, so it shows up as itself.
 *
 * ── What is real and what is absent, stated per field ───────────────────────
 * `msp_change_requests` is an MSP-era table of ~18 flat columns. The design's
 * `ChangeRequest` is a record with eleven sections and fifteen sub-objects. The
 * overlap is real but partial, and this module does NOT invent the difference:
 *
 *   REAL, straight off the row: code, title, workload, cls, risk, state,
 *   window, accounts, desc, pre, post, capturedAt, rollbackReady, linked.
 *
 *   REAL, derived from the row: audit (raised/executed events, off real
 *   timestamps), approvals (submitter from `requested_by`, approver from
 *   `approved_by`), missing (see below).
 *
 *   NO COLUMN, and left empty rather than faked: priority, mc (Message Center
 *   post), chan (release channel), countdown, aiScore/ai, just, scope, deps,
 *   secImpact, compImpact, impact, rollback, test, deploy, pipe, incidents,
 *   pir. The page already renders every one of these defensively — `c.mc &&`,
 *   `cr.chan || "Not set"`, `cur.mc || "None"` — because the design's own
 *   fixtures do not all carry them either.
 *
 * `missing` is the honest one and worth calling out. `secDone()` reads it, and
 * `compOf()` turns it into the record's "N of 6" completeness. A real change
 * request has an intake and an approval trail and nothing else, so it reports
 * 2 of 6 required sections complete — which is TRUE of the data, and is the
 * number that should make someone add the columns. Hardcoding an empty
 * `missing` would have claimed every real CR was fully documented.
 */

import type {
  ChangeRequest,
  CrAudit,
  CrLinked,
  CrPerson,
} from "./ccPageData";

/** One change request exactly as `portal-change-control.ts` puts it on the wire. */
export interface WireChangeRequest {
  readonly code: string;
  readonly title: string;
  readonly changeClass: string;
  readonly status: string;
  readonly workload: string;
  readonly target: string;
  readonly ticket: string;
  readonly requester: string;
  readonly window: string;
  readonly risk: string;
  readonly impactedUsersCount: number;
  readonly rationale: string;
  readonly pre: string;
  readonly post: string;
  readonly approvals: readonly string[];
  readonly canApprove: boolean;
  readonly canRollback: boolean;
  readonly executedAt: string | null;
  readonly backupVerified: boolean;
  readonly linkedFinding: string | null;
  readonly createdAt: string;
}

/** The four stat-card values the route computes server-side. */
export interface WireChangeControlStats {
  readonly open: number;
  readonly awaitingApproval: number;
  readonly nextWindowCount: number;
  readonly nextWindowLabel: string;
  readonly emergencyCount: number;
  readonly emergencyLookbackDays: number;
  readonly snapshotsHeld: number;
  readonly snapshotRetentionDays: number;
}

export interface WireChangeControlPayload {
  readonly requests: readonly WireChangeRequest[];
  readonly stats: WireChangeControlStats;
  /** False when the tenant has no resolvable M365 identifier — see the route's fail-closed rule. */
  readonly scoped: boolean;
}

/**
 * Server display status → the module's own state vocabulary. Total over
 * `CHANGE_REQUEST_DISPLAY_STATUSES`; see mismatch 1 in the header.
 *
 * "Implemented" maps to "Closed" rather than to one of the five the State
 * filter offers, because the design has no "Implemented" option and mapping it
 * onto "In test" or "Rolled back" would state something untrue about the
 * tenant. It therefore renders through `apprState`'s final branch as
 * "Approved" — which for a change that has actually run is correct — and is
 * simply not reachable from the State dropdown. Flagged rather than papered
 * over: the design's filter list is missing an option its own data can produce.
 */
const STATE_BY_WIRE_STATUS: Readonly<Record<string, string>> = {
  "Pending approval": "Awaiting approval",
  Approved: "Approved",
  Scheduled: "Approved",
  "In window": "In test",
  Implemented: "Closed",
  Rejected: "Draft",
  "Rolled back": "Rolled back",
};

/** Server workload → the design's spelling. Total over `CHANGE_REQUEST_WORKLOADS`. */
const WORKLOAD_BY_WIRE: Readonly<Record<string, string>> = {
  "Conditional Access": "Entra ID",
  "Exchange / mail": "Exchange Online",
  Identity: "Entra ID",
  Intune: "Intune",
  Defender: "Defender",
  SharePoint: "SharePoint",
  Purview: "Purview",
  Teams: "Microsoft Teams",
};

export function stateForWireStatus(status: string): string {
  return STATE_BY_WIRE_STATUS[status] ?? status;
}

export function workloadForWire(workload: string): string {
  return WORKLOAD_BY_WIRE[workload] ?? workload;
}

/**
 * The record sections a real row can actually fill. Everything else in
 * `CC_SECS` has no column behind it, so it is reported missing — see the
 * header's note on why that number is left honest.
 */
const SECTIONS_A_ROW_CAN_FILL = ["request", "approvals", "audit"] as const;
const ALL_SECTION_KEYS = [
  "request",
  "impact",
  "rollback",
  "approvals",
  "test",
  "env",
  "deploy",
  "audit",
  "release",
  "ai",
  "pir",
] as const;

const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The day a free-text window names, as an ISO date, or null.
 *
 * `msp_change_requests.scheduled_for` is free `text` and the route's own header
 * already flags that it cannot be date-ORDERED. Placing a chip on a calendar is
 * a weaker question than ordering, and it is answerable for the subset that
 * names a day and a month outright ("Thu 27 Aug · 07:00–09:00" → the 27th of
 * August). Prose that names no date ("Awaiting approval — no window booked",
 * "At the next change window tonight") returns null and is simply not placed,
 * which is the honest outcome — a guessed date on a freeze calendar is worse
 * than an absent one.
 *
 * The year comes from the row's own `createdAt`, not from today's clock, so a
 * change raised in December for January does not land in the wrong year.
 */
export function windowIsoDate(window: string, createdAtIso: string): string | null {
  const m = /\b(\d{1,2})\s+([A-Za-z]{3,})\b/.exec(window);
  if (!m) return null;
  const day = Number(m[1]);
  if (!(day >= 1 && day <= 31)) return null;
  const monthIdx = MONTHS_SHORT.indexOf(m[2].slice(0, 3).toLowerCase());
  if (monthIdx < 0) return null;
  const created = new Date(createdAtIso);
  const year = isNaN(created.getTime()) ? new Date().getFullYear() : created.getFullYear();
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function personFromRequester(requester: string, createdAt: string): CrPerson {
  return {
    name: requester || "Not recorded",
    org: "Raised in the customer portal",
    state: "Submitted " + formatStamp(createdAt),
    sig: "no signature on file",
    tone: "#94a3b8",
  };
}

function approverPerson(w: WireChangeRequest): CrPerson {
  // `approvals` is the route's own rendering of the approval trail. A row with
  // no approver recorded gets the design's own "waiting" tone rather than an
  // invented name.
  const line = w.approvals.find((l) => /approv/i.test(l)) || "";
  const signed = w.status === "Approved" || /approved by/i.test(line);
  return {
    name: signed ? line.replace(/^.*approved by\s*/i, "").trim() || "Recorded" : "Not assigned",
    org: "Approver must differ from the submitter",
    state: signed ? line : "Waiting for signature",
    sig: signed ? "recorded on the change request" : "no signature on file",
    tone: signed ? "#34d399" : "#fbbf24",
  };
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${hh}:${mm} UTC`;
}

/** The lifecycle events a real row can evidence, off real timestamps only. */
function auditFor(w: WireChangeRequest): CrAudit[] {
  const events: CrAudit[] = [
    {
      at: formatStamp(w.createdAt),
      event: "Raised",
      detail: w.requester ? "Raised by " + w.requester : "Raised in the customer portal",
      diff: "state: → " + w.status.toLowerCase(),
      tone: "#94a3b8",
    },
  ];
  if (w.executedAt) {
    events.push({
      at: w.executedAt,
      event: "Executed",
      detail: w.backupVerified ? "Pre-change snapshot verified" : "No verified pre-change snapshot on file",
      diff: "state: → " + w.status.toLowerCase(),
      tone: w.backupVerified ? "#34d399" : "#fbbf24",
    });
  }
  return events;
}

function linkedFor(w: WireChangeRequest): CrLinked[] {
  if (!w.linkedFinding) return [];
  return [
    {
      id: "Raised from",
      title: w.linkedFinding,
      note: "The finding this change was raised to close.",
      tag: "Finding",
      tone: "#60a5fa",
    },
  ];
}

/**
 * One wire row → the page's `ChangeRequest`.
 *
 * Every absent field is filled with the design's OWN empty sentinel rather than
 * a plausible value: `countdown` is "—" because the record's window line tests
 * for exactly that string before appending a countdown, and `mc`/`chan` are ""
 * because the page tests them for truthiness before rendering their chips.
 */
export function toChangeRequest(w: WireChangeRequest): ChangeRequest {
  const state = stateForWireStatus(w.status);
  const missing = ALL_SECTION_KEYS.filter(
    (k) => !(SECTIONS_A_ROW_CAN_FILL as readonly string[]).includes(k),
  );
  return {
    code: w.code,
    title: w.title,
    workload: workloadForWire(w.workload),
    cls: w.changeClass,
    priority: "Not set",
    risk: w.risk,
    state,
    mc: "",
    chan: "",
    window: w.window,
    countdown: "—",
    accounts: String(w.impactedUsersCount),
    aiScore: 0,
    rollbackReady: w.canRollback,
    missing,
    desc: w.rationale,
    just: "",
    scope: w.target,
    deps: "",
    secImpact: "",
    compImpact: "",
    pre: w.pre,
    post: w.post,
    capturedAt: formatStamp(w.createdAt),
    ai: { band: "Not scored", factors: [], deps: [], suggested: [], impact: "", impactMeta: "" },
    audit: auditFor(w),
    approvals: {
      submitter: personFromRequester(w.requester, w.createdAt),
      peer: {
        name: "Not assigned",
        org: "No peer review recorded",
        state: "Peer review not started",
        sig: "no signature on file",
        tone: "#64748b",
      },
      approver: approverPerson(w),
    },
    pipe: [],
    linked: linkedFor(w),
  };
}

export function toChangeRequests(payload: WireChangeControlPayload): ChangeRequest[] {
  return payload.requests.map(toChangeRequest);
}

/**
 * Real change requests → the freeze calendar's day-marker map, in the shape
 * `buildCalendar` already consumes. Only rows whose window names a date are
 * placed; see `windowIsoDate`.
 */
export function calEventsFor(
  crs: readonly ChangeRequest[],
  wire: readonly WireChangeRequest[],
): Record<string, Array<{ label: string; tone: string }>> {
  const out: Record<string, Array<{ label: string; tone: string }>> = {};
  wire.forEach((w, i) => {
    const key = windowIsoDate(w.window, w.createdAt);
    if (!key) return;
    const cr = crs[i];
    const tone = cr && cr.risk === "High" ? "#f87171" : "#60a5fa";
    (out[key] ||= []).push({ label: w.code + " window", tone });
  });
  return out;
}

/**
 * The stat-card filter sets, derived from the rows in hand.
 *
 * `CC_STAT_SETS` in ccPageData.ts is a literal map of FIXTURE codes (and it
 * also carries Microsoft-change ids, which are not change requests at all), so
 * against live data every one of its sets is empty and clicking a stat card
 * would blank the register instead of narrowing it. This computes the same
 * six sets as predicates over whatever rows are actually loaded.
 */
export function deriveStatSets(crs: readonly ChangeRequest[]): Record<string, string[]> {
  const waiting = crs.filter((c) => c.state === "Awaiting approval" || /retro/.test(c.state));
  const incomplete = crs.filter((c) => (c.missing || []).length > 0);
  const scheduled = crs.filter((c) => !/no window booked/i.test(c.window));
  const closed = crs.filter((c) => c.state === "Closed" || c.state === "Rolled back");
  const codes = (list: readonly ChangeRequest[]) => list.map((c) => c.code);
  return {
    decisions: codes([...waiting, ...closed.filter((c) => c.state === "Rolled back")]),
    waiting: codes(waiting),
    incomplete: codes(incomplete),
    scheduled: codes(scheduled),
    closed: codes(closed),
    // A live row carries no fixture window-day, so nothing can collide with the
    // design's fixed freeze. Empty is the truthful answer, not an oversight.
    freeze: [],
  };
}
