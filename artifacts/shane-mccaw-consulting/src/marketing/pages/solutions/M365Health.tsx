import React from "react";
import { SolutionDeepDive, PanelShell, type Project, type RailStep, type InfoCard } from "./_shared";

// Route /solutions/m365-health — recreated verbatim from
// Design/design_handoff_marketing/Marketing Solutions - M365 Health.dc.html.

// Score → tone, matching the design's tone(v).
function tone(v: number): string {
  return v >= 85 ? "#34d399" : v >= 60 ? "#fbbf24" : "#f87171";
}

interface PillarScore {
  label: string;
  value: number;
}
const PILLAR_SCORES: PillarScore[] = [
  { label: "Licensing", value: 90 },
  { label: "Security", value: 74 },
  { label: "Compliance", value: 71 },
  { label: "Copilot readiness", value: 66 },
  { label: "Health", value: 63 },
  { label: "Governance", value: 58 },
  { label: "Adoption", value: 52 },
];

interface StatTile {
  value: string;
  label: string;
  tone: "amber" | "red";
}
const STAT_TILES: StatTile[] = [
  { value: "46", label: "inactive licences", tone: "amber" },
  { value: "12", label: "duplicate licences", tone: "amber" },
  { value: "2", label: "high-severity alerts", tone: "red" },
  { value: "5", label: "overdue reviews", tone: "red" },
];
const TILE_TONES = {
  amber: { border: "rgba(251,191,36,.25)", bg: "rgba(251,191,36,.05)", value: "#fbbf24" },
  red: { border: "rgba(248,113,113,.3)", bg: "rgba(248,113,113,.06)", value: "#f87171" },
};

