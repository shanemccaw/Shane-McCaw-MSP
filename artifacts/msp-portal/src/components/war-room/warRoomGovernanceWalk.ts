/**
 * warRoomGovernanceWalk.ts — #331 (War Room epic #302).
 *
 * The five facilitated Governance topics (`GOV_WALK` in data/warRoomData.ts —
 * Org-Wide Sharing, Overshared Locations, Sensitive Data Exposure, External
 * Access, Copilot Exposure) were written for the fictional "Northline Health"
 * demo tenant: every headline, every chart row and every before/after row was a
 * number invented for the script, identical for every customer.
 *
 * This maps the parts that CAN be real onto the real payload #320 already
 * fetches (`GET /api/portal/assessment/war-room-pillars` →
 * `useWarRoomPillarStats`), and marks everything else so it cannot be mistaken
 * for a measurement. No new endpoint, no new scoring formula, no new check: the
 * only numbers used are stats that already resolve through `resolveMetric` over
 * real `DASHBOARD_METRICS` entries, which are already on the wire.
 *
 * ── Three states, never two ──────────────────────────────────────────────────
 * Every head / bar / heat cell / delta row lands in exactly one of:
 *
 *   REAL      a real number from the payload, formatted, with the check that
 *             produced it named in the card's note line.
 *   NO DATA   the item IS wired, but this tenant's scan produced no value for
 *             that check. Rendered in `WAR_ROOM_NO_DATA_COLOR` with an em dash —
 *             #334's existing convention for honest absence, reused rather than
 *             re-invented. Never falls back to the sample number.
 *   NOT WIRED nothing in this platform produces the figure at all. The sample
 *             content STAYS (Shane presents against it), but it is greyed to
 *             `WAR_ROOM_NOT_WIRED_COLOR` and carries a literal NOT WIRED marker,
 *             so it reads as a placeholder rather than as this tenant's data.
 *
 * The two greys mean different things and must not be conflated: NO DATA is
 * "we asked your tenant and got nothing", NOT WIRED is "we never asked, because
 * nothing collects this yet".
 *
 * ── What genuinely cannot be wired, and why ──────────────────────────────────
 * These are not oversights; each was checked against the real check catalog
 * (lib/dashboard-registry/src/metrics.ts) and api-server's
 * war-room-pillar-stats.ts, which already records the same gaps for the pillar
 * cards in `WAR_ROOM_UNPRODUCIBLE_STATS`:
 *
 *   · Per-site file counts ("Flight Ops – Mission Docs · 41,208 files") and the
 *     "3 sites carry 78% of the exposure" concentration headline need real
 *     Graph SITE-LEVEL enumeration. Every real sharing check reports a tenant
 *     aggregate (`compliance:overshared-sites` is a COUNT of sites), so the whole
 *     Overshared Locations chart is NOT WIRED.
 *   · Anonymous "Anyone" link counts — no check counts sharing links by grant
 *     type.
 *   · Classification breakdowns (PHI / PII / Confidential shares, "% labelled"
 *     per library) — `compliance:missing-labels` counts items missing a label;
 *     nothing reports what the label WOULD be, so the whole Sensitive Data
 *     heat-grid is NOT WIRED.
 *   · Guest access bucketed by age of grant — `compliance:guest-users` is a
 *     count, with no per-grant age.
 *   · Named content areas a prompt can reach ("Payroll & compensation ·
 *     reachable") — same site-level gap as above.
 *   · Post-remediation SCORE projections ("Governance pillar 34 → 71",
 *     "Copilot readiness 34% → 64%"). Nothing models a future score, and
 *     inventing one would be exactly the new scoring formula this must not add.
 *     A `resolved` target of 0 for a count of a bad thing is different: that is
 *     the definition of the topic being closed, which is what the delta grid's
 *     own column header ("Resolved") says, not a prediction.
 *   · The `wrong` / `fix` narrative lists on every section. These are the
 *     analyst's prose, and producing them for a real tenant is generation work,
 *     deferred until ShaneBot is online. Marked whole-block.
 *
 * ── Out of scope, deliberately ───────────────────────────────────────────────
 * `GOV_WALK_ENGINE` (the engine band's Data Freshness / Scoring & Thresholds
 * cards) is equally fictional but is NOT touched here: #330 recorded that its
 * fate is a separate decision, and #331 scopes to the five customer sections.
 * It has no entry in `GOV_WALK_WIRING`, so it passes through untouched — which
 * is also why the builder returns cards it does not recognise unchanged rather
 * than assuming every card is a governance topic.
 *
 * Lives outside WarRoomLogic.tsx for the same reason warRoomPillarStats.ts
 * (#320), warRoomScan.ts (#305) and warRoomSections.ts (#303) do: that file is
 * `@ts-nocheck`d to stay diffable against the Claude Design source and is
 * `.tsx`, which Node's type stripping cannot load — so anything worth a test has
 * to be a real exported function the component calls.
 */

