import React from "react";
import { Link } from "wouter";
import { MarketingLayout } from "../../components/MarketingLayout";
import { useSignalCheckCount } from "../../../hooks/useSignalCheckCount";

// Shared skeleton for the six same-shaped workload deep-dive pages (Copilot, SharePoint, Teams,
// Power Platform, Migration, M365 Health). Recreated verbatim from the
// Design/design_handoff_marketing/Marketing Solutions - <name>.dc.html files — every colour, size,
// spacing and string is the design's own. The seventh deep-dive, Governance, is a bespoke
// interactive page and does not use this module.
//
// The design prototype linked pages with relative <a href> to .dc.html filenames; production routes
// them through wouter <Link>. The design's renderVals() logic is inlined here as plain data on each
// page — no state machine, since these six pages are static.

export type SolSlug =
  | "copilot"
  | "sharepoint"
  | "teams"
  | "power-platform"
  | "migration"
  | "m365-health"
  | "governance";

// The seven deep-dives, in the design's own order, for the bottom pill row.
const DIVE_PILLS: { slug: SolSlug; label: string }[] = [
  { slug: "copilot", label: "Copilot & AI" },
  { slug: "sharepoint", label: "SharePoint" },
  { slug: "teams", label: "Teams" },
  { slug: "power-platform", label: "Power Platform" },
  { slug: "migration", label: "Migration" },
  { slug: "m365-health", label: "M365 Health" },
  { slug: "governance", label: "Governance projects" },
];

// The bottom pill row lists the dives in a per-page order (Copilot's page leads with SharePoint,
// SharePoint's leads with Copilot, etc). Each page passes its own ordered slug list.
export interface Accent {
  // hero eyebrow pill
  eyebrowBg: string;
  eyebrowBorder: string;
  eyebrowText: string;
  // mid-band eyebrow colour
  midEyebrow: string;
  // horizontal rail — hot (first) step
  railHotBorder: string;
  railNumBg: string;
  railNumBorder: string;
  railNumText: string;
  // projects grid
  projectHover: string;
  whenColor: string;
  // bottom pill row — active pill
  pillActiveBorder: string;
  pillActiveBg: string;
}

