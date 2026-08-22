import React from "react";
import { Link } from "wouter";
import { SolutionDeepDive, ArrowIcon, type Project } from "./_shared";

// Route /solutions/copilot — recreated verbatim from
// Design/design_handoff_marketing/Marketing Solutions - Copilot.dc.html. Copy, colours and layout
// are the design's own. The hero artefact (reach rows) and the mid-band (bad-path vs good-path) are
// bespoke to this page, so they are built here; the rest of the skeleton comes from SolutionDeepDive.

// ── Hero artefact: what Copilot's index can reach, on the first scan ──────────────────────────────
interface ReachRow {
  label: string;
  value: string;
  pct: number;
  color: string;
  sub: string;
}
const REACH_ROWS: ReachRow[] = [
  {
    label: "Files & messages Copilot will index",
    value: "2.1M",
    pct: 100,
    color: "#60a5fa",
    sub: "Everything the permission model exposes to licensed users.",
  },
  {
    label: "Reachable beyond their intended audience",
    value: "214,000",
    pct: 34,
    color: "#fbbf24",
    sub: "Open links, broken inheritance, org-wide groups used as ACLs.",
  },
  {
    label: "Sensitive and unlabelled among those",
    value: "3,400",
    pct: 9,
    color: "#f87171",
    sub: "Salary, legal and board material with no label — indistinguishable from a lunch menu.",
  },
];

function ReachPanel() {
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
          What Copilot can reach · first scan
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
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {REACH_ROWS.map((r) => (
          <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#cbd5e1" }}>{r.label}</span>
              <b
                style={{
                  fontSize: "14px",
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                  color: r.color,
                }}
              >
                {r.value}
              </b>
            </div>
            <div
              style={{
                height: "12px",
                borderRadius: "999px",
                background: "rgba(2,6,23,.6)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${r.pct}%`,
                  height: "100%",
                  borderRadius: "999px",
                  background: `linear-gradient(90deg,${r.color}33,${r.color})`,
                }}
              />
            </div>
            <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>{r.sub}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginTop: "16px",
          paddingTop: "14px",
          borderTop: "1px solid rgba(30,41,59,.9)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
          <b
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: "#f87171",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            66
          </b>
          <span style={{ fontSize: "11.5px", color: "#64748b" }}>readiness</span>
        </span>
        <span style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
          <b
            style={{
              fontSize: "16px",
              fontWeight: 800,
              color: "#34d399",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            82
          </b>
          <span style={{ fontSize: "11.5px", color: "#64748b" }}>gate</span>
        </span>
        <span style={{ flex: 1, minWidth: "160px", fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>
          Rollout blocked by <b style={{ color: "#f87171" }}>6 findings</b> — every one of them fixable,
          and priced, before a single seat is assigned.
        </span>
      </div>
    </div>
  );
}

// ── Mid band: the two deployment-order columns ───────────────────────────────────────────────────
interface PathStep {
  title: string;
  body: React.ReactNode;
  color: string;
  hollow?: boolean;
  end?: boolean;
}
const BAD_PATH: PathStep[] = [
  {
    title: "Buy 300 seats",
    body: "The licence spend is committed before anyone has read the tenant.",
    color: "#94a3b8",
    hollow: true,
  },
  {
    title: "Enable for everyone",
    body: "The index inherits every oversharing decision of the last decade.",
    color: "#94a3b8",
    hollow: true,
  },
  {
    title: "Week two",
    body: "“Summarise what we pay the leadership team” returns an answer.",
    color: "#fbbf24",
    hollow: true,
  },
  {
    title: "Rollout paused",
    body: "Legal owns the incident, adoption never recovers, seats keep billing.",
    color: "#f87171",
    end: true,
  },
];
const GOOD_PATH: PathStep[] = [
  {
    title: "Free readiness scan",
    body: "The exact reachable surface, measured before any spend.",
    color: "#60a5fa",
  },
  {
    title: "Exposure remediated",
    body: "Open links closed, labels applied, permissions rebuilt — as a priced SOW.",
    color: "#60a5fa",
  },
  {
    title: "Gate passed at 82",
    body: "The score clears the threshold with evidence, not optimism.",
    color: "#60a5fa",
  },
  {
    title: "Pilot, then seats",
    body: "A pilot group with usage policy in place, then licences that match reality.",
    color: "#60a5fa",
  },
  {
    title: "Watched hourly",
    body: "The Drift Engine keeps the reachable surface from quietly reopening.",
    color: "#34d399",
    end: true,
  },
];

function dotStyle(color: string, hollow?: boolean): React.CSSProperties {
  return {
    width: "11px",
    height: "11px",
    borderRadius: "999px",
    flex: "none",
    marginTop: "3px",
    ...(hollow
      ? { border: `2px solid ${color}`, background: "transparent" }
      : { background: color, boxShadow: `0 0 0 3px ${color}22` }),
  };
}

function PathColumn({
  badge,
  badgeStyle,
  border,
  steps,
}: {
  badge: string;
  badgeStyle: React.CSSProperties;
  border: string;
  steps: PathStep[];
}) {
  return (
    <div
      style={{
        flex: "1 1 340px",
        minWidth: 0,
        border: `1px solid ${border}`,
        borderRadius: "16px",
        background: "#0b1524",
        padding: "20px",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          padding: "4px 10px",
          borderRadius: "999px",
          fontSize: "9.5px",
          fontWeight: 700,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          marginBottom: "14px",
          ...badgeStyle,
        }}
      >
        {badge}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {steps.map((s, i) => (
          <div key={s.title} style={{ display: "flex", gap: "12px" }}>
            <div
              style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}
            >
              <span style={dotStyle(s.color, s.hollow)} />
              {i < steps.length - 1 ? (
                <span
                  style={{
                    width: "1px",
                    flex: 1,
                    minHeight: "18px",
                    background: "rgba(148,163,184,.15)",
                  }}
                />
              ) : null}
            </div>
            <div style={{ paddingBottom: "14px", minWidth: 0 }}>
              <div
                style={{ fontSize: "12.5px", fontWeight: 700, color: s.end ? s.color : "#f8fafc" }}
              >
                {s.title}
              </div>
              <div
                style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, marginTop: "2px" }}
              >
                {s.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeploymentOrder() {
  return (
    <>
      <div style={{ maxWidth: "680px", marginBottom: "22px" }}>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: "#a78bfa",
          }}
        >
          Deployment order
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
          The order of operations decides whether Copilot is an advantage or a headline.
        </h2>
        <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
          Most failed rollouts run the same script: buy seats, enable, apologise. The work is identical
          either way — permissions, labels, licensing — the only variable is whether it happens before
          or after someone asks Copilot the wrong question.
        </p>
      </div>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <PathColumn
          badge="How it usually goes"
          badgeStyle={{
            background: "rgba(248,113,113,.1)",
            border: "1px solid rgba(248,113,113,.3)",
            color: "#f87171",
          }}
          border="rgba(248,113,113,.28)"
          steps={BAD_PATH}
        />
        <PathColumn
          badge="How it goes here"
          badgeStyle={{
            background: "rgba(52,211,153,.08)",
            border: "1px solid rgba(52,211,153,.28)",
            color: "#34d399",
          }}
          border="rgba(52,211,153,.3)"
          steps={GOOD_PATH}
        />
      </div>
    </>
  );
}

function DriftBanner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
        marginTop: "18px",
        border: "1px solid rgba(30,41,59,.95)",
        borderRadius: "14px",
        background: "#0b1524",
        padding: "14px 20px",
      }}
    >
      <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.6 }}>
        After go-live the <b style={{ color: "#e2e8f0" }}>Drift Engine keeps watching what Copilot can
        reach</b> — a new open link or a stripped label shows up as a finding the same hour, not at
        renewal.
      </span>
      <Link
        href="/monitoring"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "7px",
          padding: "10px 18px",
          borderRadius: "10px",
          fontSize: "12.5px",
          fontWeight: 700,
          color: "#fff",
          background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
          whiteSpace: "nowrap",
        }}
      >
        See Monitoring Pricing <ArrowIcon size={14} />
      </Link>
    </div>
  );
}