import {
  formatStatValue,
  WAR_ROOM_NO_DATA_COLOR,
  type WarRoomPillarStatsPayload,
  // Explicit extension so `node --test` (which loads this module directly, with
  // no bundler) can resolve it — same reason warRoomSections.ts does it.
} from "./warRoomPillarStats.ts";

/** Literal marker text. Deliberately shouty — it has to survive a glance. */
export const WAR_ROOM_NOT_WIRED_LABEL = "NOT WIRED";

/**
 * Colour for NOT WIRED content. Slate-400: outside the red/amber/green severity
 * spectrum the real rows use, and distinct from `WAR_ROOM_NO_DATA_COLOR`
 * (fuchsia, #334) which means the opposite kind of nothing — see the header.
 */
export const WAR_ROOM_NOT_WIRED_COLOR = "#94a3b8";

export const WAR_ROOM_NOT_WIRED_NOTE =
  "NOT WIRED — sample content, not measured from this tenant";

export const WAR_ROOM_NO_DATA_LABEL = "NO DATA";

export const WAR_ROOM_NO_DATA_NOTE =
  "NO DATA — this check reported nothing for this tenant";

/** Marker appended to a label that is rendered without a colour of its own. */
export const WAR_ROOM_NOT_WIRED_SUFFIX = ` · ${WAR_ROOM_NOT_WIRED_LABEL}`;
export const WAR_ROOM_NO_DATA_SUFFIX = ` · ${WAR_ROOM_NO_DATA_LABEL}`;

/** Severity colours, matching the ones the walk cards already use. */
const TONE_BAD = "#f87171";
const TONE_WARN = "#fbbf24";
const TONE_GOOD = "#34d399";

/**
 * Every real number this walk can reach. Each is a stat id already on the #320
 * payload — nothing here adds a metric, an endpoint or a query.
 *
 * `sitesNotOvershared` is the one derived figure: total SharePoint sites minus
 * overshared sites. That is not a new formula — the registry itself already
 * pairs the two (`compliance.oversharedSiteCount.denominatorMetric` IS
 * `compliance.sharePointSiteCount`), so the complement is the same relationship
 * read the other way round.
 */
export type GovWalkSource =
  | "sites"
  | "overshared"
  | "exposure"
  | "guests"
  | "missingLabels"
  | "sitesNotOvershared";

interface StatRef {
  pillar: string;
  statId: string;
}

const STAT_REFS: Record<Exclude<GovWalkSource, "sitesNotOvershared">, StatRef> = {
  sites: { pillar: "governance", statId: "governance.sites" },
  overshared: { pillar: "governance", statId: "governance.overshared" },
  exposure: { pillar: "governance", statId: "governance.exposure" },
  guests: { pillar: "compliance", statId: "compliance.guests" },
  missingLabels: { pillar: "compliance", statId: "compliance.missingLabels" },
};

/**
 * The real `monitor_checks` key behind each source, shown on the card so the
 * customer can trace a number back to the check that produced it.
 */
