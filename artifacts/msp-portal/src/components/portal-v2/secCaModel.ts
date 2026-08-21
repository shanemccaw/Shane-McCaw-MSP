/**
 * secCaModel.ts — pure derivations behind the Conditional Access drill-down.
 *
 * Mirrors the prototype's `caRows` (18104), `caBands` (18122) and `caStatCards`
 * (18132) builders: grouping the 21 policies into their six bands, deriving each
 * row's status colour / P2 badge / wrench visibility, and computing the four
 * headline counts. Kept out of the page so the counts are unit-testable.
 */

import { CA_BANDS, CA_POLICIES, CA_STATUS_META, type CaStatus } from "./secCaData";

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