export const ACCENTS: Record<SolSlug, Accent> = {
  copilot: {
    eyebrowBg: "rgba(139,92,246,.12)",
    eyebrowBorder: "rgba(139,92,246,.3)",
    eyebrowText: "#a78bfa",
    midEyebrow: "#a78bfa",
    railHotBorder: "rgba(139,92,246,.45)",
    railNumBg: "rgba(139,92,246,.15)",
    railNumBorder: "rgba(139,92,246,.4)",
    railNumText: "#a78bfa",
    projectHover: "rgba(139,92,246,.4)",
    whenColor: "#a78bfa",
    pillActiveBorder: "rgba(139,92,246,.45)",
    pillActiveBg: "rgba(139,92,246,.1)",
  },
  sharepoint: {
    eyebrowBg: "rgba(52,211,153,.1)",
    eyebrowBorder: "rgba(52,211,153,.28)",
    eyebrowText: "#34d399",
    midEyebrow: "#34d399",
    railHotBorder: "rgba(52,211,153,.45)",
    railNumBg: "rgba(52,211,153,.12)",
    railNumBorder: "rgba(52,211,153,.4)",
    railNumText: "#34d399",
    projectHover: "rgba(52,211,153,.4)",
    whenColor: "#34d399",
    pillActiveBorder: "rgba(52,211,153,.45)",
    pillActiveBg: "rgba(52,211,153,.1)",
  },
  teams: {
    eyebrowBg: "rgba(249,115,22,.1)",
    eyebrowBorder: "rgba(249,115,22,.28)",
    eyebrowText: "#fb923c",
    midEyebrow: "#fb923c",
    railHotBorder: "rgba(249,115,22,.45)",
    railNumBg: "rgba(249,115,22,.12)",
    railNumBorder: "rgba(249,115,22,.4)",
    railNumText: "#fb923c",
    projectHover: "rgba(249,115,22,.4)",
    whenColor: "#fb923c",
    pillActiveBorder: "rgba(249,115,22,.45)",
    pillActiveBg: "rgba(249,115,22,.1)",
  },
  "power-platform": {
    eyebrowBg: "rgba(20,184,166,.1)",
    eyebrowBorder: "rgba(20,184,166,.28)",
    eyebrowText: "#2dd4bf",
    midEyebrow: "#2dd4bf",
    railHotBorder: "rgba(20,184,166,.45)",
    railNumBg: "rgba(20,184,166,.12)",
    railNumBorder: "rgba(20,184,166,.4)",
    railNumText: "#2dd4bf",
    projectHover: "rgba(20,184,166,.4)",
    whenColor: "#2dd4bf",
    pillActiveBorder: "rgba(20,184,166,.45)",
    pillActiveBg: "rgba(20,184,166,.1)",
  },
  migration: {
    eyebrowBg: "rgba(96,165,250,.1)",
    eyebrowBorder: "rgba(96,165,250,.28)",
    eyebrowText: "#60a5fa",
    midEyebrow: "#60a5fa",
    railHotBorder: "rgba(96,165,250,.45)",
    railNumBg: "rgba(96,165,250,.12)",
    railNumBorder: "rgba(96,165,250,.4)",
    railNumText: "#60a5fa",
    projectHover: "rgba(96,165,250,.4)",
    whenColor: "#60a5fa",
    pillActiveBorder: "rgba(96,165,250,.45)",
    pillActiveBg: "rgba(96,165,250,.1)",
  },
  "m365-health": {
    eyebrowBg: "rgba(34,197,94,.1)",
    eyebrowBorder: "rgba(34,197,94,.28)",
    eyebrowText: "#4ade80",
    midEyebrow: "#4ade80",
    railHotBorder: "rgba(34,197,94,.45)",
    railNumBg: "rgba(34,197,94,.12)",
    railNumBorder: "rgba(34,197,94,.4)",
    railNumText: "#4ade80",
    projectHover: "rgba(34,197,94,.4)",
    whenColor: "#4ade80",
    pillActiveBorder: "rgba(34,197,94,.45)",
    pillActiveBg: "rgba(34,197,94,.1)",
  },
  // Governance's own page is bespoke and does not consume this map, but its pill entry appears in the
  // other pages' bottom rows, so it needs an active-pill accent (its brand blue, #3b82f6 family).
  governance: {
    eyebrowBg: "rgba(59,130,246,.1)",
    eyebrowBorder: "rgba(59,130,246,.25)",
    eyebrowText: "#60a5fa",
    midEyebrow: "#60a5fa",
    railHotBorder: "rgba(59,130,246,.45)",
    railNumBg: "rgba(59,130,246,.15)",
    railNumBorder: "rgba(59,130,246,.4)",
    railNumText: "#60a5fa",
    projectHover: "rgba(59,130,246,.4)",
    whenColor: "#60a5fa",
    pillActiveBorder: "rgba(59,130,246,.45)",
    pillActiveBg: "rgba(59,130,246,.1)",
  },
};

// The rightward arrow glyph the design uses inside CTAs and the scan-step rail (stroke = currentColor).
export function ArrowIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14 6 20 12 14 18" />
    </svg>
  );
}

// The muted arrow between horizontal rail steps (stroke #475569, width 2).
function RailArrow() {
  return (
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
  );
}

// The gradient "Scan My Tenant · Free" primary CTA. Size variants match the design's hero (medium)
// and closing (large) uses.
export function ScanCta({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <Link
      href="/scan"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: big ? "8px" : "7px",
        padding: big ? "13px 26px" : "12px 22px",
        borderRadius: big ? "11px" : "10px",
        fontWeight: 700,
        fontSize: big ? "14px" : "13.5px",
        color: "#fff",
        background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
        whiteSpace: "nowrap",
      }}
    >
      Scan My Tenant · Free <ArrowIcon size={15} />
    </Link>
  );
}

// The hero artefact card shell shared by the five "estate panel" pages (SharePoint, Teams, Power
// Platform, Migration, M365 Health): the semi-opaque card with an eyebrow title on the left and the
// "Illustrative" tag on the right, then the page's own body.
export function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: "1 1 380px",
        maxWidth: "500px",
        border: "1px solid rgba(30,41,59,.95)",
        borderRadius: "18px",
        background: "#0b1524",
        padding: "22px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 700,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 600,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "#475569",
          }}
        >
          Illustrative
        </span>
      </div>
      {children}
    </div>
  );
}