export const GOV_WALK_SOURCE_CHECK: Record<GovWalkSource, string> = {
  sites: "compliance:sharepoint-sites",
  overshared: "compliance:overshared-sites",
  exposure: "copilot:overshare-exposure",
  guests: "compliance:guest-users",
  missingLabels: "compliance:missing-labels",
  sitesNotOvershared: "compliance:sharepoint-sites − compliance:overshared-sites",
};

/**
 * One real number off the payload, or null when it genuinely has none.
 *
 * Reads the stat by its stable `id` rather than its label, so a caption reword
 * on the server cannot silently break a card into NO DATA.
 */
export function govWalkValue(
  payload: WarRoomPillarStatsPayload | null | undefined,
  source: GovWalkSource,
): number | null {
  if (!payload) return null;

  if (source === "sitesNotOvershared") {
    const total = govWalkValue(payload, "sites");
    const overshared = govWalkValue(payload, "overshared");
    if (total == null || overshared == null) return null;
    // Two different checks disagreeing is not a measurement — say nothing rather
    // than render a negative count of correctly-scoped sites.
    const rest = total - overshared;
    return rest >= 0 ? rest : null;
  }

  const ref = STAT_REFS[source];
  const card = payload.pillars?.find((p) => p.pillar === ref.pillar);
  const stat = card?.stats?.find((s) => s.id === ref.statId);
  return typeof stat?.value === "number" && Number.isFinite(stat.value) ? stat.value : null;
}

/** How a real value maps to a colour. */
export type GovWalkTone = "bad" | "warn" | "good";

function toneColor(tone: GovWalkTone, value: number): string {
  if (tone === "good") return TONE_GOOD;
  if (value <= 0) return TONE_GOOD;
  return tone === "warn" ? TONE_WARN : TONE_BAD;
}

interface GovHeadWiring {
  source: GovWalkSource;
  /** The caption under the number — the REAL thing the check counts. */
  label: string;
  tone: GovWalkTone;
  /** Leading half of the note line; the check key is appended to it. */
  note: string;
}

interface GovBarWiring {
  source: GovWalkSource;
  label: string;
  /** Unit word appended to the number ("41 sites"), matching the card's style. */
  unit: string;
  tone: GovWalkTone;
  flag: string;
  /** Flag shown when the real value is 0, when that reads differently. */
  zeroFlag?: string;
}

interface GovDeltaWiring {
  source: GovWalkSource;
  label: string;
  /**
   * The "Resolved" column. Only ever a definitional end state (0 for a count of
   * a thing the topic exists to eliminate) — never a modelled figure.
   */
  resolved: string;
}

interface GovSectionWiring {
  head?: GovHeadWiring;
  /** Index-aligned with the card's own `bars`. A null or missing entry is NOT WIRED. */
  bars?: (GovBarWiring | null)[];
  /** Index-aligned with the card's `heat`. Nothing is wireable today. */
  heat?: (null)[];
  /** Index-aligned with the card's `delta`. */
  delta?: (GovDeltaWiring | null)[];
}

/**
 * The wiring, section by section, keyed by `GOV_WALK[].id`.
 *
 * A section absent from this table, or an index absent from one of its arrays,
 * is NOT WIRED — the default is "mark it", never "assume it is fine".
 */
