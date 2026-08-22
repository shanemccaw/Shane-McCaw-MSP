import React from "react";
import { Link } from "wouter";

// Shared marketing header. Recreated from Design/design_handoff_marketing/Marketing Nav.dc.html
// — colours, spacing and copy are the design's own, verbatim. The prototype linked pages with
// relative <a href> to .dc.html files; production routes them through wouter <Link>.
//
// `current` marks the active item. "What We Watch" lights up on any pillar OR deep-dive page
// (the design accepts either 'watch' or 'solutions' for that), so pillar / deep-dive / solutions
// pages pass `current="watch"`.
export type NavCurrent =
  | "home"
  | "watch"
  | "solutions"
  | "monitoring"
  | "quickstart"
  | "retainers"
  | "pricing"
  // Utility pages that are not top-nav items (Free Scan, Buy, Change Record) pass "none" so no
  // link is marked active. The design's documented set is the six above; this is a superset.
  | "none";

// The six pillars, each with its own colour and its own stroke glyph (Governance shield-check,
// Security padlock, Compliance scales, Licensing circled dollar, Adoption users, Health pulse) —
// paths lifted verbatim from the design's PILLAR_ICONS so the tiles match exactly. Pillar identity
// is an icon, never a dot.
const PILLARS: { label: string; color: string; href: string; icon: React.ReactNode }[] = [
  {
    label: "Governance",
    color: "#3b82f6",
    href: "/pillars/governance",
    icon: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    label: "Security",
    color: "#8b5cf6",
    href: "/pillars/security",
    icon: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
  },
  {
    label: "Compliance",
    color: "#e2e8f0",
    href: "/pillars/compliance",
    icon: (
      <>
        <path d="M12 3v18" />
        <path d="M5 7h14" />
        <path d="M5 7l-2 6h4z" />
        <path d="M19 7l2 6h-4z" />
        <path d="M8 21h8" />
      </>
    ),
  },
  {
    label: "Licensing",
    color: "#14b8a6",
    href: "/pillars/licensing",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v12" />
        <path d="M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2.5 2.5 0 0 0 0 5h1a2.5 2.5 0 0 1 0 5h-1a2.5 2.5 0 0 1-2.5-2" />
      </>
    ),
  },
  {
    label: "Adoption",
    color: "#f97316",
    href: "/pillars/adoption",
    icon: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    label: "Health",
    color: "#22c55e",
    href: "/pillars/health",
    icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  },
];

// The seven workload deep-dives, in the design's own order.
const DIVES: { label: string; href: string }[] = [
  { label: "Copilot & AI", href: "/solutions/copilot" },
  { label: "Governance projects", href: "/solutions/governance" },
  { label: "SharePoint", href: "/solutions/sharepoint" },
  { label: "Power Platform", href: "/solutions/power-platform" },
  { label: "Teams", href: "/solutions/teams" },
  { label: "Migration", href: "/solutions/migration" },
  { label: "M365 Health", href: "/solutions/m365-health" },
];

// The four flat nav items after the "What We Watch" dropdown.
const ITEMS: { key: NavCurrent; label: string; href: string }[] = [
  { key: "monitoring", label: "Monitoring", href: "/monitoring" },
  { key: "quickstart", label: "Quick-Start", href: "/quick-start" },
  { key: "retainers", label: "Retainers", href: "/retainers" },
  { key: "pricing", label: "Pricing", href: "/pricing" },
];

// linkCss from the design, translated to a style object: active = white/700 with a 2px #60a5fa
// underline (inset box-shadow); inactive = #94a3b8/600. The row never wraps at the header level
// (flex-wrap: nowrap); the inner link list does (flex-wrap: wrap).
function linkStyle(on: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: "7px 8px",
    borderRadius: "7px",
    fontSize: "12px",
    fontWeight: on ? 700 : 600,
    whiteSpace: "nowrap",
    color: on ? "#f8fafc" : "#94a3b8",
    ...(on ? { boxShadow: "inset 0 -2px 0 0 #60a5fa" } : null),
    ...extra,
  };
}

