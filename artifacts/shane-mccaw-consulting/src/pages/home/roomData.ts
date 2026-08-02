/**
 * Content layer for the home "room" — the persona-workshop narrative ported from
 * the Claude Design export `Copilot Assessment.dc.html`.
 *
 * PRICE TEMPLATING (project rule: no literal prices/tiers/seat counts baked into
 * UI source). The export hard-codes the assessment fee in six places — the close
 * card, two pillar `fallback`s, two `chips` replies and two `rules` replies. Every
 * one of them carries the `__FEE__` placeholder here instead, filled at render time
 * from the live Products Catalog (`/api/services` → "Copilot Readiness Assessment",
 * resolved through resolvePublicServicePriceCents). `fillTokens` below is the same
 * substitution mechanism the export already used for `__SENSITIVE__`/`__REGULATOR__`.
 *
 * Figures that are *sector medians* rather than this business's pricing (the $112k
 * of licence drift, the 27 MFA gaps, the 2,356 overshared sites) are illustrative
 * content and stay literal — they are not catalog values.
 */

export type CastId = "shane" | "kira" | "beth" | "alex" | "you";

export interface CastMember {
  id: string;
  name: string;
  short: string;
  role: string;
  initials: string;
  color: string;
  tile: string;
  bd: string;
}

export const CAST: Record<CastId, CastMember> = {
  shane: {
    id: "shane",
    name: "Shane McCaw",
    short: "Shane",
    role: "Copilot Readiness Architect",
    initials: "SM",
    color: "#67E8F9",
    tile: "linear-gradient(135deg,#3B82F6 0%,#8B5CF6 38%,#67E8F9 72%,#F3F4F6 100%)",
    bd: "rgba(103,232,249,.55)",
  },
  kira: {
    id: "kira",
    name: "Kira Vance",
    short: "Kira",
    role: "Security Assessor",
    initials: "KV",
    color: "#A78BFA",
    tile: "linear-gradient(135deg,#5b21b6,#A78BFA)",
    bd: "rgba(167,139,250,.45)",
  },
  beth: {
    id: "beth",
    name: "Beth Aldrin",
    short: "Beth",
    role: "Legal & Compliance",
    initials: "BA",
    color: "#F3F4F6",
    tile: "linear-gradient(135deg,#6b7280,#F3F4F6)",
    bd: "rgba(243,244,246,.4)",
  },
  alex: {
    id: "alex",
    name: "Alex Rowe",
    short: "Alex",
    role: "Everyday employee",
    initials: "AR",
    color: "#FB923C",
    tile: "linear-gradient(135deg,#9a3412,#FB923C)",
    bd: "rgba(251,146,60,.4)",
  },
  you: {
    id: "you",
    name: "You",
    short: "You",
    role: "",
    initials: "YOU",
    color: "#94a3b8",
    tile: "rgba(15,23,42,.75)",
    bd: "rgba(148,163,184,.24)",
  },
};

export interface Persona extends CastMember {
  day: string;
  win: string;
  risk: string;
}

export interface SiteRow {
  url: string;
  tag: string;
  files: string;
}

export interface IndustryDef {
  sites: SiteRow[];
  sitesLabel: string;
  reg: string;
  sensitive: string;
  tone: string;
  clusters: string[];
  useCases: string[];
  personas: Persona[];
}

export const INDUSTRIES = [
  "Space & aerospace",
  "Financial services",
  "Healthcare",
  "Public sector",
  "Professional services",
  "Manufacturing",
] as const;