// A single finding row inside an estate panel: a big tabular count, then a description. Three severity
// tones match the design (red / amber / neutral).
type FindingTone = "red" | "amber" | "neutral";
const FINDING_TONES: Record<FindingTone, { border: string; bg: string; value: string }> = {
  red: { border: "rgba(248,113,113,.28)", bg: "rgba(248,113,113,.05)", value: "#f87171" },
  amber: { border: "rgba(251,191,36,.25)", bg: "rgba(251,191,36,.05)", value: "#fbbf24" },
  neutral: { border: "rgba(30,41,59,.9)", bg: "rgba(2,6,23,.4)", value: "#e2e8f0" },
};
export function FindingRow({
  tone,
  value,
  children,
}: {
  tone: FindingTone;
  value: string;
  children: React.ReactNode;
}) {
  const t = FINDING_TONES[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 12px",
        border: `1px solid ${t.border}`,
        borderRadius: "10px",
        background: t.bg,
      }}
    >
      <b
        style={{
          fontSize: "18px",
          fontWeight: 800,
          color: t.value,
          fontVariantNumeric: "tabular-nums",
          flex: "none",
          width: "34px",
          textAlign: "right",
        }}
      >
        {value}
      </b>
      <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

export interface RailStep {
  n: string;
  title: string;
  body: string;
}

// The horizontal, arrow-linked step rail used in the mid band of the five rail-shaped pages
// (SharePoint waves, Teams lifecycle, Power Platform chain, Migration waves, M365 Health loop). The
// first step is "hot" (accent border + accent number tile); the rest are neutral.
function StepRail({
  steps,
  accent,
  width = 200,
}: {
  steps: RailStep[];
  accent: Accent;
  width?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        gap: "10px",
        flexWrap: "wrap",
        marginBottom: "20px",
      }}
    >
      {steps.map((s, i) => {
        const hot = i === 0;
        return (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: `${width}px`,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "15px",
                borderRadius: "14px",
                background: "#0b1524",
                border: `1px solid ${hot ? accent.railHotBorder : "rgba(30,41,59,.9)"}`,
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
                  background: hot ? accent.railNumBg : "rgba(255,255,255,.05)",
                  border: `1px solid ${hot ? accent.railNumBorder : "rgba(255,255,255,.1)"}`,
                  color: hot ? accent.railNumText : "#94a3b8",
                }}
              >
                {s.n}
              </span>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{s.title}</span>
              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{s.body}</span>
            </div>
            {i < steps.length - 1 ? <RailArrow /> : null}
          </div>
        );
      })}
    </div>
  );
}

export interface InfoCard {
  eyebrow: string;
  body: React.ReactNode;
  accent?: { border: string; bg: string; eyebrowColor: string };
  link?: { label: string; href: string; color: string };
}

// The two side-by-side info cards below the rail. The left card is neutral; the right card is often
// accent-tinted with a trailing link (the design's "The Copilot connection", "Watched after the
// fix", etc).
function InfoCards({ cards }: { cards: InfoCard[] }) {
  return (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
      {cards.map((c, i) => (
        <div
          key={i}
          style={{
            flex: "1 1 320px",
            minWidth: 0,
            border: `1px solid ${c.accent ? c.accent.border : "rgba(30,41,59,.95)"}`,
            borderRadius: "14px",
            background: c.accent ? c.accent.bg : "#0b1524",
            padding: "16px 18px",
          }}
        >
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: c.accent ? c.accent.eyebrowColor : "#94a3b8",
            }}
          >
            {c.eyebrow}
          </span>
          <p
            style={{
              fontSize: "11.5px",
              color: "#94a3b8",
              lineHeight: 1.65,
              margin: c.link ? "9px 0 10px" : "9px 0 0",
            }}
          >
            {c.body}
          </p>
          {c.link ? (
            <Link
              href={c.link.href}
              style={{ fontSize: "11.5px", fontWeight: 700, color: c.link.color }}
            >
              {c.link.label} →
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export interface Project {
  name: string;
  body: string;
  when: string;
}

// The "work, by name" projects grid. Cards link into the full solutions index (design: every card
// links to Marketing Solutions.dc.html). Hover intensifies the border to the page accent — done via
// a scoped <style> keyed to the slug, since React inline styles can't express :hover.
function ProjectsGrid({
  slug,
  eyebrow,
  heading,
  sub,
  projects,
  accent,
}: {
  slug: SolSlug;
  eyebrow: string;
  heading: string;
  sub?: string;
  projects: Project[];
  accent: Accent;
}) {
  const cls = `sol-proj-${slug}`;
  return (
    <section style={{ padding: "44px 32px 40px" }}>
      <style>{`.${cls}:hover{border-color:${accent.projectHover}!important}`}</style>
      <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
            marginBottom: "20px",
          }}
        >
          <div style={{ maxWidth: sub ? "680px" : "640px" }}>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: "#60a5fa",
              }}
            >
              {eyebrow}
            </span>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 800,
                letterSpacing: "-.025em",
                color: "#f8fafc",
                margin: "8px 0 10px",
              }}
            >
              {heading}
            </h2>
            {sub ? (
              <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>{sub}</p>
            ) : null}
          </div>
          <Link
            href="/solutions"
            style={{ fontSize: "12.5px", fontWeight: 700, color: "#60a5fa", whiteSpace: "nowrap" }}
          >
            Browse all 33 projects →
          </Link>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
            gap: "12px",
          }}
        >
          {projects.map((p) => (
            <Link
              key={p.name}
              href="/solutions"
              className={cls}
              style={{
                border: "1px solid rgba(30,41,59,.95)",
                borderRadius: "14px",
                background: "#0b1524",
                padding: "18px",
                display: "flex",
                flexDirection: "column",
                gap: "7px",
                transition: "border-color 200ms",
              }}
            >
              <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f8fafc", lineHeight: 1.4 }}>
                {p.name}
              </span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, flexGrow: 1 }}>
                {p.body}
              </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: accent.whenColor }}>{p.when}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// The bottom deep-dive pill row: the active page as a filled accent pill, the rest as outlined links,
