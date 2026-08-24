/**
 * pillarDashboardModel.ts — the pure derivations the three bespoke pillar
 * dashboards (Governance, Security, Compliance) layer on top of the shared
 * `useLivePillarHero` seam.
 *
 * ── Why this sits beside useLivePillarHero rather than inside it ──────────────
 * `useLivePillarHero` is the ONE real-data seam every rich pillar hero reads
 * (Licensing/Adoption/Health already use it): it overlays the real engine score,
 * delta, finding counts and a live/fixture `dataState` marker onto a
 * fixture-driven page. The three heroes wired here need three things beyond that,
 * all PURE and all tested here without React:
 *
 *   • `pillarSeverity`      — the status pill's real band (journeyTokens'
 *                             severityForScore), so the pill states the truth
 *                             about the live score, not the fixture "Critical".
 *   • `pillarTrendVerdict`  — Security's one-line trend sentence, derived from
 *                             the REAL replayed series direction rather than the
 *                             fixture's "2 new exposures since scan 12".
 *   • `resolveHeroTile`     — binds each design hero tile to a real source
 *                             (finding counts, or a cross-pillar stat), or to an
 *                             honest "not measured" state when the design tile has
 *                             no real producer anywhere.
 *
 * ── The honest gaps this refuses to fabricate (STEP-1 audit + STEP 2) ────────
 * Tiles with no real backing resolve `unmeasured`, never a fixture number:
 * "Overdue Access Reviews", "MFA Coverage" (a %, no denominator check), "Secure
 * Score" (real, but on the security-posture route not this payload), "Retention
 * Coverage", "Audit Retention (days)". The granular per-area cluster grids and
 * the risk heat-map's likelihood axis stay fixture too — no per-sub-area score
 * model and no probability estimate exist server-side; both are flagged as real
 * backend design work, not filled with invented data.
 */

import {
  SEVERITY_LABEL,
  SEVERITY_ON_DARK,
  severityForScore,
  type PillarKey,
} from "@/components/copilot-journey/journeyTokens";

import { formatStatValue, type PortalV2PillarView } from "./portalV2Model";

/** The status pill's real severity band + colour, or null when unscored. */
export interface PillarSeverity {
  label: string;
  color: string;
}

/**
 * The real severity band for a live score, in the app's one severity vocabulary
 * (journeyTokens). A pillar with no score has no severity — never a red zero.
 */
export function pillarSeverity(score: number | null | undefined): PillarSeverity | null {
  if (typeof score !== "number") return null;
  const band = severityForScore(score);
  return { label: SEVERITY_LABEL[band], color: SEVERITY_ON_DARK[band] };
}

/**
 * An honest one-line trend verdict from the REAL replayed series direction —
 * replaces the fixture's fabricated "Getting worse — 2 new exposures since scan
 * 12". Null when there is no real series to describe.
 */
export function pillarTrendVerdict(history: readonly number[] | null | undefined): string | null {
  if (!Array.isArray(history) || history.length < 2) return null;
  const change = Math.round(history[history.length - 1]! - history[0]!);
  if (change > 0) return `Improving — up ${change} across recent scans`;
  if (change < 0) return `Getting worse — down ${Math.abs(change)} across recent scans`;
  return "Holding steady across recent scans";
}

/**
 * The real number of OPEN findings (critical + warning) for a pillar, read off
 * the same live payload the heroes trust — or null when the pillar is not live
 * (unscored / before a payload arrives), so a drill-down page falls back to its
 * design fixture count rather than printing a real-looking 0.
 *
 * This is the one honest, VISIBLE real number a pillar drill-down can overlay
 * onto an existing "open gaps / open findings" count. The per-object rows those
 * pages list (individual overshared sites, MFA-partial users, CA policy rows,
 * obligation registers, accepted-risk cards) have no per-item server producer —
 * the war-room payload is finding-level and aggregate — so only the aggregate
 * count is wired here; the rows stay fixture, documented as backend gaps exactly
 * as the parent pillar heroes kept their ledgers/heat-maps fixture.
 */
