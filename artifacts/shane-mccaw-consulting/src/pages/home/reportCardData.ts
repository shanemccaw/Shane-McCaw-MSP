export interface ReportCardDatum {
  n: string;
  category: string;
  color: string;
  gradientTo: string;
  glow: string;
  title: string;
  desc: string;
}

export const REPORT_CARDS: ReportCardDatum[] = [
  {
    n: "01",
    category: "Licensing",
    color: "#2DD4BF",
    gradientTo: "rgba(45,212,191,0.45)",
    glow: "rgba(20,184,166,0.16)",
    title: "Copilot Licensing Alignment Report",
    desc: "Every seat misassigned, wasted, or missing — exact monthly cost waste and the fastest path to correcting it, department by department.",
  },
  {
    n: "02",
    category: "Governance",
    color: "#60A5FA",
    gradientTo: "rgba(96,165,250,0.45)",
    glow: "rgba(59,130,246,0.16)",
    title: "Microsoft 365 Governance Posture Report",
    desc: "Oversharing, permission sprawl, and policy drift — traced to the specific sites, links, and libraries causing it, not a generic maturity score.",
  },
  {
    n: "03",
    category: "Adoption",
    color: "#FB923C",
    gradientTo: "rgba(251,146,60,0.45)",
    glow: "rgba(249,115,22,0.16)",
    title: "Copilot Adoption & Workflow Readiness Report",
    desc: "Which of your people and workflows are actually ready for Copilot today, and exactly what is blocking the rest — persona by persona, department by department.",
  },
  {
    n: "04",
    category: "Compliance",
    color: "#F3F4F6",
    gradientTo: "rgba(243,244,246,0.45)",
    glow: "rgba(209,213,219,0.16)",
    title: "Microsoft 365 Compliance & Regulatory Alignment Report",
    desc: "Retention, labeling, and DLP gaps mapped against real regulatory frameworks — HIPAA, FINRA, SOX, GDPR — not a generic compliance checklist.",
  },
  {
    n: "05",
    category: "Health",
    color: "#4ADE80",
    gradientTo: "rgba(74,222,128,0.45)",
    glow: "rgba(34,197,94,0.16)",
    title: "Microsoft 365 Operational Health & Service Integrity Report",
    desc: "Service stability, configuration drift, and tenant hygiene issues that make Copilot's answers unreliable — the plumbing most assessments never check.",
  },
  {
    n: "06",
    category: "Security",
    color: "#A78BFA",
    gradientTo: "rgba(167,139,250,0.45)",
    glow: "rgba(139,92,246,0.16)",
    title: "Microsoft 365 Security Posture & Blast Radius Report",
    desc: "Identity, access, and exposure gaps — and exactly how far a single compromised account could reach through Copilot before anyone noticed.",
  },
  {
    n: "07",
    category: "All six pillars",
    color: "#22D3EE",
    gradientTo: "rgba(34,211,238,0.45)",
    glow: "rgba(59,130,246,0.16)",
    title: 'Copilot Readiness, Safety & Enablement Report',
    desc: 'The full picture — every pillar\'s real contribution to your Copilot Gate status, in one place. This is the document that answers "are we actually ready."',
  },
  {
    n: "08",
    category: "Clearance plan",
    color: "#22D3EE",
    gradientTo: "rgba(34,211,238,0.45)",
    glow: "rgba(139,92,246,0.16)",
    title: "Full Remediation Guide — Copilot Gate Clearance Plan",
    desc: "The exact sequence of fixes, phase by phase, required to clear the Copilot Gate. Nothing optional, nothing generic — every step traces to a specific finding.",
  },
];
