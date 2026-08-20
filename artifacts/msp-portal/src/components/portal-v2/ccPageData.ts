/**
 * ccPageData.ts — the Change Control page's pure view model.
 *
 * Filtering, the three tabs' derived rows and the design's own colour meta.
 * Kept out of the page component so the filter predicate and the two derived
 * tabs are unit-testable, matching `cmpDashboardData.ts` / `licDashboardData.ts`.
 *
 * ── Two of the three tabs are derived, and one of them is a found gap ───────
 * The prototype backs its three tabs with three arrays: `CC_SEED` (real change
 * requests), `CC_WINDOWS` (the maintenance schedule) and `CC_VAULT` (the
 * rollback vault). Only the first has a table behind it.
 *
 *  • The VAULT derives cleanly. Every column it shows — code, title, when, by,
 *    retention expiry, rolled-back — is a real column on `msp_change_requests`,
 *    with one substitution stated below.
 *
 *  • The MAINTENANCE SCHEDULE does not. `CC_WINDOWS` is a five-entry fixture of
 *    the customer's change POLICY (standard windows, an extended early slot, a
 *    month-end blackout, a reserved slot), and nothing in the schema models a
 *    maintenance-window policy. BUILD_PLAN §3.5 flags hold windows and the
 *    retainer ledger as the greenfield systems; this is a third one it does not
 *    mention.
 *
 *    Rather than ship a hardcoded blackout date for every tenant, the tab is
 *    built from what IS real: the windows customers' own open change requests
 *    are actually booked into, grouped by the exact `scheduledFor` string, each
 *    listing its real change requests. The policy sentence above the grid is
 *    final design copy, not tenant data, so it ships as written. A tenant with
 *    nothing booked gets an honest empty state rather than an invented calendar.
 */

import type { ChangeRequest } from "./useChangeControl";

/** `mono` — prototype 6883. */
export const CC_MONO = "'SF Mono',Menlo,Consolas,monospace";

/** Filter vocabularies, including the prototype's leading "All" sentinel (proto 14945-14947). */
export const CC_CLASSES = ["All", "Standard", "Normal", "Emergency"] as const;
export const CC_STATUSES = [
  "All",
  "Pending approval",
  "Approved",
  "Scheduled",
  "In window",
  "Implemented",
  "Rejected",
  "Rolled back",
] as const;
export const CC_WORKLOADS = [
  "All",
  "Conditional Access",
  "Exchange / mail",
  "Identity",
  "Intune",
  "Defender",
  "SharePoint",
  "Purview",
  "Teams",
] as const;

/** `ccClsMeta` — prototype 15013. */
export const CC_CLASS_COLOUR: Record<string, string> = {
  Standard: "#34d399",
  Normal: "#60a5fa",
  Emergency: "#f87171",
};

/** `ccStatusMeta` — prototype 15014-15017. */
export const CC_STATUS_COLOUR: Record<string, string> = {
  "Pending approval": "#c2a63d",
  Approved: "#60a5fa",
  Scheduled: "#22d3ee",
  "In window": "#22d3ee",
  Implemented: "#34d399",
  Rejected: "#94a3b8",
  "Rolled back": "#f87171",
};

/**
 * `ccRiskMeta` — prototype 15018. Three entries only; the prototype's lookups
 * are `ccRiskMeta[c.risk] || '#94a3b8'`, so a stored `Critical` falls through
 * to slate. That fallthrough is reproduced rather than corrected: inventing a
 * fourth colour would be designing, not porting. Flagged instead.
 */
export const CC_RISK_COLOUR: Record<string, string> = {
  Low: "#34d399",
  Medium: "#c2a63d",
  High: "#f87171",
};

/** `{ blue, green, red, amber, slate }` — prototype 15085. */
export const CC_TONE = {
  blue: "#60a5fa",
  green: "#34d399",
  red: "#f87171",
  amber: "#c2a63d",
  slate: "#64748b",
} as const;

export interface CcFilters {
  readonly changeClass: string;
  readonly status: string;
  readonly workload: string;
  readonly query: string;
}

export const CC_DEFAULT_FILTERS: CcFilters = {
  changeClass: "All",
  status: "All",
  workload: "All",
  query: "",
};

/**
 * `ccFiltered` — prototype 15004-15009, ported predicate for predicate. The
 * search haystack is the prototype's own four fields joined in its order:
 * code, title, target, ticket. Notably it does NOT search the rationale, the
 * requester or the window, so a search for a person's name finds nothing —
 * that is the design's behaviour and is kept.
 */