export function livePillarOpenCount(live: {
  dataState: "live" | "fixture";
  findingCounts: { readonly critical: number; readonly warning: number };
}): number | null {
  if (live.dataState !== "live") return null;
  return live.findingCounts.critical + live.findingCounts.warning;
}

/* ── Hero stat tiles ─────────────────────────────────────────────────────────── */

/** The resolution of one hero stat tile against the live payload. */
export interface HeroTileResolution {
  label: string;
  accent: string;
  orbAlpha: string;
  /** Formatted display value, or null when genuinely unmeasured (renders "—"). */
  value: string | null;
  /** The sub line: an honest caption when real, or a short "not measured" note. */
  sub: string;
  /** The full reason, for a tooltip, when unmeasured. */
  note: string | null;
  unmeasured: boolean;
  /** Design flag — the value prints in the accent colour rather than near-white. */
  valueInAccent: boolean;
}

/**
 * Where a hero stat tile's real value comes from. `unmeasured` is the honest
 * bucket for a design tile the platform has no check behind — stated as "not
 * measured yet", never approximated.
 */
export type HeroTileSource =
  | { kind: "findingsTotal" }
  | { kind: "criticalCount" }
  | { kind: "warningCount" }
  | { kind: "crossStat"; pillar: PillarKey; statId: string }
  | { kind: "unmeasured"; note: string };

/** One hero tile: the design's own label / accent (copy is final) plus its real source. */
export interface HeroTileBinding {
  label: string;
  accent: string;
  orbAlpha: string;
  source: HeroTileSource;
  /** The honest sub to show beside a resolved real value. */
  realSub: string;
  valueInAccent?: boolean;
}

/**
 * The subset of `LivePillarHero` a tile needs. Exactly the fields
 * `useLivePillarHero` returns, so a page passes its `live` object straight in.
 */
export interface HeroTileContext {
  loaded: boolean;
  findingCounts: { readonly critical: number; readonly warning: number };
  pillars: readonly PortalV2PillarView[];
}

/**
 * Resolve one hero tile against the live payload. Pure and total: a tile with no
 * real value never falls back to a fixture number — it resolves `unmeasured`,
 * which the page renders as "—" plus the stated reason.
 */
export function resolveHeroTile(binding: HeroTileBinding, ctx: HeroTileContext): HeroTileResolution {
  const base = {
    label: binding.label,
    accent: binding.accent,
    orbAlpha: binding.orbAlpha,
    valueInAccent: binding.valueInAccent ?? false,
  };
  const real = (value: string): HeroTileResolution => ({
    ...base,
    value,
    sub: binding.realSub,
    note: null,
    unmeasured: false,
  });
  const unmeasured = (note: string): HeroTileResolution => ({
    ...base,
    value: null,
    sub: "Not measured yet",
    note,
    unmeasured: true,
  });

  const total = ctx.findingCounts.critical + ctx.findingCounts.warning;

  switch (binding.source.kind) {
    case "findingsTotal":
      return ctx.loaded ? real(total.toLocaleString()) : unmeasured("No completed scan yet");
    case "criticalCount":
      return ctx.loaded ? real(ctx.findingCounts.critical.toLocaleString()) : unmeasured("No completed scan yet");
    case "warningCount":
      return ctx.loaded ? real(ctx.findingCounts.warning.toLocaleString()) : unmeasured("No completed scan yet");
    case "crossStat": {
      // Hoist the discriminated source into a const so its narrowing survives
      // into the closures below — a property access (`binding.source`) is widened
      // back to the full union inside a nested function, which is what defeated
      // the earlier `binding.source!.pillar` / `as { statId }` workarounds.
      const source = binding.source;
      const view = ctx.pillars.find((p) => p.key === source.pillar);
      const stat = view?.stats.find((s) => s.id === source.statId);
      return stat && typeof stat.value === "number"
        ? real(formatStatValue(stat))
        : unmeasured("This check is not in your scan package yet");
    }
    case "unmeasured":
      return unmeasured(binding.source.note);
  }
}
