/**
 * secCaModel.ts — pure derivations behind the Conditional Access drill-down.
 *
 * Mirrors the prototype's `caRows` (18104), `caBands` (18122) and `caStatCards`
 * (18132) builders: grouping the 21 policies into their six bands, deriving each
 * row's status colour / P2 badge / wrench visibility, and computing the four
 * headline counts. Kept out of the page so the counts are unit-testable.
 *
 * ── Live overlay (Git #1232) ─────────────────────────────────────────────────
 * `caBandsWithRows()`/`caStatCards()` stay pure fixture derivations — the 21
 * named baselines, their `purpose` text and which of them require Entra ID P2
 * are Shane's own opinionated naming/playbook standard, not something Graph
 * returns, and stay as design content. `caBandsWithRowsLive()` overlays each
 * row's `status`/`note` with the tenant's REAL Conditional Access policies
 * (`useCaBaselineLive`, reading `identity:ca-policy-count`'s real per-policy
 * `id`/`displayName`/`state` and `license:sku-utilization`'s real SKU
 * inventory) — matched by displayName against the baseline's own naming
 * convention, since a policy this platform builds via the wrench flow is
 * created with exactly that name. A tenant with no matching real policy is
 * reported as missing honestly, never as one of the fixture's fabricated
 * per-tenant numbers (accounts, dates, exclusion counts).
 */

import { CA_BANDS, CA_POLICIES, CA_STATUS_META, type CaPolicy, type CaStatus } from "./secCaData";
import { type LiveCaPolicy } from "./useCaBaselineLive";

export interface CaRowVM {
  id: string;
  purpose: string;
  note: string;
  statusLabel: string;
  statusColor: string;
  showP2: boolean;
  /** A policy already "In place" is not actionable — no wrench, muted id. */
  actionable: boolean;
  fixKey: string;
}

export interface CaBandVM {
  range: string;
  label: string;
  desc: string;
  count: number;
  rows: CaRowVM[];
}

export interface CaStatCard {
  label: string;
  value: string;
  sub: string;
  c: string;
}

function caCount(status: CaStatus): number {
  return CA_POLICIES.filter((p) => p.status === status).length;
}

/** `caRows.filter(...)` grouped by band — `caBands` (18122). */
export function caBandsWithRows(): CaBandVM[] {
  return CA_BANDS.map((b) => {
    const rows: CaRowVM[] = CA_POLICIES.filter((p) => p.band === b.key).map((p) => {
      const m = CA_STATUS_META[p.status];
      const actionable = p.status !== "present";
      return {
        id: p.id,
        purpose: p.purpose,
        note: p.note,
        statusLabel: m.label,
        statusColor: m.c,
        showP2: !!p.p2,
        actionable,
        fixKey: "ca-" + p.id,
      };
    });
    return { range: b.range, label: b.label, desc: b.desc, count: rows.length, rows };
  });
}

/** `caStatCards` (18132) — four headline counts, values derived from the fixture. */
export function caStatCards(): CaStatCard[] {
  return [
    { label: "Baseline policies", value: String(CA_POLICIES.length), sub: "checked every scan", c: "#8B5CF6" },
    { label: "In place", value: String(caCount("present")), sub: "enabled and verified", c: "#34d399" },
    { label: "Needs attention", value: String(caCount("partial")), sub: "report-only or over-excluded", c: "#fbbf24" },
    { label: "Missing", value: String(caCount("missing")), sub: "not present in the tenant", c: "#f87171" },
  ];
}

/** Graph's real `conditionalAccessPolicy.state` values, mapped onto the page's three-way status. */
function statusFromGraphState(state: string): CaStatus {
  if (state === "enabled") return "present";
  if (state === "enabledForReportingButNotEnforced") return "partial";
  return "missing"; // "disabled", or any future/unrecognised value
}

/**
 * Finds the real tenant policy behind one baseline definition. A policy this
 * platform builds via the wrench flow is created with the baseline's own `id`
 * as its Graph `displayName` (the naming convention IS the spec), so an exact
 * match is checked first; the numeric prefix (e.g. "CA001") is checked next to
 * tolerate a hand-renamed policy that otherwise still matches the baseline.
 */
function findLiveMatch(def: CaPolicy, live: readonly LiveCaPolicy[]): LiveCaPolicy | null {
  const exact = live.find((p) => p.displayName.trim().toLowerCase() === def.id.toLowerCase());
  if (exact) return exact;
  const prefix = def.id.split("-")[0]?.toLowerCase();
  if (!prefix) return null;
  return live.find((p) => p.displayName.trim().toLowerCase().startsWith(prefix)) ?? null;
}

/** A real, non-fabricated note — no per-tenant numbers this build cannot verify from Graph. */
function liveNote(def: CaPolicy, match: LiveCaPolicy | null, hasEntraP2: boolean | null): string {
  let base: string;
  if (!match) {
    base = "No matching policy was found in your tenant.";
  } else if (match.state === "enabled") {
    base = `A policy named "${match.displayName}" is enabled and enforced in your tenant.`;
  } else if (match.state === "enabledForReportingButNotEnforced") {
    base = `A policy named "${match.displayName}" exists in your tenant but is in report-only mode — not yet enforced.`;
  } else {
    base = `A policy named "${match.displayName}" exists in your tenant but is disabled.`;
  }
  if (def.p2 && hasEntraP2 === false) {
    base += " This baseline also requires an Entra ID P2 licence, which this tenant does not currently have.";
  }
  return base;
}

/**
 * Same shape as `caBandsWithRows()`, with `status`/`note` overlaid from the
 * tenant's real Conditional Access policies. `purpose`/`showP2` stay the
 * baseline's own definitional content — see this file's header.
 */
export function caBandsWithRowsLive(livePolicies: readonly LiveCaPolicy[], hasEntraP2: boolean | null): CaBandVM[] {
  return CA_BANDS.map((b) => {
    const rows: CaRowVM[] = CA_POLICIES.filter((p) => p.band === b.key).map((p) => {
      const match = findLiveMatch(p, livePolicies);
      const status = match ? statusFromGraphState(match.state) : "missing";
      const m = CA_STATUS_META[status];
      return {
        id: p.id,
        purpose: p.purpose,
        note: liveNote(p, match, hasEntraP2),
        statusLabel: m.label,
        statusColor: m.c,
        showP2: !!p.p2,
        actionable: status !== "present",
        fixKey: "ca-" + p.id,
      };
    });
    return { range: b.range, label: b.label, desc: b.desc, count: rows.length, rows };
  });
}

/** Same shape as `caStatCards()`, counted off the live-overlaid rows. */
export function caStatCardsLive(bands: readonly CaBandVM[]): CaStatCard[] {
  const rows = bands.flatMap((b) => b.rows);
  const count = (label: string) => rows.filter((r) => r.statusLabel === label).length;
  return [
    { label: "Baseline policies", value: String(rows.length), sub: "checked every scan", c: "#8B5CF6" },
    { label: "In place", value: String(count(CA_STATUS_META.present.label)), sub: "enabled and verified", c: "#34d399" },
    { label: "Needs attention", value: String(count(CA_STATUS_META.partial.label)), sub: "report-only or over-excluded", c: "#fbbf24" },
    { label: "Missing", value: String(count(CA_STATUS_META.missing.label)), sub: "not present in the tenant", c: "#f87171" },
  ];
}
