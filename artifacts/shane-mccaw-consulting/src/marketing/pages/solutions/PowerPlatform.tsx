import React from "react";
import { SolutionDeepDive, PanelShell, FindingRow, type Project, type RailStep, type InfoCard } from "./_shared";

// Route /solutions/power-platform — recreated verbatim from
// Design/design_handoff_marketing/Marketing Solutions - Power Platform.dc.html.

interface EnvRow {
  name: string;
  count: number;
  pct: number;
  color: string;
}
const ENV_ROWS: EnvRow[] = [
  { name: "Default environment", count: 149, pct: 100, color: "#f87171" },
  { name: "Governed environments", count: 26, pct: 17, color: "#34d399" },
  { name: "Personal productivity", count: 12, pct: 8, color: "#64748b" },
];

function EstatePanel() {
  return (
    <PanelShell title="Power Platform estate · first scan">
      <span
        style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginBottom: "8px" }}
      >
        Where 187 apps & flows actually live
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "16px" }}>
        {ENV_ROWS.map((e) => (
          <div key={e.name} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ width: "120px", flex: "none", fontSize: "11px", color: "#cbd5e1", fontWeight: 600 }}>
              {e.name}
            </span>
            <div
              style={{ flex: 1, height: "14px", borderRadius: "999px", background: "rgba(2,6,23,.6)", overflow: "hidden" }}
            >
              <div
                style={{
                  width: `${e.pct}%`,
                  height: "100%",
                  borderRadius: "999px",
                  background: `linear-gradient(90deg,${e.color}33,${e.color})`,
                }}
              />
            </div>
            <span
              style={{
                width: "60px",
                flex: "none",
                textAlign: "right",
                fontSize: "11px",
                fontWeight: 700,
                color: e.color,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {e.count}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <FindingRow tone="red" value="9">
          DLP incidents — flows moving business data through connectors policy never covered
        </FindingRow>
        <FindingRow tone="amber" value="4">
          weak DLP policies — business and non-business connectors mixed in one group
        </FindingRow>
        <FindingRow tone="amber" value="14">
          flows owned by accounts that no longer exist — still running, unownable
        </FindingRow>
        <FindingRow tone="neutral" value="6">
          premium licences assigned and inactive — paying for capability nobody uses
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
        Every row is a real, inspectable finding — the flow, the connector, the missing owner attached.
      </div>
    </PanelShell>
  );
}

const CHAIN: RailStep[] = [
  { n: "1", title: "A maker builds it", body: "Invoice approvals, in the default environment, under their own account." },
  { n: "2", title: "The business adopts it", body: "It works, so Finance quietly depends on it. IT never hears." },
  { n: "3", title: "The maker leaves", body: "Offboarding disables the account. The flow’s connections start failing." },
  { n: "4", title: "Month-end breaks", body: "Nobody can edit the flow, because nobody owns it." },
  { n: "5", title: "Or: none of this", body: "Governed environments, service accounts, and a scan that finds these flows first." },
];

const INFO_CARDS: InfoCard[] = [
  {
    eyebrow: "What good looks like",
    body: "A default environment for experiments, governed environments for anything load-bearing, DLP groups that make the dangerous combinations impossible, and every production flow with a named owner and a service account — so the automation survives the person.",
  },
  {
    eyebrow: "Watched after the fix",
    accent: { border: "rgba(20,184,166,.3)", bg: "rgba(20,184,166,.05)", eyebrowColor: "#2dd4bf" },
    body: "Monitoring keeps reading the estate: new flows in the default environment, DLP policy drift, owners who leave — each surfaces as a finding with a runbook, not as next year’s surprise.",
    link: { label: "See what monitoring covers", href: "/monitoring", color: "#2dd4bf" },
  },
];

const PROJECTS: Project[] = [
  {
    name: "Governance Remediation & Architecture Hardening",
    body: "Environment strategy, DLP policy groups and ownership rules — the structural work that brings maker activity under governance without killing it.",
    when: "The structural fix",
  },
  {
    name: "License Waste Optimization & Cost Recovery",
    body: "Premium Power Platform licences reconciled against actual use — idle and duplicate capability reclaimed before renewal.",
    when: "When spend leaks",
  },
  {
    name: "Drift Baseline & Handover",
    body: "The approved configuration — environments, DLP, ownership — recorded as the baseline every future scan compares against.",
    when: "When the fix must hold",
  },
];

export default function SolutionPowerPlatform() {
  return (
    <SolutionDeepDive
      slug="power-platform"
      eyebrowLabel="Deep dive · Power Platform"
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
          <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
        </svg>
      }
      h1="Your business runs on flows nobody in IT has ever seen."
      heroPara1="Power Apps and Power Automate are where the business builds what IT didn’t have time for — invoice approvals, HR forms, the spreadsheet that became an app. Useful, load-bearing, and living in the default environment with whatever permissions the maker had."
      heroPara2="The panel alongside is what a first scan of a typical Power Platform estate returns."
      secondaryCta={{ label: "See Monitoring Pricing", href: "/monitoring" }}
      bullets={["Environments", "DLP policies", "App & flow ownership", "Premium connectors"]}
      heroPanel={<EstatePanel />}
      midEyebrow="The failure mode"
      midH2="The maker leaves. The flow keeps running. Then one day it doesn’t."
      midPara="Shadow IT doesn’t fail loudly — it fails on the day the invoice approvals silently stop. The fix isn’t banning makers. It’s environments with rules, DLP that separates business data from personal connectors, and ownership that survives offboarding."
      rail={CHAIN}
      infoCards={INFO_CARDS}
      projectsEyebrow="Where the work lands"
      projectsH2="Power Platform findings feed the same catalogue as everything else."
      projectsSub="There’s no “Power Platform tax” project — the scan’s findings route into the named projects they actually belong to."
      projects={PROJECTS}
      pillOrder={["copilot", "sharepoint", "teams", "power-platform", "migration", "m365-health", "governance"]}
      watchedUnder={[
        { label: "Governance", href: "/pillars/governance" },
        { label: "Licensing", href: "/pillars/licensing" },
      ]}
      scanIntro="The free scan reads your environments, DLP policies, ownership and premium connector use. Findings become a scoped, priced statement of work — and the estate panel on this page becomes yours, with real numbers in it."
    />
  );
}
