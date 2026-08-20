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

import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { GitCommit } from "lucide-react";

import { useAuth } from "@/lib/auth-context";

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
const SIDEBAR_WASH =
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
              </Link>
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
                <div style={{ padding: "10px 10px", fontSize: "12px", color: "#64748b" }}>
                  Account settings arrive with the settings pages.
                </div>
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