export const IND: Record<string, IndustryDef> = {
  "Space & aerospace": {
    sites: [
      { url: "contoso.sharepoint.com/sites/flight-ops-mission-docs", tag: "EEEU · Edit", files: "41,208" },
      { url: "contoso.sharepoint.com/sites/propulsion-drawings", tag: "EEEU · Read", files: "18,502" },
      { url: "contoso.sharepoint.com/sites/launch-readiness-2026", tag: "EEEU · Edit", files: "22,116" },
      { url: "contoso.sharepoint.com/sites/contracts-legal", tag: "EEEU · Read", files: "8,412" },
      { url: "contoso.sharepoint.com/sites/hr-people-ops", tag: "Org-wide link", files: "6,730" },
      { url: "contoso.sharepoint.com/sites/supplier-aerostruct", tag: "Guest · 61", files: "3,204" },
      { url: "contoso.sharepoint.com/sites/mission-assurance-waivers", tag: "EEEU · Read", files: "5,118" },
      { url: "contoso.sharepoint.com/sites/programme-finance-fy26", tag: "Anyone link", files: "2,884" },
      { url: "contoso.sharepoint.com/sites/ground-systems-archive", tag: "EEEU · Read", files: "17,940" },
      { url: "contoso.sharepoint.com/sites/anomaly-review-board", tag: "Anyone link", files: "1,406" },
    ],
    sitesLabel: "Flight Ops – Mission Docs",
    reg: "ITAR and your export-control officer",
    sensitive: "mission data, flight software and supplier drawings",
    tone: "Twenty years of programme sites nobody ever closed, and half of them hold something export-controlled.",
    clusters: [
      "Mission operations",
      "Engineering & design",
      "Programme management",
      "Supply chain",
      "Mission assurance & safety",
      "Ground systems",
    ],
    useCases: [
      "Draft flight-readiness and review documentation",
      "Summarise anomaly and incident reports",
      "Find the current revision of a spec",
      "Prepare programme status for oversight boards",
      "Onboard new engineers to a programme",
      "Answer supplier and contract questions",
    ],
    personas: [
      {
        id: "sp1",
        name: "Maya Okonkwo",
        short: "Maya",
        role: "Flight Operations Lead",
        initials: "MO",
        color: "#60A5FA",
        tile: "linear-gradient(135deg,#1d4ed8,#60A5FA)",
        bd: "#60A5FA6b",
        day: "Runs console shifts and writes the anomaly reports nobody else has time for.",
        win: "Copilot drafts the anomaly narrative from the actual telemetry log and prior incidents.",
        risk: "Only if prior incident reports are labelled — otherwise it cites a superseded finding as current.",
      },
      {
        id: "sp2",
        name: "Juan Delgado",
        short: "Juan",
        role: "Propulsion Engineer",
        initials: "JD",
        color: "#A78BFA",
        tile: "linear-gradient(135deg,#5b21b6,#A78BFA)",
        bd: "#A78BFA6b",
        day: "Specs and revisions across shares migrated off a file server in 2014.",
        win: "Finds the current drawing revision instantly instead of opening six folders to check.",
        risk: "Those shares hold ITAR-controlled drawings with permissions nobody has reviewed since the migration.",
      },
      {
        id: "sp3",
        name: "Jane Okafor",
        short: "Jane",
        role: "Programme Controller",
        initials: "JO",
        color: "#2DD4BF",
        tile: "linear-gradient(135deg,#0f766e,#2DD4BF)",
        bd: "#2DD4BF6b",
        day: "Cost and schedule performance across four concurrent programmes.",
        win: "Variance commentary drafted from the actual EVM workbook rather than retyped each month.",
        risk: "Her retrieval scope also reaches contract terms and pricing she should not summarise.",
      },
      {
        id: "sp4",
        name: "Priya Raman",
        short: "Priya",
        role: "Mission Assurance",
        initials: "PR",
        color: "#F3F4F6",
        tile: "linear-gradient(135deg,#6b7280,#F3F4F6)",
        bd: "#F3F4F66b",
        day: "Evidences safety and quality controls to the review board.",
        win: "Surfaces the standard and the waiver in one query instead of a two-day file hunt.",
        risk: "Her prompts are records. Unset retention means she cannot say where they live.",
      },
      {
        id: "sp5",
        name: "Sam Oyelaran",
        short: "Sam",
        role: "Supply Chain Manager",
        initials: "SO",
        color: "#FB923C",
        tile: "linear-gradient(135deg,#9a3412,#FB923C)",
        bd: "#FB923C6b",
        day: "Chases long-lead parts and supplier correspondence across a decade of email.",
        win: "Supplier history and terms summarised in seconds, in Teams, where he already works.",
        risk: "Supplier terms are the single most overshared category we find in aerospace tenants.",
      },
    ],
  },
  "Financial services": {
    sites: [
      { url: "contoso.sharepoint.com/sites/deal-team-active", tag: "EEEU · Edit", files: "38,904" },
      { url: "contoso.sharepoint.com/sites/client-portfolios", tag: "EEEU · Read", files: "21,330" },
      { url: "contoso.sharepoint.com/sites/contracts-legal", tag: "EEEU · Read", files: "8,412" },
      { url: "contoso.sharepoint.com/sites/hr-people-ops", tag: "Org-wide link", files: "6,730" },
      { url: "contoso.sharepoint.com/sites/credit-committee", tag: "EEEU · Edit", files: "4,802" },
      { url: "contoso.sharepoint.com/sites/vendor-diligence", tag: "Guest · 48", files: "3,110" },
      { url: "contoso.sharepoint.com/sites/finance-fy26-planning", tag: "Anyone link", files: "2,884" },
      { url: "contoso.sharepoint.com/sites/compliance-evidence", tag: "EEEU · Read", files: "9,266" },
      { url: "contoso.sharepoint.com/sites/advisor-all-hands", tag: "EEEU · Read", files: "18,502" },
      { url: "contoso.sharepoint.com/sites/surveillance-review", tag: "Anyone link", files: "1,406" },
    ],
    sitesLabel: "Deal Team – Active",
    reg: "FINRA and your auditors",
    sensitive: "deal files and client portfolios",
    tone: "That is where a single 'Everyone except external users' folder turns into a reportable event.",
    clusters: [
      "Front office & advisory",
      "Risk & compliance",
      "Finance & controllership",
      "Operations",
      "Technology",
      "Client service",
    ],
    useCases: [
      "Prepare for client meetings from prior history",
      "Draft variance and management commentary",
      "Answer policy and procedure questions",
      "Summarise regulatory correspondence",
      "Onboard new advisors",
      "Review communications for disclosure risk",
    ],
    personas: [
      {
        id: "fs1",
        name: "Jane Okafor",
        short: "Jane",
        role: "Financial Controller",
        initials: "JO",
        color: "#2DD4BF",
        tile: "linear-gradient(135deg,#0f766e,#2DD4BF)",
        bd: "#2DD4BF6b",
        day: "Closes the month across four entities, chasing reconciliations in email threads.",
        win: "Copilot drafts variance commentary from the actual workbook instead of a rewrite every month.",
        risk: "The same retrieval reaches deal files she has no business summarising.",
      },
      {
        id: "fs2",
        name: "Marcus Bell",
        short: "Marcus",
        role: "Client Advisor",
        initials: "MB",
        color: "#FB923C",
        tile: "linear-gradient(135deg,#9a3412,#FB923C)",
        bd: "#FB923C6b",
        day: "Twelve client meetings a week, every prep pulled from SharePoint history he half-remembers.",
        win: "Meeting recap and prior-engagement summary in seconds — your highest-value use case.",
        risk: "Three versions of a client agreement and he quotes the wrong terms with total confidence.",
      },
      {
        id: "fs3",
        name: "Priya Raman",
        short: "Priya",
        role: "Compliance Officer",
        initials: "PR",
        color: "#F3F4F6",
        tile: "linear-gradient(135deg,#6b7280,#F3F4F6)",
        bd: "#F3F4F66b",
        day: "Evidences controls to auditors and reviews comms for disclosure risk.",
        win: "Surfaces the policy and the exception in one query instead of a two-day hunt.",
        risk: "Her prompts are records. Unset retention means she cannot answer where they live.",
      },
      {
        id: "fs4",
        name: "Juan Delgado",
        short: "Juan",
        role: "Platform Engineer",
        initials: "JD",
        color: "#A78BFA",
        tile: "linear-gradient(135deg,#5b21b6,#A78BFA)",
        bd: "#A78BFA6b",
        day: "Owns the tenant, the change windows and every escalation.",
        win: "Change history and service advisories summarised instead of read end to end.",
        risk: "He is also the one who has to remediate whatever this assessment finds.",
      },
      {
        id: "fs5",
        name: "Dana Whitfield",
        short: "Dana",
        role: "Operations Lead",
        initials: "DW",
        color: "#60A5FA",
        tile: "linear-gradient(135deg,#1d4ed8,#60A5FA)",
        bd: "#60A5FA6b",
        day: "Exception queues, settlement breaks and process documentation.",
        win: "Drafts the break narrative from the actual case notes.",
        risk: "Case notes sit in sites with tenant-wide access nobody has audited.",
      },
    ],
  },
  Healthcare: {
    sites: [
      { url: "contoso.sharepoint.com/sites/clinical-protocols-archive", tag: "EEEU · Read", files: "17,940" },
      { url: "contoso.sharepoint.com/sites/revenue-cycle-denials", tag: "Org-wide link", files: "5,118" },
      { url: "contoso.sharepoint.com/sites/patient-services-cases", tag: "EEEU · Edit", files: "24,660" },
      { url: "contoso.sharepoint.com/sites/hr-people-ops", tag: "Org-wide link", files: "6,730" },
      { url: "contoso.sharepoint.com/sites/research-study-data", tag: "EEEU · Read", files: "11,204" },
      { url: "contoso.sharepoint.com/sites/payer-contracts", tag: "Guest · 39", files: "3,412" },
      { url: "contoso.sharepoint.com/sites/privacy-evidence", tag: "EEEU · Read", files: "4,880" },
      { url: "contoso.sharepoint.com/sites/finance-fy26-planning", tag: "Anyone link", files: "2,884" },
      { url: "contoso.sharepoint.com/sites/informatics-integrations", tag: "EEEU · Edit", files: "7,902" },
      { url: "contoso.sharepoint.com/sites/incident-review", tag: "Anyone link", files: "1,406" },
    ],
    sitesLabel: "Clinical Protocols – Archive",
    reg: "HIPAA",
    sensitive: "patient records and case notes",
    tone: "Then the retrieval path matters more than the model — PHI inside a summarised answer is still PHI.",
    clusters: [
      "Clinical services",
      "Revenue cycle",
      "Compliance & privacy",
      "Research",
      "Operations",
      "IT & informatics",
    ],
    useCases: [
      "Draft referral and discharge correspondence",
      "Summarise care pathway guidance",
      "Analyse denial patterns",
      "Answer policy and consent questions",
      "Prepare audit evidence",
      "Onboard clinical staff",
    ],
    personas: [
      {
        id: "hc1",
        name: "Dr. Elena Ruiz",
        short: "Dr.",
        role: "Clinical Lead",
        initials: "ER",
        color: "#4ADE80",
        tile: "linear-gradient(135deg,#166534,#4ADE80)",
        bd: "#4ADE806b",
        day: "Clinic all morning, documentation squeezed into the afternoon.",
        win: "Drafts referral letters and summarises care pathways from her department's own guidance.",
        risk: "If PHI sits in unlabelled shares, that draft quietly becomes a disclosure.",
      },
      {
        id: "hc2",
        name: "Tom Hargrove",
        short: "Tom",
        role: "Revenue Cycle Manager",
        initials: "TH",
        color: "#2DD4BF",
        tile: "linear-gradient(135deg,#0f766e,#2DD4BF)",
        bd: "#2DD4BF6b",
        day: "Chases denials and payer correspondence across a decade of SharePoint.",
        win: "Denial-pattern summaries pulled from the correspondence he already owns.",
        risk: "His account is the one most likely to hold access nobody has reviewed since 2019.",
      },
      {
        id: "hc3",
        name: "Priya Raman",
        short: "Priya",
        role: "Privacy Officer",
        initials: "PR",
        color: "#F3F4F6",
        tile: "linear-gradient(135deg,#6b7280,#F3F4F6)",
        bd: "#F3F4F66b",
        day: "Runs the HIPAA evidence pack and fields every access question.",
        win: "Purview posture in one place instead of six admin centres.",
        risk: "She needs prompt retention answered in writing before anyone gets a licence.",
      },
      {
        id: "hc4",
        name: "Juan Delgado",
        short: "Juan",
        role: "Clinical Informatics",
        initials: "JD",
        color: "#A78BFA",
        tile: "linear-gradient(135deg,#5b21b6,#A78BFA)",
        bd: "#A78BFA6b",
        day: "Bridges the clinical system and the tenant, owns integrations.",
        win: "Summarises integration change history and advisories.",
        risk: "Broad Graph consent granted years ago to apps nobody uses any more.",
      },
      {
        id: "hc5",
        name: "Dana Whitfield",
        short: "Dana",
        role: "Patient Services",
        initials: "DW",
        color: "#60A5FA",
        tile: "linear-gradient(135deg,#1d4ed8,#60A5FA)",
        bd: "#60A5FA6b",
        day: "Casework, appeals and constant policy lookups.",
        win: "Policy answers with citations instead of a slow email to compliance.",
        risk: "Patient records in the same retrieval scope is a HIPAA problem, not an IT one.",
      },
    ],
  },
  "Public sector": {
    sites: [
      { url: "contoso.sharepoint.com/sites/programme-delivery-2026", tag: "EEEU · Edit", files: "33,118" },
      { url: "contoso.sharepoint.com/sites/constituent-casework", tag: "EEEU · Read", files: "28,440" },
      { url: "contoso.sharepoint.com/sites/records-schedule", tag: "Org-wide link", files: "6,730" },
      { url: "contoso.sharepoint.com/sites/procurement-live", tag: "EEEU · Read", files: "9,204" },
      { url: "contoso.sharepoint.com/sites/hr-people-ops", tag: "Org-wide link", files: "5,118" },
      { url: "contoso.sharepoint.com/sites/supplier-framework", tag: "Guest · 55", files: "3,204" },
      { url: "contoso.sharepoint.com/sites/policy-legal", tag: "EEEU · Read", files: "8,412" },
      { url: "contoso.sharepoint.com/sites/finance-fy26-planning", tag: "Anyone link", files: "2,884" },
      { url: "contoso.sharepoint.com/sites/it-operations-archive", tag: "EEEU · Read", files: "17,940" },
      { url: "contoso.sharepoint.com/sites/foi-responses", tag: "Anyone link", files: "1,406" },
    ],
    sitesLabel: "Programme Delivery 2026",
    reg: "your records-management schedule",
    sensitive: "case files and constituent data",
    tone: "Your records schedule predates the cloud, and Copilot has never heard of a single line of it.",
    clusters: [
      "Programme delivery",
      "Constituent services",
      "Records & FOI",
      "Finance & procurement",
      "IT operations",
      "Policy & legal",
    ],
    useCases: [
      "Draft programme status for oversight bodies",
      "Answer policy questions with citations",
      "Prepare FOI and records responses",
      "Summarise procurement documentation",
      "Onboard new caseworkers",
      "Track commitments across programmes",
    ],
    personas: [
      {
        id: "ps1",
        name: "Dana Whitfield",
        short: "Dana",
        role: "Programme Manager",
        initials: "DW",
        color: "#60A5FA",
        tile: "linear-gradient(135deg,#1d4ed8,#60A5FA)",
        bd: "#60A5FA6b",
        day: "Reports on twelve funded programmes to three oversight bodies.",
        win: "Status rollups drafted from the actual project sites rather than chased by email.",
        risk: "Those sites are the ones with tenant-wide access nobody has audited.",
      },
      {
        id: "ps2",
        name: "Juan Delgado",
        short: "Juan",
        role: "Infrastructure Engineer",
        initials: "JD",
        color: "#A78BFA",
        tile: "linear-gradient(135deg,#5b21b6,#A78BFA)",
        bd: "#A78BFA6b",
        day: "Runs the tenant, fields escalations, owns every change window.",
        win: "Summarises change history and service advisories instead of reading them all.",
        risk: "He is also the one who has to remediate whatever this finds.",
      },
      {
        id: "ps3",
        name: "Priya Raman",
        short: "Priya",
        role: "Records Officer",
        initials: "PR",
        color: "#F3F4F6",
        tile: "linear-gradient(135deg,#6b7280,#F3F4F6)",
        bd: "#F3F4F66b",
        day: "Applies a records schedule written before anyone had a OneDrive.",
        win: "Retention gaps surfaced against the schedule she already maintains.",
        risk: "Copilot interaction history is unset, so prompts fall outside the schedule entirely.",
      },
      {
        id: "ps4",
        name: "Jane Okafor",
        short: "Jane",
        role: "Finance Business Partner",
        initials: "JO",
        color: "#2DD4BF",
        tile: "linear-gradient(135deg,#0f766e,#2DD4BF)",
        bd: "#2DD4BF6b",
        day: "Budget monitoring and procurement paperwork across departments.",
        win: "Drafts the budget narrative from the actual ledger extract.",
        risk: "Procurement files carry commercial terms in openly shared sites.",
      },
      {
        id: "ps5",
        name: "Sam Oyelaran",
        short: "Sam",
        role: "Caseworker",
        initials: "SO",
        color: "#FB923C",
        tile: "linear-gradient(135deg,#9a3412,#FB923C)",
        bd: "#FB923C6b",
        day: "High case volume, most of it decided by finding the right precedent.",
        win: "Precedent and guidance surfaced in seconds instead of a folder crawl.",
        risk: "Constituent data is in the same scope as the guidance he is searching.",
      },
    ],
  },
  "Professional services": {
    sites: [
      { url: "contoso.sharepoint.com/sites/client-engagements-live", tag: "EEEU · Edit", files: "41,208" },
      { url: "contoso.sharepoint.com/sites/proposals-library", tag: "EEEU · Read", files: "18,502" },
      { url: "contoso.sharepoint.com/sites/contracts-legal", tag: "EEEU · Read", files: "8,412" },
      { url: "contoso.sharepoint.com/sites/hr-people-ops", tag: "Org-wide link", files: "6,730" },
      { url: "contoso.sharepoint.com/sites/methodology-knowledge", tag: "EEEU · Edit", files: "12,116" },
      { url: "contoso.sharepoint.com/sites/subcontractor-network", tag: "Guest · 61", files: "3,204" },
      { url: "contoso.sharepoint.com/sites/independence-checks", tag: "EEEU · Read", files: "5,118" },
      { url: "contoso.sharepoint.com/sites/finance-fy26-planning", tag: "Anyone link", files: "2,884" },
      { url: "contoso.sharepoint.com/sites/practice-all-hands", tag: "EEEU · Read", files: "17,940" },
      { url: "contoso.sharepoint.com/sites/billing-disputes", tag: "Anyone link", files: "1,406" },
    ],
    sitesLabel: "Client Engagements – Live",
    reg: "your client confidentiality obligations",
    sensitive: "client engagement files",
    tone: "One tenant across every client, which is exactly where matter-level separation quietly breaks.",
    clusters: [
      "Client delivery",
      "Business development",
      "Finance & billing",
      "Knowledge management",
      "IT & operations",
      "Risk & independence",
    ],
    useCases: [
      "Recall prior engagement history",
      "Draft proposals from past work",
      "Summarise meeting outcomes",
      "Answer methodology questions",
      "Onboard new consultants",
      "Prepare billing and utilisation commentary",
    ],
    personas: [
      {
        id: "pf1",
        name: "Marcus Bell",
        short: "Marcus",
        role: "Engagement Lead",
        initials: "MB",
        color: "#FB923C",
        tile: "linear-gradient(135deg,#9a3412,#FB923C)",
        bd: "#FB923C6b",
        day: "Lives in Teams, pulls client history out of SharePoint all day.",
        win: "Prior-engagement recall in seconds. This is where your ROI actually comes from.",
        risk: "Cross-client retrieval is the failure mode that ends a relationship, not a rollout.",
      },
      {
        id: "pf2",
        name: "Jane Okafor",
        short: "Jane",
        role: "Finance Manager",
        initials: "JO",
        color: "#2DD4BF",
        tile: "linear-gradient(135deg,#0f766e,#2DD4BF)",
        bd: "#2DD4BF6b",
        day: "Runs billing and utilisation across every active engagement.",
        win: "Utilisation commentary drafted from the timesheet data she already exports.",
        risk: "Her licence has sat idle four months — one of 312 the scan will find.",
      },
      {
        id: "pf3",
        name: "Juan Delgado",
        short: "Juan",
        role: "IT Lead",
        initials: "JD",
        color: "#A78BFA",
        tile: "linear-gradient(135deg,#5b21b6,#A78BFA)",
        bd: "#A78BFA6b",
        day: "One person, one tenant, every request.",
        win: "Copilot triages his ticket queue and drafts the change notes.",
        risk: "He has nobody to hand the remediation list to. It has to be ordered and finite.",
      },
      {
        id: "pf4",
        name: "Priya Raman",
        short: "Priya",
        role: "Risk & Independence",
        initials: "PR",
        color: "#F3F4F6",
        tile: "linear-gradient(135deg,#6b7280,#F3F4F6)",
        bd: "#F3F4F66b",
        day: "Conflict checks and client confidentiality obligations.",
        win: "Conflict history surfaced across engagements in one query.",
        risk: "That same query crosses client boundaries if matter separation is not enforced.",
      },
      {
        id: "pf5",
        name: "Dana Whitfield",
        short: "Dana",
        role: "Knowledge Manager",
        initials: "DW",
        color: "#60A5FA",
        tile: "linear-gradient(135deg,#1d4ed8,#60A5FA)",
        bd: "#60A5FA6b",
        day: "Curates the methodology library nobody can ever find.",
        win: "Copilot finally makes the library usable — if the metadata exists.",
        risk: "Three versions of every template and no labels is why answers come back wrong.",
      },
    ],
  },
  Manufacturing: {
    sites: [
      { url: "contoso.sharepoint.com/sites/engineering-drawings", tag: "EEEU · Edit", files: "41,208" },
      { url: "contoso.sharepoint.com/sites/plant-shift-logs", tag: "EEEU · Read", files: "18,502" },
      { url: "contoso.sharepoint.com/sites/supplier-terms", tag: "Guest · 61", files: "3,204" },
      { url: "contoso.sharepoint.com/sites/hr-people-ops", tag: "Org-wide link", files: "6,730" },
      { url: "contoso.sharepoint.com/sites/quality-nonconformance", tag: "EEEU · Read", files: "9,940" },
      { url: "contoso.sharepoint.com/sites/contracts-legal", tag: "EEEU · Read", files: "8,412" },
      { url: "contoso.sharepoint.com/sites/production-planning", tag: "EEEU · Edit", files: "5,118" },
      { url: "contoso.sharepoint.com/sites/finance-fy26-planning", tag: "Anyone link", files: "2,884" },
      { url: "contoso.sharepoint.com/sites/export-control-archive", tag: "EEEU · Read", files: "17,940" },
      { url: "contoso.sharepoint.com/sites/incident-review", tag: "Anyone link", files: "1,406" },
    ],
    sitesLabel: "Engineering Drawings",
    reg: "your export-control obligations",
    sensitive: "designs, specs and supplier terms",
    tone: "The risk hides in engineering shares nobody has audited since the file-server migration.",
    clusters: ["Engineering & design", "Plant operations", "Supply chain", "Quality", "Finance", "IT & OT"],
    useCases: [
      "Find the current spec revision",
      "Draft shift handovers and incident reports",
      "Summarise supplier correspondence",
      "Prepare quality and audit documentation",
      "Onboard plant staff",
      "Analyse cost variance",
    ],
    personas: [
      {
        id: "mf1",
        name: "Juan Delgado",
        short: "Juan",
        role: "Design Engineer",
        initials: "JD",
        color: "#A78BFA",
        tile: "linear-gradient(135deg,#5b21b6,#A78BFA)",
        bd: "#A78BFA6b",
        day: "Specs, revisions and supplier drawings across migrated shares.",
        win: "Finds the current revision instead of opening six folders to check.",
        risk: "Those shares carry export-controlled drawings with permissions inherited from 2014.",
      },
      {
        id: "mf2",
        name: "Sam Oyelaran",
        short: "Sam",
        role: "Plant Operations",
        initials: "SO",
        color: "#FB923C",
        tile: "linear-gradient(135deg,#9a3412,#FB923C)",
        bd: "#FB923C6b",
        day: "Shift handovers, incident reports, supplier chasing — mostly on a phone.",
        win: "Handover summaries drafted from the shift log, in Teams, in thirty seconds.",
        risk: "Mobile-first users are the cohort your adoption data always misses.",
      },
      {
        id: "mf3",
        name: "Jane Okafor",
        short: "Jane",
        role: "Cost Accountant",
        initials: "JO",
        color: "#2DD4BF",
        tile: "linear-gradient(135deg,#0f766e,#2DD4BF)",
        bd: "#2DD4BF6b",
        day: "Standard costing, variance analysis, supplier terms reconciliation.",
        win: "Variance commentary drafted from the workbook rather than retyped each period.",
        risk: "Supplier terms are the most overshared category we find in your sector.",
      },
      {
        id: "mf4",
        name: "Priya Raman",
        short: "Priya",
        role: "Quality Manager",
        initials: "PR",
        color: "#F3F4F6",
        tile: "linear-gradient(135deg,#6b7280,#F3F4F6)",
        bd: "#F3F4F66b",
        day: "Non-conformance reports and audit evidence.",
        win: "Surfaces the standard and the prior finding in one query.",
        risk: "Audit evidence in openly shared sites is a finding in itself.",
      },
      {
        id: "mf5",
        name: "Dana Whitfield",
        short: "Dana",
        role: "Production Planner",
        initials: "DW",
        color: "#60A5FA",
        tile: "linear-gradient(135deg,#1d4ed8,#60A5FA)",
        bd: "#60A5FA6b",
        day: "Balances demand against capacity every single week.",
        win: "Summarises supplier lead-time changes from the correspondence.",
        risk: "Planning data sits alongside commercial terms in the same scope.",
      },
    ],
  },
};

