/**
 * useLivePillarHero.ts — the single real-data seam for the three rich pillar
 * dashboards that were shipped as 100% design fixture (Licensing, Adoption,
 * Health).
 *
 * ── What this wires, and what it deliberately does NOT ──────────────────────
 * `GET /api/portal/assessment/war-room-pillars` (via `usePortalV2Pillars`)
 * already computes every pillar's REAL display score, evaluation, replayed
 * score trend and findings through the live health engine. The rich dashboard
 * pages, however, are the prototype's own composition — a per-SKU money ledger,
 * a department heat-map, a config-drift table, a stale-object inventory, a set
 * of adoption plays. NONE of those have a per-item server feed; the war-room
 * payload carries aggregates, not the design's fictional Halden Materials rows.
 *
 * So this hook wires the ONE value that is genuinely real, present on every
 * hero and authoritative from the engine: the pillar SCORE (and the score
 * delta, derived from the same real score history the engine replays). The
 * heat-map / drift / inventory / plays stay on their fixture and are
 * documented as gaps, exactly as the Ownership and Microsoft Changes wiring
 * passes kept unbacked sections whole rather than half-filling them.
 *
 * UPDATE (Git #1230): Licensing's per-SKU ledger IS now real — wired
 * separately through `useLicenseSkuLedgerLive` (usePortalV2Pillars.ts), not
 * through this hook, since it's row data rather than a hero scalar. Its 3
 * recovery buckets (today/renewal/reassign) remain fixture: no billing-term or
 * usage-activity data exists anywhere in this platform to classify a seat by
 * timing. See licDashboardData.ts's `licLedgerCardsFromLive` for the exact
 * boundary of what is and is not real on that page.
 *
 * ── Honest-null contract ────────────────────────────────────────────────────
 * `score` is null when the tenant is genuinely unscored for this pillar
 * (`evaluation.status !== "scored"`) — the same nullable contract the Overview
 * and the generic pillar page already honour (#517). A page overlays the real
 * score when it is a number and falls back to its design fixture otherwise, so
 * the ring never renders a red zero for a missing measurement. `dataState` says
 * which source is on screen so a test can prove the difference.
 */

import { useMemo, type CSSProperties } from "react";

import { type PillarKey } from "@/components/copilot-journey/journeyTokens";
import { usePortalV2Pillars } from "./usePortalV2Pillars";
import { type PortalV2PillarView } from "./portalV2Model";

/** Positive score movement is healthy on every pillar's ring; negative is not. */
export const HERO_DELTA_UP = "#34d399";
export const HERO_DELTA_DOWN = "#f87171";

/**
 * A visually-clipped (not display:none) style for the hidden per-hero source
 * indicator. Rendered text stays in the DOM so a test can read el.innerText and
 * assert "live" vs "fixture", but it takes no visual space — the same technique
 * the Security Plan page uses for its `pv2-sp-source` marker.
 */
export const PV2_SOURCE_CLIP: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

export interface HeroDelta {
  /** e.g. "+3 this month" / "-2 this month". Sign is always explicit. */
  text: string;
  /** Green when the score rose (or held), red when it fell. */
  color: string;
}

/**
 * The ring delta from a real, replayed score series. Pure so it is unit-tested
 * without a render. A higher score is better on every pillar's hero ring (the
 * Health TREND chart inverts because it counts debt, but the ring delta tracks
 * the score itself, same as the other five), so up is green uniformly.
 *
 * Returns null when there is not enough history to state a movement — the caller
 * falls back to its design fixture rather than inventing a "+0".
 */
export function deriveHeroDelta(series: readonly number[] | null | undefined): HeroDelta | null {
  if (!Array.isArray(series) || series.length < 2) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (typeof last !== "number" || typeof prev !== "number") return null;
  const d = last - prev;
  return {
    text: `${d >= 0 ? "+" : ""}${d} this month`,
    color: d >= 0 ? HERO_DELTA_UP : HERO_DELTA_DOWN,
  };
}

export interface LivePillarHero {
  /** The engine's real display score, or null when this pillar is unscored. */
  readonly score: number | null;
  /** Real score delta, or null when history is too short to state one. */
  readonly delta: HeroDelta | null;
  /** True once a first real payload has arrived. */
  readonly loaded: boolean;
  /** True while a scan is genuinely running right now. */
  readonly scanning: boolean;
  /** The tenant's real finding counts for this pillar. */
  readonly findingCounts: { readonly critical: number; readonly warning: number };
  /**
   * The real replayed score series (≥5 real checkpoints) or null — feeds the
   * bespoke Governance/Security/Compliance hero sparklines. Same series
   * `deriveHeroDelta` reads; exposed so a page can draw the whole line, not just
   * the last movement. Added for the Gov/Sec/Cmp wiring (their heroes draw a real
   * trend); the Licensing/Adoption/Health heroes never read it.
   */
  readonly history: readonly number[] | null;
  /**
   * Every pillar's card view from the SAME payload, so a hero can read another
   * pillar's real stat without a second fetch — the Governance hero's "Global
   * Administrators" tile IS the Security card's `security.globalAdmins` count.
   */
  readonly pillars: readonly PortalV2PillarView[];
  /** "live" once a real numeric score is on screen; "fixture" otherwise. */
  readonly dataState: "live" | "fixture";
}

/**
 * Overlay the real score/delta/findings for one pillar onto a fixture-driven
 * dashboard. Reads the SAME payload the Overview and generic pillar page trust,
 * through the SAME `usePortalV2Pillars` seam, so there is no second fetching or
 * scoring path to drift.
 */
export function useLivePillarHero(key: PillarKey): LivePillarHero {
  const { view, loaded, scanning } = usePortalV2Pillars();

  return useMemo(() => {
    const pillar = view.pillars.find((p) => p.key === key);
    const score = pillar && typeof pillar.score === "number" ? pillar.score : null;
    return {
      score,
      delta: deriveHeroDelta(pillar?.trend?.series ?? null),
      loaded,
      scanning,
      findingCounts: pillar?.findingCounts ?? { critical: 0, warning: 0 },
      history: pillar?.trend?.series ?? null,
      pillars: view.pillars,
      dataState: score !== null ? "live" : "fixture",
    };
  }, [view, key, loaded, scanning]);
}
