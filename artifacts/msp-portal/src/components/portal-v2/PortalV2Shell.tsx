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

import { Fragment, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Bell, FileText, GitCommit, PlayCircle, ShieldOff, Users } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useHoldBadge } from "@/components/portal-v2/holds/useHoldBadge";

import {
  PILLAR_ICON_PATHS,
  PILLAR_ORDER,
  hexAlpha,
} from "@/components/copilot-journey/journeyTokens";

import "./portal-v2.css";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/**
 * The Operate group's nav rows — prototype 7232-7236. Icon names are the
 * prototype's own, resolved against the installed `lucide-react` rather than
 * assumed (BUILD_PLAN §5.8): `git-commit` → `GitCommit`.
 *
 * Grows one row at a time as its pages land — never a row pointing at a route
 * that does not exist.
 */
const OPERATE_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  title: string;
  testId: string;
  /** "holds" wires the hold-window badge; absent means no badge, which is most rows. */
  badge?: "holds";
  icon: typeof GitCommit;
}> = [
  {
    href: "/portal-v2/change-control",
    label: "Change Control",
    title:
      "Change Control — every tenant change with a request, an approval and a rollback point",
    testId: "pv2-nav-change-control",
    icon: GitCommit,
  },
  {
    href: "/portal-v2/runbooks",
    label: "Active Runbooks",
    title: "Active Runbooks — procedures in progress, including hold windows",
    testId: "pv2-nav-runbooks",
    badge: "holds",
    icon: PlayCircle,
  },
];

/**
 * The GOVERNANCE group — Round Three's regroup.
 *
 * "The old 'Standards & risk' catch-all (7 mixed items) is split into two
 * groups: Governance — Ownership, Risk Register, Security Plan, PII Governance
 * — and Reference — SOPs & Runbooks, Microsoft Changes. Order is now Operate /
 * Governance / Reference / Library."
 *
 * The new shell's `navGroupDefs` confirms it: no "Standards & risk" remains,
 * and Governance carries `ownership` / `risk-register` / `security-plan` / `pii`
 * in that order.
 *
 * Two of the four are listed here, because two have pages. Security Plan and
 * PII Governance are not built, and the standing rule for this nav is "never a
 * row pointing at a route that does not exist" — the same rule that kept SOPs
 * and Microsoft Changes out of the old group. They join when their pages land.
 *
 * The Risk Register `title` is the prototype's verbatim, and it UNDER-DESCRIBES
 * the page: it says "accepted risks", while the register actually carries all
 * twelve risks across five statuses and defaults its status filter to "All
 * statuses". Kept as written, because copy is final.
 */
const GOVERNANCE_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  title: string;
  testId: string;
  icon: typeof ShieldOff;
  subs?: ReadonlyArray<{ key: string; label: string; href: string }>;
}> = [
  {
    href: "/portal-v2/ownership",
    label: "Ownership",
    title: "Ownership — four names against every service, change, control and freeze",
    testId: "pv2-nav-ownership",
    icon: Users,
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
    icon: ShieldOff,
  },
];

/**
 * The REFERENCE group — the other half of Round Three's split.
 *
 * The new shell's Reference group has two rows, SOPs & Runbooks and Microsoft
 * Changes. Only Microsoft Changes has a page, so only it is listed, under the
 * same rule as Governance above.
 *
 * Its five sub-items are the prototype's own wave keys (shell 8843), which are
 * INDEX STRINGS — '0' … '4' — not slugs. They become readable URL segments
 * here, because "/portal-v2/ms-changes/2" would be a worse link than
 * "/portal-v2/ms-changes/q2" for something a customer is meant to be able to
 * send to a colleague. The labels are the design's verbatim.
 */