export const DEFAULT_INDUSTRY = "Space & aerospace";

export const VOICE: Record<string, { ally: CastId; line: string }> = {
  "IT / M365 admin": {
    ally: "kira",
    line: "You are the one who has to run the remediation, so the report names the setting and the cmdlet for every finding — not just the risk.",
  },
  "Security or risk": {
    ally: "kira",
    line: "Then you and Kira will get on. The security pillar leads with blast radius per privileged identity, because that is the number that actually moves a sign-off.",
  },
  "Legal or compliance": {
    ally: "beth",
    line: "Then Beth is asking your questions before you have to. Everything in the compliance pillar ships with the tenant setting that evidences it.",
  },
  "Exec or finance": {
    ally: "alex",
    line: "You want the one-page version: cost, risk, return. The licensing model and page one of the report are written for exactly that meeting.",
  },
  "Everyday employee": {
    ally: "alex",
    line: "Then Alex is your stand-in here. Your version of this is 'it was confidently wrong once and I stopped trusting it' — which is measurable and fixable.",
  },
};

export const DEFAULT_VOICE = {
  ally: "kira" as CastId,
  line: "Whatever the title says, the report is written so the person who has to act can act without a translator.",
};

export type ProblemKey = "sprawl" | "waste" | "adoption" | "evidence" | "signoff";
export type PillarId =
  | "governance"
  | "licensing"
  | "adoption"
  | "compliance"
  | "health"
  | "security"
  | "copilot";

