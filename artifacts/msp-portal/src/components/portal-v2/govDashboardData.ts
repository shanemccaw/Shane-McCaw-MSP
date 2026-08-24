/**
 * govDashboardData.ts — the Governance pillar dashboard fixture.
 *
 * Transcribed verbatim from the prototype: `govAreaLinksRaw` (line 11079), the
 * hero scalars (lines 7269-7287) and the status/tier builder (11946-11988).
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * These are the prototype's fictional figures. The pillar's REAL score already
 * flows through `usePortalV2Pillars` on the overview and the generic pillar
 * page; this dashboard is the design's own composition, and swapping these for
 * live values is Phase 3 work. Keeping them in one module is what makes that a
 * single-file change — the same rule the build plan states for every fixture.
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
  { key: "governance-guests", label: "Guest Access Governance", score: 34, prevScore: 21, sub: "guests, up from 21", icon: "users", cluster: "Identity & Ownership", weight: "large", status: "yellow" },
  { key: "governance-group-owners", label: "Group Ownership Governance", score: 26, prevScore: 26, sub: "groups need an owner", icon: "key", cluster: "Identity & Ownership", weight: "medium", status: "red" },
  { key: "governance-team-owners", label: "Team Ownership Governance", score: 6, prevScore: 8, sub: "teams need an owner", icon: "key", cluster: "Identity & Ownership", weight: "small", status: "yellow" },
  { key: "governance-orphaned-groups", label: "Orphaned Groups", score: 11, prevScore: 9, sub: "no active members", icon: "users", cluster: "Identity & Ownership", weight: "small", status: "red" },
  { key: "governance-orphaned-teams", label: "Orphaned Teams", score: 5, prevScore: 5, sub: "no active members", icon: "users", cluster: "Identity & Ownership", weight: "small", status: "yellow" },
  { key: "governance-app-access", label: "App Governance", score: 14, prevScore: 12, sub: "apps, service principals", icon: "clipboard-list", cluster: "Apps & Roles", weight: "large", status: "yellow" },
  { key: "governance-pim", label: "Role Governance (PIM)", score: 4, prevScore: 4, sub: "standing roles, not JIT", icon: "key", cluster: "Apps & Roles", weight: "medium", status: "red" },
  { key: "governance-device-inventory", label: "Device Inventory Governance", score: 212, prevScore: 205, sub: "devices tracked", icon: "smartphone", cluster: "Devices", weight: "small", status: "green" },
  { key: "governance-device-lifecycle", label: "Device Lifecycle Governance", score: 17, prevScore: 14, sub: "past retirement age", icon: "smartphone", cluster: "Devices", weight: "medium", status: "yellow" },
  { key: "governance-device-ownership", label: "Device Ownership Governance", score: 23, prevScore: 19, sub: "no assigned owner", icon: "smartphone", cluster: "Devices", weight: "medium", status: "red" },
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

/**
 * Per-card derived values for the area tiles — the current design's card builder
 * (`Customer Portal Shell.dc.html` 13847-13878). The earlier revision rendered a
 * plain card; the current one carries a tier-scaled delta chip that always prints
 * (`±0` when flat, coloured by direction unless the area is green) and a four-bar
 * sparkline interpolated from `prevScore → score`. Structurally identical to
 * Compliance's `cmpAreaGeometry`; kept in the Governance module so the card's
 * numbers stay in one place per the fixture rule.
 */
export function govAreaGeometry(tile: GovAreaLink) {
  const meta = GOV_STATUS_META[tile.status];
  const delta = tile.score - tile.prevScore;
  const deltaColor =
    tile.status === "green" ? "#64748b" : delta > 0 ? "#f87171" : delta < 0 ? "#34d399" : "#64748b";
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
  const sparkVals = Array.from(
    { length: 4 },
    (_, i) => tile.prevScore + (tile.score - tile.prevScore) * (i / 3),
  );
  const sMin = Math.min(...sparkVals);
  const sMax = Math.max(...sparkVals, sMin + 1);
  const sparkBars = sparkVals.map((v, i) => ({
    height: Math.max(3, Math.round(((v - sMin) / (sMax - sMin)) * 16)),
    opacity: i === 3 ? 1 : 0.4,
  }));
  return { meta, deltaText, deltaColor, sparkBars };
}