// and a "Watched under: <pillar> · <pillar>" note on the right.
function DeepDivePillRow({
  active,
  order,
  watchedUnder,
  accent,
}: {
  active: SolSlug;
  order: SolSlug[];
  watchedUnder: { label: string; href: string }[];
  accent: Accent;
}) {
  const byslug = (s: SolSlug) => DIVE_PILLS.find((d) => d.slug === s)!;
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
            Deep dives
          </span>
          {order.map((slug) => {
            const pill = byslug(slug);
            if (slug === active) {
              return (
                <span
                  key={slug}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 11px",
                    borderRadius: "999px",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    color: "#f8fafc",
                    border: `1px solid ${accent.pillActiveBorder}`,
                    background: accent.pillActiveBg,
                  }}
                >
                  {pill.label}
                </span>
              );
            }
            return (
              <Link
                key={slug}
                href={`/solutions/${slug}`}
                style={{
                  padding: "6px 11px",
                  borderRadius: "999px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  color: "#94a3b8",
                  border: "1px solid rgba(30,41,59,.9)",
                }}
              >
                {pill.label}
              </Link>
            );
          })}
        </div>
        <span style={{ fontSize: "11px", color: "#64748b" }}>
          Watched under:{" "}
          {watchedUnder.map((w, i) => (
            <React.Fragment key={w.href}>
              {i > 0 ? " · " : null}
              <Link href={w.href} style={{ color: "#60a5fa", fontWeight: 600 }}>
                {w.label}
              </Link>
            </React.Fragment>
          ))}
        </span>
      </div>
    </section>
  );
}

// The closing "From Scan to Scoped Work" band — the same four scan steps on every page (verbatim),
// with a per-page intro paragraph. The hot (first) step is always the brand blue, regardless of the
// page's own accent (matches the design's shared stepCss).
function buildScanSteps(checkCount: number): { n: string; title: string; body: string }[] {
  return [
    { n: "1", title: "Run the free scan", body: `Read-only Graph scan. ${checkCount} checks, all six pillars.` },
    { n: "2", title: "Get a priced SOW", body: "Findings become named phases with fixed prices." },
    { n: "3", title: "Select your scopes", body: "Keep, defer or drop each phase before signing." },
    { n: "4", title: "Sign, pay, onboard", body: "Account, portal and remediation window in one pass." },
  ];
}

function ScanToScopedWork({ intro }: { intro: string }) {
  const checkCount = useSignalCheckCount();
  const SCAN_STEPS = buildScanSteps(checkCount);
  return (
    <section style={{ padding: "32px 32px 56px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
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
        {SCAN_STEPS.map((s, i) => {
          const hot = i === 0;
          return (
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
                  border: `1px solid ${hot ? "rgba(59,130,246,.45)" : "rgba(30,41,59,.9)"}`,
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
                    background: hot ? "rgba(59,130,246,.15)" : "rgba(255,255,255,.05)",
                    border: `1px solid ${hot ? "rgba(59,130,246,.4)" : "rgba(255,255,255,.1)"}`,
                    color: hot ? "#60a5fa" : "#94a3b8",
                  }}
                >
                  {s.n}
                </span>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{s.title}</span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{s.body}</span>
              </div>
              {i < SCAN_STEPS.length - 1 ? <RailArrow /> : null}
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: "center", marginTop: "26px" }}>
        <ScanCta size="lg" />
        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "10px" }}>
          Read-only. No agent, no charge, and the findings are yours either way.
        </div>
      </div>
    </section>
  );
}