export interface ProblemDef {
  key: ProblemKey;
  chip: string;
  focus: PillarId;
  score: number;
  name: string;
  role: string;
  color: string;
  said: string;
  body: string;
  start: string;
  close: string;
}

export const PROBLEMS: ProblemDef[] = [
  {
    key: "sprawl",
    chip: "Copilot will surface files it shouldn't",
    focus: "governance",
    score: 54,
    name: "The Sprawl Owner",
    role: "Governance-first profile",
    color: "#60A5FA",
    said: "My worry is Copilot surfacing files people were never meant to see.",
    body: "You inherited years of SharePoint and Teams nobody pruned. Copilot does not bypass permissions — it removes the friction that used to hide them.",
    start: "Data Access Governance reports and the SAM Content Management Assessment, first in the run",
    close:
      "Because oversharing is your blocker, the scan opens on the permission map: every tenant-wide site, every EEEU link, ranked by what actually holds __SENSITIVE__.",
  },
  {
    key: "waste",
    chip: "We're paying for seats nobody uses",
    focus: "licensing",
    score: 66,
    name: "The Budget Owner",
    role: "Licensing-first profile",
    color: "#2DD4BF",
    said: "We're carrying a lot of seats and I can't tell if anyone uses them.",
    body: "This is a spend question, not a security one. Copilot Dashboard and the M365 usage reports already hold the answer; almost nobody reads them.",
    start: "Usage telemetry per role against assigned seats, first in the run",
    close:
      "Because spend is your blocker, the licence model leads the report and the reassignment list is the first thing you can act on.",
  },
  {
    key: "adoption",
    chip: "Nobody is actually using it",
    focus: "adoption",
    score: 61,
    name: "The Stalled Rollout",
    role: "Adoption-first profile",
    color: "#FB923C",
    said: "We rolled it out and people quietly stopped using it.",
    body: "Adoption dies on grounding, not on training. Three versions of a policy in three sites with no metadata and the model picks confidently and wrongly.",
    start: "Grounding-conflict analysis and role-based prompt testing, first in the run",
    close:
      "Because adoption is your blocker, we lead with the grounding conflicts and ship six tested prompts per department that work on your own content.",
  },
  {
    key: "evidence",
    chip: "We can't prove what's compliant",
    focus: "compliance",
    score: 58,
    name: "The Evidence Keeper",
    role: "Compliance-first profile",
    color: "#F3F4F6",
    said: "I have to prove this is compliant before anyone turns it on.",
    body: "Your blocker is documentary, not technical. Retention, residency and DLP posture written down in language a regulator and a board both accept.",
    start: "Purview DSPM for AI baseline and prompt-retention posture, first in the run",
    close:
      "Because evidence is your blocker, every finding ships with the tenant setting that proves it, mapped to __REGULATOR__.",
  },
  {
    key: "signoff",
    chip: "Security won't sign off",
    focus: "security",
    score: 49,
    name: "The Stalled Sign-off",
    role: "Security-first profile",
    color: "#A78BFA",
    said: "Security won't sign this off and I need something that satisfies them.",
    body: "You need an assessor's answer, not a vendor's: ranked findings with Graph evidence, and the day-one control that buys back the quarter.",
    start: "Access Explorer review and blast-radius modelling, first in the run",
    close:
      "Because sign-off is your blocker, the security pillar leads and the report is written to be read by the person withholding approval.",
  },
];

export const FOCUS_LABEL: Record<PillarId, string> = {
  governance: "Governance",
  licensing: "Licensing",
  adoption: "Adoption",
  compliance: "Compliance",
  security: "Security",
  health: "Health",
  copilot: "Copilot",
};

export interface PillarStat {
  k: string;
  v: string;
  d: string;
  bad?: boolean;
  good?: boolean;
}

export interface PillarDef {
  id: PillarId;
  n: string;
  title: string;
  primary: string;
  accent: string;
  motion: "sweep" | "grid" | "arc" | "beam" | "pulse" | "ripple" | "burst";
  paths: string[];
  circles?: { cx: number; cy: number; r: number }[];
  headline: string;
  lead: { who: string; text: string }[];
  focusLine: { who: string; text: string } | null;
  isProfile?: boolean;
  isClose?: boolean;
  prompt: string;
  placeholder: string;
  chips: [string, string][];
  rules: [RegExp, string][];
  fallback: string;
  stats?: PillarStat[];
}

