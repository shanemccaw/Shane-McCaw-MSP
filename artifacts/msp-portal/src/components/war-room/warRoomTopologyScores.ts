/**
 * warRoomTopologyScores.ts
 *
 * Real per-pillar scores for the War Room's radial diagram (#312, parent epic
 * #302) — the two thin business-impact rings in TopologyCanvas.tsx.
 *
 * The design intent of those rings was already right and already documented in
 * the canvas's own comment: the INNER ring is what the real scan found, the
 * OUTER ring is where the customer's own toggled answers take it. The colour
 * maths was right too (high score → low impact → green). What was missing was
 * data: both rings fell back to `baseScores()`, an average over the canvas's
 * hardcoded `NODES` demo array, because `mapBaseline`/`mapProjected` in
 * WarRoomLogic.tsx were themselves derived from the fictional "Northline Health"
 * constants in warRoomData.ts (`DIVES[*].score`, `GOV_BASE.score`,
 * `COPILOT_BASE`, `LIC_SKUS`). With no real difference between the two sources
 * and every demo score skewed low, both rings rendered uniformly red.
 *
 * This module is the pure, testable half of the fix. It owns two things:
 *
 *   1. `toTopologyBaseline` — the real engine's per-pillar output, mapped onto
 *      the canvas's seven pillar groups. NO NEW SCORING FORMULA: the numbers
 *      come from `GET /api/portal/assessment/telemetry-comparison`, i.e. the
 *      platform's own `computeHealthEngine` path via
 *      `calculateArchitectureHealthScore` — exactly the infrastructure #245
 *      already proved on the Telemetry page, reached through the same
 *      `useRealTelemetryComparison()` hook rather than a second mechanism.
 *
 *   2. `computeTopologyDeltas` / `projectTopologyScores` — the outer ring. The
 *      customer's lever toggles, staged changes, inventory runs and licence
 *      adjustments are REAL user input and stay exactly as they were; what
 *      changes is what they are applied TO. They used to produce an absolute
 *      score off a demo baseline (`GOV_BASE.score + gain`, `28 + gain`,
 *      a waste ratio over `LIC_SKUS`); they now produce a DELTA that is added to
 *      the real baseline above. Same customer intent, real starting point.
 *
 * ── Pillars the engine has no data for ──────────────────────────────────────
 * `toTopologyBaseline` yields `null` for those, never a filled-in number, for
 * the same reason #245's radar drops them: a fabricated score reads as a real
 * measurement. The canvas drops a `null` pillar out of its segment's weighting
 * and renders a segment with nothing behind it in a neutral "no data" grey
 * rather than colouring it as though it had been measured.
 */

/** The canvas's seven pillar groups, in PILLAR_SECTORS order. */
export const TOPOLOGY_PILLAR_GROUPS = [
  'Security',
  'Governance',
  'Licensing',
  'Adoption',
  'Copilot',
  'Compliance',
  'Health',
] as const;

export type TopologyPillarGroup = (typeof TOPOLOGY_PILLAR_GROUPS)[number];

/**
 * Engine pillar key (api-server's `RADAR_PILLARS` in pillar-coverage.ts) → the
 * canvas group that represents it. Seven real pillars, seven groups, 1:1 — the
 * only non-identity pair is `architecture`, which is the engine's name for what
 * the War Room and MapView both call the Health pillar (the tenant's own
 * operational health, `DIVES.health` / `hub-health` in the demo registry).
 */
export const ENGINE_PILLAR_TO_TOPOLOGY_GROUP: Readonly<Record<string, TopologyPillarGroup>> = {
  security: 'Security',
  governance: 'Governance',
  licensing: 'Licensing',
  adoption: 'Adoption',
  copilot: 'Copilot',
  compliance: 'Compliance',
  architecture: 'Health',
};

/** 0–100 higher-is-healthier per group; `null` = the engine measured nothing here. */
export type TopologyScores = Record<TopologyPillarGroup, number | null>;

/** Sparse `group → score` for the pillars the customer's own answers actually move. */
export type TopologyProjection = Partial<Record<TopologyPillarGroup, number>>;

/** One real pillar off `useRealTelemetryComparison().pillars`. */
export interface RealPillarScore {
  pillar: string;
  actual: number;
}

/** The engine's own display ceiling — mirrors `cap()` in WarRoomLogic's projection. */
const MAX_SCORE = 99;

function clampScore(v: number): number {
  return Math.max(0, Math.min(MAX_SCORE, Math.round(v)));
}

function emptyScores(): TopologyScores {
  return {
    Security: null,
    Governance: null,
    Licensing: null,
    Adoption: null,
    Copilot: null,
    Compliance: null,
    Health: null,
  };
}

