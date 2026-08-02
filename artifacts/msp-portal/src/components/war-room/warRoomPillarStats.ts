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

export interface WarRoomPillarCardPayload {
  pillar: string;
  enginePillar: string;
  /** 0–100, higher = healthier. Null when no evaluable rule feeds the pillar. */
  score: number | null;
  rawRiskScore: number;
  stats: WarRoomStatPayload[];
  findings: WarRoomPillarFindingPayload[];
  findingCounts: { critical: number; warning: number };
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
  /** True when a real payload covered this pillar at all. */
  loaded: boolean;
}

export const WAR_ROOM_PILLAR_VIEW_EMPTY: WarRoomPillarView = {
  score: null,
  stats: [],
  findings: [],
  findingCounts: { critical: 0, warning: 0 },
  loaded: false,
};

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