export const PILLARS: PillarDef[] = [
  {
    id: "governance",
    n: "01",
    title: "Governance",
    primary: "#3B82F6",
    accent: "#60A5FA",
    motion: "sweep",
    paths: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "m9 12 2 2 4-4"],
    headline: "Copilot reads whatever your permissions already allow.",
    lead: [
      {
        who: "shane",
        text: "Permissions first, because everything else is downstream. Copilot grounds answers in Microsoft Graph — it does not widen access, it removes the friction that used to hide it. Before Copilot you had to know which site to search and which file to guess at.",
      },
      {
        who: "kira",
        text: "Which in practice means every file a person could theoretically reach through search is now a file Copilot will happily summarise for them, with citations.",
      },
    ],
    focusLine: {
      who: "shane",
      text: "Since this is your blocker we go deeper here: not just the counts, but which of those sites hold __SENSITIVE__, who granted the access, and whether Restricted Content Discovery is the right first move.",
    },
    prompt: "Your turn — what worries you most about what Copilot could reach?",
    placeholder: "e.g. our SharePoint has never been cleaned up",
    chips: [
      ["What would Copilot actually find?", "Running it against your tenant now."],
      [
        "Our SharePoint is a mess",
        "Then the first pass is uncomfortable and useful. We run the Data Access Governance reports and the SAM Content Management Assessment, rank sites by real sensitivity, and turn on Restricted SharePoint Search as a temporary net while you fix permissions properly.",
      ],
      [
        "Nobody knows who owns what",
        "Ownerless workspaces are the median finding. A site ownership policy in simulation mode surfaces candidate owners from Graph signals, then you promote it to active and let the owners do their own access reviews.",
      ],
      [
        "Is Restricted Search enough?",
        "No, and Microsoft says so too. RSS is a tenant-wide allow-list of up to 100 sites and it is explicitly a temporary safety net — the real fix is permissions, labels and lifecycle underneath it.",
      ],
    ],
    rules: [
      [
        /(label|sensitiv|classif|purview)/,
        "Labels are the second lever. Restricted Content Discovery buys you the quarter on the worst sites; sensitivity labels and DLP are the three-week tier; access reviews and lifecycle are the quarter.",
      ],
      [
        /(teams|channel|group)/,
        "Public Teams channels and orphaned M365 groups are the quiet ones — dozens in the median tenant, every one of them in the retrieval path. We list them with member counts and last activity.",
      ],
      [
        /(fix|remediat|how do we|what do we do|first)/,
        "Day one: Restricted Content Discovery on the worst sites. Weeks two to four: labels and DLP where they matter. Quarter: site lifecycle, ownership policy and access reviews. All of it in Deliverable 02 with the PowerShell written.",
      ],
      [
        /(rcd|rss|restricted)/,
        "RCD hides specific sites from Copilot and search without changing permissions. RSS is the blunter tenant-wide allow-list. We tell you which sites need which, and when to turn RSS back off.",
      ],
    ],
    fallback:
      "Every governance answer has the same shape: what Copilot can reach, why that permission exists, and the cheapest control that closes it.",
    stats: [
      { k: "EEEU-shared items", v: "41,208", d: "Everyone-except-external-users" },
      { k: "Sites flagged by DAG", v: "11", d: "Overshared or sensitive content" },
      { k: "Sites without 2 owners", v: "36", d: "No lifecycle policy attached" },
      { k: "Retention policies", v: "2 of 9", d: "Against the recommended set" },
    ],
  },
  {
    id: "licensing",
    n: "02",
    title: "Licensing",
    primary: "#14B8A6",
    accent: "#2DD4BF",
    motion: "grid",
    paths: [
      "M2 9V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4",
      "M2 15v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4",
      "M4 12h16",
    ],
    headline: "The licence scan usually pays for the assessment on its own.",
    lead: [
      {
        who: "shane",
        text: "This is the bonus pillar. While we are already reading Graph for the security work, licence drift comes back for free — seats still assigned to leavers, duplicate SKUs, E5 features paid for and never enabled, E3 users doing E5 work, and Copilot seats nobody has opened in thirty days.",
      },
      {
        who: "shane",
        text: "In the median tenant that is six figures of annual waste. The reassignment list has covered the fee before the session ended more than once — which is the cheapest way I know to make a readiness assessment self-funding.",
      },
    ],
    focusLine: {
      who: "shane",
      text: "Since spend is your blocker this leads your report: drift by SKU, measured use per role against seat cost, and a reassignment list rather than a cancellation argument you will lose at renewal.",
    },
    prompt: "How many seats are you carrying, and when did anyone last audit them?",
    placeholder: "e.g. 400 seats, nobody reviews them",
    chips: [
      [
        "We bought seats for everyone",
        "The expensive pattern, and the easiest to recover from. We measure weekly active use per role and cross it against drift — leavers, duplicates, orphaned SKUs — then hand you a reassignment list before you argue with procurement.",
      ],
      [
        "We haven't bought any yet",
        "Best position to be in. We size the pilot from your own telemetry rather than headcount, which usually halves the first purchase and makes the second one defensible.",
      ],
      [
        "Does this pay for itself?",
        "Usually, and usually in the same session. Median tenant carries around $112k a year of drift and idle seats, against __FEE__ for the assessment. Deliverable 03 is the line-by-line version finance signs.",
      ],
    ],
    rules: [
      [
        /(cancel|reduce|cut|save|renew)/,
        "Reassign before you cancel. Idle seats moved to measured-demand roles recover more value than a mid-term reduction, which most agreements make painful anyway.",
      ],
      [
        /(how much|cost|price|budget|roi|pay for)/,
        "The assessment is priced at __FEE__, with no seat-based scaling. The licence pillar alone typically surfaces six figures of annual drift and idle spend, so it tends to pay for itself on the first reassignment — before you have acted on a single security finding.",
      ],
      [
        /(e3|e5|business premium|licen|sku|sam|drift)/,
        "Drift is the quiet one: seats on leavers, duplicate assignments, orphaned SKUs, and E5 features you pay for and never enabled. Copilot also sits on your base licence, so the mix decides which governance controls you even have access to.",
      ],
    ],
    fallback:
      "Licensing is the least emotional pillar and the one that funds the rest: drift, measured use, spend, and a reassignment list.",
    stats: [
      { k: "Licence drift detected", v: "47", d: "Leavers, duplicates, orphaned SKUs", bad: true },
      { k: "Idle Copilot seats", v: "312", d: "No prompt in 30 days" },
      { k: "E5 features unused", v: "9", d: "Paid for, never enabled" },
      { k: "Recoverable annually", v: "$112k", d: "Median tenant, per year", good: true },
    ],
  },
  {
    id: "adoption",
    n: "03",
    title: "Adoption",
    primary: "#F97316",
    accent: "#FB923C",
    motion: "arc",
    paths: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87"],
    circles: [{ cx: 9, cy: 7, r: 4 }],
    headline: "Nobody asks a tool twice after it is confidently wrong.",
    lead: [
      {
        who: "shane",
        text: "The pattern is always the same: someone asks for last quarter's summary, gets three versions of a policy document with all three cited, and quietly goes back to searching Teams by hand. Three near-identical documents in three sites with no metadata and no labels — the model has no way to know which one is current. Trust does not come back on its own after that.",
      },
    ],
    focusLine: {
      who: "shane",
      text: "Since adoption is your blocker we lead with the grounding conflicts behind that experience, then role-based prompt testing with citation review — not just licence assignment and a training session.",
    },
    prompt: "What happened the last time someone in your org tried it?",
    placeholder: "e.g. it gave a confidently wrong answer",
    chips: [
      [
        "It gave a wrong answer",
        "Grounding, almost always. Duplicate documents with no metadata across sites. We find the conflicts, name the documents, and tell you which one to retire.",
      ],
      [
        "Nobody was trained",
        "Training works once the answers are right. We ship six tested prompts per department that work on your data — that moves usage further than any two-hour session I have watched.",
      ],
      [
        "It went quiet after a few weeks",
        "The classic curve. The report names which cohorts dropped, what they asked in the last week they were active, and which of them are recoverable.",
      ],
    ],
    rules: [
      [
        /(train|enable|champion)/,
        "Champions work when they have real prompts against real tenant data. The report ships the library so your champions are not inventing examples in front of a room.",
      ],
      [
        /(measur|metric|track|kpi|dashboard)/,
        "Copilot Dashboard in Viva Insights plus three numbers: weekly active per department, prompts per active user, and retained-at-week-six. Tracked monthly, that is enough to manage this.",
      ],
      [
        /(teams|word|excel|outlook)/,
        "Usage concentrates in Teams and Outlook first, Word later, Excel rarely without help. We measure per app so enablement goes where people already are.",
      ],
    ],
    fallback:
      "Adoption covers who used it, who stopped, what broke their trust, and the prompts that work on your content.",
    stats: [
      { k: "Trained in wave one", v: "200", d: "Two-hour enablement" },
      { k: "Still active, week 3", v: "34", d: "Prompt volume per user", bad: true },
      { k: "Grounding conflicts", v: "1,942", d: "Duplicate or unlabelled sources" },
      { k: "Recoverable users", v: "118", d: "With grounding fix + prompt pack", good: true },
    ],
  },
  {
    id: "compliance",
    n: "04",
    title: "Compliance",
    primary: "#F3F4F6",
    accent: "#D1D5DB",
    motion: "beam",
    paths: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M9 15h6"],
    headline: "A prompt is a record. Someone will ask where it lives.",
    lead: [
      {
        who: "beth",
        text: "My question is narrow. When an employee types a client name into Copilot — where does that prompt live, for how long, and who can produce it in discovery. I need the tenant setting that evidences the answer, not a paragraph claiming it.",
      },
      {
        who: "shane",
        text: "In the tenant, in the user's mailbox, discoverable through Purview like any other item — under your retention policy, if you have one. In most tenants Copilot interaction history is unset, which means indefinite by default.",
      },
    ],
    focusLine: {
      who: "shane",
      text: "Since evidence is your blocker, your report maps each finding to __REGULATOR__ and starts from a Purview DSPM for AI baseline, so the pack drops into your existing evidence file rather than sitting beside it.",
    },
    prompt: "What does legal or your regulator need you to prove?",
    placeholder: "e.g. where prompts are stored and for how long",
    chips: [
      [
        "Where prompts are stored",
        "In the tenant, in the user's mailbox, under your retention policy — if one exists. We evidence it with the actual settings and verify eDiscovery returns them, because sometimes it does not.",
      ],
      [
        "Data residency",
        "Advanced Data Residency status per workload, and whether grounding stays in-boundary. Written as a statement your board can read without a translator.",
      ],
      [
        "We're in a regulated industry",
        "Then the report maps findings to your control framework rather than to Microsoft product names. That is the version auditors accept.",
      ],
    ],
    rules: [
      [
        /(gdpr|hipaa|finra|sox|iso|nist|cmmc|ferpa|eu ai)/,
        "Compliance Manager carries templates for most of these. We map each finding to the control it touches so the report extends your existing assessment instead of duplicating it.",
      ],
      [
        /(retention|delete|purge)/,
        "Copilot interaction history is unset in most tenants — indefinite by default. Setting it is a ten-minute change and finding 14 in the report.",
      ],
      [
        /(ediscover|legal hold|subpoena|litigation)/,
        "Prompts and responses are discoverable through Purview like any mailbox item. We verify eDiscovery actually returns them in your tenant, because misconfigured retention sometimes means it does not.",
      ],
      [
        /(dlp|label)/,
        "DLP at the connector level and sensitivity labels on the content Copilot grounds against. Labels also carry into the responses, which is the part most people miss.",
      ],
    ],
    fallback:
      "Compliance covers retention, residency, DLP coverage and label posture, each with the setting that evidences it.",
    stats: [
      { k: "DLP coverage", v: "31%", d: "Of recommended policy set" },
      { k: "Sensitivity labels live", v: "4", d: "Published and applied" },
      { k: "Prompt retention", v: "Unset", d: "Copilot interaction history", bad: true },
      { k: "Residency evidence", v: "Partial", d: "Advanced Data Residency" },
    ],
  },
  {
    id: "health",
    n: "05",
    title: "Health",
    primary: "#22C55E",
    accent: "#4ADE80",
    motion: "pulse",
    paths: ["M22 12h-4l-3 9L9 3l-3 9H2"],
    headline: "Copilot is only as fast as the index underneath it.",
    lead: [
      {
        who: "shane",
        text: "Search index lag, Graph throttling and open service advisories are what make Copilot feel unreliable when nothing is broken. We measure them so the adoption conversation stops being a guess — and so you get a clean bill of health in writing when it is fine.",
      },
      {
        who: "kira",
        text: "And so nobody spends a quarter hardening a platform whose real problem was a four-hour index lag.",
      },
    ],
    focusLine: null,
    isProfile: true,
    prompt: "Anything about tenant performance you want checked?",
    placeholder: "e.g. search has always felt slow",
    chips: [
      [
        "Search feels slow",
        "Index lag is the usual culprit and Copilot inherits every minute of it. We measure per workload rather than guessing, and separate lag from throttling.",
      ],
      [
        "We keep hitting throttling",
        "Graph throttling shows up as Copilot thinking forever. We measure your request rate against tenant limits and name the integrations burning the budget.",
      ],
      [
        "Everything seems fine",
        "Then this pillar is a two-page clean bill of health — worth having in writing before someone blames Copilot for something else.",
      ],
    ],
    rules: [
      [
        /(outage|incident|down|advisor)/,
        "Open advisories get listed against the workloads they touch, so a week-three adoption dip can be attributed instead of argued about.",
      ],
      [
        /(perform|slow|lag|latenc|index)/,
        "Index lag, Graph latency and throttling headroom. Those three explain most 'Copilot is unreliable' complaints I get sent.",
      ],
    ],
    fallback: "Health is the shortest pillar: workload stability, index lag, throttling headroom, open advisories.",
    stats: [
      { k: "Workload stability", v: "98.4%", d: "Trailing 30 days", good: true },
      { k: "Search index lag", v: "4h", d: "Median across workloads" },
      { k: "Open advisories", v: "3", d: "Touching retrieval paths" },
      { k: "Throttling headroom", v: "Low", d: "Graph request budget", bad: true },
    ],
  },
  {
    id: "security",
    n: "06",
    title: "Security",
    primary: "#8B5CF6",
    accent: "#A78BFA",
    motion: "ripple",
    paths: ["M7 11V7a5 5 0 0 1 10 0v4", "M3 11h18v11H3z", "M12 16v2"],
    headline: "Copilot does not widen permissions. It makes them obvious.",
    lead: [
      {
        who: "kira",
        text: "My turn, and I am going to be blunt, because this is the pillar that stops rollouts and everyone in this room has spent six chapters avoiding it.",
      },
      {
        who: "kira",
        text: "Blast radius. Not 'is Copilot secure' — Microsoft's answer to that is fine. The question is what one compromised privileged identity can now summarise in plain English in four seconds instead of three days of manual searching.",
      },
      {
        who: "kira",
        text: "MFA exceptions are my favourite lie — everyone says fully deployed, median tenant carries twenty-seven gaps and the service accounts are always in there. Then Conditional Access: six policies, four still report-only, which documents what should happen and enforces nothing.",
      },
      {
        who: "kira",
        text: "And if DLP is not evaluating the Copilot retrieval path specifically, you have a policy set that stops a human emailing a file and does nothing about a model summarising its contents into a chat window. Show me a tenant where Copilot cannot summarise the HR site and I will approve it today — I have never seen one on a first pass.",
      },
      {
        who: "shane",
        text: "You won't, and I don't ask you to pretend otherwise. What you get is the ranked list with Graph evidence, blast radius per privileged identity, and the day-one control that buys back the quarter while labels and access reviews land.",
      },
      {
        who: "kira",
        text: "Which is the only reason I sign these off. Not because the tenant is clean — because the list is finite, ordered, and I can watch it shrink.",
      },
    ],
    focusLine: {
      who: "kira",
      text: "If sign-off is what you're missing, this is the section you hand over. Ranked findings with evidence — assessors accept that. We do not accept assurances, and neither should you.",
    },
    prompt: "What would your security lead need to see before signing off?",
    placeholder: "e.g. proof Copilot can't reach HR files",
    chips: [
      [
        "Proof Copilot can't reach HR",
        "You won't get that on a first pass. You get the ranked list of what it can reach and the control that closes each one, with the Access Explorer evidence behind it.",
      ],
      [
        "Our MFA coverage is patchy",
        "Median tenant has around 27 gaps and privileged accounts are usually among them. Finding 05, and the fastest thing on the list to close.",
      ],
      [
        "Third-party apps concern us",
        "Broad Graph consent granted years ago to apps nobody uses. We list each one, its permissions, and when it last did anything.",
      ],
    ],
    rules: [
      [
        /(blast|breach|exfil|leak)/,
        "Blast radius is modelled per privileged identity: what that account can reach, and what Copilot would summarise on its behalf. That is the number that moves sign-offs.",
      ],
      [
        /(zero trust|conditional access|ca polic)/,
        "Report-only Conditional Access policies are documentation, not control. We count them separately and the report says so plainly.",
      ],
      [
        /(pen ?test|audit|red team)/,
        "This is not a penetration test. It is a permission and configuration assessment against the Copilot retrieval path — a different scope, and the one that actually predicts oversharing.",
      ],
      [
        /(guest|external)/,
        "Stale guests are the forgotten path. Dormant guest accounts with lingering site membership sit inside the grounding scope until someone removes them.",
      ],
    ],
    fallback:
      "Security covers identity gaps, consent grants, guest lifecycle and blast radius, each with Graph evidence attached.",
    stats: [
      { k: "Conditional Access", v: "6", d: "4 still report-only" },
      { k: "MFA gaps", v: "27", d: "Privileged accounts included", bad: true },
      { k: "Broad-consent apps", v: "9", d: "Graph permissions granted" },
      { k: "Stale guest accounts", v: "64", d: "19 dormant over a year" },
    ],
  },
  {
    id: "copilot",
    n: "07",
    title: "Copilot",
    primary: "#67E8F9",
    accent: "#7DD3FC",
    motion: "burst",
    paths: [
      "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
      "M19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9z",
    ],
    headline: "Inside the hour you know exactly what Copilot can see.",
    lead: [
      {
        who: "shane",
        text: "Everything above is a conversation. This is where you get an answer. Read-only Graph access, nothing installed, nothing changed. The scan runs in about ten minutes. Then we spend thirty to forty-five minutes reading the output together, and you walk out with a Go or No-Go on Copilot plus a step-by-step remediation guide.",
      },
      {
        who: "beth",
        text: "And the residency and retention statements come signed and dated. That is the part my board actually reads.",
      },
      {
        who: "kira",
        text: "I get the ranked list with evidence. If it says the tenant is ready, I will say so in the meeting.",
      },
    ],
    focusLine: null,
    isClose: true,
    prompt: "Anything you want to know before booking?",
    placeholder: "e.g. what access do you actually need?",
    chips: [
      [
        "What access do you need?",
        "Read-only Graph access for the length of the session. Nothing installed, nothing changed, and you revoke it the moment we finish.",
      ],
      [
        "Who writes the report?",
        "I do. Same framework I wrote at NASA and the agency distributed M365-wide. You are not getting a junior with a scanner and a template.",
      ],
      [
        "Do we get the fixes too?",
        "Yes — the remediation guide is one of the nine documents, step by step against your own findings. If you want us to execute it, the fee is credited in full against that work.",
      ],
    ],
    rules: [
      [
        /(timeline|how long|when|weeks|hour)/,
        "One session. The scan takes about ten minutes, then thirty to forty-five minutes to read the nine documents together. You leave with the decision made, not a report to schedule a follow-up about.",
      ],
      [
        /(price|cost|discount|cheaper)/,
        "Priced at __FEE__, with no seat-based scaling, and credited against remediation. There is no cheaper version — there is a free diagnostic that returns six of the twenty-four findings.",
      ],
      [
        /(free|diagnostic|trial|sample)/,
        "The free diagnostic returns six of the twenty-four findings. Enough to know whether you have a problem, not enough to fix it.",
      ],
    ],
    fallback:
      "Short version: one session, priced at __FEE__, nine documents from your live telemetry, read-only access, credited against remediation.",
  },
];

