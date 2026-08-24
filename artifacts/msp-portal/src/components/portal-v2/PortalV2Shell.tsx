/**
 * PortalV2Shell.tsx — the Customer Portal chrome.
 *
 * Ported value-for-value from the prototype's shell
 * (`Customer Portal Shell.dc.html` lines 37-272), cross-checked against the
 * README's own Shell spec table. Where the two disagree the PROTOTYPE WINS —
 * see the header note below for the one place they do.
 *
 * ── Why the layout is built this way ────────────────────────────────────────
 * "Nav scrolls, chrome does not" is not a CSS flourish, it is the whole reason
 * the shell is structured as it is:
 *   • the `<aside>` is `position:sticky; top:0; height:100vh` with
 *     `overflow:hidden`,
 *   • its brand block, health bar and collapse footer are all `flex:0 0 auto`,
 *   • only the `<nav>` between them is `flex:1; overflow-y:auto`,
 *   • the content column is `height:100vh; overflow:hidden` so that the
 *     `<main>` inside it is the only thing that scrolls.
 * Getting any one of those wrong makes the whole page scroll as a unit and the
 * header slide away, which is what the README's "Sticky" line is really asking
 * for.
 *
 * ── README vs prototype: one real discrepancy ───────────────────────────────
 * The README's table says the header is "Sticky." The prototype's header is
 * `position:relative; z-index:10` — NOT sticky. It does not need to be: the
 * content column is a fixed-height flex column and `<main>` scrolls inside it,
 * so the header never moves. Implementing `position:sticky` here would be
 * copying the prose over the artefact, which is exactly the failure the
 * Governance pass turned up. The prototype's value is used.
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Plus } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useHoldBadge } from "@/components/portal-v2/holds/useHoldBadge";
import { usePortalV2Pillars } from "@/components/portal-v2/usePortalV2Pillars";
import { tenantHealthSummary, urgentToAlertItems } from "@/components/portal-v2/portalV2Model";
import {
  PORTAL_V2_NAV,
  isNavItemActive,
  isNavSubActive,
  type NavGlyph,
  type NavGroup,
  type NavItem,
  type NavSubItem,
} from "@/components/portal-v2/portalV2Nav";

import {
  PILLAR_ICON_PATHS,
  SEVERITY_ON_DARK,
  hexAlpha,
} from "@/components/copilot-journey/journeyTokens";

// ── The shell's five systems (Part 1) ────────────────────────────────────────
// Every one is UI-only against the design's own fixtures; the palette index,
// ShaneBot replies, hold windows, alerts and knowledge base all live in
// components/portal-v2/shell/ and are wired here.
import { accountDisplay } from "@/components/portal-v2/shell/shellData";
import { useShaneBot } from "@/components/portal-v2/shell/useShaneBot";
import { useSelectionAsk } from "@/components/portal-v2/shell/useSelectionAsk";
import { PaletteOverlay } from "@/components/portal-v2/shell/PaletteOverlay";
import { ShaneBotPanel, ShaneBotLauncher, SelectionChip } from "@/components/portal-v2/shell/ShaneBot";
import { AlertsTrayContent } from "@/components/portal-v2/shell/AlertsTrayContent";
import { AccountMenuContent, NewMenuContent } from "@/components/portal-v2/shell/HeaderMenus";
import { KnowledgeBaseOverlay } from "@/components/portal-v2/shell/KnowledgeBaseOverlay";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { formSpecForNewCreate, type NewCreateKind } from "@/components/portal-v2/newMenuCreate";

import "./portal-v2.css";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** `sidebarWidth: expanded ? '256px' : '76px'` — prototype line 16972. */
const SIDEBAR_EXPANDED = 256;
const SIDEBAR_COLLAPSED = 76;

/**
 * `sidebarWash` / `topBarWash` at the default 'bad' tenant stage
 * (prototype 6909-6915). Both are stage-derived from `stageMeta.flat`, which is
 * `#f87171` at 'bad'; the literal expansions are used here because the stage
 * machinery is not ported.
 */
