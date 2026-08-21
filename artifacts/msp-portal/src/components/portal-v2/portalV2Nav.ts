/**
 * portalV2Nav.ts — the Customer Portal v2 left nav, as data.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  NEVER A ROW POINTING AT A ROUTE THAT DOES NOT EXIST.
 *
 *  Add a nav entry in the SAME change as the route it points at, never before.
 *  A row that 404s is worse than a missing row: the customer reads it as the
 *  product being broken rather than as the feature not being finished yet.
 *
 *  The design's full nav is larger than this file. Governance is meant to carry
 *  Security Plan and PII Governance; Reference is meant to carry SOPs &
 *  Runbooks; Operate is meant to carry Remediation Tracker and Policy
 *  Decisions. My Architect and Copilot sit above / after the Pillars group and
 *  arrived with Part 9; Projects (Part 8) shares the ungrouped region and is
 *  still absent because its page is. An absent row is absent because its page
 *  is, not because it was forgotten — see PORTAL_V2_PARALLEL_PLAN.md for which
 *  part builds each.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the nav is a module and not JSX in the shell ──────────────────────
 * Thirteen parts of the portal build run as concurrent agents. Every part that
 * adds a page needs one nav row, and if that row is declared inside
 * `PortalV2Shell.tsx` then every one of them edits the same 1,200-line
 * component and they conflict. Here, a part appends one entry to one array.
 *
 * ── What this file does NOT own ───────────────────────────────────────────
 * Rendering. The shell still draws the nav, and the three visual treatments
 * below are genuinely different in the design, not an abstraction that got
 * away — so a group declares WHICH treatment it wants and the shell keeps the
 * markup:
 *
 *   • `solo`    — one row, no group label. Overview only.
 *   • `pillars` — a 26px coloured identity tile and a right-edge active bar.
 *   • `plain`   — a 15px glyph in an 18px box; the treatment every other row
 *                 uses, and the only one that draws sub-items or a badge.
 *
 * Trying to express the pillar tile and the plain glyph as one parameterised
 * renderer would have meant a component with a flag for every difference,
 * which is harder to read than three explicit branches.
 */

import { Bell, FileText, GitCommit, PlayCircle, ShieldOff, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PILLAR_ICON_PATHS, PILLAR_ORDER } from "@/components/copilot-journey/journeyTokens";

/**
 * Keyed off the ICON MAP, not `PillarKey`. The two differ: `PillarKey` is the
 * six graded pillars, while `PILLAR_ICON_PATHS` also carries `copilot`, which
 * is the glyph Overview uses. Typing this as `PillarKey` rejects Overview.
 */
export type PillarGlyphKey = keyof typeof PILLAR_ICON_PATHS;

/** How a group's rows are drawn. See the header note. */
export type NavRenderKind = "solo" | "pillars" | "plain";

/**
 * A row's icon. Two shapes because the design genuinely uses two: most rows
 * take a lucide glyph, while Overview and the six pillars use the portal's own
 * `PillarGlyph` paths, which are not lucide icons and carry a pillar identity
 * colour with them.
 */
export type NavGlyph =
  | { kind: "lucide"; icon: LucideIcon }
  | { kind: "pillar"; pillar: PillarGlyphKey };

export interface NavSubItem {
  key: string;
  label: string;
  href: string;
}

export interface NavItem {
  href: string;
  label: string;
  /** The `title` attribute. Copy is final — reproduce the design's verbatim. */
  title: string;
  testId: string;
  glyph: NavGlyph;
  /**
   * Which live badge feeds this row, if any. Badges are RARE on purpose: the
   * handoff README calls the nav badge "the single place in the nav that says
   * a decision is waiting", so adding a second one is a design decision, not a
   * detail. Only `plain` groups render it.
   */
  badge?: "holds";
  /**
   * Sub-rows, shown only while this row is active AND the sidebar is expanded.
   * Each is a real URL so the view is linkable.
   */
  subs?: readonly NavSubItem[];
  /**
   * Match the location EXACTLY rather than by prefix. Overview needs it: at
   * `/portal-v2` a prefix match would light it on every page in the portal.
   */
  exact?: boolean;
  /** Pillar rows only — the identity colour for the tile and active bar. */
  primary?: string;
}

export interface NavGroup {
  /** `null` renders no group label and no divider — Overview's case. */
  label: string | null;
  render: NavRenderKind;
  items: readonly NavItem[];
}

/**
 * Overview — prototype 7220-7228. Uses the `copilot` pillar glyph at 18px
 * rather than a lucide icon, and is the only `exact` row in the nav.
 */
const OVERVIEW_ITEM: NavItem = {
  href: "/portal-v2",
  label: "Overview",
  title: "Overview",
  testId: "pv2-nav-overview",
  glyph: { kind: "pillar", pillar: "copilot" },
  exact: true,
};