const PROJECTS: Project[] = [
  {
    name: "Copilot for Microsoft 365 Deployment Project",
    body: "The permission model, labelling and licensing plan behind a safe rollout — for organizations that want it defensible rather than fast.",
    when: "Before the first seat",
  },
  {
    name: "Copilot Data Exposure Remediation",
    body: "Closes the oversharing, unlabelled content and orphaned permissions a readiness scan found — the work that turns a blocked rollout into an approved one.",
    when: "When the scan says no",
  },
  {
    name: "Copilot Adoption & Governance Program",
    body: "Acceptable-use policy, prompt handling, and the adoption work that makes renewal justifiable after the week-one spike collapses.",
    when: "After go-live",
  },
  {
    name: "Adoption Enablement",
    body: "Training and champions for the workloads Copilot sits on — because a licence nobody uses is the most expensive kind.",
    when: "Alongside rollout",
  },
];

export default function SolutionCopilot() {
  return (
    <SolutionDeepDive
      slug="copilot"
      eyebrowLabel="Deep dive · Copilot & AI"
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
          <path d="M12 4a4 4 0 014 4c2 0 4 1.6 4 4a4 4 0 01-2 3.5V17a4 4 0 01-4 4h-4a4 4 0 01-4-4v-1.5A4 4 0 014 12c0-2.4 2-4 4-4a4 4 0 014-4z" />
        </svg>
      }
      h1="Copilot doesn’t leak your data. It reads it out loud."
      heroPara1="Copilot answers from whatever your permission model already exposes. Every overshared site, every “Anyone with the link”, every unlabelled salary file — reachable today, quotable the day the seats go live. The rollout doesn’t create the exposure. It narrates it."
      heroPara2="The panel alongside is what a readiness scan returns for a typical mid-market tenant — the exact surface Copilot’s index will see."
      secondaryCta={{ label: "See a Sample Readiness Report", href: "/scan" }}
      bullets={["The 82 readiness gate", "Read-only Graph scan", "No agent installed"]}
      heroPanel={<ReachPanel />}
      midEyebrow="Deployment order"
      midH2="The order of operations decides whether Copilot is an advantage or a headline."
      midPara=""
      midBandOverride={<DeploymentOrder />}
      postMidBanner={<DriftBanner />}
      projectsEyebrow="The work, by name"
      projectsH2="Four named Copilot projects. No prices until your scan says which ones you need."
      projects={PROJECTS}
      pillOrder={["copilot", "sharepoint", "teams", "power-platform", "migration", "m365-health", "governance"]}
      watchedUnder={[
        { label: "Security", href: "/pillars/security" },
        { label: "Adoption", href: "/pillars/adoption" },
      ]}
      scanIntro="The free scan reads the exact surface Copilot’s index will see. Findings become a scoped, priced statement of work — and the readiness panel on this page becomes yours, with real numbers in it."
    />
  );
}
