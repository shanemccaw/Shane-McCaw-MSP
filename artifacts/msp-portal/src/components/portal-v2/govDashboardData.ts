/**
 * govDashboardData.ts — the Governance pillar dashboard fixture.
 *
 * Transcribed verbatim from the prototype: `govAreaLinksRaw` (line 11079), the
 * hero scalars (lines 7269-7287) and the status/tier builder (11946-11988).
 *
 * ── What is WIRED to real data now, and what is still fixture ────────────────
 * The Governance page's HERO is wired to the live war-room-pillars payload
 * (`useLivePillarHero` + pillarDashboardModel): the score ring, the score delta,
 * the 30-day trend sparkline, the severity/status pill, and the hero stat tiles
 * ("Global Administrators" is the real cross-pillar security.globalAdmins count;
 * "Governance Findings" is the real finding total; "Overdue Access Reviews" is a
 * stated gap). `GOV_HERO.score/delta/history/statusLabel/stats` below are now only
 * FALLBACKS used before the payload loads / on an unscored tenant.
 *
 * The 14 `GOV_AREA_LINKS` per-sub-area scores/prevScores/status shipped as a
 * fixture too — confident fake numbers on a never-scanned tenant (#1330). That
 * is now wired: thirteen of the cards have a real, active `monitor_checks`
 * check behind them (ten from #1333; the three Devices cards added #1366 per
 * Shane's confirmed mapping), read live per-card (value + previous-scan delta +
 * derived severity) via `useGovAreaLinksLive` off
 * `GET /api/portal/governance/areas`. The `score`/`prevScore`/`status` fields
 * below are no longer rendered as confident numbers — a card shows its REAL
 * live value or an honest "—". Only "External Sharing Drift" still renders
 * that no-data state unconditionally (a scan-to-scan drift check, blocked on
 * #1287) — see `lib/portal-governance-areas.ts`.
 */

import { trendGeometry } from "./DriftTrend";

export type GovAreaStatus = "red" | "yellow" | "green";

export interface GovAreaLink {
  key: string;
  label: string;
  score: number;
  prevScore: number;
  sub: string;
  icon: string;
  cluster: string;
  weight: string;
  status: GovAreaStatus;
}

/**
 * Status → colour, copy, and TIER. Severity drives size as well as colour: a red
 * area is rendered large and grows 3×, a green one is small and grows 1×, so the
 * grid itself reads as a severity map before any number is read.
 *
 * Note yellow's wash deliberately ignores its own `c` and uses amber
 * #fbbf24/#f59e0b — that is the prototype's own inconsistency, preserved because
 * the alternative is a visibly different gradient from the design.
 */
export const GOV_STATUS_META: Readonly<
  Record<GovAreaStatus, { c: string; label: string; tier: "large" | "medium" | "small"; wash: string }>
> = {
  red: {
    c: "#f87171",
    label: "Not yet addressed",
    tier: "large",
    wash: "linear-gradient(160deg, #f8717112, rgba(15,23,42,.5))",
  },
  yellow: {
    c: "#c2a63d",
    label: "Partially addressed",
    tier: "medium",
    wash: "linear-gradient(135deg, #fbbf2426, #f59e0b14, rgba(15,23,42,.5))",
  },
  green: {
    c: "#34d399",
    label: "Fully covered",
    tier: "small",
    wash: "linear-gradient(160deg, #34d39910, rgba(15,23,42,.5))",
  },
};

/**
 * The card wash/colour/label for a card with NO live scan data (#1333) — a card
 * whose check has never collected for this tenant, or one of the four cards with
 * no backing check at all. Rendered as a muted slate tile at the smallest tier
 * with an honest "No scan data available" label and a "—" in place of a score,
 * so it never reads as a real zero or a fabricated number.
 */
export const GOV_NODATA_META: { c: string; label: string; tier: "small"; wash: string } = {
  c: "#64748b",
  label: "No scan data available",
  tier: "small",
  wash: "linear-gradient(160deg, rgba(100,116,139,.08), rgba(15,23,42,.45))",
};

/** Cluster order — line 11990. */
export const GOV_CLUSTERS: readonly string[] = [
  "Sharing & Collaboration",
  "Identity & Ownership",
  "Apps & Roles",
  "Devices",
];