/**
 * The six pillars — derived from `PILLAR_ORDER` rather than restated, so the
 * nav cannot drift from the pillar taxonomy the rest of the app reads. href
 * and testId are template-derived from the key for the same reason.
 */
const PILLAR_ITEMS: readonly NavItem[] = PILLAR_ORDER.map((p) => ({
  href: `/portal-v2/${p.key}`,
  label: p.label,
  title: p.label,
  testId: `pv2-nav-${p.key}`,
  glyph: { kind: "pillar", pillar: p.key },
  primary: p.primary,
}));

/**
 * Operate — prototype 7232-7236. Icon names are the prototype's own, resolved
 * against the installed `lucide-react` rather than assumed: `git-commit` →
 * `GitCommit`.
 *
 * The design's Operate group also holds Remediation Tracker and Policy
 * Decisions. Both are Part 5.
 */
const OPERATE_ITEMS: readonly NavItem[] = [
  {
    href: "/portal-v2/change-control",
    label: "Change Control",
    title:
      "Change Control — every tenant change with a request, an approval and a rollback point",
    testId: "pv2-nav-change-control",
    glyph: { kind: "lucide", icon: GitCommit },
  },
  {
    href: "/portal-v2/runbooks",
    label: "Active Runbooks",
    title: "Active Runbooks — procedures in progress, including hold windows",
    testId: "pv2-nav-runbooks",
    glyph: { kind: "lucide", icon: PlayCircle },
    badge: "holds",
  },
];

/**
 * Governance — Round Three's regroup split the old "Standards & risk"
 * catch-all into Governance and Reference, in the order Operate / Governance /
 * Reference / Library.
 *
 * The design's group is Ownership, Risk Register, Security Plan, PII
 * Governance. The last two are Part 7.
 *
 * The Risk Register `title` is the prototype's verbatim and it UNDER-DESCRIBES
 * the page: it says "accepted risks", while the register carries all twelve
 * risks across five statuses and defaults its filter to "All statuses". Kept
 * as written, because copy is final.
 */
const GOVERNANCE_ITEMS: readonly NavItem[] = [
  {
    href: "/portal-v2/ownership",
    label: "Ownership",
    title: "Ownership — four names against every service, change, control and freeze",
    testId: "pv2-nav-ownership",
    glyph: { kind: "lucide", icon: Users },
    // The prototype's eight sub-items are the object-type filter — shell 8823.
    subs: [
      { key: "all", label: "Everything", href: "/portal-v2/ownership" },
      { key: "service", label: "Microsoft services", href: "/portal-v2/ownership/service" },
      { key: "change", label: "Individual changes", href: "/portal-v2/ownership/change" },
      { key: "cr", label: "Change requests", href: "/portal-v2/ownership/cr" },
      { key: "control", label: "Compliance controls", href: "/portal-v2/ownership/control" },
      { key: "freeze", label: "Freeze windows", href: "/portal-v2/ownership/freeze" },
      { key: "incident", label: "Incidents", href: "/portal-v2/ownership/incident" },
      { key: "announce", label: "Announcements", href: "/portal-v2/ownership/announce" },
    ],
  },
  {
    href: "/portal-v2/risk-register",
    label: "Risk Register",
    title: "Risk Register — accepted risks, with the owner and the review date",
    testId: "pv2-nav-risk-register",
    glyph: { kind: "lucide", icon: ShieldOff },
  },
];

/**
 * Reference — the other half of Round Three's split. The design's group is
 * SOPs & Runbooks and Microsoft Changes; the former is Part 6.
 *
 * The wave sub-items are the prototype's own (shell 8843), whose keys are
 * INDEX STRINGS — '0' … '4'. They become readable slugs here, because
 * "/portal-v2/ms-changes/2" is a worse link than ".../q2" for something a
 * customer is meant to send to a colleague. The labels are verbatim.
 */
const REFERENCE_ITEMS: readonly NavItem[] = [
  {
    href: "/portal-v2/ms-changes",
    label: "Microsoft Changes",
    title: "Microsoft Changes — message centre posts, read against your tenant",
    testId: "pv2-nav-ms-changes",
    glyph: { kind: "lucide", icon: Bell },
    subs: [
      { key: "late-august", label: "Late August wave", href: "/portal-v2/ms-changes" },
      { key: "september", label: "September wave", href: "/portal-v2/ms-changes/september" },
      { key: "q2", label: "Q2 · Oct – Dec", href: "/portal-v2/ms-changes/q2" },
      { key: "q3", label: "Q3 · Jan – Mar", href: "/portal-v2/ms-changes/q3" },
      { key: "beyond", label: "Q4 and beyond", href: "/portal-v2/ms-changes/beyond" },
    ],
  },
];