export const GOV_WALK_WIRING: Record<string, GovSectionWiring> = {
  // 01 — the one section that is almost entirely real.
  orgwide: {
    head: {
      source: "overshared",
      label: "sites flagged overshared",
      tone: "bad",
      note: "threshold for a Copilot go-live is 0",
    },
    bars: [
      {
        source: "overshared",
        label: "Sites flagged overshared",
        unit: "sites",
        tone: "bad",
        flag: "over threshold",
        zeroFlag: "within threshold",
      },
      // "Anonymous “Anyone” links" — no check counts sharing links by grant type.
      null,
      {
        source: "guests",
        label: "Guest identities",
        unit: "guests",
        tone: "warn",
        flag: "external",
        zeroFlag: "none",
      },
      {
        source: "sitesNotOvershared",
        label: "Sites not flagged overshared",
        unit: "sites",
        tone: "good",
        flag: "healthy",
      },
    ],
    delta: [
      { source: "overshared", label: "Sites flagged overshared", resolved: "0" },
      // "Files reachable tenant-wide" has no producer; the real blast-radius
      // figure is the ITEM count, relabelled exactly as #320 relabelled it on
      // the pillar card rather than approximating a file count.
      { source: "exposure", label: "Items over-exposed", resolved: "0" },
      // "Governance pillar 34 → 71" — nothing projects a post-remediation score.
      null,
    ],
  },

  // 02 — the concentration headline and every per-site row need site-level
  // enumeration that does not exist. Only the tenant-aggregate delta row is real.
  locations: {
    delta: [
      { source: "overshared", label: "Sites flagged overshared", resolved: "0" },
      null,
      null,
    ],
  },

  // 03 — the headline count is real; the classification breakdown is not.
  sensitive: {
    head: {
      source: "missingLabels",
      label: "files with no sensitivity label",
      tone: "bad",
      note: "measured",
    },
    delta: [
      null,
      { source: "missingLabels", label: "Files with no sensitivity label", resolved: "0" },
      null,
    ],
  },

  // 04 — the guest count is real; nothing buckets guests by age of grant, and
  // "Resolved" for guests is not zero (you keep the current vendors), so no
  // delta row can be honestly targeted.
  external: {
    head: {
      source: "guests",
      label: "guest identities with standing access",
      tone: "warn",
      note: "measured",
    },
  },

  // 05 — the go/no-go headline is the real over-exposure count.
  copilot: {
    head: {
      source: "exposure",
      label: "items a normal prompt can reach",
      tone: "bad",
      note: "no elevated rights required",
    },
    delta: [
      // "Copilot readiness 34% → 64%" — a modelled score, same gap as above.
      null,
      { source: "exposure", label: "Items over-exposed", resolved: "0" },
      { source: "missingLabels", label: "Files with no sensitivity label", resolved: "0" },
    ],
  },
};

/** One head/bar/heat item after wiring, as the card renders it. */
export interface GovWalkItemState {
  wired?: boolean;
  noData?: boolean;
  notWired?: boolean;
}

function count(value: number): string {
  return formatStatValue(value, "count");
}

/**
 * The wired form of one walk card.
 *
 * Returns the card UNCHANGED when it is not one of the five governance topics —
 * another pillar's walk, the engine band, or a card id this table does not know.
 * Wiring is opt-in per section precisely so a future section cannot inherit
 * someone else's numbers by accident.
 */
export function govWalkCard(
  card: any,
  pillar: string | null | undefined,
  payload: WarRoomPillarStatsPayload | null | undefined,
): any {
  if (!card) return card;
  if (pillar !== "governance") return card;
  const wiring = GOV_WALK_WIRING[card.id];
  if (!wiring) return card;

  const head = wireHead(card, wiring, payload);
  const bars = wireBars(card, wiring, payload);
  const heat = wireHeat(card, wiring);
  const delta = wireDelta(card, wiring, payload);

  const sites = govWalkValue(payload, "sites");
  const scanNote =
    sites == null
      ? ""
      : `measured across ${count(sites)} SharePoint sites in the latest scan`;

  return {
    ...card,
    head,
    bars,
    heat,
    delta,
    /** True for every card this module has processed — the render site's switch. */
    govWired: true,
    scanNote,
    /** Both narrative lists are generation work, deferred. */
    wrongNotWired: true,
    fixNotWired: true,
    /**
     * The go/no-go gate strip (score now, score "with changes", the blocker
     * checklist) is a projection model with hardcoded numbers — same score-
     * projection gap as the delta rows, so it is marked rather than half-wired.
     */
    gateNotWired: !!card.gate,
  };
}