/**
 * Exported because the prototype gives this exact value a SECOND name,
 * `moduleWash` (19161), and uses it as the page background behind the three
 * imported modules and the Settings page. `sidebarWash = sharedWash` at 8483
 * proves they are one value, so the pages read this constant rather than
 * restating the gradient and letting the two drift.
 */
export const SIDEBAR_WASH =
  "linear-gradient(180deg, #f8717118, #f871710a 55%, #f8717106 100%)";
const TOPBAR_WASH =
  "linear-gradient(90deg, #f8717116, #f8717108 45%, rgba(2,6,23,.9) 100%)";

export function PillarGlyph({
  pillar,
  color,
  size = 14,
}: {
  pillar: keyof typeof PILLAR_ICON_PATHS;
  color: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PILLAR_ICON_PATHS[pillar]} />
    </svg>
  );
}

/** `navItemBaseCss(isActive, color)` — prototype 7185-7194. */
function navItemStyle(isActive: boolean, expanded: boolean): React.CSSProperties {
  return {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: expanded ? "9px 10px" : "9px 0",
    justifyContent: expanded ? "flex-start" : "center",
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    background: isActive ? "rgba(148,163,184,.07)" : "transparent",
    color: isActive ? "#f1f5f9" : "#94a3b8",
    fontSize: "13px",
    fontWeight: 600,
    letterSpacing: "-.005em",
    transition: "background 150ms,color 150ms",
    textDecoration: "none",
    width: "100%",
  };
}

/**
 * A row's glyph. Two shapes because the design uses two — see `NavGlyph` in
 * portalV2Nav.ts. Sizes are the prototype's: 18px for the solo Overview row,
 * 14px inside a pillar's coloured tile, 15px for every plain row.
 */
function NavGlyphIcon({
  glyph,
  size,
  color,
}: {
  glyph: NavGlyph;
  size: number;
  color: string;
}) {
  if (glyph.kind === "pillar") {
    return <PillarGlyph pillar={glyph.pillar} color={color} size={size} />;
  }
  const Icon = glyph.icon;
  return <Icon size={size} color={color} />;
}

/**
 * The `plain` treatment — a 15px glyph in an 18px box (prototype 7185-7194),
 * deliberately different from a pillar row's coloured 26px tile.
 *
 * This renders Operate, Governance, Reference and Library. Operate used to have
 * its own copy of this loop purely because it carries the hold-window badge;
 * the badge is handled here instead, so all four groups share one renderer and
 * a new group is a registry entry rather than another loop.
 */