/**
 * Library — prototype 7244-7246. Its own group in the prototype's
 * `navGroupDefs`, not part of Operate. The `title` is verbatim, including its
 * "84-document library" claim, which the page itself backs up.
 */
const LIBRARY_ITEMS: readonly NavItem[] = [
  {
    href: "/portal-v2/documents",
    label: "Documents",
    title: "Documents — your deliverables, and the 84-document library",
    testId: "pv2-nav-documents",
    glyph: { kind: "lucide", icon: FileText },
  },
];

/**
 * My Architect — the retainer page (Part 9). Prototype `topDefs` (shell 8803):
 * an UNGROUPED row above the Pillars group, drawn with the plain 15px glyph, no
 * group label and no divider. Projects (Part 8) shares this ungrouped region
 * and sits beside it; each part adds its OWN single-item `label: null` group,
 * which renders identically to one shared group but keeps two concurrent parts
 * from editing the same array entry. The icon is the prototype's own `users`.
 */
const RETAINER_ITEM: NavItem = {
  href: "/portal-v2/retainer",
  label: "My Architect",
  title: "My Architect",
  testId: "pv2-nav-retainer",
  glyph: { kind: "lucide", icon: Users },
};

/**
 * Copilot — the readiness verdict page (Part 9), and the ONLY surface for the
 * Copilot gate now the rebuilt Overview has no gate band. Prototype 133-143: a
 * STANDALONE row after the Pillars group, drawn with a 26px cyan identity tile
 * — the `pillars` render treatment — rather than the plain glyph. `primary` is
 * the design's `#22D3EE`.
 *
 * The design also draws a live "41 / 82" gate pill on this row. The shell has
 * no render path for a nav pill and it belongs to another part this wave, so
 * the row carries the cyan Copilot identity and the gate number lives in full
 * on the page itself (portal-v2-copilot.tsx, from `COPILOT_GATE_TARGET`). The
 * pill is the one nav detail deferred to the shell owner rather than added by
 * editing a file this part must not touch.
 */
const COPILOT_ITEM: NavItem = {
  href: "/portal-v2/copilot",
  label: "Copilot",
  title: "Copilot",
  testId: "pv2-nav-copilot",
  glyph: { kind: "lucide", icon: Sparkles },
  primary: "#22D3EE",
};

/**
 * The nav, in render order.
 *
 * Group order is Round Three's: Overview, Pillars, then Operate / Governance /
 * Reference / Library. The design also places My Architect (and Projects, Part
 * 8) ungrouped above Pillars, and Copilot standalone after Pillars; My
 * Architect and Copilot arrive here with Part 9.
 */
export const PORTAL_V2_NAV: readonly NavGroup[] = [
  { label: null, render: "solo", items: [OVERVIEW_ITEM] },
  // My Architect — ungrouped, above Pillars. Projects (Part 8) joins this
  // region as its own sibling `label: null` group.
  { label: null, render: "plain", items: [RETAINER_ITEM] },
  { label: "Pillars", render: "pillars", items: PILLAR_ITEMS },
  // Copilot — standalone after the Pillars group, drawn with the pillar tile
  // treatment in the design's cyan.
  { label: null, render: "pillars", items: [COPILOT_ITEM] },
  { label: "Operate", render: "plain", items: OPERATE_ITEMS },
  { label: "Governance", render: "plain", items: GOVERNANCE_ITEMS },
  { label: "Reference", render: "plain", items: REFERENCE_ITEMS },
  { label: "Library", render: "plain", items: LIBRARY_ITEMS },
];

/**
 * Is this row the current page?
 *
 * Prefix matching is the default so a drill-down keeps its parent lit —
 * `/portal-v2/governance/oversharing` must light Governance. `exact` opts out,
 * and only Overview needs it: at `/portal-v2` a prefix match would light it on
 * every page in the portal. The trailing-slash tolerance is the shell's
 * original behaviour, kept.
 */
export function isNavItemActive(item: NavItem, location: string): boolean {
  if (item.exact) return location === item.href || location === `${item.href}/`;
  return location === item.href || location.startsWith(`${item.href}/`);
}

/**
 * Is this sub-row the current view?
 *
 * A sub-item whose href IS the parent's is the "all"/default view, so it is
 * also active at the explicit `/all` form — which is how Ownership's
 * "Everything" row stays lit on both `/ownership` and `/ownership/all`.
 */
export function isNavSubActive(sub: NavSubItem, parentHref: string, location: string): boolean {
  return (
    location === sub.href || (sub.href === parentHref && location === `${parentHref}/all`)
  );
}