function wireHead(card: any, wiring: GovSectionWiring, payload: WarRoomPillarStatsPayload | null | undefined) {
  const spec = wiring.head;
  const original = card.head || { v: "—", l: "", tone: WAR_ROOM_NOT_WIRED_COLOR, note: "" };

  if (!spec) {
    return {
      ...original,
      tone: WAR_ROOM_NOT_WIRED_COLOR,
      note: `${original.note || ""} · ${WAR_ROOM_NOT_WIRED_NOTE}`.replace(/^ · /, ""),
      notWired: true,
    };
  }

  const value = govWalkValue(payload, spec.source);
  const check = GOV_WALK_SOURCE_CHECK[spec.source];

  if (value == null) {
    return {
      v: "—",
      l: spec.label,
      tone: WAR_ROOM_NO_DATA_COLOR,
      note: `${WAR_ROOM_NO_DATA_NOTE} · ${check}`,
      noData: true,
    };
  }

  return {
    v: count(value),
    l: spec.label,
    tone: toneColor(spec.tone, value),
    note: `${spec.note} · ${check}`,
    wired: true,
  };
}

function wireBars(card: any, wiring: GovSectionWiring, payload: WarRoomPillarStatsPayload | null | undefined) {
  const bars = (card.bars || []).map((bar: any, i: number) => {
    const spec = wiring.bars?.[i] ?? null;

    if (!spec) {
      // Sample content stays — but greyed off the severity spectrum and flagged,
      // so a fabricated red bar cannot read as this tenant's critical finding.
      return { ...bar, c: WAR_ROOM_NOT_WIRED_COLOR, flag: WAR_ROOM_NOT_WIRED_LABEL, notWired: true };
    }

    const value = govWalkValue(payload, spec.source);
    const check = GOV_WALK_SOURCE_CHECK[spec.source];

    if (value == null) {
      return {
        ...bar,
        l: spec.label,
        v: "—",
        pct: 0,
        c: WAR_ROOM_NO_DATA_COLOR,
        flag: WAR_ROOM_NO_DATA_LABEL,
        noData: true,
        check,
      };
    }

    return {
      ...bar,
      l: spec.label,
      v: `${count(value)} ${spec.unit}`,
      pct: 0,
      c: toneColor(spec.tone, value),
      flag: value > 0 ? spec.flag : (spec.zeroFlag ?? spec.flag),
      wired: true,
      source: spec.source,
      check,
      value,
    };
  });

  // Bar width is proportional to the largest REAL value in the chart. The old
  // percentages were eyeballed for the script (41 → 100%, 1,104 → 34%); a bar
  // whose width contradicts its own number is its own kind of fake.
  const max = bars.reduce((m: number, b: any) => (b.wired && b.value > m ? b.value : m), 0);
  for (const bar of bars) {
    if (!bar.wired) continue;
    bar.pct = bar.value > 0 && max > 0 ? Math.max(2, Math.round((100 * bar.value) / max)) : 0;
  }
  return bars;
}

function wireHeat(card: any, wiring: GovSectionWiring) {
  return (card.heat || []).map((cell: any, i: number) => {
    const spec = wiring.heat?.[i] ?? null;
    if (spec) return cell;
    return {
      ...cell,
      c: WAR_ROOM_NOT_WIRED_COLOR,
      sub: WAR_ROOM_NOT_WIRED_NOTE,
      notWired: true,
    };
  });
}

function wireDelta(card: any, wiring: GovSectionWiring, payload: WarRoomPillarStatsPayload | null | undefined) {
  return (card.delta || []).map((row: any, i: number) => {
    const spec = wiring.delta?.[i] ?? null;
    // The delta grid renders three bare strings per row, so the marker has to
    // ride on the label — there is no colour channel to use here.
    if (!spec) return [`${row[0]}${WAR_ROOM_NOT_WIRED_SUFFIX}`, row[1], row[2]];

    const value = govWalkValue(payload, spec.source);
    if (value == null) return [`${spec.label}${WAR_ROOM_NO_DATA_SUFFIX}`, "—", spec.resolved];
    return [spec.label, count(value), spec.resolved];
  });
}