/**
 * The inner ring's real data: the engine's per-pillar display scores keyed by
 * canvas group. Pillars the engine returned nothing for stay `null`.
 *
 * `pillars` is `useRealTelemetryComparison().pillars`, which has ALREADY dropped
 * every pillar whose `displayScore` was null (see `toPillarViews` in
 * telemetryComparison.ts) — so anything arriving here is a real measurement.
 */
export function toTopologyBaseline(pillars: readonly RealPillarScore[] | null | undefined): TopologyScores {
  const out = emptyScores();
  if (!pillars) return out;
  for (const p of pillars) {
    const group = ENGINE_PILLAR_TO_TOPOLOGY_GROUP[p.pillar];
    if (!group) continue; // an engine pillar this diagram has no wedge for — ignored, never guessed at
    if (typeof p.actual !== 'number' || !Number.isFinite(p.actual)) continue;
    out[group] = clampScore(p.actual);
  }
  return out;
}

/** True once at least one pillar carries a real measured score. */
export function hasRealScores(scores: TopologyScores | null | undefined): boolean {
  if (!scores) return false;
  return TOPOLOGY_PILLAR_GROUPS.some((g) => typeof scores[g] === 'number');
}

/** The customer's live War Room state that feeds the projection. */
export interface TopologyDeltaState {
  /** `levers` — deep-dive lever toggles, keyed `"<dive>:<leverId>"`, plus governance lever ids. */
  levers?: Record<string, boolean> | null;
  /** `changes` — staged change-plan items. */
  changes?: Record<string, boolean> | null;
  /** `lic` — per-SKU seat quantities the customer moved on the licence adjuster. */
  lic?: Record<string, number> | null;
  /** `invRun` — per-dive inventory runs; `"done"` is the only state that scores. */
  invRun?: Record<string, string> | null;
}

/** The demo catalogs the toggles are defined in — passed in so this stays pure. */
export interface TopologyDeltaCatalogs {
  CHANGES: Record<string, { gov?: number; sec?: number; ready?: number }>;
  GOV_LEVERS: readonly { id: string; d: { score: number } }[];
  DIVES: Record<string, { score: number; levers: readonly { id: string; score: number }[] }>;
  DIVE_INV: Record<string, { toggle: { id: string } } | undefined>;
  LIC_SKUS: readonly { id: string; purchased: number; assigned: number; cost: number }[];
}

/** Points an inventory run that has actually completed is worth — as in the original projection. */
const INVENTORY_TOGGLE_POINTS = 9;
const INVENTORY_RUN_POINTS = 4;

/** Assigned-Copilot-seat headroom the readiness gain is scaled against, from the original projection. */
const COPILOT_SEAT_DENOMINATOR = 1876;
const COPILOT_SEAT_MAX_GAIN = 62;
const COPILOT_SEAT_GAIN_FACTOR = 120;

/** Waste-ratio → licensing-score conversion, unchanged from the original projection. */
const LICENSING_WASTE_FACTOR = 250;
const LICENSING_SCORE_FLOOR = 18;

/** Dive key (`DIVES`) → canvas group. Capitalisation only, as the original did. */
function diveKeyToGroup(key: string): TopologyPillarGroup | null {
  const group = (key.charAt(0).toUpperCase() + key.slice(1)) as TopologyPillarGroup;
  return TOPOLOGY_PILLAR_GROUPS.includes(group) ? group : null;
}

/** The licensing score the original projection computed from a set of seat quantities. */
function licensingScore(
  skus: TopologyDeltaCatalogs['LIC_SKUS'],
  quantityFor: (sku: TopologyDeltaCatalogs['LIC_SKUS'][number]) => number,
): number {
  let monthly = 0;
  let wasteMonthly = 0;
  for (const sku of skus) {
    const qty = quantityFor(sku);
    monthly += qty * sku.cost;
    wasteMonthly += Math.max(0, qty - sku.assigned) * sku.cost;
  }
  const ratio = monthly > 0 ? wasteMonthly / monthly : 0;
  return Math.max(LICENSING_SCORE_FLOOR, Math.min(MAX_SCORE, Math.round(100 - ratio * LICENSING_WASTE_FACTOR)));
}

/** The Copilot readiness score the original projection computed from a seat count. */
function copilotSeatScore(seats: number, base: number): number {
  return base + Math.min(COPILOT_SEAT_MAX_GAIN, (seats / COPILOT_SEAT_DENOMINATOR) * COPILOT_SEAT_GAIN_FACTOR);
}

