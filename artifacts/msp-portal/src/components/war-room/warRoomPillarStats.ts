/**
 * warRoomPillarStats.ts — #320 (War Room epic #302).
 *
 * Shapes the real pillar-card payload from
 * `GET /api/portal/assessment/war-room-pillars` into exactly what the seven
 * completed-scan summary cards render: a score, up to four stat callouts, and
 * the card's note line.
 *
 * Before this, all of that came from the hardcoded `HERO_PHASE` literal in
 * `warRoomData.ts` — seven fixed scores and 28 fixed numbers invented for the
 * fictional "Northline Health" demo tenant, identical for every customer. See
 * api-server's lib/war-room-pillar-stats.ts for the per-stat provenance table
 * (which real check produces each number, and which of the originals had no real
 * producer at all).
 *
 * This lives outside WarRoomLogic.tsx for the same reason warRoomScan.ts (#305)
 * and warRoomSections.ts (#303) do: that file is `@ts-nocheck`d to stay diffable
 * against the Claude Design source and is `.tsx`, which Node's type stripping
 * cannot load — so anything worth a test has to be a real exported function the
 * component calls, not inline logic.
 *
 * ── The one rule everything here follows ─────────────────────────────────────
 * A stat the tenant has no real data for is OMITTED, never zeroed and never
 * back-filled with the old fictional number. A card with two real stats shows
 * two. A pillar with no evaluable rule shows no score rather than a plausible
 * one. This matches how #245's radar already treats a pillar with no data
 * (absent, not zeroed) and is why `formatStatValue` is only ever reached with a
 * real number.
 */

/** Mirrors `WarRoomStatUnit` in api-server's lib/war-room-pillar-stats.ts. */
export type WarRoomStatUnit = "count" | "percent" | "currency";

/** One real stat callout as the server sends it. */
export interface WarRoomStatPayload {
  id: string;
  label: string;
  unit: WarRoomStatUnit;
  /** Real number, or null when the source genuinely has no data for it. */
  value: number | null;
  /** Machine-stable reason `value` is null (`no_data`, `license_gap`, …). */
  unavailableReason?: string;
  source: string;
  replaces: string;
}

export interface WarRoomPillarFindingPayload {
  severity: "critical" | "warning";
  checkKey: string;
  title: string;
}

/**
 * A Microsoft purchase link for the licence gaps THIS pillar's own checks
 * reported (#489), exactly as api-server's `license-gap-purchase-links.ts`
 * resolved it.
 *
 * Never re-derived here. Which SKU a card shows depends on how many of the
 * three gap categories the WHOLE TENANT is missing — one gapped category links
 * that category's add-on, all three link Microsoft 365 E7 instead — and a card
 * that decided for itself would name its own add-on for a tenant whose real
 * recommendation is the consolidated one.
 */
export interface WarRoomPillarUpgradePayload {
  skuKey: string;
  skuName: string;
  url: string;
  /** This pillar's real gapped check keys behind the link. */
  checkKeys: string[];
}

export interface WarRoomPillarCardPayload {
  pillar: string;
  enginePillar: string;
  /** 0–100, higher = healthier. Null when no evaluable rule feeds the pillar. */
  score: number | null;
  rawRiskScore: number;
  stats: WarRoomStatPayload[];
  findings: WarRoomPillarFindingPayload[];
  findingCounts: { critical: number; warning: number };
  /** Empty for a pillar with no licence gap — never a placeholder link. */
  licenseGapUpgrades?: WarRoomPillarUpgradePayload[];
}

export interface WarRoomPillarStatsPayload {
  pillars: WarRoomPillarCardPayload[];
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  activeRunId: string | null;
  generatedAt: string;
}

/** What one card renders. `stats` holds only stats with a real number. */
export interface WarRoomPillarView {
  score: number | null;
  stats: { v: string; l: string }[];
  /** Real finding titles for this pillar, worst first. Empty when there are none. */
  findings: string[];
  findingCounts: { critical: number; warning: number };
  /**
   * Purchase links for this pillar's own licence gaps (#489). Empty for every
   * pillar of a tenant with no licence gap, which is most of them.
   *
   * The card carries these rather than a finding, because a licence gap never
   * BECOMES a card finding: `diagnostics-runner` classifies it as severity
   * `info` (a licence tier is not a security finding) and this card's finding
   * list is critical/warning only. Without this field the War Room says nothing
   * at all about a tenant's licence gaps.
   */
  upgrades: WarRoomPillarUpgradePayload[];
  /** True when a real payload covered this pillar at all. */
  loaded: boolean;
}

export const WAR_ROOM_PILLAR_VIEW_EMPTY: WarRoomPillarView = {
  score: null,
  stats: [],
  findings: [],
  findingCounts: { critical: 0, warning: 0 },
  upgrades: [],
  loaded: false,
};

/**
 * Dedicated colour for the honest "no real data" indicator (#334) — a pillar
 * that genuinely has no evaluable score or stat, as opposed to one that's
 * still queued/running or one with a real (good or bad) result. Deliberately
 * outside the red/amber/green severity spectrum (and the neutral greys used
 * for "queued"/"muted" states) so it can never be misread as a measured
 * score of any kind. Shared by the Welcome screen pillar cards
 * (WarRoomLogic.tsx) and the radial diagram's honest no-data segments
 * (topology/TopologyCanvas.tsx, #312) so both surfaces agree on what "no
 * data" looks like.
 */
export const WAR_ROOM_NO_DATA_COLOR = "#e879f9";