export const DELIVERABLES: { key: PillarId; tag: string; color: string; name: string; note: string }[] = [
  {
    key: "governance",
    tag: "Deliverable 01",
    color: "#67e8f9",
    name: "Go / No-Go Readiness Report",
    note: "The verdict, with the Graph evidence behind it",
  },
  {
    key: "governance",
    tag: "Deliverable 02",
    color: "#A78BFA",
    name: "Oversharing Remediation Playbook",
    note: "RCD, labels and lifecycle in three tiers",
  },
  {
    key: "licensing",
    tag: "Deliverable 03",
    color: "#2DD4BF",
    name: "Licence Drift & Right-Sizing Model",
    note: "Drift, idle seats and the reassignment list",
  },
  {
    key: "compliance",
    tag: "Deliverable 04",
    color: "#F3F4F6",
    name: "Step-by-Step Remediation Guide",
    note: "Every finding, in order, with the cmdlet",
  },
];

export interface ReadinessCheck {
  id: string;
  n: string;
  q: string;
  opts: [string, number][];
  back: Record<number, string>;
}

/**
 * The readiness checks, distributed across the pillars they actually belong to.
 * Eleven in total: the ten numbered checks (q1–q10) plus the unnumbered health
 * baseline (`qh`, shown as "—"). The score denominator is derived from this map,
 * so adding a check here is all it takes to change the scale.
 */