/**
 * How far the customer's own answers move each pillar, in points.
 *
 * Every term is the SAME arithmetic the previous `mapProjected` used — the
 * governance levers' `d.score`, each dive lever's `score`, the staged changes'
 * `gov`/`sec`/`ready`, the inventory toggle and completed run, the licence
 * adjuster's waste ratio and the Copilot seat curve. The one structural change
 * is that each is now expressed as a delta against the same formula evaluated at
 * the customer's UNCHANGED starting point, so it can be applied to the real
 * engine baseline instead of carrying a demo absolute with it.
 *
 * Copilot deliberately SUMS its two sources rather than letting the seat curve
 * overwrite the staged-change gain the way the original did: staging a readiness
 * change and buying seats are two independent things the customer did, and under
 * a delta model there is no reason one should erase the other.
 */
export function computeTopologyDeltas(
  state: TopologyDeltaState,
  catalogs: TopologyDeltaCatalogs,
): TopologyProjection {
  const on = state.levers || {};
  const staged = state.changes || {};
  const licAdjust = state.lic || {};
  const invRun = state.invRun || {};
  const deltas: TopologyProjection = {};

  const add = (group: TopologyPillarGroup, points: number) => {
    if (!points) return;
    deltas[group] = (deltas[group] || 0) + points;
  };

  // Staged change-plan items feed the pillar each one belongs to.
  let changeGov = 0;
  let changeSec = 0;
  let changeReady = 0;
  for (const id of Object.keys(catalogs.CHANGES)) {
    if (!staged[id]) continue;
    const change = catalogs.CHANGES[id];
    changeGov += change.gov || 0;
    changeSec += change.sec || 0;
    changeReady += change.ready || 0;
  }

  const govLeverGain = catalogs.GOV_LEVERS.filter((l) => on[l.id]).reduce((a, l) => a + l.d.score, 0);
  add('Governance', govLeverGain + changeGov);
  add('Security', changeSec);
  add('Copilot', changeReady);

  // Deep-dive levers, their inventory toggle, and a completed inventory run.
  for (const key of Object.keys(catalogs.DIVES)) {
    const group = diveKeyToGroup(key);
    if (!group) continue;
    let gain = catalogs.DIVES[key].levers.filter((l) => on[`${key}:${l.id}`]).reduce((a, l) => a + l.score, 0);
    const inventory = catalogs.DIVE_INV[key];
    if (inventory && on[`${key}:${inventory.toggle.id}`]) gain += INVENTORY_TOGGLE_POINTS;
    if (inventory && invRun[key] === 'done') gain += INVENTORY_RUN_POINTS;
    add(group, gain);
  }

  // Licence adjuster: only scores once the customer has actually moved a seat count.
  if (Object.keys(licAdjust).length) {
    const before = licensingScore(catalogs.LIC_SKUS, (sku) => sku.purchased);
    const after = licensingScore(catalogs.LIC_SKUS, (sku) =>
      licAdjust[sku.id] === undefined ? sku.purchased : licAdjust[sku.id],
    );
    add('Licensing', after - before);

    const copilotSku = catalogs.LIC_SKUS.find((s) => s.id === 'copilot');
    if (copilotSku) {
      const seatsBefore = copilotSku.purchased;
      const seatsAfter = licAdjust.copilot === undefined ? copilotSku.purchased : licAdjust.copilot;
      // `base` cancels in the subtraction — 0 keeps the delta independent of any demo constant.
      add('Copilot', Math.round(copilotSeatScore(seatsAfter, 0) - copilotSeatScore(seatsBefore, 0)));
    }
  }

  for (const group of TOPOLOGY_PILLAR_GROUPS) {
    if (deltas[group] === 0) delete deltas[group];
  }
  return deltas;
}

/**
 * The outer ring: the real baseline moved by the customer's own answers.
 *
 * Returns a SPARSE map of only the pillars that genuinely moved, or `null` when
 * nothing did — which is exactly what the canvas's `ghosting` check expects, so
 * an untouched War Room shows one ring's worth of real scan data rather than two
 * identical rings.
 *
 * A pillar the engine did not measure gets no projection either: there is
 * nothing real to project FROM, and inventing a starting point so the outer ring
 * has something to draw is the fabrication this whole change removes.
 */
export function projectTopologyScores(
  baseline: TopologyScores | null | undefined,
  deltas: TopologyProjection,
): TopologyProjection | null {
  if (!baseline) return null;
  const out: TopologyProjection = {};
  for (const group of TOPOLOGY_PILLAR_GROUPS) {
    const base = baseline[group];
    const delta = deltas[group];
    if (typeof base !== 'number' || !delta) continue;
    const projected = clampScore(base + delta);
    if (projected !== base) out[group] = projected;
  }
  return Object.keys(out).length ? out : null;
}
