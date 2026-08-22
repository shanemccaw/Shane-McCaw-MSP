import React from "react";
import { Link } from "wouter";

// Shared building blocks for the six pillar pages (Part 4), recreated from the
// Marketing Pillar - <name>.dc.html design references. Every pillar page follows the
// same skeleton (nav -> hero -> mid band -> inside-the-portal -> retainer band ->
// six-pillars strip -> scan-to-scoped-work CTA -> footer). The two trailing sections
// are near-identical across all six — only the active pillar, the accent colour and a
// couple of verbatim copy strings differ — so they live here once, parameterised.

export type PillarSlug =
  | "governance"
  | "security"
  | "compliance"
  | "licensing"
  | "adoption"
  | "health";

// The canonical pillar glyph + colour, matching the Nav's PILLAR_ICONS exactly. Pillar
// identity is an icon, never a dot. `activeBorder`/`activeBg` are the design's own rgba
// values for the lit peer-strip pill (Compliance is the odd one out at .4/.08).
type PillarMeta = {
  slug: PillarSlug;
  label: string;
  color: string;
  activeBorder: string;
  activeBg: string;
  icon: React.ReactNode;
};

export const PILLARS: PillarMeta[] = [
  {
    slug: "governance",
    label: "Governance",
    color: "#3b82f6",
    activeBorder: "rgba(59,130,246,.45)",
    activeBg: "rgba(59,130,246,.1)",
    icon: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    slug: "security",
    label: "Security",
    color: "#8b5cf6",
    activeBorder: "rgba(139,92,246,.45)",
    activeBg: "rgba(139,92,246,.1)",
    icon: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
  },
  {
    slug: "compliance",
    label: "Compliance",
    color: "#e2e8f0",
    activeBorder: "rgba(226,232,240,.4)",
    activeBg: "rgba(226,232,240,.08)",
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
    slug: "licensing",
    label: "Licensing",
    color: "#14b8a6",
    activeBorder: "rgba(20,184,166,.45)",
    activeBg: "rgba(20,184,166,.1)",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v12" />
        <path d="M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2.5 2.5 0 0 0 0 5h1a2.5 2.5 0 0 1 0 5h-1a2.5 2.5 0 0 1-2.5-2" />
      </>
    ),
  },
  {
    slug: "adoption",
    label: "Adoption",
    color: "#f97316",
    activeBorder: "rgba(249,115,22,.45)",
    activeBg: "rgba(249,115,22,.1)",
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
    slug: "health",
    label: "Health",
    color: "#22c55e",
    activeBorder: "rgba(34,197,94,.45)",
    activeBg: "rgba(34,197,94,.1)",
    icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  },
];

// The design's ubiquitous stroke arrow (line + chevron), used on every CTA button.
export function ArrowRight({ size = 15, sw = 1.8 }: { size?: number; sw?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14 6 20 12 14 18" />
    </svg>
  );
}

// "The six pillars" strip: every pillar as a rounded pill, the current one lit in its
// own colour and non-linking, plus the page's three "Go deeper" deep-dive links.
export function PillarPeerStrip({
  active,
  deeper,
}: {
  active: PillarSlug;
  deeper: { label: string; href: string }[];
}) {
  return (
    <section style={{ padding: "0 32px 40px" }}>
      <div
        style={{
          maxWidth: "1120px",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          border: "1px solid rgba(30,41,59,.95)",
          borderRadius: "14px",
          background: "#0b1524",
          padding: "14px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "#475569",
              marginRight: "4px",
            }}
          >
            The six pillars
          </span>
          {PILLARS.map((p) => {
            const on = p.slug === active;
            const pillStyle: React.CSSProperties = {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 11px",
              borderRadius: "999px",
              fontSize: "11.5px",
              fontWeight: on ? 700 : 600,
              color: on ? "#f8fafc" : "#94a3b8",
              border: on ? `1px solid ${p.activeBorder}` : "1px solid rgba(30,41,59,.9)",
              ...(on ? { background: p.activeBg } : null),
            };
            const inner = (
              <>
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
                {p.label}
              </>
            );
            return on ? (
              <span key={p.slug} style={pillStyle}>
                {inner}
              </span>
            ) : (
              <Link key={p.slug} href={`/pillars/${p.slug}`} style={pillStyle}>
                {inner}
              </Link>
            );
          })}
        </div>
        <span style={{ fontSize: "11px", color: "#64748b" }}>
          Go deeper:{" "}
          {deeper.map((d, i) => (
            <React.Fragment key={d.href}>
              {i > 0 ? " · " : null}
              <Link href={d.href} style={{ color: "#60a5fa", fontWeight: 600 }}>
                {d.label}
              </Link>
            </React.Fragment>
          ))}
        </span>
      </div>
    </section>
  );
}

// The four-step "From Scan to Scoped Work" closing CTA. Steps are identical across all
// six pillars (and their blue "hot" styling is fixed regardless of page colour); only
// the top gradient tint (`accent`, the page colour at 5%) and the intro copy differ.
const STEPS = [
  { n: "1", title: "Run the free scan", body: "Read-only Graph scan. 158 checks, all six pillars.", hot: true },
  { n: "2", title: "Get a priced SOW", body: "Findings become named phases with fixed prices.", hot: false },
  { n: "3", title: "Select your scopes", body: "Keep, defer or drop each phase before signing.", hot: false },
  { n: "4", title: "Sign, pay, onboard", body: "Account, portal and remediation window in one pass.", hot: false },
];

export function ScanToScopedWork({ accent, intro }: { accent: string; intro: React.ReactNode }) {
  return (
    <section
      style={{
        padding: "32px 32px 56px",
        background: `linear-gradient(180deg, ${accent}, rgba(2,6,23,0) 55%)`,
      }}
    >
      <div style={{ maxWidth: "760px", margin: "0 auto 26px", textAlign: "center" }}>
        <h2
          style={{
            fontSize: "19px",
            fontWeight: 700,
            color: "#f8fafc",
            margin: "0 0 10px",
            letterSpacing: "-.02em",
          }}
        >
          From Scan to Scoped Work
        </h2>
        <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0, fontSize: "13px" }}>{intro}</p>
      </div>
      <div
        style={{
          maxWidth: "980px",
          margin: "0 auto",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "center",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "210px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "16px",
                borderRadius: "14px",
                background: "#0b1524",
                border: `1px solid ${s.hot ? "rgba(59,130,246,.45)" : "rgba(30,41,59,.9)"}`,
              }}
            >
              <span
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "7px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: 800,
                  ...(s.hot
                    ? {
                        background: "rgba(59,130,246,.15)",
                        border: "1px solid rgba(59,130,246,.4)",
                        color: "#60a5fa",
                      }
                    : {
                        background: "rgba(255,255,255,.05)",
                        border: "1px solid rgba(255,255,255,.1)",
                        color: "#94a3b8",
                      }),
                }}
              >
                {s.n}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{s.title}</span>
              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{s.body}</span>
            </div>
            {i < STEPS.length - 1 ? (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="#475569"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="4" y1="12" x2="20" y2="12" />
                <polyline points="14 6 20 12 14 18" />
              </svg>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", marginTop: "26px" }}>
        <Link
          href="/scan"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "13px 26px",
            borderRadius: "11px",
            fontWeight: 700,
            fontSize: "14px",
            color: "#fff",
            background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
            whiteSpace: "nowrap",
          }}
        >
          Scan My Tenant &#183; Free <ArrowRight />
        </Link>
        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "10px" }}>
          Read-only. No agent, no charge, and the findings are yours either way.
        </div>
      </div>
    </section>
  );
}
