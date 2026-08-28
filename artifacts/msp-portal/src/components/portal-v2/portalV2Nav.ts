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
 *  Runbooks; Operate carries Remediation Tracker and Policy Decisions, which
 *  arrived with Part 5. My Architect and Copilot sit above / after the Pillars group and
 *  arrived with Part 9; Projects (Part 8) shares the ungrouped region beside My
 *  Architect and arrived with Part 8. An absent row is absent because its page
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

import { Bell, CheckCircle, ClipboardList, FileText, GitCommit, PlayCircle, Scale, ShieldCheck, ShieldOff, Sparkles, Users } from "lucide-react";
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

/**
 * One segment of a rich sub-item's stacked bar — prototype shared sub-nav
 * template (shell 184-188). `flex` is the segment's own count: the bar is a
 * flex row of `flex:<n> 0 0` spans, so a segment's width is its share of the
 * total and a zero segment collapses. `dim` marks a segment whose opacity drops
 * when the sub-item is inactive (Microsoft Changes dims every segment; the
 * Remediation phase bar dims only its filled segment and leaves the slate
 * remainder solid).
 */
export interface NavSubBar {
  readonly flex: number;
  readonly color: string;
  readonly dim?: boolean;
}

/**
 * The Round Four rich sub-nav treatment — the stacked bar, count, range and
 * one-line note the shell draws under an active Microsoft Changes wave or
 * Remediation phase (shell 169-194, enrichment 18038-18062 / 21066-21088).
 * Absent on a plain text sub-item (Change Control, Ownership, SOPs), which keeps
 * the simple `↳` + label row.
 */
export interface NavSubRich {
  /** Right-aligned total on the header row — a wave's "35", a phase's "2/3". */
  readonly count: string;
  /** The landing range / target line under the header — "Target 12 August". */
  readonly range: string;
  /** The stacked bar, left→right. */
  readonly bars: readonly NavSubBar[];
  /** The one-line note under the bar — "5 tasks open · On Track". */
  readonly meta: string;
  /**
   * The note's colour. Fixed by content in the design, NOT by active state — a
   * wave with a breaking change reads red whether or not it is selected.
   */
  readonly metaTone: string;
  /** The count's colour when active (inactive is always `#475569`). */
  readonly countToneActive: string;
  /** A dimmed segment's opacity when inactive — MSC `.6`, Remediation `.7`. */
  readonly barInactiveOpacity: number;
  /**
   * True for Remediation phases: clicking the active phase clears the filter
   * (shell 9141, `rtPhaseSel: … === sb.key ? null : sb.key`). Microsoft Changes
   * waves do NOT toggle — there is always exactly one selected wave.
   */
  readonly toggle?: boolean;
}

export interface NavSubItem {
  key: string;
  label: string;
  href: string;
  /** The rich Round Four treatment; absent leaves the plain text sub-row. */
  rich?: NavSubRich;
}

/**
 * A badge whose text is fixed in the design rather than fetched live. The
 * `"holds"` / `"pii-exposed"` tokens, by contrast, name a badge the shell
 * resolves at runtime from a hook. `urgent` omitted renders the quiet grey
 * treatment the design uses for this badge; set it true only for the blue "a
 * decision is waiting" styling.
 */
