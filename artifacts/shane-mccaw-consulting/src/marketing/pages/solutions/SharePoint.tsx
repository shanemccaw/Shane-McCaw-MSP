import React from "react";
import { SolutionDeepDive, PanelShell, FindingRow, type Project, type RailStep, type InfoCard } from "./_shared";

// Route /solutions/sharepoint — recreated verbatim from
// Design/design_handoff_marketing/Marketing Solutions - SharePoint.dc.html.

// Stacked sharing-link legend swatch.
function Swatch({ color }: { color: string }) {
  return <span style={{ width: "9px", height: "9px", borderRadius: "3px", background: color }} />;
}

function EstatePanel() {
  return (
    <PanelShell title="SharePoint estate · first scan">
      <span
        style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginBottom: "7px" }}
      >
        How 1,840 active sharing links are scoped
      </span>
      <div style={{ display: "flex", height: "16px", borderRadius: "999px", overflow: "hidden", marginBottom: "8px" }}>
        <div style={{ width: "9%", background: "#f87171" }} title="Anyone with the link" />
        <div style={{ width: "34%", background: "#fbbf24" }} />
        <div style={{ width: "57%", background: "#34d399" }} />
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="#f87171" />
          Anyone with the link · <b style={{ color: "#f87171" }}>166</b>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="#fbbf24" />
          Whole organization · <b style={{ color: "#fbbf24" }}>625</b>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#94a3b8" }}>
          <Swatch color="#34d399" />
          Specific people · <b style={{ color: "#34d399" }}>1,049</b>
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <FindingRow tone="red" value="31">
          orphaned sites — the owner left, nobody inherited them, content still reachable
        </FindingRow>
        <FindingRow tone="amber" value="12">
          overshared sites — broken inheritance chains granting far past the intended audience
        </FindingRow>
        <FindingRow tone="neutral" value="4">
          admin-level drift findings — tenant sharing settings moved since the baseline
        </FindingRow>
      </div>
      <div
        style={{
          fontSize: "10.5px",
          color: "#64748b",
          lineHeight: 1.6,
          marginTop: "12px",
          paddingTop: "11px",
          borderTop: "1px solid rgba(30,41,59,.9)",
        }}
      >
        Every number here is a real, inspectable finding with the sites and links attached — not a
        questionnaire score.
      </div>
    </PanelShell>
  );
}

const WAVES: RailStep[] = [
  { n: "1", title: "Inventory & rank", body: "Every link and break, ranked by what it exposes." },
  { n: "2", title: "Owners notified", body: "Site owners confirm what is still needed, with a deadline." },
  { n: "3", title: "Links expire in waves", body: "Anyone-links first, org-wide next — never during a freeze." },
  { n: "4", title: "Inheritance rebuilt", body: "Custom permissions collapsed back into structure." },
  { n: "5", title: "Watched for regrowth", body: "New open links surface as findings the same hour." },
];

const INFO_CARDS: InfoCard[] = [
  {
    eyebrow: "Why architecture is the other half",
    body: "Oversharing is usually a symptom. Sites without a hub structure, permissions customised because the structure didn’t fit, metadata nobody maintains — information architecture decides whether people find things or give up. It also decides what Copilot can surface, and to whom.",
  },
  {
    eyebrow: "The Copilot connection",
    accent: { border: "rgba(139,92,246,.3)", bg: "rgba(139,92,246,.05)", eyebrowColor: "#a78bfa" },
    body: "Most SharePoint remediation is discovered while preparing for Copilot — its index reads exactly what your permission model exposes. Fix SharePoint and the readiness gate moves.",
    link: { label: "Read the Copilot & AI deep dive", href: "/solutions/copilot", color: "#a78bfa" },
  },
];

const PROJECTS: Project[] = [
  {
    name: "Sharing Exposure Remediation",
    body: "A scan already found the overshared sites, broken inheritance and open links — this closes them safely, in sequence with the business, without breaking live work.",
    when: "When the scan says so",
  },
  {
    name: "SharePoint & Teams IA Rebuild",
    body: "Hub structure, permissions that follow architecture instead of exceptions, and search that returns the right thing — the fix for an intranet people route around.",
    when: "When nobody finds anything",
  },
  {
    name: "Intranet / Hub Site Build-Out",
    body: "A hub-based intranet built on the rebuilt architecture — so the front door of the tenant is somewhere staff actually go.",
    when: "After the IA holds",
  },
  {
    name: "SharePoint Migration",
    body: "File shares and legacy sites moved into the structure — not dumped into it — with permissions mapped, not copied.",
    when: "When content moves in",
  },
];

export default function SolutionSharePoint() {
  return (
    <SolutionDeepDive
      slug="sharepoint"
      eyebrowLabel="Deep dive · SharePoint"
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
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 13l9 5 9-5" />
        </svg>
      }
      h1="Every SharePoint starts tidy. Then people use it."
      heroPara1="Sites created on demand, permissions customised per site, links shared with whoever asked. Ten years later nobody can say who can reach what — but Copilot can, and so can an auditor. SharePoint is where tenant exposure actually lives."
      heroPara2="The panel alongside is a typical first scan of a mid-market SharePoint estate."
      secondaryCta={{ label: "See Monitoring Pricing", href: "/monitoring" }}
      bullets={["Site & hub architecture", "Permission inheritance traced", "Search & findability"]}
      heroPanel={<EstatePanel />}
      midEyebrow="Remediation, in sequence"
      midH2="Closing access is riskier than finding it. So it happens in waves."
      midPara="Kill every open link overnight and you break live tenders, auditor access and half of Finance’s month-end. Exposure is retired in a sequence agreed with the business — and the Drift Engine keeps it from quietly coming back."
      rail={WAVES}
      infoCards={INFO_CARDS}
      projectsEyebrow="The work, by name"
      projectsH2="Four named SharePoint projects. Priced against your scan, not a rate card."
      projects={PROJECTS}
      pillOrder={["copilot", "sharepoint", "teams", "power-platform", "migration", "m365-health", "governance"]}
      watchedUnder={[
        { label: "Governance", href: "/pillars/governance" },
        { label: "Security", href: "/pillars/security" },
      ]}
      scanIntro="The free scan reads your real site architecture, inheritance chains and sharing links. Findings become a scoped, priced statement of work — and the estate panel on this page becomes yours, with real numbers in it."
    />
  );
}