/**
 * Dedicated colour for the "still being scanned" indicator (#340) — a pillar
 * whose real checks have started reporting but have not all come back yet.
 *
 * Deliberately a calm sky-cyan, in the same family as the live/READING accent
 * the row already uses for the pillar being read this instant, because it means
 * the same reassuring thing: work in progress, nothing wrong. Just as
 * deliberately NOT `WAR_ROOM_NO_DATA_COLOR` — the whole point of #340 is that a
 * pillar mid-scan must not wear the "we looked and found nothing" treatment —
 * and not the red/amber/green severity spectrum, which would read as a verdict
 * on a pillar that hasn't been judged yet.
 */
export const WAR_ROOM_SCANNING_COLOR = "#7dd3fc";

/**
 * Render one real number the way the card showed its fictional predecessor:
 * thousands-separated counts ("1,204"), whole-dollar currency ("$847,608"),
 * percentages with a sign ("34%").
 *
 * Only ever called with a real number — a null value is filtered out upstream,
 * because a dash under a caption reads as a measurement and this has none.
 */
export function formatStatValue(value: number, unit: WarRoomStatUnit): string {
  switch (unit) {
    case "percent":
      // The engine's display scores are already whole numbers; round defensively
      // rather than surfacing 33.99999 from a float round-trip through JSON.
      return `${Math.round(value)}%`;
    case "currency":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    default:
      // Counts are integers in every real source; Math.round keeps a float that
      // slipped through from rendering as "1204.0000001".
      return Math.round(value).toLocaleString("en-US");
  }
}

/**
 * The card view for one pillar. Returns the empty view (no score, no stats) when
 * the payload has not arrived or does not cover this pillar — deliberately the
 * same shape as "arrived but has nothing real", because to the customer those
 * are the same statement: we are not showing you a number we do not have.
 */
export function warRoomPillarView(
  pillarKey: string,
  payload: WarRoomPillarStatsPayload | null | undefined,
): WarRoomPillarView {
  const card = payload?.pillars?.find((p) => p.pillar === pillarKey);
  if (!card) return WAR_ROOM_PILLAR_VIEW_EMPTY;

  return {
    score: typeof card.score === "number" ? card.score : null,
    stats: (card.stats ?? [])
      .filter((s): s is WarRoomStatPayload & { value: number } => typeof s.value === "number")
      .map((s) => ({ v: formatStatValue(s.value, s.unit), l: s.label })),
    findings: (card.findings ?? []).map((f) => f.title).filter((t) => typeof t === "string" && t.length > 0),
    findingCounts: card.findingCounts ?? { critical: 0, warning: 0 },
    // Only links that actually carry a URL and a name. A malformed or
    // pre-#489 payload degrades to no link rather than to a dead one.
    upgrades: (card.licenseGapUpgrades ?? []).filter(
      (u) => typeof u?.url === "string" && u.url.length > 0 && typeof u?.skuName === "string" && u.skuName.length > 0,
    ),
    loaded: true,
  };
}

/** Every pillar's view, keyed by pillar — built once per render. */
export function warRoomPillarViews(
  pillarKeys: readonly string[],
  payload: WarRoomPillarStatsPayload | null | undefined,
): Record<string, WarRoomPillarView> {
  const out: Record<string, WarRoomPillarView> = {};
  for (const key of pillarKeys) out[key] = warRoomPillarView(key, payload);
  return out;
}

/**
 * The card's note line — what the fictional `HERO_PHASE.find[0]` used to say
 * ("41 sites publishing tenant-wide"). Real findings first; when the pillar
 * genuinely produced none, say that rather than reaching for a fallback string
 * that implies one.
 *
 * `scored` is whether this pillar's checks actually reported in the run, so a
 * pillar the package never covered says "not covered by this scan" instead of
 * claiming a clean bill of health it never earned.
 */
export function warRoomPillarNote(view: WarRoomPillarView, scored: boolean): string {
  if (view.findings.length > 0) return view.findings[0]!;
  if (!view.loaded) return "waiting for scan data";
  if (!scored) return "not covered by this scan";
  return "no critical or warning findings";
}

/**
 * The card's licence-gap line (#489) — how many of this pillar's checks could
 * not run for want of a licence, and what would let them.
 *
 * Null when the pillar has no gap, so no card ever shows an empty upsell strip.
 * Deliberately counts the pillar's OWN gapped checks rather than the category's
 * full roster: the card is entitled to say what this tenant's scan actually hit,
 * and nothing more.
 *
 * A live function rather than a string built in the .tsx for the same reason
 * every other rule in this file is: the component that draws the card cannot be
 * type-checked or unit-tested, so anything worth getting right has to be an
 * exported function it calls.
 */
export function warRoomUpgradeNote(view: WarRoomPillarView): string | null {
  if (!view.upgrades.length) return null;
  const checks = new Set(view.upgrades.flatMap((u) => u.checkKeys ?? []));
  const noun = checks.size === 1 ? "check" : "checks";
  const skus = view.upgrades.map((u) => u.skuName).join(" · ");
  return checks.size > 0 ? `${checks.size} ${noun} not licensed — ${skus}` : `Not licensed — ${skus}`;
}

/**
 * The rolling findings feed the intro shows. Real finding titles from the
 * pillars that have actually reported, tagged with the pillar they belong to —
 * the same shape the fake `HERO_PHASE.find` strings fed, so the feed component
 * is unchanged.
 */
export function warRoomFindingsFeed(
  entries: readonly { pillar: string; label: string; color: string; scored: boolean }[],
  payload: WarRoomPillarStatsPayload | null | undefined,
  limit: number,
): { v: string; c: string; n: string }[] {
  const out: { v: string; c: string; n: string }[] = [];
  for (const entry of entries) {
    if (!entry.scored) continue;
    const view = warRoomPillarView(entry.pillar, payload);
    for (const title of view.findings) out.push({ v: title, c: entry.color, n: entry.label });
  }
  return out.slice(-limit);
}