export interface NavStaticBadge {
  readonly label: string;
  readonly urgent?: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  /** The `title` attribute. Copy is final — reproduce the design's verbatim. */
  title: string;
  testId: string;
  glyph: NavGlyph;
  /**
   * The badge on this row, if any. `"holds"` and `"pii-exposed"` each name a
   * LIVE badge the shell resolves from a hook — Active Runbooks' hold count
   * and PII Governance's real High-severity finding count (Git #1438;
   * `usePiiExposedBadge`) respectively — while a `NavStaticBadge` carries text
   * genuinely fixed in the design. Badges are RARE on purpose: the handoff
   * README calls the nav badge "the single place in the nav that says a
   * decision is waiting", so adding one is a design decision, not a detail.
   * Only `plain` groups render it.
   */
  badge?: "holds" | "pii-exposed" | NavStaticBadge;
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
 * The seven Remediation Tracker phases as rich sub-nav items — the design's own
 * default bar values (shell `PH` 20681-20689, enrichment 21066-21088). Status →
 * colour is the design's exact map (21074): Complete `#34d399`, At Risk
 * `#fbbf24`, Blocked `#f87171`, everything else (On Track) `#60a5fa`. `count`,
 * `range` and `meta` are the phase's default done/total, target date and
 * open-tasks line; `bars` is the two-segment fill (status colour) over slate
 * remainder. These are STATIC fixture for the shell pass — the design computes
 * them live from the tracker, which the data-wiring pass owns.
 */
const RT_STATUS_COLOR: Readonly<Record<string, string>> = {
  Complete: "#34d399",
  "At Risk": "#fbbf24",
  Blocked: "#f87171",
  "On Track": "#60a5fa",
};

function remediationPhaseSub(
  key: string,
  label: string,
  due: string,
  status: string,
  done: number,
  total: number,
): NavSubItem {
  const color = RT_STATUS_COLOR[status] ?? "#60a5fa";
  const pct = Math.round((done / total) * 100);
  const open = total - done;
  const meta =
    status === "Complete"
      ? "Phase complete"
      : `${open} ${open === 1 ? "task" : "tasks"} open · ${status}`;
  return {
    key,
    label,
    href: `/portal-v2/remediation/${key}`,
    rich: {
      count: `${done}/${total}`,
      range: `Target ${due}`,
      bars: [
        { flex: pct, color, dim: true },
        { flex: 100 - pct, color: "rgba(148,163,184,.16)" },
      ],
      meta,
      metaTone: color,
      countToneActive: color,
      barInactiveOpacity: 0.7,
      toggle: true,
    },
  };
}

const REMEDIATION_PHASE_SUBS: readonly NavSubItem[] = [
  remediationPhaseSub("discovery", "Discovery", "12 August", "Complete", 2, 3),
  remediationPhaseSub("stabilization", "Stabilization", "26 August", "On Track", 0, 5),
  remediationPhaseSub("baseline", "Baseline", "9 September", "At Risk", 2, 4),
  remediationPhaseSub("hardening", "Hardening", "30 September", "On Track", 1, 4),
  remediationPhaseSub("copilot", "Copilot Readiness", "21 October", "Blocked", 1, 4),
  remediationPhaseSub("drift", "Drift Cleanup", "4 November", "On Track", 0, 4),
  remediationPhaseSub("identity", "Identity Hygiene", "18 November", "On Track", 1, 7),
];

/**
 * Operate — prototype 8810-8820. Icon names are the prototype's own, resolved
 * against the installed `lucide-react` rather than assumed: `git-commit` →
 * `GitCommit`, `check-circle` → `CheckCircle`, `file-text` → `FileText`.
 *
 * The design's Operate group is Change Control, Active Runbooks, Remediation
 * Tracker, Policy Decisions — in that order. Remediation Tracker and Policy
 * Decisions arrived with Part 5.
 *
 * POLICY DECISIONS' NAV BADGE IS DEFERRED, DELIBERATELY. The design draws a
 * "N due" badge on this row (prototype 8820: `cmpPolicyDue ? cmpPolicyDue + '
 * due' : ''`, currently "2 due" — the due + expired count). The shell renders a
 * nav badge only for `badge === "holds"` (PortalV2Shell.tsx line 187, fed by
 * the `useHoldBadge` hook); a second badge type needs a shell render path this
 * part must not add. So the row carries no badge and the same due/expired count
 * is surfaced ON the page, in its own state counters — the same call Part 9 made
 * for the Copilot nav pill. The count itself is `pdFlaggedCount` in
 * policyDecisionsModel.ts, ready for the shell owner to wire.
 */
const OPERATE_ITEMS: readonly NavItem[] = [
  {
    href: "/portal-v2/change-control",
    label: "Change Control",
    title:
      "Change Control — every tenant change with a request, an approval and a rollback point",
    testId: "pv2-nav-change-control",
    glyph: { kind: "lucide", icon: GitCommit },
    // The design's own view tabs (Change Control.dc.html viewTabs), each a real
    // URL. "Briefing" is the module root, so it lights on /change-control and
    // /change-control/all the same way Ownership's "Everything" does. Round Two
    // removed "Policy & settings" from this sub-nav (the policy UI now lives in
    // the Settings page), but the module keeps a deep-linkable policy view at
    // /portal-v2/change-control/settings that the header badge and alerts
    // target — it is intentionally NOT a sub-item here.
    subs: [
      { key: "briefing", label: "Briefing", href: "/portal-v2/change-control" },
      { key: "register", label: "Register", href: "/portal-v2/change-control/register" },
      { key: "catalogue", label: "Catalogue", href: "/portal-v2/change-control/catalogue" },
      { key: "calendar", label: "Freezes & notices", href: "/portal-v2/change-control/calendar" },
      { key: "review", label: "Change review", href: "/portal-v2/change-control/review" },
    ],
  },
  {
    href: "/portal-v2/runbooks",
    label: "Active Runbooks",
    title: "Active Runbooks — procedures in progress, including hold windows",
    testId: "pv2-nav-runbooks",
    glyph: { kind: "lucide", icon: PlayCircle },
    badge: "holds",
  },
  {
    href: "/portal-v2/remediation",
    label: "Remediation Tracker",
    title: "Remediation Tracker — findings being closed, and what closed them",
    testId: "pv2-nav-remediation",
    glyph: { kind: "lucide", icon: CheckCircle },
    // Round Four: the seven phases live in the left nav, drawn with the rich
    // sub-nav treatment (a two-segment status bar, a done/total count, its
    // target date and a "N tasks open · <status>" line) — the same pattern the
    // Microsoft Changes waves use below, and the pattern the README says the
    // phases now follow. Each phase is a real URL that filters the tracker;
    // clicking the active phase clears the filter (`toggle`). The bar values are
    // the design's own defaults (shell 21066-21088); computing them live off the
    // real tracker is the second, data-wiring pass — this pass is the shell.
    subs: REMEDIATION_PHASE_SUBS,
  },
  {
    href: "/portal-v2/policy-decisions",
    label: "Policy Decisions",
    title:
      "Policy Decisions — gaps you have decided to live with, with an owner and a review date",
    testId: "pv2-nav-policy-decisions",
    glyph: { kind: "lucide", icon: FileText },
  },
];

/**
 * Governance — Round Three's regroup split the old "Standards & risk"
 * catch-all into Governance and Reference, in the order Operate / Governance /
 * Reference / Library.
 *
 * The design's group is Ownership, Risk Register, Security Plan, PII
 * Governance — all four present. Security Plan and PII Governance arrived with
 * Part 7; PII carries a live "N exposed" nav badge (Git #1438), sourced from
 * the tenant's real High-severity PII findings rather than the design's fixed
 * "3 exposed" — see `usePiiExposedBadge`.
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
  // Security Plan and PII Governance — prototype 8834-8835, added with Part 7,
  // in the design's group order (after Risk Register). Icons are the
  // prototype's own: `shield-check` → ShieldCheck, `scale` → Scale.
  {
    href: "/portal-v2/security-plan",
    label: "Security Plan",
    title: "Security Plan — the authoritative record of how this tenant must be run",
    testId: "pv2-nav-security-plan",
    glyph: { kind: "lucide", icon: ShieldCheck },
  },
  {
    href: "/portal-v2/pii",
    label: "PII Governance",
    title: "PII Governance — where personal data lives, who can reach it, and what moved",
    testId: "pv2-nav-pii",
    glyph: { kind: "lucide", icon: Scale },
    // Git #1438: was the design's fixed "3 exposed" (`piiNavBadge`, shell
    // 8807/8835) — a count of Public/External-reachable locations that has no
    // real backing (`piiModel.ts`'s `piiExposedCount` reads only the design
    // fixture, `piiData.ts`; the live page dropped that dimension entirely
    // once wired to real data). Now resolved LIVE by `usePiiExposedBadge` from
    // the tenant's real High-severity PII findings, and omitted entirely (not
    // "0 exposed") when there are none or nothing has scanned yet.
    badge: "pii-exposed",
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
/**
 * The five Microsoft Changes waves as rich sub-nav items — the design's own
 * default bar values (Microsoft Changes.dc.html wave nav, shell enrichment
 * 18038-18062). The stacked bar's four segments are breaks `#f87171`, decide
 * `#fbbf24`, verify `#a78bfa`, informational `#475569`; each segment's flex is
 * its own count, so a zero segment collapses. `count` is the wave total,
 * `range` its landing window, `meta` the "what this means" line whose colour is
 * fixed by content (red if anything breaks, amber if a decision is due, else
 * slate). Waves do NOT toggle. Static fixture for the shell pass.
 */
function msChangesWaveSub(
  key: string,
  label: string,
  href: string,
  breaks: number,
  decide: number,
  verify: number,
  informational: number,
  range: string,
  meta: string,
): NavSubItem {
  const total = breaks + decide + verify + informational;
  const metaTone = breaks > 0 ? "#f87171" : decide > 0 ? "#fbbf24" : "#475569";
  return {
    key,
    label,
    href,
    rich: {
      count: String(total),
      range,
      bars: [
        { flex: breaks, color: "#f87171", dim: true },
        { flex: decide, color: "#fbbf24", dim: true },
        { flex: verify, color: "#a78bfa", dim: true },
        { flex: informational, color: "#475569", dim: true },
      ],
      meta,
      metaTone,
      countToneActive: "#93c5fd",
      barInactiveOpacity: 0.6,
    },
  };
}

const MS_CHANGES_WAVE_SUBS: readonly NavSubItem[] = [
  msChangesWaveSub("late-august", "Late August wave", "/portal-v2/ms-changes", 0, 1, 5, 29, "Landing 24 Aug – 6 Sep", "1 needs a decision"),
  msChangesWaveSub("september", "September wave", "/portal-v2/ms-changes/september", 2, 6, 12, 60, "Landing 7 Sep – 4 Oct", "2 stop something working"),
  msChangesWaveSub("q2", "Q2 · Oct – Dec", "/portal-v2/ms-changes/q2", 1, 4, 15, 80, "The quarter after this one", "1 stops something working"),
  msChangesWaveSub("q3", "Q3 · Jan – Mar", "/portal-v2/ms-changes/q3", 0, 1, 5, 39, "Early next year", "1 needs a decision"),
  msChangesWaveSub("beyond", "Q4 and beyond", "/portal-v2/ms-changes/beyond", 0, 0, 2, 20, "Announced, no firm date", "nothing breaks here"),
];

const REFERENCE_ITEMS: readonly NavItem[] = [
  // SOPs & Runbooks — prototype 8838, added with Part 6, first in the Reference
  // group (before Microsoft Changes) as the design orders it. Icon is the
  // prototype's own `clipboard-list`. The three subs are the design's own hub
  // sub-views (shell 8839-8841), each a real URL: Library is the module root, so
  // it lights on /portal-v2/sops the way Ownership's "Everything" lights on its
  // root. The four sop-* category keys (shell 8789) are NOT nav rows — the design
  // reaches them from the command palette, not the left nav.
  {
    href: "/portal-v2/sops",
    label: "SOPs & Runbooks",
    title: "SOPs & Runbooks — the procedure library, ours and yours",
    testId: "pv2-nav-sops",
    glyph: { kind: "lucide", icon: ClipboardList },
    subs: [
      { key: "library", label: "Library", href: "/portal-v2/sops" },
      { key: "queue", label: "Execution queue", href: "/portal-v2/sops/queue" },
      { key: "audit", label: "Execution history", href: "/portal-v2/sops/audit" },
    ],
  },
  {
    href: "/portal-v2/ms-changes",
    label: "Microsoft Changes",
    title: "Microsoft Changes — message centre posts, read against your tenant",
    testId: "pv2-nav-ms-changes",
    glyph: { kind: "lucide", icon: Bell },
    // Round Four: the five waves now carry the rich sub-nav treatment (a stacked
    // breaks/decide/verify/informational bar, the wave total, its landing range,
    // and a one-line "what this means" note) — the design's own default values
    // (Microsoft Changes.dc.html wave nav, shell enrichment 18038-18062). Unlike
    // the Remediation phases these do NOT toggle: there is always exactly one
    // selected wave, and Late August (the module root) is the default. Values
    // are static fixture for the shell pass.
    subs: MS_CHANGES_WAVE_SUBS,
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
 * Projects — the SOW-based delivery page (Part 8). Prototype `topDefs` (shell
 * 8804): the SECOND ungrouped row, drawn with the plain 15px glyph, no group
 * label and no divider — it sits beside My Architect above the Pillars group.
 * The icon is the prototype's own `clipboard-list`. Like My Architect it is its
 * OWN single-item `label: null` group, so the two ungrouped parts never edit
 * the same array entry; the design's topDefs order (retainer, then projects) is
 * kept by placing this group directly after My Architect's below.
 */
const PROJECTS_ITEM: NavItem = {
  href: "/portal-v2/projects",
  label: "Projects",
  title: "Projects",
  testId: "pv2-nav-projects",
  glyph: { kind: "lucide", icon: ClipboardList },
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
  // region as its own sibling `label: null` group, directly after — the
  // prototype's topDefs order is retainer, then projects.
  { label: null, render: "plain", items: [RETAINER_ITEM] },
  { label: null, render: "plain", items: [PROJECTS_ITEM] },
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