const REFERENCE_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  title: string;
  testId: string;
  icon: typeof ShieldOff;
  subs?: ReadonlyArray<{ key: string; label: string; href: string }>;
}> = [
  {
    href: "/portal-v2/ms-changes",
    label: "Microsoft Changes",
    title: "Microsoft Changes — message centre posts, read against your tenant",
    testId: "pv2-nav-ms-changes",
    icon: Bell,
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
 * The Library group — prototype 7244-7246. Its own group in the prototype's
 * `navGroupDefs`, not part of Operate, and currently one row: `file-text` →
 * `FileText`. The prototype's `title` is kept verbatim, including its "84-
 * document library" claim, which the page itself backs up.
 */
const LIBRARY_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  title: string;
  testId: string;
  icon: typeof FileText;
}> = [
  {
    href: "/portal-v2/documents",
    label: "Documents",
    title: "Documents — your deliverables, and the 84-document library",
    testId: "pv2-nav-documents",
    icon: FileText,
  },
];

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

/** The group label + its hairline rule — prototype 122-125. */
/**
 * A nav group with no badge machinery — Standards & risk, and Library.
 *
 * Non-pillar rows are deliberately different from pillar ones: no coloured 26px
 * tile, just a plain 15px glyph in an 18px box (prototype 7185-7194).
 */
function SimpleNavGroup({
  label,
  items,
  location,
  expanded,
}: {
  label: string;
  items: ReadonlyArray<{
    href: string;
    label: string;
    title: string;
    testId: string;
    icon: typeof ShieldOff;
    subs?: ReadonlyArray<{ key: string; label: string; href: string }>;
  }>;
  location: string;
  expanded: boolean;
}) {
  return (
    <>
      <GroupLabel label={label} expanded={expanded} />
      {items.map((item) => {
        const isActive = location === item.href || location.startsWith(`${item.href}/`);
        const Glyph = item.icon;
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
                <Glyph size={15} color={isActive ? "#60a5fa" : "#94a3b8"} />
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
  subs: ReadonlyArray<{ key: string; label: string; href: string }>;
  location: string;
  parentHref: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 0 6px" }}>
      {subs.map((sb) => {
        // The bare parent path IS the "all" sub-item, so it is active both at
        // "/…/ownership" and at "/…/ownership/all".
        const on =
          location === sb.href || (sb.href === parentHref && location === `${parentHref}/all`);
        return (
          <Link
            key={sb.key}
            href={sb.href}
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
            </span>
          </Link>
        );
      })}
    </div>
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
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
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
  const [location] = useLocation();
  const { logout } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const holdBadge = useHoldBadge();

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
                Tenant Monitoring
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
              style={{
                width: "62%",
                height: "100%",
                borderRadius: 2,
                background: "#f87171",
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
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  color: "#94a3b8",
                  fontFamily: MONO,
                }}
              >
                62 · Needs work
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
          <Link
            href="/portal-v2"
            title="Overview"
            data-testid="pv2-nav-overview"
            style={navItemStyle(isOverview, expanded)}
          >
            <span
              style={{
                flex: "0 0 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PillarGlyph pillar="copilot" color={isOverview ? "#f1f5f9" : "#94a3b8"} size={18} />
            </span>
            {expanded && <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap" }}>Overview</span>}
          </Link>

          <GroupLabel label="Pillars" expanded={expanded} />

          {PILLAR_ORDER.map((p) => {
            const isActive = location === `/portal-v2/${p.key}` || location.startsWith(`/portal-v2/${p.key}/`);
            const iconColor =
              p.key === "compliance" && !isActive ? "#cbd5e1" : isActive ? p.primary : "#94a3b8";
            return (
              <Link
                key={p.key}
                href={`/portal-v2/${p.key}`}
                title={p.label}
                data-testid={`pv2-nav-${p.key}`}
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
                    background: hexAlpha(p.primary, 0.1),
                    border: `1px solid ${p.primary}33`,
                  }}
                >
                  <PillarGlyph pillar={p.key} color={iconColor} size={14} />
                </span>
                {expanded && (
                  <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap" }}>{p.label}</span>
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
                      background: p.primary,
                    }}
                  />
                )}
              </Link>
            );
          })}

          {/*
            ── Operate — prototype 7231-7236 ────────────────────────────────
            Only the items that EXIST are listed, per BUILD_PLAN §3.3: "the
            remaining groups get added as their phases land, never as dead
            rows." Active Runbooks and Remediation Tracker join this group as
            their own pages land.

            Non-pillar nav items are deliberately different from pillar ones:
            no coloured 26px tile, a plain 15px glyph in an 18px box, and
            `navItemBaseCss(isActive, '#60a5fa')` — whose colour argument the
            prototype never actually reads (7185-7194), so `navItemStyle` is
            already the right shape.

            The prototype's badge/dot machinery on these rows is driven purely
            by hold windows ("1 due" on Active Runbooks) and is not reproduced
            here, because no item in this group carries a badge yet.
          */}
          <GroupLabel label="Operate" expanded={expanded} />

          {OPERATE_ITEMS.map((item) => {
            const isActive =
              location === item.href || location.startsWith(`${item.href}/`);
            const Glyph = item.icon;
            // Only Active Runbooks carries a badge, and only when a hold window
            // needs a decision — see useHoldBadge for the README's reasoning.
            const badge = item.badge === "holds" ? holdBadge : null;
            return (
              <Link
                key={item.href}
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
                  <Glyph size={15} color={isActive ? "#60a5fa" : "#94a3b8"} />
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
                    data-testid="pv2-nav-runbooks-badge"
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
                    data-testid="pv2-nav-runbooks-dot"
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
            );
          })}

          {/* ── Round Three's group order: Operate / Governance / Reference /
              Library. All three below are badge-free, so they share one
              renderer; Operate above keeps its own loop because only it carries
              the hold-window badge. */}
          <SimpleNavGroup
            label="Governance"
            items={GOVERNANCE_ITEMS}
            location={location}
            expanded={expanded}
          />

          <SimpleNavGroup
            label="Reference"
            items={REFERENCE_ITEMS}
            location={location}
            expanded={expanded}
          />

          <SimpleNavGroup
            label="Library"
            items={LIBRARY_ITEMS}
            location={location}
            expanded={expanded}
          />
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
          {/* Search trigger — a trigger, not an input. max-width 280px. */}
          <div
            title="Search everything — ⌘K"
            data-testid="pv2-search-trigger"
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

          {/* Alerts bell + tray */}
          <div style={{ position: "relative", flex: "0 0 auto" }}>
            <IconBtn
              title="Notifications"
              onClick={() => {
                setAlertsOpen((v) => !v);
                setAccountOpen(false);
              }}
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

            {alertsOpen && (
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
                {/* The tray's rows are driven by the alerts + hold-window systems,
                    neither of which is built yet. An honest empty state rather
                    than fabricated alerts — the geometry above is the spec. */}
                <div style={{ padding: "18px 16px", fontSize: "12px", color: "#64748b" }}>
                  No alerts yet. Smart alerts arrive with the alerts and hold-window
                  systems.
                </div>
              </div>
            )}
          </div>

          {/* Account chip + menu */}
          <div style={{ position: "relative", flex: "0 0 auto" }}>
            <button
              onClick={() => {
                setAccountOpen((v) => !v);
                setAlertsOpen(false);
              }}
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
                JD
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
                  Jordan Diaz
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
                  IT Lead
                </span>
              </div>
              <span
                style={{
                  flex: "0 0 auto",
                  display: "flex",
                  color: "#64748b",
                  marginLeft: 2,
                  transform: `rotate(${accountOpen ? 180 : 0}deg)`,
                  transition: "transform 180ms",
                }}
              >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>

            {accountOpen && (
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
                {/* Settings is reached from HERE, not the left nav — the
                    prototype's account menu carries it (19243) and the nav
                    does not. This replaces the placeholder note that stood
                    here while the page did not exist. */}
                <Link
                  href="/portal-v2/settings"
                  onClick={() => setAccountOpen(false)}
                  data-testid="pv2-account-settings"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "12px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                    textAlign: "left",
                    textDecoration: "none",
                  }}
                >
                  Settings
                </Link>
                {/* Sign out is real today — the account menu is where the design
                    puts it, and having it here gives a deterministic way to end
                    a session. Without it the only sign-out affordance in the app
                    is on the flat no-slug route and carries no test handle, which
                    is why a persisted session makes login-first test runs flaky. */}
                <button
                  onClick={() => void logout()}
                  data-testid="pv2-sign-out"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "none",
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  Sign out
                </button>
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
    </div>
  );
}