/** The 14 area tiles, verbatim from `govAreaLinksRaw` (line 11079). */
export const GOV_AREA_LINKS: readonly GovAreaLink[] = [
  { key: "governance-oversharing", label: "Overshared SharePoint", score: 5, prevScore: 3, sub: "sites shared externally", icon: "mail", cluster: "Sharing & Collaboration", weight: "large", status: "red" },
  { key: "governance-public-teams", label: "Public Teams", score: 4, prevScore: 4, sub: "joinable by anyone", icon: "users", cluster: "Sharing & Collaboration", weight: "medium", status: "red" },
  { key: "governance-sharing-drift", label: "External Sharing Drift", score: 3, prevScore: 1, sub: "new shares since last scan", icon: "git-commit", cluster: "Sharing & Collaboration", weight: "small", status: "red" },
  { key: "governance-channels", label: "Channel Governance", score: 12, prevScore: 15, sub: "private/shared flagged", icon: "shield-check", cluster: "Sharing & Collaboration", weight: "small", status: "yellow" },
  { key: "governance-guests", label: "Guest Access Governance", score: 34, prevScore: 21, sub: "guests", icon: "users", cluster: "Identity & Ownership", weight: "large", status: "yellow" },
  { key: "governance-group-owners", label: "Group Ownership Governance", score: 26, prevScore: 26, sub: "groups need an owner", icon: "key", cluster: "Identity & Ownership", weight: "medium", status: "red" },
  { key: "governance-team-owners", label: "Team Ownership Governance", score: 6, prevScore: 8, sub: "teams need an owner", icon: "key", cluster: "Identity & Ownership", weight: "small", status: "yellow" },
  { key: "governance-orphaned-groups", label: "Orphaned Groups", score: 11, prevScore: 9, sub: "no active members", icon: "users", cluster: "Identity & Ownership", weight: "small", status: "red" },
  { key: "governance-orphaned-teams", label: "Orphaned Teams", score: 5, prevScore: 5, sub: "no active members", icon: "users", cluster: "Identity & Ownership", weight: "small", status: "yellow" },
  { key: "governance-app-access", label: "App Governance", score: 14, prevScore: 12, sub: "apps, service principals", icon: "clipboard-list", cluster: "Apps & Roles", weight: "large", status: "yellow" },
  { key: "governance-pim", label: "Role Governance (PIM)", score: 4, prevScore: 4, sub: "standing roles, not JIT", icon: "key", cluster: "Apps & Roles", weight: "medium", status: "red" },
  { key: "governance-device-inventory", label: "Device Inventory Governance", score: 212, prevScore: 205, sub: "devices enrolled", icon: "smartphone", cluster: "Devices", weight: "small", status: "green" },
  { key: "governance-device-lifecycle", label: "Device Lifecycle Governance", score: 17, prevScore: 14, sub: "stale or duplicate records", icon: "smartphone", cluster: "Devices", weight: "medium", status: "yellow" },
  { key: "governance-device-ownership", label: "Device Compliance Governance", score: 23, prevScore: 19, sub: "non-compliant devices", icon: "smartphone", cluster: "Devices", weight: "medium", status: "red" },
];

/** Hero scalars — lines 7270-7287, 11383-11384, 17973, 18006-18007. */
export const GOV_HERO = {
  score: 62,
  delta: "-4 this month",
  history: [70, 71, 69, 67, 68, 66, 65, 63, 64, 62],
  globalAdmins: 6,
  findingCount: 7,
  scanNumber: 14,
  fixedSinceScan1: 9,
  lastScan: "2 hours ago",
  nextScan: "22 hours",
  riskAccepted: 1,
  /**
   * The three hero stat tiles. Labels are stored in Title Case exactly as the
   * prototype writes them (lines 468, 474, 480) — the uppercase appearance comes
   * from `text-transform:uppercase` in the tile style, NOT from the data. Storing
   * them pre-uppercased would bake a presentation decision into the content.
   *
   * Copy is final: "Overdue Access Reviews" (not "Access reviews overdue") and
   * "Governance Findings" (not "Open findings").
   */
  stats: [
    {
      label: "Overdue Access Reviews",
      value: "12",
      sub: "Oldest is 61 days overdue",
      accent: "#14B8A6",
      orbAlpha: "2e",
    },
    {
      label: "Global Administrators",
      value: "6",
      sub: "1 added this week",
      accent: "#3B82F6",
      orbAlpha: "33",
    },
    {
      label: "Governance Findings",
      value: "7",
      sub: "From your latest scan",
      accent: "#8B5CF6",
      orbAlpha: "33",
    },
  ],
  /** Hero card title and subtitle — prototype lines 425-426. */
  title: "Governance Health",
  subtitle: "Governance pillar score from your latest scan",
  /** Status pill — prototype line 429. */
  statusLabel: "Needs attention",
} as const;

