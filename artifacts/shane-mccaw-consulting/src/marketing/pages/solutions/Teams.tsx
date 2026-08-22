import React from "react";
import { SolutionDeepDive, PanelShell, FindingRow, type Project, type RailStep, type InfoCard } from "./_shared";

// Route /solutions/teams — recreated verbatim from
// Design/design_handoff_marketing/Marketing Solutions - Teams.dc.html.

interface YearRow {
  year: string;
  total: number;
  active: number;
}
const YEAR_ROWS: YearRow[] = [
  { year: "2023", total: 51, active: 12 },
  { year: "2024", total: 67, active: 21 },
  { year: "2025", total: 78, active: 35 },
  { year: "2026", total: 52, active: 41 },
];

function Swatch({ color }: { color: string }) {
  return <span style={{ width: "9px", height: "9px", borderRadius: "3px", background: color }} />;
}

function EstatePanel() {
  return (
    <PanelShell title="Teams estate · first scan">
      <span
        style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginBottom: "8px" }}
      >
        248 teams · created vs still active, by year
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "16px" }}>
        {YEAR_ROWS.map((y) => {
          const activePct = Math.round((y.active / y.total) * 100);
          return (
            <div key={y.year} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                style={{ width: "38px", flex: "none", fontSize: "10.5px", color: "#64748b", fontVariantNumeric: "tabular-nums" }}
              >
                {y.year}
              </span>
              <div
                style={{
                  flex: 1,
                  height: "14px",
                  borderRadius: "999px",
                  background: "rgba(2,6,23,.6)",
                  overflow: "hidden",
                  display: "flex",
                }}
              >
                <div style={{ width: `${activePct}%`, height: "100%", background: "#fb923c" }} />
                <div style={{ width: `${100 - activePct}%`, height: "100%", background: "rgba(148,163,184,.18)" }} />
              </div>
              <span
                style={{ width: "110px", flex: "none", fontSize: "10.5px", color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}
              >
                {y.active} of {y.total} still active
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="#fb923c" />
          Active in the last 90 days
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="rgba(148,163,184,.25)" />
          Silent — kept everything, used by nobody
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <FindingRow tone="red" value="11">
          orphaned teams — no owner at all, members and guests still inside
        </FindingRow>
        <FindingRow tone="amber" value="6">
          channels open wider than their team intended — files included
        </FindingRow>
        <FindingRow tone="neutral" value="3">
          meeting & calling policies drifted from the approved baseline
        </FindingRow>
      </div>
    </PanelShell>
  );
}

const LIFECYCLE: RailStep[] = [
  { n: "1", title: "Born governed", body: "Naming policy, a required owner pair, sensitivity set at creation." },
  { n: "2", title: "Guests time-boxed", body: "External access expires unless the owner renews it." },
  { n: "3", title: "Silence detected", body: "90 days without activity puts a team on the expiry track." },
  { n: "4", title: "Owner asked once", body: "Keep it or lose it — with the archive date attached." },
  { n: "5", title: "Archived, not lost", body: "Content retained per policy, access retired, sprawl ends." },
];

const INFO_CARDS: InfoCard[] = [
  {
    eyebrow: "Guests are the sharp edge",
    body: "A guest invited for one project keeps access until someone removes it — and nobody’s job is removing it. Guest review with expiry turns “forever” into “until the review says otherwise”, and the Security Engine flags the stale ones that slip through.",
  },
  {
    eyebrow: "Phones and rooms are policy too",
    body: "Teams Phone and Teams Rooms fail the same way — licences assigned ad hoc, calling policies copied from whoever set up the last one. Both are named projects below, configured once and then watched for drift like everything else.",
  },
];

const PROJECTS: Project[] = [
  {
    name: "Teams Sprawl & Lifecycle Automation",
    body: "The loop above, built into your tenant: naming, ownership, expiry, guest review and archiving that run without anyone remembering to.",
    when: "The structural fix",
  },
  {
    name: "External Sharing & Guest Access Governance",
    body: "Every guest accounted for — who invited them, what they can reach, when it expires — across Teams, SharePoint and OneDrive in one policy.",
    when: "When guests are the risk",
  },
  {
    name: "Teams Phone License & Calling Policy Configuration",
    body: "Calling plans, policies and licensing configured deliberately instead of copied forward — and reconciled against what telephony actually costs.",
    when: "When phones join Teams",
  },
  {
    name: "Teams Rooms License & Policy Configuration",
    body: "Room accounts, licences and meeting policies set up as managed objects with owners — not shared mailboxes with a screen attached.",
    when: "When rooms misbehave",
  },
];

export default function SolutionTeams() {
  return (
    <SolutionDeepDive
      slug="teams"
      eyebrowLabel="Deep dive · Teams"
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
          <circle cx="9" cy="8" r="3.2" />
          <path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" />
          <circle cx="17.5" cy="9" r="2.4" />
          <path d="M15.5 14.6c2.8.3 5 2.2 5 5.4" />
        </svg>
      }
      h1="Teams multiply. Owners don’t."
      heroPara1="Every project spawns a team, every team spawns channels, files and guests — and when the project ends, all of it stays. Ownerless teams keep their members, their guests and their data, reachable forever, governed by nobody."
      heroPara2="The panel alongside is what a first scan of a typical Teams estate returns."
      secondaryCta={{ label: "See Monitoring Pricing", href: "/monitoring" }}
      bullets={["Team lifecycle", "External guest access", "Meeting & calling policy"]}
      heroPanel={<EstatePanel />}
      midEyebrow="Lifecycle"
      midH2="Sprawl isn’t a cleanup project. It’s the absence of a lifecycle."
      midPara="Delete the dead teams today and you’re back here in eighteen months. The fix is a loop that runs without you — naming, ownership, expiry and guest review enforced from the day a team is born."
      rail={LIFECYCLE}
      infoCards={INFO_CARDS}
      projectsEyebrow="The work, by name"
      projectsH2="Four named Teams projects. Priced against your scan, not a rate card."
      projects={PROJECTS}
      pillOrder={["copilot", "sharepoint", "teams", "power-platform", "migration", "m365-health", "governance"]}
      watchedUnder={[
        { label: "Governance", href: "/pillars/governance" },
        { label: "Adoption", href: "/pillars/adoption" },
      ]}
      scanIntro="The free scan reads your real team lifecycle, guest access and policy state. Findings become a scoped, priced statement of work — and the estate panel on this page becomes yours, with real numbers in it."
    />
  );
}