function PlainNavGroup({
  group,
  location,
  expanded,
  holdBadge,
}: {
  group: NavGroup;
  location: string;
  expanded: boolean;
  holdBadge: ReturnType<typeof useHoldBadge>;
}) {
  return (
    <>
      {group.label !== null && <GroupLabel label={group.label} expanded={expanded} />}
      {group.items.map((item) => {
        const isActive = isNavItemActive(item, location);
        // Badges are rare on purpose — the README calls the nav badge "the
        // single place in the nav that says a decision is waiting". Two shapes:
        // "holds" is resolved LIVE from the hold-window hook; a static badge
        // ({ label, urgent? }) carries text fixed in the design, e.g. PII
        // Governance's "3 exposed". Both render through the one span below.
        const badge = item.badge === "holds" ? holdBadge : (item.badge ?? null);
        return (
          <Fragment key={item.href}>
            <Link
              href={item.href}
              title={item.title}
              data-testid={item.testId}
              style={navItemStyle(isActive, expanded)}
            >
              <span
                style={{
                  flex: "0 0 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <NavGlyphIcon
                  glyph={item.glyph}
                  size={15}
                  color={isActive ? "#60a5fa" : "#94a3b8"}
                />
              </span>
              {expanded && (
                <span
                  style={{
                    flex: 1,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.label}
                </span>
              )}
              {/* Badge when expanded — prototype 7263-7265. */}
              {expanded && badge?.label && (
                <span
                  data-testid={`${item.testId}-badge`}
                  style={{
                    flex: "0 0 auto",
                    padding: "2px 7px",
                    borderRadius: 5,
                    border: `1px solid ${badge.urgent ? "rgba(96,165,250,.5)" : "rgba(148,163,184,.18)"}`,
                    background: badge.urgent ? "rgba(96,165,250,.14)" : "transparent",
                    color: badge.urgent ? "#93c5fd" : "#64748b",
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    fontFamily: MONO,
                  }}
                >
                  {badge.label}
                </span>
              )}
              {/* Collapsed mode shows a 6px dot instead — prototype 7266-7267. */}
              {!expanded && badge?.label && (
                <span
                  data-testid={`${item.testId}-dot`}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 8,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: badge.urgent ? "#60a5fa" : "#475569",
                  }}
                />
              )}
            </Link>
            {item.subs && isActive && expanded && (
              <NavSubItems subs={item.subs} location={location} parentHref={item.href} />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * The `solo` treatment — one row, no group label, an 18px pillar glyph.
 * Overview only, and the only row in the nav matched exactly rather than by
 * prefix (see `isNavItemActive`).
 */
function SoloNavItem({
  item,
  location,
  expanded,
}: {
  item: NavItem;
  location: string;
  expanded: boolean;
}) {
  const isActive = isNavItemActive(item, location);
  return (
    <Link
      href={item.href}
      title={item.title}
      data-testid={item.testId}
      style={navItemStyle(isActive, expanded)}
    >
      <span
        style={{
          flex: "0 0 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <NavGlyphIcon glyph={item.glyph} size={18} color={isActive ? "#f1f5f9" : "#94a3b8"} />
      </span>
      {expanded && (
        <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap" }}>{item.label}</span>
      )}
    </Link>
  );
}

/**
 * The `pillars` treatment — a 26px coloured identity tile (prototype 7210) and
 * a 2px right-edge bar on the active row. Kept as its own renderer because
 * neither belongs on any other group's rows.
 */
function PillarNavGroup({
  group,
  location,
  expanded,
}: {
  group: NavGroup;
  location: string;
  expanded: boolean;
}) {
  return (
    <>
      {group.label !== null && <GroupLabel label={group.label} expanded={expanded} />}
      {group.items.map((item) => {
        const isActive = isNavItemActive(item, location);
        const primary = item.primary ?? "#60a5fa";
        // Compliance's identity colour is near-white, so it takes a dimmer
        // grey when inactive rather than glowing brighter than the active row.
        const iconColor =
          item.glyph.kind === "pillar" && item.glyph.pillar === "compliance" && !isActive
            ? "#cbd5e1"
            : isActive
              ? primary
              : "#94a3b8";
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.title}
            data-testid={item.testId}
            style={navItemStyle(isActive, expanded)}
          >
            {/* tileCss — prototype 7210 */}
            <span
              style={{
                flex: "0 0 26px",
                width: 26,
                height: 26,
                borderRadius: 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: hexAlpha(primary, 0.1),
                border: `1px solid ${primary}33`,
              }}
            >
              <NavGlyphIcon glyph={item.glyph} size={14} color={iconColor} />
            </span>
            {expanded && (
              <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap" }}>{item.label}</span>
            )}
            {isActive && (
              <span
                style={{
                  position: "absolute",
                  right: expanded ? 4 : 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 2,
                  height: 16,
                  borderRadius: 1,
                  background: primary,
                }}
              />
            )}
          </Link>
        );
      })}
    </>
  );
}

/**
 * The sub-nav under an active nav row — prototype 169-178.
 *
 * ── Round Two's "↳" ────────────────────────────────────────────────────────
 * "Sub-nav active-state accent changed from a left vertical bar to a leading
 * `↳` glyph on the active sub-item, across Change Control, Ownership, SOPs and
 * Microsoft Changes sub-navigation."
 *
 * Two things about the artefact are worth stating, because the sentence reads
 * slightly differently from what the markup does:
 *
 *  1. There was nothing to change HERE. The round-one shell has no sub-nav at
 *     all — `grep -c "↳"` on it is 0, and its nav rows carry no `subs`. So this
 *     is the sub-nav's first appearance in this build, drawn to the new spec
 *     rather than converted from a bar.
 *  2. The glyph is NOT the active indicator. Prototype 175 renders `↳` on
 *     EVERY sub-item unconditionally, at 11px `#475569`; what changes when a
 *     sub-item is active is its row — a `rgba(0,120,212,.5)` border, a
 *     `rgba(0,120,212,.12)` wash, and the label going 800/`#f8fafc`. Both are
 *     reproduced as written; drawing the glyph only on the active row would
 *     look like the changelog's sentence and not like the design.
 *
 * `subsVisible: !!o.subs && isActive && expanded` (8872) is why this renders
 * only under the active parent and only when the sidebar is open — a collapsed
 * 76px rail has no room for it.
 */
function NavSubItems({
  subs,
  location,
  parentHref,
}: {
  subs: readonly NavSubItem[];
  location: string;
  parentHref: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 0 6px" }}>
      {subs.map((sb) => {
        // The bare parent path IS the "all" sub-item, so it is active both at
        // "/…/ownership" and at "/…/ownership/all" — see isNavSubActive.
        const on = isNavSubActive(sb, parentHref, location);
        // Round Four toggle (Remediation phases only): clicking the active phase
        // clears the filter — the prototype does it as `sel === key ? null : key`
        // (shell 9141); with URL-as-state that means the active row links back to
        // the module root. Waves do not toggle, so this is a no-op for them.
        const href = sb.rich?.toggle && on ? parentHref : sb.href;
        return (
          <Link
            key={sb.key}
            href={href}
            title={sb.label}
            data-testid={`pv2-subnav-${sb.key}`}
            aria-current={on ? "page" : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              width: "100%",
              textAlign: "left",
              padding: "8px 10px 9px 20px",
              borderRadius: 8,
              border: `1px solid ${on ? "rgba(0,120,212,.5)" : "transparent"}`,
              background: on ? "rgba(0,120,212,.12)" : "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textDecoration: "none",
            }}
          >
            {/* Header row: ↳ + label on the left, the rich count on the right. */}
            <span
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
                width: "100%",
              }}
            >
              <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                <span style={{ flex: "0 0 auto", fontSize: "11px", color: "#475569", lineHeight: 1 }}>
                  ↳
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: on ? 800 : 600,
                    color: on ? "#f8fafc" : "#94a3b8",
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {sb.label}
                </span>
              </span>
              {sb.rich && (
                <span
                  style={{
                    flex: "0 0 auto",
                    fontSize: "10px",
                    fontWeight: 800,
                    fontFamily: MONO,
                    color: on ? sb.rich.countToneActive : "#475569",
                  }}
                >
                  {sb.rich.count}
                </span>
              )}
            </span>

            {/* The rich body — range, the stacked bar, the one-line note. */}
            {sb.rich && <RichSubBody rich={sb.rich} on={on} />}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The Round Four rich sub-nav body — prototype shared template lines 182-190. A
 * range line, a stacked bar (each segment `flex:<n> 0 0`, so its width is its
 * share of the total and a zero segment collapses), and the note. Dimmed
 * segments drop to the design's inactive opacity when the row is not selected;
 * the note colour is fixed by content, not by active state.
 */
function RichSubBody({
  rich,
  on,
}: {
  rich: NonNullable<NavSubItem["rich"]>;
  on: boolean;
}) {
  return (
    <>
      <span style={{ fontSize: "9.5px", color: on ? "#93c5fd" : "#64748b" }}>{rich.range}</span>
      <div
        style={{
          display: "flex",
          gap: 2,
          height: 4,
          borderRadius: 2,
          overflow: "hidden",
          width: "100%",
        }}
      >
        {rich.bars.map((bar, i) => (
          <span
            key={i}
            style={{
              flex: `${bar.flex} 0 0`,
              background: bar.color,
              opacity: bar.dim ? (on ? 1 : rich.barInactiveOpacity) : 1,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: "9.5px", fontWeight: 600, color: rich.metaTone }}>{rich.meta}</span>
    </>
  );
}

function GroupLabel({ label, expanded }: { label: string; expanded: boolean }) {
  if (!expanded) {
    // Collapsed mode replaces each label with a 1px divider — prototype 127-129.
    return (
      <div
        style={{
          height: 1,
          background: "rgba(148,163,184,.1)",
          margin: "10px 6px 8px",
        }}
      />
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 10px 6px" }}>
      <span
        style={{
          fontSize: "9.5px",
          fontWeight: 700,
          color: "#475569",
          letterSpacing: ".12em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {/* The hairline runs from the label to the panel edge. */}
      <span style={{ flex: 1, height: 1, background: "rgba(148,163,184,.09)" }} />
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
  badge,
  testId,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
  badge?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      data-testid={testId}
      style={{
        position: "relative",
        flex: "0 0 34px",
        width: 34,
        height: 34,
        borderRadius: 5,
        border: "1px solid rgba(148,163,184,.16)",
        background: "#0b1a2e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "#94a3b8",
      }}
    >
      {children}
      {badge}
    </button>
  );
}

export function PortalV2Shell({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  const [location, navigate] = useLocation();
  const { user, logout, fetchWithAuth } = useAuth();
  const account = accountDisplay(user);
  const [expanded, setExpanded] = useState(true);
  // The portal's ONE form primitive, hosted here so a New-menu "New X" opens it on
  // any portal-v2 page. Its onSubmit does the real POST — see newMenuCreate.ts.
  const { openForm, formElement } = useFormDrawer();
  // The three header dropdowns are mutually exclusive — the prototype closes the
  // others whenever one opens (shell 7407-7449).
  const [openMenu, setOpenMenu] = useState<null | "new" | "alerts" | "account">(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [kb, setKb] = useState<{ open: boolean; articleId: string | null }>({ open: false, articleId: null });
  const holdBadge = useHoldBadge();
  // The tray's "Smart alerts" section — real findings, same `urgent` ranking
  // the Overview's Most Urgent list uses (see portalV2Model.ts). The shell
  // fetches its own copy so the tray is correct from whichever page it opens
  // on, not only pages that happen to already call this hook.
  const { view: alertsView, loaded: alertsLoaded } = usePortalV2Pillars();
  const alertItems = useMemo(() => urgentToAlertItems(alertsView.urgent), [alertsView.urgent]);
  // Sidebar "Tenant health" bar — same six real pillar scores, no second fetch.
  const tenantHealth = useMemo(() => tenantHealthSummary(alertsView), [alertsView]);

  const shaneBot = useShaneBot();
  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    setOpenMenu(null);
  }, []);
  // ⌘K with a selection asks ShaneBot; ⌘K with none opens the palette. The chip
  // is placed once at the selection and never follows the pointer (README §2).
  const selection = useSelectionAsk(shaneBot.askShane, openPalette);

  /** Navigate and close every transient shell surface. */
  const go = useCallback(
    (href: string) => {
      setOpenMenu(null);
      setPaletteOpen(false);
      setKb({ open: false, articleId: null });
      navigate(href);
    },
    [navigate],
  );

  const openKb = useCallback((articleId: string | null) => {
    setKb({ open: true, articleId });
    setOpenMenu(null);
    setPaletteOpen(false);
  }, []);

  /** A New-menu item that has a real backend opens its create form here. */
  const handleCreate = useCallback(
    (kind: NewCreateKind) => {
      setOpenMenu(null);
      openForm(
        formSpecForNewCreate(kind, {
          fetchWithAuth,
          onError: (message) =>
            // The FormDrawer has already flipped to its optimistic done panel; a
            // real failure is logged rather than silently swallowed.
            console.error("New-menu create failed:", message),
        }),
      );
    },
    [openForm, fetchWithAuth],
  );

  // Close any open header dropdown on an outside click — prototype 7441-7449.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el && el.closest && el.closest("[data-pv2-menu]")) return;
      setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openMenu]);

  const isOverview = location === "/portal-v2" || location === "/portal-v2/";

  return (
    <div className="pv2-root" style={{ minHeight: "100vh", display: "flex", background: "#020617" }}>
      {/* ── Sidebar — prototype 39-156 ──────────────────────────────────── */}
      <aside
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          width: expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED,
          flex: `0 0 ${expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED}px`,
          background: SIDEBAR_WASH,
          // The prototype is explicit: border-right:none. The panel is separated
          // from the content by its wash, not by a rule.
          borderRight: "none",
          display: "flex",
          flexDirection: "column",
          transition: "width 200ms ease,flex-basis 200ms ease",
          overflow: "hidden",
        }}
        data-testid="pv2-sidebar"
        data-expanded={expanded ? "true" : "false"}
      >
        {/* Brand lockup — 64px tall, two-line wordmark */}
        <div
          style={{
            height: 64,
            flex: "0 0 64px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 18px",
            borderBottom: "1px solid rgba(148,163,184,.1)",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "linear-gradient(135deg,#0078D4,#00B4D8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: 800,
              letterSpacing: "-.02em",
              color: "#fff",
              flex: "0 0 32px",
            }}
          >
            SM
          </div>
          {expanded && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                lineHeight: 1.15,
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  fontSize: "13.5px",
                  fontWeight: 700,
                  color: "#f8fafc",
                  letterSpacing: "-.01em",
                }}
              >
                Shane McCaw
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "#64748b",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                }}
              >
                Consulting
              </span>
            </div>
          )}
        </div>

        {/* Tenant health bar — prototype 51-61 */}
        <div
          style={{
            padding: "12px 18px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            borderBottom: "1px solid rgba(148,163,184,.1)",
          }}
        >
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: "rgba(148,163,184,.12)",
              overflow: "hidden",
            }}
          >
            <div
              data-testid="pv2-tenant-health-bar-fill"
              style={{
                width: `${tenantHealth.score ?? 0}%`,
                height: "100%",
                borderRadius: 2,
                background: tenantHealth.severity ? SEVERITY_ON_DARK[tenantHealth.severity] : "#64748b",
              }}
            />
          </div>
          {expanded && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Tenant health
              </span>
              <span
                data-testid="pv2-tenant-health-score"
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  color: "#94a3b8",
                  fontFamily: MONO,
                }}
              >
                {tenantHealth.score === null ? "—" : tenantHealth.score} · {tenantHealth.label}
              </span>
            </div>
          )}
        </div>

        {/* Nav — the ONLY scrolling region in the sidebar */}
        <nav
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "14px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
          data-testid="pv2-nav"
        >
          {/*
            ── The nav, rendered from the registry ──────────────────────────
            Every row lives in portalV2Nav.ts, and a group declares which of the
            three visual treatments it wants. This loop is the whole nav: adding
            a page means appending one entry to that module rather than editing
            this component, which is what lets the remaining parts of the portal
            build run as concurrent agents without colliding here.
          */}
          {PORTAL_V2_NAV.map((group) => {
            const key = group.label ?? group.items[0]?.href ?? group.render;
            if (group.render === "solo") {
              return group.items.map((item) => (
                <SoloNavItem key={item.href} item={item} location={location} expanded={expanded} />
              ));
            }
            if (group.render === "pillars") {
              return (
                <PillarNavGroup key={key} group={group} location={location} expanded={expanded} />
              );
            }
            return (
              <PlainNavGroup
                key={key}
                group={group}
                location={location}
                expanded={expanded}
                holdBadge={holdBadge}
              />
            );
          })}
        </nav>

        {/* Collapse toggle — prototype 148-155. `panel-left` glyph. */}
        <div
          style={{
            padding: 10,
            borderTop: "1px solid rgba(148,163,184,.1)",
            flex: "0 0 auto",
          }}
        >
          <button
            onClick={() => setExpanded((v) => !v)}
            data-testid="pv2-collapse-toggle"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: expanded ? "flex-start" : "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 5,
              border: "1px solid rgba(148,163,184,.14)",
              background: "transparent",
              color: "#94a3b8",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <span style={{ flex: "0 0 15px", display: "flex" }}>
              {/* iconSvg('panel-left') — prototype 6355 */}
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </span>
            {expanded && <span style={{ whiteSpace: "nowrap" }}>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Content column — fixed height so only <main> scrolls ───────── */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        {/* Header — prototype 160. relative + z-10, NOT sticky (see file note). */}
        <header
          style={{
            position: "relative",
            zIndex: 10,
            height: 64,
            flex: "0 0 64px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 24px",
            background: TOPBAR_WASH,
            backdropFilter: "blur(8px)",
          }}
          data-testid="pv2-header"
        >
          {/* Search trigger — a trigger, not an input. max-width 280px.
              ⌘K (with no selection) opens the same palette; see useSelectionAsk. */}
          <div
            title="Search everything — ⌘K"
            data-testid="pv2-search-trigger"
            onClick={openPalette}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openPalette();
              }
            }}
            style={{
              cursor: "pointer",
              flex: "1 1 140px",
              minWidth: 0,
              maxWidth: 280,
              marginRight: "auto",
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: "#0b1a2e",
              border: "1px solid rgba(148,163,184,.16)",
              borderRadius: 5,
              padding: "7px 11px",
            }}
          >
            <span style={{ flex: "0 0 15px", display: "flex", color: "#64748b" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: "12px",
                color: "#64748b",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Search everything
            </span>
            <span
              style={{
                flex: "0 0 auto",
                padding: "1px 5px",
                borderRadius: 4,
                border: "1px solid rgba(148,163,184,.2)",
                fontSize: "9.5px",
                fontWeight: 700,
                color: "#475569",
                fontFamily: MONO,
              }}
            >
              ⌘K
            </span>
          </div>

          {/* New menu — prototype 220-242. */}
          <div data-pv2-menu style={{ position: "relative", flex: "0 0 auto" }}>
            <button
              onClick={() => setOpenMenu((m) => (m === "new" ? null : "new"))}
              data-testid="pv2-new-button"
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 13px 0 11px",
                borderRadius: 5,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 160ms,border-color 160ms,color 160ms",
                border: `1px solid ${openMenu === "new" ? "rgba(0,180,216,.65)" : "rgba(148,163,184,.16)"}`,
                background:
                  openMenu === "new"
                    ? "linear-gradient(135deg,rgba(0,120,212,.32),rgba(0,180,216,.2))"
                    : "#0b1a2e",
                color: openMenu === "new" ? "#ffffff" : "#cbd5e1",
              }}
            >
              <Plus size={14} color={openMenu === "new" ? "#ffffff" : "#7dd3fc"} />
              <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".01em", whiteSpace: "nowrap" }}>New</span>
            </button>
            {openMenu === "new" && (
              <div
                data-testid="pv2-new-menu"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 42,
                  zIndex: 90,
                  width: 320,
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 12,
                  background: "#0b1524",
                  boxShadow: "0 18px 44px rgba(2,6,23,.6)",
                  overflow: "hidden",
                }}
              >
                <NewMenuContent onNavigate={go} onCreate={handleCreate} />
              </div>
            )}
          </div>

          {/* Knowledge-base "?" — prototype 245. Opens the KB overlay in browse. */}
          <button
            onClick={() => openKb(null)}
            title="Get help on this page"
            data-testid="pv2-kb-button"
            style={{
              flex: "0 0 34px",
              width: 34,
              height: 34,
              borderRadius: 5,
              border: "1px solid rgba(148,163,184,.16)",
              background: "#0b1a2e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#94a3b8",
              fontFamily: "inherit",
              fontSize: "14px",
              fontWeight: 700,
            }}
          >
            ?
          </button>

          {/* Alerts bell + tray */}
          <div data-pv2-menu style={{ position: "relative", flex: "0 0 auto" }}>
            <IconBtn
              title="Notifications"
              testId="pv2-alerts-bell"
              onClick={() => setOpenMenu((m) => (m === "alerts" ? null : "alerts"))}
              badge={
                <span
                  className="pv2-slow-pulse"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#f43f5e",
                    boxShadow: "0 0 0 2px #071324",
                  }}
                />
              }
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
              </svg>
            </IconBtn>

            {openMenu === "alerts" && (
              <div
                data-testid="pv2-alerts-tray"
                style={{
                  position: "absolute",
                  right: 0,
                  top: 42,
                  zIndex: 80,
                  width: 400,
                  maxHeight: "70vh",
                  overflowY: "auto",
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 12,
                  background: "#0b1524",
                  boxShadow: "0 18px 44px rgba(2,6,23,.55)",
                }}
              >
                <div
                  style={{
                    padding: "14px 16px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    borderBottom: "1px solid rgba(30,41,59,.9)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".2em",
                      textTransform: "uppercase",
                      color: "#64748b",
                    }}
                  >
                    Smart alerts
                  </span>
                  <span style={{ fontSize: "11.5px", color: "#475569" }}>
                    Same ranking as Most Urgent — pillar coded, sized by impact
                  </span>
                </div>
                {/* Hold windows needing a decision, then the smart alerts —
                    both from one source, ranked as Most Urgent. */}
                <AlertsTrayContent onNavigate={go} alertItems={alertItems} alertsLoaded={alertsLoaded} />
              </div>
            )}
          </div>

          {/* Account chip + menu */}
          <div data-pv2-menu style={{ position: "relative", flex: "0 0 auto" }}>
            <button
              onClick={() => setOpenMenu((m) => (m === "account" ? null : "account"))}
              data-testid="pv2-account-chip"
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "5px 10px 5px 5px",
                borderRadius: 5,
                border: "1px solid rgba(148,163,184,.16)",
                background: "#0b1a2e",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 4,
                  background: "linear-gradient(135deg,#0078D4,#00B4D8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#fff",
                  flex: "0 0 26px",
                }}
              >
                {account.initials}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  lineHeight: 1.15,
                  textAlign: "left",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#e2e8f0",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 110,
                  }}
                >
                  {account.name}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 500,
                    color: "#64748b",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 110,
                  }}
                >
                  {account.role}
                </span>
              </div>
              <span
                style={{
                  flex: "0 0 auto",
                  display: "flex",
                  color: "#64748b",
                  marginLeft: 2,
                  transform: `rotate(${openMenu === "account" ? 180 : 0}deg)`,
                  transition: "transform 180ms",
                }}
              >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>

            {openMenu === "account" && (
              <div
                data-testid="pv2-account-menu"
                style={{
                  position: "absolute",
                  right: 0,
                  top: 42,
                  zIndex: 80,
                  width: 210,
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 10,
                  background: "#0b1524",
                  boxShadow: "0 18px 44px rgba(2,6,23,.55)",
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                {/* The design's full account menu — Settings, Change control
                    policy, Alert preferences, Webhooks, Billing, Account
                    security, Sign out (shell 19242-19249). Several targets are
                    owned by later parts and resolve when they land; Settings and
                    the change-control policy exist today. Sign out is real. */}
                <AccountMenuContent onNavigate={go} onSignOut={() => void logout()} />
              </div>
            )}
          </div>
        </header>

        {/* main is the only scrolling region in the content column */}
        {/* The prototype's header carries NO page title — every page renders its
            own heading (e.g. Overview at 277-281, Governance at 425). `title`
            and `eyebrow` are kept on the props for the document title and for
            callers that still pass them, but deliberately not painted into the
            chrome, because doing so would be a band the design does not have. */}
        <main
          style={{ flex: 1, minWidth: 0, overflowX: "hidden", overflowY: "auto" }}
          data-testid="pv2-main"
          aria-label={eyebrow ? `${eyebrow} — ${title}` : title}
        >
          {children}
        </main>
      </div>

      {/* ── The five systems' overlays, mounted at the shell root ──────────── */}
      <PaletteOverlay
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={go}
        onOpenKb={(articleId) => openKb(articleId)}
        onAsk={shaneBot.askShane}
      />

      <KnowledgeBaseOverlay
        open={kb.open}
        seedArticleId={kb.articleId}
        location={location}
        onClose={() => setKb({ open: false, articleId: null })}
        onNavigate={go}
        onAsk={shaneBot.askShane}
      />

      {/* The New-menu create form, when one is open. */}
      {formElement}

      {/* ShaneBot: the selection chip (at the selection, nothing follows the
          pointer), the chat panel, and the launcher. */}
      {selection.chip && (
        <SelectionChip
          chip={selection.chip}
          onAsk={(topic) => {
            selection.dismiss();
            shaneBot.askShane(topic);
          }}
        />
      )}
      {shaneBot.open && <ShaneBotPanel api={shaneBot} />}
      <ShaneBotLauncher onClick={shaneBot.toggle} />
    </div>
  );
}