/**
 * The sparkline geometry. The prototype writes this IIFE out once per pillar
 * (7271-7282 for Governance, 15656-15666 for Security) byte-identically apart
 * from the history array, so the body now lives in `DriftTrend.trendGeometry`
 * and this is the Governance binding of it. The ±3 headroom pad on the domain is
 * what keeps the line off the frame edge.
 */
export function govTrendGeometry() {
  return trendGeometry(GOV_HERO.history);
}

/** The live per-card values a tile renders from (#1333) — real scan data, or a null value for no-data. */
export interface GovAreaLiveView {
  /** The latest scan's count, or null when the card has no live data. */
  readonly value: number | null;
  /** The previous scan's count, or null when there is no prior scan to delta against. */
  readonly prevValue: number | null;
  /** The derived severity, or null on no-data. */
  readonly status: GovAreaStatus | null;
}

/**
 * Per-card derived values for the area tiles — the current design's card builder
 * (`Customer Portal Shell.dc.html` 13847-13878): a status-coloured icon, a
 * tier-scaled delta chip, and a four-bar sparkline interpolated from
 * `prevValue → value`. Structurally identical to Compliance's `cmpAreaGeometry`;
 * kept in the Governance module so the card's numbers stay in one place per the
 * fixture rule.
 *
 * Now driven by REAL live values (#1333), so it also handles the two states the
 * fixture never had:
 *   • no live data → the muted `GOV_NODATA_META` tile, a "—" value, no delta, no
 *     sparkline (`hasData:false`);
 *   • a first scan with no prior collection → a real value with `deltaText:null`
 *     (no fabricated `±0`) and a flat sparkline.
 * The delta chip is muted on a green area rather than coloured, and prints `±0`
 * only when a genuine prior scan is flat.
 */
export function govAreaLiveGeometry(view: GovAreaLiveView) {
  if (view.value === null || view.status === null) {
    return {
      hasData: false as const,
      meta: GOV_NODATA_META,
      valueText: "—",
      deltaText: null as string | null,
      deltaColor: "#64748b",
      sparkBars: [] as { height: number; opacity: number }[],
    };
  }

  const meta = GOV_STATUS_META[view.status];
  const value = view.value;
  const hasPrev = view.prevValue !== null;
  const delta = hasPrev ? value - (view.prevValue as number) : 0;
  const deltaColor =
    view.status === "green" ? "#64748b" : delta > 0 ? "#f87171" : delta < 0 ? "#34d399" : "#64748b";
  const deltaText = hasPrev ? (delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0") : null;
  const sparkVals = hasPrev
    ? Array.from({ length: 4 }, (_, i) => (view.prevValue as number) + (value - (view.prevValue as number)) * (i / 3))
    : Array.from({ length: 4 }, () => value);
  const sMin = Math.min(...sparkVals);
  const sMax = Math.max(...sparkVals, sMin + 1);
  const sparkBars = sparkVals.map((v, i) => ({
    height: Math.max(3, Math.round(((v - sMin) / (sMax - sMin)) * 16)),
    opacity: i === 3 ? 1 : 0.4,
  }));
  return { hasData: true as const, meta, valueText: String(value), deltaText, deltaColor, sparkBars };
}

/**
 * The fixture-data adapter kept for `govDashboardData.test.ts` — the design's own
 * `score`/`prevScore`/`status` run through the same geometry the live path uses.
 * The page itself renders from `govAreaLiveGeometry` with real scan data.
 */
export function govAreaGeometry(tile: GovAreaLink) {
  return govAreaLiveGeometry({ value: tile.score, prevValue: tile.prevScore, status: tile.status });
}