export const READINESS: Record<PillarId, ReadinessCheck[]> = {
  governance: [
    {
      id: "q8",
      n: "08",
      q: "Do you have written Copilot ground rules yet — acceptable use, what staff may and may not put in a prompt?",
      opts: [
        ["Published and acknowledged", 10],
        ["Drafted, not published", 6],
        ["Nothing written down", 2],
      ],
      back: {
        10: "Then you are ahead of almost everyone. We check it against what the tenant actually permits — the two rarely match.",
        6: "Draft is fine. The assessment gives you the tenant evidence to finish it rather than guessing at the rules.",
        2: "Normal, and fixable in an afternoon once you know what Copilot can actually reach. It is one of the nine documents.",
      },
    },
  ],
  licensing: [
    {
      id: "q1",
      n: "01",
      q: "Where are you on licensing — do you already hold E3, E5 or Business Premium, and are any Copilot seats assigned?",
      opts: [
        ["E5, Copilot seats assigned", 10],
        ["E3 or Business Premium", 6],
        ["Mixed, honestly not sure", 3],
      ],
      back: {
        10: "Good. E5 gives you SharePoint Advanced Management and Purview, which is most of the toolkit this assessment recommends.",
        6: "Workable. Some governance controls are gated behind E5, so the report tells you which findings you can close today and which need a SKU conversation.",
        3: "Then the licence scan earns its place immediately. Drift, duplicates and orphaned SKUs usually cover the fee on their own.",
      },
    },
  ],
  adoption: [
    {
      id: "q5",
      n: "05",
      q: "How familiar is your workforce with AI already — are people using it daily, or is this genuinely new ground?",
      opts: [
        ["Already using AI daily", 10],
        ["A handful of enthusiasts", 6],
        ["Almost entirely new", 3],
      ],
      back: {
        10: "Then your risk is shadow AI, not reluctance. We check what tools are already touching tenant data.",
        6: "That handful is your champion pool. The report names them from actual usage rather than volunteers.",
        3: "Then the first three answers people get decide everything. Grounding quality matters more than training budget.",
      },
    },
    {
      id: "q6",
      n: "06",
      q: "Is there a training plan or named AI champions to carry adoption once the licences land?",
      opts: [
        ["Plan and champions in place", 10],
        ["Planned, nobody named", 5],
        ["Neither yet", 2],
      ],
      back: {
        10: "Then we hand your champions six tested prompts per department instead of generic examples.",
        5: "Naming them is the easy part. Giving them prompts that work on your own content is what makes it stick.",
        2: "Expected. Adoption failure is almost always a grounding problem first and a training problem second.",
      },
    },
  ],
  compliance: [
    {
      id: "q3",
      n: "03",
      q: "How is data sensitivity handled today — are sensitivity labels and classification actually applied?",
      opts: [
        ["Labels published and applied", 10],
        ["Published, barely applied", 5],
        ["No labels yet", 2],
      ],
      back: {
        10: "Then Copilot inherits that protection into its responses, which is exactly the outcome you want.",
        5: "Published-but-unapplied is the common state. We measure coverage rather than existence.",
        2: "Then Restricted Content Discovery is your day-one control while labelling catches up.",
      },
    },
    {
      id: "q4",
      n: "04",
      q: "Are DLP policies live, and is there a governance framework deciding who gets access to what?",
      opts: [
        ["Both, actively enforced", 10],
        ["DLP only, no framework", 5],
        ["Neither", 2],
      ],
      back: {
        10: "We test them against the Copilot retrieval path specifically — that is where most policy sets have a gap.",
        5: "DLP without an access framework catches leaks but not oversharing. Copilot exposes the second one.",
        2: "Purview DSPM for AI gives you a baseline in a day. It is where your remediation guide starts.",
      },
    },
  ],
  health: [
    {
      id: "qh",
      n: "—",
      q: "Has anyone baselined tenant performance — search index lag, Graph throttling, open advisories?",
      opts: [
        ["Monitored continuously", 10],
        ["Only when something breaks", 5],
        ["Never looked", 3],
      ],
      back: {
        10: "Then we compare against your own baseline rather than sector medians. Much sharper findings.",
        5: "Reactive is normal. The risk is blaming Copilot for a four-hour index lag that predates it.",
        3: "We baseline it during the scan, so you get the clean bill of health in writing either way.",
      },
    },
  ],
  security: [
    {
      id: "q2",
      n: "02",
      q: "Is Entra ID fully configured, and is MFA deployed broadly — including privileged accounts?",
      opts: [
        ["Fully deployed, no exceptions", 10],
        ["Deployed with exceptions", 5],
        ["Patchy or unknown", 2],
      ],
      back: {
        10: "Then Kira's hardest question is already answered and we can spend the time on retrieval scope instead.",
        5: "Exceptions are where the findings live. We enumerate every one and rank them by what Copilot could reach.",
        2: "Finding 05, and the fastest thing on the whole list to close. Median tenant carries 27 gaps.",
      },
    },
  ],
  copilot: [
    {
      id: "q9",
      n: "09",
      q: "Have you pinned down where Copilot would actually pay — the specific processes, not the general promise?",
      opts: [
        ["Specific use cases identified", 10],
        ["A rough idea", 6],
        ["Not yet", 3],
      ],
      back: {
        10: "Then we test those exact use cases against your tenant during the scan. Real prompts, your data, measured results.",
        6: "Rough is enough to start. The assessment sharpens it against what your content can actually support.",
        3: "That is what the persona work above is for. The report ranks use cases by what your tenant can ground today.",
      },
    },
    {
      id: "q10",
      n: "10",
      q: "Is there a plan to measure it afterwards — productivity, time saved, adoption rates?",
      opts: [
        ["Metrics defined and tracked", 10],
        ["Intending to, no method", 5],
        ["No plan", 2],
      ],
      back: {
        10: "Then you will be one of the few who can prove the renewal. We add the Copilot Dashboard baseline to your pack.",
        5: "Three numbers is enough: weekly active per department, prompts per active user, retained at week six.",
        2: "Without it the renewal conversation is a feeling. We set the baseline during the scan so you have a before.",
      },
    },
    {
      id: "q7",
      n: "07",
      q: "Last one — does executive leadership actually back this, or are you the one carrying it?",
      opts: [
        ["Full executive sponsorship", 10],
        ["Interested, not committed", 5],
        ["I am carrying it alone", 3],
      ],
      back: {
        10: "Then the report is written for them: page one is the verdict and the money, the rest is evidence.",
        5: "The licence recovery number is usually what converts interest into commitment. It is page two.",
        3: "Then you need ammunition, not encouragement. That is precisely what nine evidenced documents are for.",
      },
    },
  ],
};

/** Two or three personas speak per pillar, in order, so the room is never just Shane and Kira. */
export const PERSONA_TAKE: Record<PillarId, { i: number; line: string }[]> = {
  governance: [
    {
      i: 0,
      line: "This is the bit that worries me. I do not want to be the person who asks an innocent question and gets handed something I was never meant to read.",
    },
    {
      i: 1,
      line: "And half of what I work in came off a file server in a migration nobody documented. I could not tell you who has access to it.",
    },
  ],
  licensing: [
    {
      i: 2,
      line: "I would rather that budget went to people who actually use it. I know of at least a dozen licences sitting on leavers.",
    },
  ],
  adoption: [
    {
      i: 1,
      line: "Honestly, I gave it three tries. It got the wrong document twice and I stopped. Nobody keeps pushing past that.",
    },
    {
      i: 0,
      line: "I stuck with it, but only because I already knew which answer was right. Someone new would have believed the wrong one.",
    },
  ],
  compliance: [
    {
      i: 2,
      line: "My problem is simpler. If I cannot show where a prompt lives and how long it is kept, I cannot sign anything — no matter how useful it is.",
    },
  ],
  health: [
    {
      i: 1,
      line: "It just has to feel fast. If it thinks for ten seconds, people go back to searching manually and never come back.",
    },
  ],
  security: [
    { i: 2, line: "And I need that answer before we roll out, not after somebody finds it in an audit." },
    {
      i: 1,
      line: "I will say the quiet part. There are shares I can open today that I am fairly sure I should not be able to.",
    },
  ],
  copilot: [
    { i: 0, line: "For what it is worth, I want this. I just want it to be right before it is in front of me every day." },
  ],
};