export function filterChangeRequests(
  requests: readonly ChangeRequest[],
  filters: CcFilters,
): ChangeRequest[] {
  const query = filters.query.trim().toLowerCase();
  return requests.filter(
    (c) =>
      (filters.changeClass === "All" || c.changeClass === filters.changeClass) &&
      (filters.status === "All" || c.status === filters.status) &&
      (filters.workload === "All" || c.workload === filters.workload) &&
      (!query || `${c.code} ${c.title} ${c.target} ${c.ticket}`.toLowerCase().includes(query)),
  );
}

/** One maintenance-schedule card — the shape the prototype's `ccWindowRows` renders. */
export interface CcWindowRow {
  readonly when: string;
  readonly kind: string;
  readonly tone: string;
  readonly items: readonly string[];
  readonly note: string;
}

/** Statuses the prototype counts as still-open (proto 15045). */
const OPEN_STATUSES = new Set(["Pending approval", "Approved", "Scheduled", "In window"]);

/**
 * The maintenance schedule, derived from the windows this tenant's open change
 * requests are really booked into. See the header for why it is derived rather
 * than fixtured.
 *
 * Grouping is on the exact `scheduledFor` string because that column is free
 * text and cannot be date-ordered — "Thu 27 Aug · 07:00–09:00 BST" and
 * "2026-07-27 02:00 UTC (Next Maint Window)" are both real stored values.
 * Groups are ordered by size, then alphabetically, so the ordering is stable
 * rather than dependent on row ids.
 */
export function deriveWindowRows(requests: readonly ChangeRequest[]): CcWindowRow[] {
  const groups = new Map<string, ChangeRequest[]>();
  for (const c of requests) {
    if (!OPEN_STATUSES.has(c.status)) continue;
    const key = c.window.trim();
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([when, items]) => {
      const hasEmergency = items.some((c) => c.changeClass === "Emergency");
      return {
        when,
        // The prototype's kinds (Standard window / Extended window / Blackout /
        // …) come from a policy the schema does not hold. What IS knowable from
        // the data is whether an emergency change is booked into the slot, so
        // that is what the chip says. It never claims a policy classification
        // nothing recorded.
        kind: hasEmergency ? "Emergency change" : "Booked window",
        tone: hasEmergency ? CC_TONE.red : CC_TONE.blue,
        items: items.map((c) => `${c.code} · ${c.title}`),
        note: `${items.length} change${items.length === 1 ? "" : "s"} booked into this window.`,
      };
    });
}

/** One rollback-vault row — the shape the prototype's `ccVaultRows` renders. */
export interface CcVaultRow {
  readonly code: string;
  readonly title: string;
  readonly when: string;
  readonly by: string;
  readonly expires: string;
  readonly verified: string;
  readonly isRolledBack: boolean;
}

/**
 * The rollback vault, derived from change requests that have actually executed.
 *
 * ONE SUBSTITUTION, stated rather than hidden: the prototype's `verified`
 * column reads "Verified by scan 13" — a link from a change request to the scan
 * that confirmed it, which no column models. What the row genuinely knows is
 * `backupVerified`, so that is what it reports. Claiming a scan verified a
 * change when nothing records which scan did would be the worse choice on a
 * page whose whole argument is provenance.
 */
export function deriveVaultRows(
  requests: readonly ChangeRequest[],
  retentionDays: number,
): CcVaultRow[] {
  return requests
    .filter((c) => c.status === "Implemented" || c.status === "Rolled back")
    .map((c) => {
      const isRolledBack = c.status === "Rolled back";
      return {
        code: c.code,
        title: c.title,
        // `executedAt` is free text on the row; when it is absent the change is
        // still in the vault by status, so the request date is shown and
        // labelled as such rather than left blank.
        when: c.executedAt?.trim()
          ? `${isRolledBack ? "Rolled back" : "Implemented"} ${c.executedAt.trim()}`
          : `${isRolledBack ? "Rolled back" : "Implemented"} · time not recorded`,
        by: c.requester,
        expires: isRolledBack
          ? "Snapshot consumed by rollback"
          : `Snapshot held until ${formatRetentionExpiry(c.createdAt, retentionDays)}`,
        verified: c.backupVerified ? "Pre-change snapshot verified" : "Pre-change snapshot not verified",
        isRolledBack,
      };
    });
}

/**
 * `createdAt` + retentionDays, rendered the way the prototype writes its vault
 * dates ("Snapshot held until 10 Nov"). Returns a plain marker rather than
 * "Invalid Date" if the timestamp cannot be parsed.
 */
export function formatRetentionExpiry(createdAtIso: string, retentionDays: number): string {
  const created = new Date(createdAtIso);
  if (Number.isNaN(created.getTime())) return "an unrecorded date";
  const expiry = new Date(created.getTime() + retentionDays * 86_400_000);
  return expiry.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