// The full data contract for one of the six same-shaped deep-dive pages.
export interface DeepDiveData {
  slug: SolSlug;
  navCurrent?: "watch" | "solutions";
  // hero
  eyebrowLabel: string;
  eyebrowIcon: React.ReactNode;
  h1: React.ReactNode;
  heroPara1: string;
  heroPara2: string;
  secondaryCta: { label: string; href: string };
  bullets: string[];
  heroPanel: React.ReactNode;
  // mid band
  midEyebrow: string;
  midH2: string;
  midPara: string;
  rail?: RailStep[];
  railWidth?: number;
  infoCards?: InfoCard[];
  // Copilot replaces the rail+cards with a bespoke inner body, and can add a trailing banner.
  midBandOverride?: React.ReactNode;
  postMidBanner?: React.ReactNode;
  // projects
  projectsEyebrow: string;
  projectsH2: string;
  projectsSub?: string;
  projects: Project[];
  // bottom pill row
  pillOrder: SolSlug[];
  watchedUnder: { label: string; href: string }[];
  // closing band
  scanIntro: string;
}

// Renders one complete same-shaped deep-dive page inside the shared marketing shell.
export function SolutionDeepDive(d: DeepDiveData) {
  const accent = ACCENTS[d.slug];
  return (
    <MarketingLayout current={d.navCurrent ?? "watch"}>
      {/* Hero */}
      <section style={{ padding: "48px 32px 30px" }}>
        <div
          style={{
            maxWidth: "1120px",
            margin: "0 auto",
            display: "flex",
            gap: "44px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1.1 1 380px", minWidth: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: accent.eyebrowBg,
                border: `1px solid ${accent.eyebrowBorder}`,
                color: accent.eyebrowText,
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: "18px",
              }}
            >
              {d.eyebrowIcon} {d.eyebrowLabel}
            </span>
            <h1
              style={{
                fontSize: "clamp(30px,3.4vw,40px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.12,
                color: "#f8fafc",
                margin: "0 0 16px",
                textWrap: "pretty",
              }}
            >
              {d.h1}
            </h1>
            <p
              style={{
                fontSize: "15px",
                color: "#94a3b8",
                lineHeight: 1.7,
                margin: "0 0 12px",
                maxWidth: "54ch",
              }}
            >
              {d.heroPara1}
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                lineHeight: 1.7,
                margin: "0 0 24px",
                maxWidth: "54ch",
              }}
            >
              {d.heroPara2}
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "22px" }}>
              <ScanCta />
              <Link
                href={d.secondaryCta.href}
                style={{
                  padding: "12px 22px",
                  borderRadius: "10px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  color: "#cbd5e1",
                  border: "1px solid rgba(148,163,184,.2)",
                  whiteSpace: "nowrap",
                }}
              >
                {d.secondaryCta.label}
              </Link>
            </div>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {d.bullets.map((b) => (
                <span
                  key={b}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11.5px",
                    color: "#64748b",
                  }}
                >
                  <span
                    style={{ width: "5px", height: "5px", borderRadius: "999px", background: "#34d399" }}
                  />
                  {b}
                </span>
              ))}
            </div>
          </div>

          {d.heroPanel}
        </div>
      </section>

      {/* Mid band */}
      <section
        style={{
          padding: "40px 32px 46px",
          background: "#050d1e",
          borderTop: "1px solid rgba(255,255,255,.05)",
          borderBottom: "1px solid rgba(255,255,255,.05)",
        }}
      >
        <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
          {d.midBandOverride ?? (
            <>
              <div style={{ maxWidth: "680px", marginBottom: "24px" }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".2em",
                    textTransform: "uppercase",
                    color: accent.midEyebrow,
                  }}
                >
                  {d.midEyebrow}
                </span>
                <h2
                  style={{
                    fontSize: "24px",
                    fontWeight: 800,
                    letterSpacing: "-.025em",
                    color: "#f8fafc",
                    margin: "8px 0 10px",
                  }}
                >
                  {d.midH2}
                </h2>
                <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
                  {d.midPara}
                </p>
              </div>
              {d.rail ? <StepRail steps={d.rail} accent={accent} width={d.railWidth} /> : null}
              {d.infoCards ? <InfoCards cards={d.infoCards} /> : null}
            </>
          )}
          {d.postMidBanner ?? null}
        </div>
      </section>

      <ProjectsGrid
        slug={d.slug}
        eyebrow={d.projectsEyebrow}
        heading={d.projectsH2}
        sub={d.projectsSub}
        projects={d.projects}
        accent={accent}
      />

      <DeepDivePillRow active={d.slug} order={d.pillOrder} watchedUnder={d.watchedUnder} accent={accent} />

      <ScanToScopedWork intro={d.scanIntro} />
    </MarketingLayout>
  );
}