export const ICON_PATH: Record<string, string> = {
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="M12 8v4"></path><path d="M12 16h.01"></path>',
  scale:
    '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"></path><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"></path><path d="M7 21h10"></path><path d="M12 3v18"></path><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"></path>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
  coins:
    '<circle cx="8" cy="8" r="6"></circle><path d="M18.09 10.37A6 6 0 1 1 10.34 18"></path><path d="M7 6h1v4"></path>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>',
};

export interface PriorityFlag {
  t: "critical" | "high";
  i: keyof typeof ICON_PATH;
  why: string;
}

/** Where each sector's regulatory and commercial pressure actually lands. */
export const INDUSTRY_PRIORITY: Record<string, Partial<Record<PillarId, PriorityFlag>>> = {
  "Space & aerospace": {
    security: {
      t: "critical",
      i: "shield",
      why: "ITAR / EAR export-controlled technical data — unauthorised access is a federal matter, not an IT ticket",
    },
    governance: {
      t: "critical",
      i: "flame",
      why: "Decades of programme sites and migrated engineering shares with permissions nobody has reviewed",
    },
    compliance: {
      t: "high",
      i: "scale",
      why: "Export-control records, mission assurance evidence and review-board traceability",
    },
  },
  "Financial services": {
    compliance: {
      t: "critical",
      i: "flame",
      why: "SEC 17a-4 / FINRA recordkeeping — prompts and responses are business records",
    },
    security: { t: "critical", i: "shield", why: "MNPI and client PII; information-barrier failures are reportable events" },
    governance: { t: "high", i: "lock", why: "Ethical walls between deal teams break the moment retrieval crosses them" },
  },
  Healthcare: {
    compliance: { t: "critical", i: "flame", why: "HIPAA — PHI inside a generated summary is still a disclosure" },
    security: {
      t: "critical",
      i: "shield",
      why: "Patient records reachable by anyone with a licence is a breach waiting for a query",
    },
    governance: { t: "high", i: "lock", why: "Clinical shares and research data with a decade of inherited access" },
  },
  "Public sector": {
    compliance: {
      t: "critical",
      i: "flame",
      why: "Records schedules and FOI — prompts fall outside a retention policy written before the cloud",
    },
    governance: { t: "high", i: "lock", why: "Constituent casework and programme sites shared org-wide by default" },
    security: { t: "high", i: "shield", why: "Nation-state interest and constituent data in one tenant" },
  },
  "Professional services": {
    governance: {
      t: "critical",
      i: "flame",
      why: "One tenant across every client — matter-level separation is the whole business",
    },
    compliance: { t: "high", i: "scale", why: "Client confidentiality and independence obligations you contracted for" },
    licensing: { t: "high", i: "coins", why: "Utilisation is your margin; idle seats are billable capacity you paid for twice" },
  },
  Manufacturing: {
    security: { t: "critical", i: "shield", why: "Designs, specs and process IP — the highest-value theft target in your sector" },
    governance: {
      t: "critical",
      i: "flame",
      why: "Engineering shares migrated off file servers with permissions carried over wholesale",
    },
    adoption: { t: "high", i: "users", why: "A frontline, mobile-first workforce your usage telemetry consistently misses" },
  },
};

export type ChapterId = "hero" | "intro" | "industry" | "cast" | PillarId;

export const CHAP_ORDER: ChapterId[] = [
  "hero",
  "intro",
  "industry",
  "cast",
  "governance",
  "licensing",
  "adoption",
  "compliance",
  "health",
  "security",
  "copilot",
];

export const SOURCES: Record<PillarId, string[]> = {
  governance: ["SharePoint Data Access Governance", "SAM Content Management Assessment"],
  licensing: ["Microsoft 365 usage reports", "Copilot Dashboard · Viva Insights"],
  adoption: ["Copilot Dashboard", "Graph search telemetry"],
  compliance: ["Purview DSPM for AI", "Compliance Manager"],
  health: ["Service Health API", "Graph throttling telemetry"],
  security: ["Entra Access Explorer", "Conditional Access policy set"],
  copilot: ["All seven pillars", "150+ tenant checks"],
};

export const HERO_LINE =
  "A security assessor, the people who would actually use Copilot, and me — around one table, working through what it does to each of their days. Tell me about your organisation and we will walk all seven readiness pillars against your real workload. The Go / No-Go comes from the paid assessment; this is where you find out whether you need one.";

export const CHAP: Record<ChapterId, { label: string; color: string; who: CastId; line: string }> = {
  hero: {
    label: "The room · assembling",
    color: "#67E8F9",
    who: "shane",
    line: "Three personas, seven pillars, and how they collide with real work.",
  },
  intro: {
    label: "About Shane · who is running this",
    color: "#60A5FA",
    who: "shane",
    line: "Who I am, what this is, and how the hour actually runs.",
  },
  industry: {
    label: "Discovery · 4 questions",
    color: "#67E8F9",
    who: "shane",
    line: "Tell me your industry, or I will start us in space.",
  },
  cast: {
    label: "Your personas · joining",
    color: "#4ADE80",
    who: "shane",
    line: "Three people from your sector, and what Copilot actually does to their day.",
  },
  governance: {
    label: "Pillar 01 · Governance",
    color: "#60A5FA",
    who: "kira",
    line: "Permissions first — everything downstream depends on who can already see what.",
  },
  licensing: {
    label: "Pillar 02 · Licensing",
    color: "#2DD4BF",
    who: "shane",
    line: "Licence drift and idle seats. This pillar usually pays for the assessment outright.",
  },
  adoption: {
    label: "Pillar 03 · Adoption",
    color: "#FB923C",
    who: "shane",
    line: "Adoption is a grounding problem wearing a training problem's clothes.",
  },
  compliance: {
    label: "Pillar 04 · Compliance",
    color: "#F3F4F6",
    who: "shane",
    line: "Nothing counts here unless you can evidence it in writing.",
  },
  health: {
    label: "Pillar 05 · Health",
    color: "#4ADE80",
    who: "shane",
    line: "An indicative reading from your answers — the real verdict needs your tenant.",
  },
  security: {
    label: "Pillar 06 · Security",
    color: "#A78BFA",
    who: "kira",
    line: "This is the section that stops most rollouts. Read it carefully.",
  },
  copilot: {
    label: "Pillar 07 · Copilot",
    color: "#67E8F9",
    who: "shane",
    line: "That is the whole assessment. One session, fixed fee, every document is yours.",
  },
};

export const FIVE_W: { k: string; v: string; d: string }[] = [
  {
    k: "Who",
    v: "Shane McCaw",
    d: "NASA's M365 Copilot Architect. 30 years in the ecosystem. The person who writes your report is the person in the room.",
  },
  {
    k: "What",
    v: "Copilot Readiness Assessment",
    d: "150+ checks across seven pillars, a Go / No-Go verdict, and nine documents written from your live tenant telemetry.",
  },
  {
    k: "When",
    v: "Under an hour",
    d: "About 10 minutes to scan your tenant, then 30 to 45 minutes reading the output together. You leave the session decided.",
  },
  {
    k: "Where",
    v: "Inside your tenant",
    d: "Read-only Graph access. Nothing installed, nothing changed, revoke it the day the report lands.",
  },
  {
    k: "Why",
    v: "Readiness is per-persona",
    d: "The same tenant is safe for one role and reckless for another. The pillars decide which, and for whom.",
  },
  {
    k: "How",
    v: "One session, one screen share",
    d: "DAG reports, the SAM assessment, Purview DSPM for AI and Graph telemetry run live while we talk.",
  },
];

export const INTRO_MESSAGES: { who: CastId; text: string }[] = [
  {
    who: "shane",
    text: "Shane McCaw. Thirty years in the Microsoft ecosystem, and I wrote the governance framework NASA distributed agency-wide. These days I do one thing: open enterprise tenants and work out whether Copilot is safe to switch on — in that tenant, with the permissions it actually has.",
  },
  {
    who: "shane",
    text: "Ask me anything as we go. A few questions from me, we build the people who would really use Copilot, then walk the seven pillars against their workload.",
  },
];

export const HERO_STATS: { v: string; k: string }[] = [
  { v: "150+", k: "Graph & tenant checks" },
  { v: "7", k: "Readiness pillars" },
  { v: "~10 min", k: "Scan to documents" },
  { v: "9", k: "Documents, tenant-specific" },
];

/**
 * Fills the export's content placeholders. `__SENSITIVE__`/`__REGULATOR__` come
 * from the selected sector; `__FEE__` comes from the live catalog price (never a
 * literal in source — see the file header).
 *
 * Every `__FEE__` site is phrased as a "…at/against __FEE__" slot so that
 * FEE_UNRESOLVED reads correctly while `/api/services` is still in flight or
 * unavailable. The alternative — printing a number the catalog has not confirmed —
 * is exactly what the no-hardcoding rule exists to prevent.
 */
export const FEE_UNRESOLVED = "a fixed fee";

export function fillTokens(
  text: string,
  ind: Pick<IndustryDef, "sensitive" | "reg">,
  fee: string,
): string {
  return text
    .split("__SENSITIVE__")
    .join(ind.sensitive)
    .split("__REGULATOR__")
    .join(ind.reg)
    .split("__FEE__")
    .join(fee);
}