export function Nav({ current = "home" }: { current?: NavCurrent }) {
  const watchOn = current === "watch" || current === "solutions";
  return (
    <>
      {/* The design's <helmet> rules: no underlines, hover reveal of the dropdown, and the
          per-link hover wash inside it. Kept scoped to the nav so nothing leaks site-wide. */}
      <style>{`
        .sm-nav a{text-decoration:none}
        .sm-solutions-dd a:hover{background:rgba(59,130,246,.1);color:#f8fafc}
        .sm-solutions-wrap:hover .sm-solutions-dd{display:flex!important}
      `}</style>
      <header
        className="sm-nav"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background:
            "linear-gradient(90deg, rgba(2,6,23,.92), rgba(0,180,216,.05) 40%, rgba(139,92,246,.08) 70%, rgba(59,130,246,.1) 100%)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(30,41,59,.9)",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "9px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            flexWrap: "nowrap",
          }}
        >
          {/* Logo lockup (order 1) */}
          <Link
            href="/"
            style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0, order: 1 }}
          >
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "9px",
                background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: 800,
                color: "#fff",
              }}
            >
              SM
            </div>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <span style={{ fontSize: "15px", fontWeight: 700, color: "#f8fafc" }}>Shane McCaw</span>
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                M365 Architecture
              </span>
            </div>
          </Link>

          {/* CTA (order 3) */}
          <Link
            href="/scan"
            style={{
              flexShrink: 0,
              padding: "7px 13px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 700,
              color: "#fff",
              background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
              whiteSpace: "nowrap",
              order: 3,
            }}
          >
            Scan My Tenant · Free
          </Link>

          {/* Link list (order 2) — wraps among itself so the CTA never orphans */}
          <nav
            style={{
              display: "flex",
              gap: 0,
              flexWrap: "wrap",
              flex: "1 1 auto",
              minWidth: 0,
              justifyContent: "center",
              alignItems: "center",
              rowGap: "4px",
              order: 2,
            }}
          >
            <Link href="/" style={linkStyle(current === "home")}>
              Home
            </Link>

            <div className="sm-solutions-wrap" style={{ position: "relative" }}>
              <span
                style={linkStyle(watchOn, {
                  cursor: "default",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                })}
              >
                What We Watch{" "}
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
              <div
                className="sm-solutions-dd"
                style={{
                  display: "none",
                  position: "absolute",
                  top: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  paddingTop: "8px",
                  zIndex: 60,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "6px",
                    padding: "10px",
                    borderRadius: "12px",
                    background: "#0b1524",
                    border: "1px solid rgba(30,41,59,.9)",
                    boxShadow: "0 16px 40px rgba(2,6,23,.6)",
                  }}
                >
                  {/* Column 1 — the six pillars */}
                  <div style={{ display: "flex", flexDirection: "column", minWidth: "200px" }}>
                    <span
                      style={{
                        padding: "4px 11px 7px",
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".16em",
                        textTransform: "uppercase",
                        color: "#475569",
                      }}
                    >
                      The six pillars
                    </span>
                    {PILLARS.map((p) => (
                      <Link
                        key={p.label}
                        href={p.href}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "9px",
                          padding: "6px 11px",
                          borderRadius: "8px",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: "#94a3b8",
                        }}
                      >
                        <span
                          style={{
                            flex: "none",
                            width: "22px",
                            height: "22px",
                            borderRadius: "7px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: `${p.color}1A`,
                            border: `1px solid ${p.color}33`,
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="13"
                            height="13"
                            fill="none"
                            stroke={p.color}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            {p.icon}
                          </svg>
                        </span>
                        {p.label}
                      </Link>
                    ))}
                  </div>

                  <div style={{ width: "1px", background: "rgba(30,41,59,.9)" }} />

                  {/* Column 2 — the seven deep-dives */}
                  <div style={{ display: "flex", flexDirection: "column", minWidth: "190px" }}>
                    <span
                      style={{
                        padding: "4px 11px 7px",
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".16em",
                        textTransform: "uppercase",
                        color: "#475569",
                      }}
                    >
                      Deep dives
                    </span>
                    {DIVES.map((s) => (
                      <Link
                        key={s.href}
                        href={s.href}
                        style={{
                          display: "block",
                          padding: "7px 11px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: "#94a3b8",
                        }}
                      >
                        {s.label}
                      </Link>
                    ))}
                    <Link
                      href="/solutions"
                      style={{
                        display: "block",
                        marginTop: "4px",
                        padding: "8px 11px",
                        borderTop: "1px solid rgba(30,41,59,.9)",
                        fontSize: "12px",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        color: "#60a5fa",
                      }}
                    >
                      All 33 projects →
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {ITEMS.map((it) => (
              <Link key={it.key} href={it.href} style={linkStyle(it.key === current)}>
                {it.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}

export default Nav;
