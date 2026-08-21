/**
 * riskPanelModel.ts — the derivation behind the Governance and Security
 * pillars' risk-accepted drop panel.
 *
 * A verbatim port of the prototype's `buildRiskDrop` (`Customer Portal
 * Shell.dc.html` line 8187), which both pillars call with the SAME fixture and
 * the SAME severity/status colour maps — only the pillar string differs:
 *
 *     govRisk: this.buildRiskDrop(RR_RISKS, 'Governance', rrSevMeta, rrStatusMeta)  // 21049
 *     secRisk: this.buildRiskDrop(RR_RISKS, 'Security',   rrSevMeta, rrStatusMeta)  // 21050
 *
 * So the panel is genuinely shared, and this module + `RiskAcceptedPanel.tsx`
 * are the one implementation both pillar pages render. Compliance has no such
 * panel in the current design (its banner links straight to the register).
 *
 * ── One fixture, not a fork ─────────────────────────────────────────────────
 * The rows come from `RR_RISKS` — the very fixture the Risk Register page reads
 * — filtered to the pillar, exactly as the prototype does. The colour maps are
 * the register's own `RR_SEV_META` / `RR_STATUS_META`, which ARE the prototype's
 * `rrSevMeta` / `rrStatusMeta`. Nothing here is a second copy of either.
 *
 * ── The heat-map band is NOT the register's heat band ───────────────────────
 * `buildRiskDrop` grades a likelihood×impact cell on a FOUR-step scale
 * (>=15 red, >=9 orange, >=4 gold, else green — line 8195). The Risk Register
 * page's own `heatCell` uses a different THREE-step scale (>=15 / >=8 / else).
 * They are different derivations for different surfaces and must not be merged;
 * this file carries the pillar-panel four-band scale, transcribed from 8195.
 */

import { RR_RISKS, type RiskEntry } from "./riskRegisterData";
import { RR_SEV_META, RR_STATUS_META } from "./riskRegisterModel";

/** A single likelihood×impact cell of the 5×5 grid. */
export interface HeatCell {
  /** The number of risks sitting on this pair, or "" when none. */
  n: string;
  /** Hover title: the risks' `id · title` lines, or the empty-cell coordinate. */
  title: string;
  /** The four-band colour for this cell's score. */
  band: string;
  /** True when at least one risk sits here — drives the filled styling. */
  filled: boolean;
}

/** One row of the risks list. */
export interface RiskPanelRow {
  id: string;
  title: string;
  owner: string;
  status: string;
  inherent: string;
  residual: string;
  /** rrSevMeta[inherent]. */
  inherentColor: string;
  /** rrSevMeta[residual]. */
  residualColor: string;
  /** rrStatusMeta[status]. */
  statusColor: string;
}

/** The expanded detail of one row. */
export interface RiskPanelDetail {
  id: string;
  title: string;
  /** "Likelihood L × impact I = L*I" — prototype 8225. */
  score: string;
  what: string;
  outcome: string;
  controls: string[];
  evidence: string;
  owner: string;
  review: string;
  isAccepted: boolean;
  accRef: string;
  accWhy: string;
  accComp: string;
  accBy: string;
  accOn: string;
  accUntil: string;
}

export interface RiskPanel {
  count: number;
  rows: RiskPanelRow[];
  /** Exactly 25 cells, row-major from likelihood 5 down to 1, impact 1..5. */
  cells: HeatCell[];
}

/** The four-band cell colour — prototype `buildRiskDrop` line 8195. */
export function heatBand(score: number): string {
  return score >= 15 ? "#f87171" : score >= 9 ? "#fb923c" : score >= 4 ? "#c2a63d" : "#34d399";
}

/** The pillar's rows and 5×5 heat-map — prototype 8188-8216, 8234. */
export function buildRiskPanel(pillar: string): RiskPanel {
  const rows = RR_RISKS.filter((r) => r.pillar === pillar);

  const cells: HeatCell[] = [];
  // Likelihood runs 5 → 1 so the most likely row sits at the top; impact 1 → 5
  // left to right (low to high). This ordering is the prototype's own (8191-8192)
  // and is what the "Rows run from most likely at the top" caption describes.
  for (let L = 5; L >= 1; L--) {
    for (let I = 1; I <= 5; I++) {
      const hits = rows.filter((r) => r.likelihood === L && r.impact === I);
      const band = heatBand(L * I);
      cells.push({
        n: hits.length ? String(hits.length) : "",
        title: hits.length
          ? hits.map((h) => `${h.id} · ${h.title}`).join("\n")
          : `Likelihood ${L} × impact ${I}`,
        band,
        filled: hits.length > 0,
      });
    }
  }

  return {
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      owner: r.owner,
      status: r.status,
      inherent: r.inherent,
      residual: r.residual,
      inherentColor: RR_SEV_META[r.inherent],
      residualColor: RR_SEV_META[r.residual],
      statusColor: RR_STATUS_META[r.status],
    })),
    cells,
  };
}

/** The expanded row's detail — prototype 8218-8233. Null when `id` is not a
 * risk of this pillar (so a stale expanded id renders nothing, not a crash). */
export function buildRiskDetail(pillar: string, id: string | null): RiskPanelDetail | null {
  if (!id) return null;
  const r: RiskEntry | undefined = RR_RISKS.find((x) => x.pillar === pillar && x.id === id);
  if (!r) return null;
  const a = r.accepted;
  return {
    id: r.id,
    title: r.title,
    score: `Likelihood ${r.likelihood} × impact ${r.impact} = ${r.likelihood * r.impact}`,
    what: r.what,
    outcome: r.outcome,
    controls: r.controls ?? [],
    evidence: r.evidence,
    owner: r.owner,
    review: r.review,
    isAccepted: !!a,
    accRef: a ? a.register : "",
    accWhy: a ? a.why : "",
    accComp: a ? a.compensating : "",
    accBy: a ? a.by : "",
    accOn: a ? a.on : "",
    accUntil: a ? a.until : "",
  };
}