function HealthPanel() {
  return (
    <PanelShell title="Tenant health · first readout">
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: "92px", height: "92px", flex: "none" }}>
          <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(148,163,184,.12)" strokeWidth="9" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray="166.3 263.9"
            />
          </svg>
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <b style={{ fontSize: "24px", fontWeight: 800, color: "#fbbf24", fontVariantNumeric: "tabular-nums" }}>
              63
            </b>
            <span
              style={{
                fontSize: "8.5px",
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              of 100
            </span>
          </span>
        </div>
        <div style={{ flex: 1, minWidth: "180px", fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>
          Composite of seven scored dimensions. Remediating the current findings takes this tenant to{" "}
          <b style={{ color: "#34d399" }}>90</b> — and the SOW that does it is priced from the same scan.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "14px" }}>
        {PILLAR_SCORES.map((p) => {
          const fg = tone(p.value);
          return (
            <div key={p.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ width: "118px", flex: "none", fontSize: "11px", color: "#cbd5e1", fontWeight: 600 }}>
                {p.label}
              </span>
              <div
                style={{ flex: 1, height: "10px", borderRadius: "999px", background: "rgba(2,6,23,.6)", overflow: "hidden" }}
              >
                <div
                  style={{
                    width: `${p.value}%`,
                    height: "100%",
                    borderRadius: "999px",
                    background: `linear-gradient(90deg,${fg}33,${fg})`,
                  }}
                />
              </div>
              <b
                style={{
                  width: "26px",
                  flex: "none",
                  textAlign: "right",
                  fontSize: "11.5px",
                  fontWeight: 800,
                  color: fg,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {p.value}
              </b>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {STAT_TILES.map((t) => {
          const tt = TILE_TONES[t.tone];
          return (
            <span
              key={t.label}
              style={{
                flex: 1,
                minWidth: "100px",
                textAlign: "center",
                padding: "8px 6px",
                borderRadius: "9px",
                border: `1px solid ${tt.border}`,
                background: tt.bg,
              }}
            >
              <b
                style={{
                  display: "block",
                  fontSize: "15px",
                  fontWeight: 800,
                  color: tt.value,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.value}
              </b>
              <span style={{ fontSize: "9.5px", color: "#94a3b8" }}>{t.label}</span>
            </span>
          );
        })}
      </div>
    </PanelShell>
  );
}

const LOOP: RailStep[] = [
  { n: "1", title: "Checks run", body: "30–133 checks per cycle, every one a pass or a finding." },
  { n: "2", title: "Findings score", body: "Each finding subtracts from its pillar, weighted by severity." },
  { n: "3", title: "Pillars roll up", body: "Seven scores compose into the one number worth reporting." },
  { n: "4", title: "Work moves it", body: "Runbooks and SOWs close findings; the score records the gain." },
];

const INFO_CARDS: InfoCard[] = [
  {
    eyebrow: "Health pays for itself in licensing",
    body: "The same readout that scores the tenant finds the idle and duplicate licences funding it. In most first scans the recoverable licence spend covers the monitoring subscription several times over — the Licensing pillar page walks through it.",
  },
  {
    eyebrow: "Not the same as the Health pillar",
    accent: { border: "rgba(34,197,94,.3)", bg: "rgba(34,197,94,.05)", eyebrowColor: "#4ade80" },
    body: (
      <>
        This page is your tenant’s vitals. The <b style={{ color: "#e2e8f0" }}>Health pillar</b> watches the
        other side: Microsoft’s own Message Center and roadmap changes, scored against your configuration
        before they land.
      </>
    ),
    link: { label: "Read the Health pillar", href: "/pillars/health", color: "#4ade80" },
  },
];

const PROJECTS: Project[] = [
  {
    name: "License Waste Optimization & Cost Recovery",
    body: "The 46 inactive and 12 duplicate licences in the readout, reclaimed — usually the fastest score gain and the one that funds the rest.",
    when: "Fastest payback",
  },
  {
    name: "Drift Baseline & Handover",
    body: "The approved configuration recorded as the baseline, so next quarter’s score measures drift from a known-good state instead of a guess.",
    when: "Make it hold",
  },
  {
    name: "Governance Remediation & Architecture Hardening",
    body: "The structural work behind a weak Governance score — ownership, change control and sharing policy brought back under control.",
    when: "The deep fix",
  },
];

export default function SolutionM365Health() {
  return (
    <SolutionDeepDive
      slug="m365-health"
      eyebrowLabel="Deep dive · M365 Health"
      eyebrowIcon={
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 12 8 12 11 19 14 5 17 12 21 12" />
        </svg>
      }
      h1="When the board asks “is Microsoft 365 fine?”, this is the number."
      heroPara1="Not a feeling, not a helpdesk anecdote — a composite health score rolled up from every pillar the platform watches, with the idle spend, the overdue reviews and the open alerts that explain it sitting one click below."
      heroPara2="The panel alongside is a typical tenant’s first health readout. The composite is only as good as its worst pillar — which is the point."
      secondaryCta={{ label: "See Monitoring Pricing", href: "/monitoring" }}
      bullets={["One composite score", "Recalculated every check cycle", "Evidence one click down"]}
      heroPanel={<HealthPanel />}
      midEyebrow="Why one number works"
      midH2="A score you can’t argue with, because the evidence is attached."
      midPara="Health scores fail when they’re vibes with a gauge. This one is arithmetic over findings — every point lost traces to specific items a click away, and every point gained names the work that earned it."
      rail={LOOP}
      railWidth={210}
      infoCards={INFO_CARDS}
      projectsEyebrow="The work, by name"
      projectsH2="The projects a health readout most often triggers."
      projects={PROJECTS}
      pillOrder={["copilot", "sharepoint", "teams", "power-platform", "migration", "m365-health", "governance"]}
      watchedUnder={[
        { label: "Health", href: "/pillars/health" },
        { label: "Licensing", href: "/pillars/licensing" },
      ]}
      scanIntro="The free scan produces this exact readout for your tenant — the composite, the seven scores, and the findings under them. What it finds becomes a scoped, priced statement of work."
    />
  );
}
