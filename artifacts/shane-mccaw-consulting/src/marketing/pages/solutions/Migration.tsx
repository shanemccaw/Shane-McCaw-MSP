import React from "react";
import { SolutionDeepDive, PanelShell, FindingRow, type Project, type RailStep, type InfoCard } from "./_shared";

// Route /solutions/migration — recreated verbatim from
// Design/design_handoff_marketing/Marketing Solutions - Migration.dc.html.

function Swatch({ color }: { color: string }) {
  return <span style={{ width: "9px", height: "9px", borderRadius: "3px", background: color }} />;
}

function SourcePanel() {
  return (
    <PanelShell title="Source environment · pre-migration scan">
      <span
        style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginBottom: "8px" }}
      >
        What’s actually in the 412 accounts you’re quoted for
      </span>
      <div style={{ display: "flex", height: "16px", borderRadius: "999px", overflow: "hidden", marginBottom: "8px" }}>
        <div style={{ width: "66%", background: "#34d399" }} />
        <div style={{ width: "10%", background: "#fbbf24" }} />
        <div style={{ width: "24%", background: "#f87171" }} />
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="#34d399" />
          Live people · <b style={{ color: "#34d399" }}>271</b>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="#fbbf24" />
          Service & shared · <b style={{ color: "#fbbf24" }}>41</b>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="#f87171" />
          Stale — don’t move · <b style={{ color: "#f87171" }}>100</b>
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <FindingRow tone="red" value="41">
          stale accounts still licensed — paying today, quoted for tomorrow
        </FindingRow>
        <FindingRow tone="amber" value="5">
          mailboxes auto-forwarding externally — a data path that must not survive the move
        </FindingRow>
        <FindingRow tone="amber" value="8">
          shared mailboxes with sign-in enabled — standing credentials nobody rotates
        </FindingRow>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "8px",
          marginTop: "12px",
          paddingTop: "11px",
          borderTop: "1px solid rgba(30,41,59,.9)",
        }}
      >
        <b style={{ fontSize: "22px", fontWeight: 800, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>
          ~24%
        </b>
        <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>
          of this migration’s scope shouldn’t move at all — found before the quote, not after the invoice.
        </span>
      </div>
    </PanelShell>
  );
}

const WAVES: RailStep[] = [
  { n: "1", title: "Scan & de-scope", body: "Stale objects found and cut before anything is quoted." },
  { n: "2", title: "Map, don’t copy", body: "Permissions land in the target’s structure, not pasted over it." },
  { n: "3", title: "Pilot wave", body: "One friendly department finds the defects at small scale." },
  { n: "4", title: "Waves with rollback", body: "Each wave has a recorded way back and a freeze check." },
  { n: "5", title: "Baseline & watch", body: "The clean end-state becomes the drift baseline monitoring holds." },
];

const INFO_CARDS: InfoCard[] = [
  {
    eyebrow: "The freeze calendar applies",
    body: "Waves are scheduled against your change-control calendar — nothing cuts over during quarter close or a code freeze. If the tenant is under monitoring, the schedule already knows those dates.",
  },
  {
    eyebrow: "Day one on the new tenant",
    accent: { border: "rgba(96,165,250,.3)", bg: "rgba(96,165,250,.05)", eyebrowColor: "#60a5fa" },
    body: "A migration ends with a baseline: the approved configuration recorded, monitoring switched on, and drift measured from a tenant that started clean — the one time in its life that’s true.",
    link: { label: "See what monitoring covers", href: "/monitoring", color: "#60a5fa" },
  },
];

const PROJECTS: Project[] = [
  {
    name: "Microsoft 365 Migration Execution",
    body: "The full move into Microsoft 365 — mail, files, identity — run in waves with the de-scope done first.",
    when: "Into M365",
  },
  {
    name: "Tenant-to-Tenant Migration",
    body: "Merger, acquisition or divestiture — two tenants become one without either side losing a week of mail.",
    when: "M&A and splits",
  },
  {
    name: "SharePoint Migration",
    body: "File shares and legacy sites moved into a rebuilt architecture — permissions mapped, not copied.",
    when: "Files and sites",
  },
  {
    name: "Exchange Online Hygiene & Modernization",
    body: "Forwarding rules, shared mailbox sign-ins and legacy protocols cleaned up — before or instead of a move.",
    when: "Mail first",
  },
  {
    name: "Intune Deployment & Device Compliance Build-Out",
    body: "Devices enrolled and compliant on the target tenant, so day one isn’t a helpdesk queue.",
    when: "Devices follow",
  },
];

export default function SolutionMigration() {
  return (
    <SolutionDeepDive
      slug="migration"
      eyebrowLabel="Deep dive · Migration"
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
          <path d="M8 3H5a2 2 0 00-2 2v3" />
          <path d="M16 3h3a2 2 0 012 2v3" />
          <path d="M8 21H5a2 2 0 01-2-2v-3" />
          <path d="M16 21h3a2 2 0 002-2v-3" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <polyline points="13 8 17 12 13 16" />
        </svg>
      }
      h1="Don’t pay to move the mess."
      heroPara1="Every migration quote is priced by volume — and a third of that volume is usually stale accounts, dead mailboxes and files nobody has opened since the last migration. Move it and you’ve paid to relocate your problems onto a clean tenant."
      heroPara2="The panel alongside is what a pre-migration scan finds in a typical source environment — before anything is quoted."
      secondaryCta={{ label: "Browse Migration Projects", href: "/solutions" }}
      bullets={["Mailboxes & file shares read first", "Waves, not big-bang", "Rollback point per wave"]}
      heroPanel={<SourcePanel />}
      midEyebrow="How it runs"
      midH2="Clean first. Move in waves. Keep a way back."
      midPara="Big-bang cutovers fail loudly and unrecoverably. Waves fail small — one pilot group finds the broken permission mapping, one rollback point undoes it, and the next wave ships without the defect."
      rail={WAVES}
      infoCards={INFO_CARDS}
      projectsEyebrow="The work, by name"
      projectsH2="Five named migration projects. Priced against your scan, not your volume."
      projects={PROJECTS}
      pillOrder={["copilot", "sharepoint", "teams", "power-platform", "migration", "m365-health", "governance"]}
      watchedUnder={[
        { label: "Governance", href: "/pillars/governance" },
        { label: "Health", href: "/pillars/health" },
      ]}
      scanIntro="The free scan reads the source environment — mailboxes, file shares, stale objects, tenant configuration. Findings become a scoped, priced statement of work — including what not to move."
    />
  );
}
