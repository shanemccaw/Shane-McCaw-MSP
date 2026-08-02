/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (script lines 3625-7937 - data constants)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */

/** Static briefing content: pillars, node registry, scripted dialogue, dive walkthroughs. */

export const PILLARS = [
  { id: "security", label: "Security", impact: "RISK", color: "#f87171" },
  { id: "governance", label: "Governance", impact: "CONTROL", color: "#a78bfa" },
  { id: "licensing", label: "Licensing", impact: "COST", color: "#fbbf24" },
  { id: "adoption", label: "Adoption", impact: "PRODUCTIVITY", color: "#2dd4bf" },
  { id: "copilot", label: "Copilot & AI", impact: "AI IMPACT", color: "#60a5fa" },
  { id: "compliance", label: "Compliance", impact: "LEGAL", color: "#818cf8" },
  { id: "health", label: "Tenant Health", impact: "EXPERIENCE", color: "#34d399" }
];

export const NODES = [
  { id: "entra", label: "Entra ID", pillar: "security", status: "healthy", metric: "99.98%", latency: 118, endpoint: "/v1.0/directoryObjects" },
  { id: "ca", label: "Conditional Access", pillar: "security", status: "healthy", metric: "42 pol", latency: 204, endpoint: "/beta/identity/conditionalAccess/policies" },
  { id: "defender", label: "Defender Endpoint", pillar: "security", status: "healthy", metric: "98.4%", latency: 176, endpoint: "/v1.0/security/alerts_v2" },
  { id: "sharepoint", label: "SharePoint Governance", pillar: "governance", status: "healthy", metric: "1,204", latency: 288, endpoint: "/v1.0/sites?search=*" },
  { id: "guests", label: "Guest Access", pillar: "governance", status: "drift", metric: "612 ext", latency: 231, endpoint: "/v1.0/users?$filter=userType eq 'Guest'" },
  { id: "meter", label: "Licensing Meter", pillar: "licensing", status: "healthy", metric: "2,140", latency: 143, endpoint: "/v1.0/subscribedSkus" },
  { id: "seatdrift", label: "Seat Drift", pillar: "licensing", status: "healthy", metric: "-12%", latency: 155, endpoint: "/beta/reports/getOffice365ActiveUserDetail" },
  { id: "teams", label: "Teams Adoption", pillar: "adoption", status: "healthy", metric: "87%", latency: 197, endpoint: "/v1.0/reports/getTeamsUserActivityCounts" },
  { id: "copilotready", label: "Copilot Readiness", pillar: "copilot", status: "drift", metric: "61%", latency: 264, endpoint: "/beta/copilot/readiness" },
  { id: "semantic", label: "Semantic Index", pillar: "copilot", status: "healthy", metric: "queued", latency: 312, endpoint: "/beta/search/semanticIndex" },
  { id: "dlp", label: "Exchange DLP", pillar: "compliance", status: "healthy", metric: "18 rules", latency: 221, endpoint: "/beta/security/dataLossPrevention/policies" },
  { id: "purview", label: "Purview Audit", pillar: "compliance", status: "healthy", metric: "180d", latency: 405, endpoint: "/beta/security/auditLog/queries" },
  { id: "intune", label: "Intune Compliance", pillar: "health", status: "healthy", metric: "94.2%", latency: 189, endpoint: "/v1.0/deviceManagement/managedDevices" },
  { id: "servicehealth", label: "Service Health", pillar: "health", status: "healthy", metric: "nominal", latency: 96, endpoint: "/v1.0/admin/serviceAnnouncement/healthOverviews" }
];

export const CONTEXT = {
  org: "Northline Health",
  industry: "Regional provider network · 14 clinics, 2 hospitals",
  seats: "6,180 M365 seats · 4,200 clinical",
  regs: ["HIPAA / HITECH", "42 CFR Part 2", "State PHI breach law", "Joint Commission audit"],
  personas: [
    { role: "Attending Clinician", n: "2,140 seats", tools: "Outlook · Teams · Word", use: "Draft visit summaries and referral letters from the encounter note", risk: "Grounds on PHI in unlabeled OneDrive folders", color: "#60a5fa" },
    { role: "Nurse Manager", n: "480 seats", tools: "Teams · Excel · Planner", use: "Shift handover digests and staffing variance summaries", risk: "Cross-unit channels carry patient identifiers", color: "#34d399" },
    { role: "Revenue Cycle Analyst", n: "310 seats", tools: "Excel · SharePoint · Outlook", use: "Denial trend analysis and payer appeal drafting", risk: "Claims workbooks shared org-wide", color: "#fbbf24" },
    { role: "Compliance Officer", n: "40 seats", tools: "Purview · Word · Teams", use: "Audit evidence assembly and policy redlines", risk: "Needs provable retention, not best effort", color: "#f87171" }
  ],
  sensitivity: [
    { label: "PHI", pct: 38, color: "#f87171" },
    { label: "PII", pct: 21, color: "#fbbf24" },
    { label: "Confidential", pct: 27, color: "#60a5fa" },
    { label: "General", pct: 14, color: "#475569" }
  ],
  labelled: "78% of PHI containers labelled · 11,400 documents unlabelled",
  collab: [
    { label: "Within care team", pct: 63 },
    { label: "Cross-department", pct: 22 },
    { label: "External (payers, vendors)", pct: 11 },
    { label: "Patient-facing", pct: 4 }
  ],
  collabNote: "41 org-wide links · 312 guest identities · 96 sites with broken inheritance",
  tools: [
    { label: "Outlook", pct: 96 }, { label: "Teams", pct: 88 }, { label: "Word", pct: 74 },
    { label: "Excel", pct: 69 }, { label: "SharePoint", pct: 61 }, { label: "OneDrive", pct: 58 }, { label: "Copilot", pct: 31 }
  ],
  priorities: [
    { rank: "01", label: "Cut clinical documentation burden", metric: "6.4 hrs / clinician / week" },
    { rank: "02", label: "Keep PHI out of generated answers", metric: "reportable under MSA §7.4" },
    { rank: "03", label: "Stop paying for ungoverned seats", metric: "$8,400 / month recoverable" },
    { rank: "04", label: "Shorten revenue cycle", metric: "denial rework down 18%" }
  ],
  roi: [
    { v: "$4.1M", l: "Annual clinical time recovered", c: "#34d399" },
    { v: "3.2×", l: "Return over 14 months", c: "#34d399" },
    { v: "$317K", l: "Annual license position", c: "#e2e8f0" },
    { v: "$101K", l: "Recoverable waste / year", c: "#fbbf24" }
  ],
  security: [
    { v: "96%", l: "MFA coverage", c: "#34d399" },
    { v: "14", l: "Privileged roles drifted", c: "#fbbf24" },
    { v: "62%", l: "DLP policy coverage", c: "#f87171" },
    { v: "2", l: "Unscoped DLP policies", c: "#f87171" }
  ]
};

export const INTRO = [
  { who: "shane", focus: "copilotready", pillar: "Copilot readiness",
    line: "Before any of this means anything, you should know who is in the room. I'm Shane — I run M365 architecture at NASA scale. My job today is not to sell you a licence. It's to show you what your own tenant already told us this morning, and let the people who live in it do the talking.",
    tenure: "Lead M365 Architect · 14 years · NASA",
    lives: "Purview · Entra · Graph · Copilot Studio",
    day: "Runs the read-only tenant scan, then sequences the work so nothing lands before it is safe to land.",
    pains: [["Every vendor shows a dashboard", "nobody shows the tenant"], ["Readiness scored in slideware", "not in Graph"]],
    wants: "A briefing where every number on screen came out of your tenant, live.",
    stat: [["6,180", "seats in scope"], ["122", "signals polled"], ["31%", "Copilot active"]] },

  { who: "jane", focus: "sharepoint", pillar: "Governance",
    line: "I'm Maya. I sit between the clinics and the platform. When someone shares a folder to make their day easier, it lands in my queue three months later as an exposure. I am not against sharing — I am against sharing we cannot see.",
    tenure: "Flight Controller · Contoso · 6 years",
    lives: "SharePoint · Teams · OneDrive",
    day: "Approves site requests, chases broken inheritance, fields 'why can't I see this' tickets from four clinics.",
    pains: [["41 sites carry org-wide links", "every licensed user can reach them"], ["96 sites with broken inheritance", "no owner reviews them"], ["312 guest identities", "last access review: never"]],
    wants: "Copilot that respects intent, not just permissions.",
    stat: [["1,204", "sites in scope"], ["41", "org-wide links"], ["78%", "labelled"]] },

  { who: "priya", focus: "intune", pillar: "Security",
    line: "Dr. Aaron Vance. I'm a research scientist, and I'm the person your readiness number is actually about. I lose the first ninety minutes of every day to documentation. I don't need a copilot that's clever. I need one that's allowed to see the right thing.",
    tenure: "Research Scientist · Contoso · 9 years",
    lives: "Word · Outlook · Teams · Excel",
    day: "Drafts summaries and referral letters, hunts the right prior document across three sites before writing a line.",
    pains: [["6.4 hours a week", "lost to routine documentation"], ["312 endpoints off baseline", "his device among them"], ["20 minutes", "to find numbers Copilot found in 9 seconds"]],
    wants: "Nine seconds instead of twenty minutes — on content he is cleared to see.",
    stat: [["6.4h", "lost / week"], ["312", "endpoints drifted"], ["61%", "readiness"]] },

  { who: "marcus", focus: "servicehealth", pillar: "Health",
    line: "Ellis, support team lead. Forty percent of my queue is people asking questions the tenant could answer itself. I'm not worried about AI taking my job. I'm worried about it answering with something it should never have been able to read.",
    tenure: "Support Team Lead · Contoso · 4 years",
    lives: "Teams · Outlook · ServiceNow · Intune",
    day: "Triages 340 tickets a week, owns the change window, writes the evidence pack when something goes wrong.",
    pains: [["40% of tickets", "are answerable from existing content"], ["Ticket aging climbing", "while the team firefights access"], ["Change windows", "10 working days, no room for surprises"]],
    wants: "Deflection he can trust, with an audit trail he can hand to Beth.",
    stat: [["340", "tickets / week"], ["40%", "self-answerable"], ["99%", "SLA compliance"]] },

  { who: "kirk", focus: "ca", pillar: "Security",
    line: "Kirk Danvers. I assess security for a living, which means I am the least popular person in most of these meetings. I don't deal in posture scores. I deal in what an attacker — or an over-eager prompt — can actually reach today.",
    tenure: "Security Assessor · independent",
    lives: "Entra · Defender · Purview · Graph",
    day: "Pulls live evidence read-only, then proves the blast radius rather than describing it.",
    pains: [["14 privileged roles drifted", "outside PIM"], ["2 DLP policies unscoped", "PHI paths uncovered"], ["Posture reported quarterly", "risk moves daily"]],
    wants: "Findings raised with evidence attached, not adjectives.",
    stat: [["96%", "MFA coverage"], ["14", "roles drifted"], ["62%", "DLP coverage"]] },

  { who: "beth", focus: "dlp", pillar: "Compliance",
    line: "Beth Aldrin, legal and risk. I care about exactly one question: if this system surfaces regulated content in an answer, is it an internal issue or a reportable one? Today, on these numbers, it is reportable.",
    tenure: "Legal & Risk · Contoso · 11 years",
    lives: "Purview · Word · Teams",
    day: "Owns the MSA, the breach clock, and the conversation nobody wants to have with a regulator.",
    pains: [["Reportable under MSA §7.4", "if PHI surfaces in a generated answer"], ["11,400 unlabelled documents", "inside Copilot's reach"], ["Retention rules", "best-effort, not provable"]],
    wants: "Provable containment before the pilot widens, not after.",
    stat: [["11,400", "unlabelled docs"], ["§7.4", "MSA clause"], ["38%", "of content is PHI"]] }
];

export const PERSONAS = {
  shane: { name: "Shane McCaw", role: "Lead M365 Architect · NASA", side: "host", tile: "linear-gradient(135deg,#0078D4,#67E8F9)", initials: "SM", color: "#60a5fa", side2: "left", seatX: "17%", seatY: "13%" },
  jane: { name: "Maya Torres", role: "Flight Controller · Contoso", side: "left", tile: "linear-gradient(135deg,#1d4ed8,#0ea5e9)", initials: "MT", color: "#60a5fa", seatX: "9%", seatY: "30%" },
  priya: { name: "Dr. Aaron Vance", role: "Research Scientist · Contoso", side: "left", tile: "linear-gradient(135deg,#0f766e,#2dd4bf)", initials: "AV", color: "#2dd4bf", seatX: "3%", seatY: "56%" },
  marcus: { name: "Ellis Brandt", role: "Support Team Lead · Contoso", side: "right", tile: "linear-gradient(135deg,#4338ca,#818cf8)", initials: "EB", color: "#818cf8", seatX: "90%", seatY: "22%" },
  kirk: { name: "Kirk Danvers", role: "Security Assessor", side: "right", tile: "linear-gradient(135deg,#b91c1c,#f87171)", initials: "KD", color: "#f87171", seatX: "93%", seatY: "52%" },
  beth: { name: "Beth Aldrin", role: "Legal & Risk", side: "right", tile: "linear-gradient(135deg,#a16207,#fbbf24)", initials: "BA", color: "#fbbf24", seatX: "90%", seatY: "80%" },
  user: { name: "You", role: "Participant", side: "user", tile: "linear-gradient(135deg,#1e293b,#334155)", initials: "YOU", color: "#22d3ee", seatX: "88%", seatY: "82%" }
};


export const PERSONA_BRIEF = {
  shane: {
    fn: "Lead M365 Architect at NASA — deployed Copilot to the largest US federal agency, 2026 Forum Award winner, and author of the governance white paper circulated by the White House. Chairs this assessment readout and owns the go/no-go call.",
    cares: "Whether the tenant can clear the 75 percent readiness gate inside the Phase 3 window, with owners and dates that hold.",
    blocking: "Three named gaps — Exchange DLP scope, SharePoint oversharing, Intune device drift — worth 17 readiness points combined.",
    needs: "Phase 3 closed at ten of ten findings, then a staged rollout starting with Finance and Legal.",
    good: ["Identity perimeter is nominal and needs no work", "Adoption is high enough for Copilot to deliver value on day one", "Every blocker has a named owner and a date"],
    bad: ["Readiness recalculation is manual between beats", "Pilot comms plan drafted but unapproved"],
    ugly: ["Enabling at 61 percent would put ungoverned content in front of every licensed user"],
    priorities: ["Close DLP scope first — it breaks the risk chain at the source", "Publish the Intune baseline the same night", "Hold tenant-wide rollout until Phase 3 closes"],
    actions: ["copilotready", "riskchain", "sow"]
  },
  jane: {
    fn: "Mission specialist — translates tenant telemetry into operational blockers and sequencing.",
    cares: "What Copilot will actually surface the moment grounding is switched on.",
    blocking: "41 sites carrying org-wide links, plus unlabelled personal stores in OneDrive.",
    needs: "Scoped access on every overshared site and label inheritance enforced before the semantic index builds.",
    good: ["All 1,204 sites inventoried with owners assigned", "External sharing already restricted to authenticated guests"],
    bad: ["Label inheritance not enforced on new sites", "Site lifecycle reviews 40 days overdue"],
    ugly: ["Copilot does not create exposure, it surfaces it — oversharing becomes citable answers instantly"],
    priorities: ["Convert org-wide links to scoped access", "Enforce label inheritance at site provisioning", "Hold the semantic index build until the sweep completes"],
    actions: ["sharepoint", "onedrive", "copilotready"]
  },
  priya: {
    fn: "Operations lead — owns device posture, baseline enforcement and day-to-day service health.",
    cares: "That every endpoint running Copilot is on a managed, compliant baseline.",
    blocking: "312 devices that fell out of Intune compliance when the autopilot profile was re-scoped.",
    needs: "Baseline re-published, drift detection back to continuous, and CA device-compliance grants scoped to the Copilot app.",
    good: ["94.2 percent compliant, encryption and secure boot enforced everywhere", "Service health nominal across all workloads"],
    bad: ["Baseline is 11 days old and drift detection is lagging", "Patch ring 3 is two cycles behind"],
    ugly: ["Drifting devices can still run Copilot in Teams and Word tonight"],
    priorities: ["Re-publish the compliance baseline", "Re-assign the unassigned device groups", "Scope a device-compliance grant to Copilot"],
    actions: ["intune", "ca"]
  },
  marcus: {
    fn: "Engineering lead — owns policy configuration, change control and the technical remediation itself.",
    cares: "Coverage completeness: every policy scoped to every object it is supposed to evaluate.",
    blocking: "Two unscoped DLP policy sets and a Conditional Access estate with no Copilot-specific policy.",
    needs: "DLP baseline applied to finance and legal scopes, and a CA policy that governs Copilot app sessions.",
    good: ["18 DLP rules live with classifiers tuned to under 2 percent false positives", "42 CA policies with MFA on all privileged roles"],
    bad: ["Three DLP rules still in simulation", "Risk-based sign-in policy report-only for 1,200 users"],
    ugly: ["Finance and legal mailboxes are never evaluated on egress — that is the first link in the chain"],
    priorities: ["Apply the DLP baseline in the next change window", "Promote simulation rules to enforce", "Scope a Copilot app policy in Conditional Access"],
    actions: ["dlp", "ca"]
  },
  kirk: {
    fn: "Security expert — joins on trigger to assess risk boundaries and data protection posture.",
    cares: "Whether Copilot grounding stays inside a secure data boundary.",
    blocking: "The DLP gap feeding data exposure — a clean identity perimeter does not compensate for content reachable by everyone.",
    needs: "Egress evaluation on 100 percent of grounded content before scope widens beyond pilot.",
    good: ["Defender coverage 98.4 percent with zero open high-severity alerts", "Legacy auth blocked, no excluded principals remaining"],
    bad: ["OAuth app grants reviewed quarterly rather than continuously", "Session controls missing on unmanaged browsers"],
    ugly: ["The exposure is in the content estate, not the identity estate — and content is exactly what Copilot reads"],
    priorities: ["Break the risk chain at the DLP link", "Move OAuth grant review to continuous", "Keep pilot scope to Finance and Legal"],
    actions: ["dlp", "riskchain"]
  },
  beth: {
    fn: "Legal and risk advisor — joins on trigger to assess contractual and financial exposure.",
    cares: "Whether a grounded answer can create a reportable event under the MSA.",
    blocking: "Open DLP scope plus 41 overshared sites, which together make exposure contractual rather than theoretical.",
    needs: "The chain broken at DLP, a signed change record, and audit retention covering the whole pilot window.",
    good: ["180-day audit retention means every interaction is reconstructable", "Sign-off path defined with a named approver"],
    bad: ["Change record drafted but unsigned", "Retention labels not yet applied to Copilot chat history"],
    ugly: ["Deploying at 61 percent puts the exposure on our side of the MSA line"],
    priorities: ["No tenant-wide rollout until the chain is broken", "Pilot under audit retention in Finance and Legal only", "Sign the change record once DLP closes"],
    actions: ["riskchain", "copilotready"]
  }
};

export const ICONS = {
  shield: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  folder: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z",
  cloud: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
  device: "M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2",
  meter: "M12 20v-8M6 20v-4M18 20V8M3 20h18",
  spark: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1",
  chain: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.2 19"
};

export const CARDS = {
  dlp: { title: "Finding 01 — DLP scope gap", from: "marcus", icon: "shield", question: "This is the finding that costs you the most. What do you want to see?", blurb: "Two policy sets never evaluate finance and legal egress — the single heaviest finding in the assessment.", control: "button", cta: "Add to roadmap", pts: 6 },
  ca: { title: "Finding 08 — No Copilot session policy", from: "marcus", icon: "lock", question: "Your identity posture is strong — the gap is the Copilot session itself. Where do you want to go?", blurb: "42 policies, MFA everywhere, legacy auth blocked — but nothing governs the Copilot app session itself.", control: "toggle", cta: "Include in Phase 1", pts: 3 },
  sharepoint: { title: "Finding 03 — SharePoint oversharing", from: "jane", icon: "folder", question: "This is the finding most likely to surprise your users. How do you want to look at it?", blurb: "41 of 1,204 sites publish org-wide links — collected across every site collection in the tenant.", control: "slider", min: 0, max: 41, invert: true, unit: " links", pts: 4 },
  onedrive: { title: "Finding 05 — OneDrive exposure", from: "jane", icon: "cloud", question: "Personal stores are the quiet half of this. What next?", blurb: "612 external guests hold standing access, and personal stores are the largest unlabelled pool we found.", control: "toggle", cta: "Include in scope", pts: 2 },
  intune: { title: "Finding 06 — Device baseline drift", from: "priya", icon: "device", question: "Fastest points on the board. Want the detail or the projection?", blurb: "312 endpoints sit outside the compliance baseline — that is where prompts and answers would render.", control: "button", cta: "Add workstream", pts: 9 },
  licensing: { title: "Finding 11 — Seat metering", from: "priya", icon: "meter", question: "This one changes what you pay, not just what you risk. What next?", blurb: "2,140 seats provisioned against 1,876 active — a 12 percent gap between what you buy and what you use.", control: "slider", min: -12, max: 0, unit: "%", pts: 1 },
  copilotready: { title: "Readiness projection", from: "shane", icon: "spark", question: "That is the whole picture. Where do you want to take it?", blurb: "Every finding rolls up here: 61 percent today against a 75 percent deployment bar.", control: "button", cta: "Model projection", pts: 5 },
  riskchain: { title: "Finding sequence — deployment gate", from: "kirk", icon: "chain", question: "Sequence matters here. How do you want to handle it?", blurb: "Unscoped egress, reachable content, no session boundary — read in sequence, not in isolation.", control: "toggle", cta: "Sequence before deploy", pts: 6 }
};
export const BLAST = {
    dlp: { title: "Blast radius — DLP scope gap", core: "2", coreLabel: "unscoped policy sets", rings: [["1,412", "mailboxes never evaluated"], ["8.4M", "messages in scope"], ["$4.1M", "regulated records reachable"]] },
    sharepoint: { title: "Blast radius — oversharing", core: "41", coreLabel: "sites with org-wide links", rings: [["1,876", "users who can already reach them"], ["214K", "files exposed"], ["6", "regulated document types"]] },
    onedrive: { title: "Blast radius — OneDrive exposure", core: "612", coreLabel: "external guests", rings: [["3,180", "shared folders"], ["61K", "unlabelled files"], ["180d", "link lifetime"]] },
    intune: { title: "Blast radius — device drift", core: "312", coreLabel: "non-compliant devices", rings: [["1,104", "sessions per day"], ["27", "sites touched per device"], ["9 pts", "readiness held down"]] },
    ca: { title: "Blast radius — session gap", core: "1", coreLabel: "missing Copilot policy", rings: [["1,876", "users in scope"], ["100%", "of grounded answers"], ["0", "session controls today"]] },
    licensing: { title: "Blast radius — seat drift", core: "264", coreLabel: "idle seats", rings: [["$317K", "annual spend"], ["12%", "forecast gap"], ["264", "grounding identities carried"]] },
    copilotready: { title: "Blast radius — readiness gap", core: "14", coreLabel: "points below threshold", rings: [["1,876", "users waiting"], ["3", "blocking findings"], ["10d", "to close"]] },
    riskchain: { title: "Blast radius — finding sequence", core: "3", coreLabel: "linked findings", rings: [["41", "sites in the chain"], ["1,412", "mailboxes in the chain"], ["MSA §7.4", "contractual trigger"]] }
};

export const SCAN_STEPS = [
  ["Enumerating SharePoint & Teams sites", "1,204 sites · 3,912 document libraries"],
  ["Reading sharing links and permissions", "EEEU · org-wide · anonymous · guest ACLs"],
  ["Cross-checking Purview labels and DLP scope", "184,000 files evaluated"],
  ["Ranking by what Copilot could ground on", "compiling exposure set"]
];
export const FINDINGS = {
  governance: [
    { id: "f-gov-1", t: "41 SharePoint sites publish org-wide or EEEU links", m: "214,806 files reachable by 1,876 accounts", sow: "SharePoint Clean-Up · EEEU" },
    { id: "f-gov-2", t: "612 guest identities hold standing access", m: "no expiry, no re-attestation cycle", sow: "SharePoint Clean-Up · EEEU" },
    { id: "f-gov-3", t: "22% of content carries no sensitivity label", m: "inheritance off at provisioning", sow: "Labeling & Inheritance" },
    { id: "f-gov-4", t: "Teams public channels expose connected sites", m: "23 anonymous links with no expiry", sow: "Teams Public → Private" }
  ],
  licensing: [
    { id: "f-lic-1", t: "1,308 paid seats are unassigned", m: "$847,608 per year", sow: "Licence Right-Sizing" },
    { id: "f-lic-2", t: "25 Copilot licences owned, 2 assigned", m: "400-seat pilot needs 400", sow: "Licence Right-Sizing" },
    { id: "f-lic-3", t: "47 licensed accounts belong to departed staff", m: "$20,304 per year", sow: "Licence Right-Sizing" },
    { id: "f-lic-4", t: "38% of seats assigned directly, not by group", m: "every leaver is a manual step", sow: "Licence Governance" }
  ],
  adoption: [
    { id: "f-ado-1", t: "Only 22% of meetings are transcribed", m: "gates the highest-frequency use case", sow: "Adoption Enablement" },
    { id: "f-ado-2", t: "Zero named champions across 1,876 seats", m: "target is 1 per 50", sow: "Adoption Enablement" },
    { id: "f-ado-3", t: "64% of files are shared in chat, not libraries", m: "weakly governed, weakly indexed", sow: "Adoption Enablement" },
    { id: "f-ado-4", t: "One generic enablement deck for every role", m: "4 role tracks required", sow: "Adoption Enablement" }
  ],
  compliance: [
    { id: "f-cmp-1", t: "40,480 regulated files carry no label", m: "PHI, PII, contractual", sow: "Labeling & Inheritance" },
    { id: "f-cmp-2", t: "3 PHI classifiers stuck in simulation mode", m: "report matches, block nothing", sow: "Labeling & Inheritance" },
    { id: "f-cmp-3", t: "Copilot chat history outside retention scheme", m: "no retention label applied", sow: "Compliance Evidence" },
    { id: "f-cmp-4", t: "MSA §4.1 change record drafted, unsigned", m: "named approver, no signature", sow: "Compliance Evidence" }
  ],
  health: [
    { id: "f-hlt-1", t: "312 endpoints outside the compliance baseline", m: "one device in six", sow: "Device Baseline" },
    { id: "f-hlt-2", t: "47 tenant settings drifted outside change control", m: "in the last 90 days", sow: "Device Baseline" },
    { id: "f-hlt-3", t: "18 standing global admins against a target of 5", m: "no PIM elevation", sow: "Identity Hardening" },
    { id: "f-hlt-4", t: "Zero automated remediation runbooks", m: "every fix is manual", sow: "Device Baseline" }
  ],
  security: [
    { id: "f-sec-1", t: "2 DLP policy sets never evaluate", m: "1,412 mailboxes, 8.4M messages", sow: "DLP Scope Closure" },
    { id: "f-sec-2", t: "No Copilot session policy in conditional access", m: "100% of grounded answers", sow: "Conditional Access" },
    { id: "f-sec-3", t: "Sign-in risk policy still in report-only", m: "41 risky sign-ins unchallenged", sow: "Conditional Access" },
    { id: "f-sec-4", t: "Copilot interactions are out of DLP scope", m: "prompts and responses unevaluated", sow: "DLP Scope Closure" }
  ]
};

export const PILLAR_META = {
  governance: { label: "Governance", color: "#3B82F6" },
  licensing: { label: "Licensing", color: "#14B8A6" },
  adoption: { label: "Adoption", color: "#F97316" },
  compliance: { label: "Compliance", color: "#F3F4F6" },
  health: { label: "Health", color: "#22C55E" },
  security: { label: "Security", color: "#0078D4" }
};

export const USE_CASES = [
  { id: "uc1", who: "jane", title: "Draft the shift handover from Teams threads", detail: "Summarise 41 channels into one handover note, cited back to the source messages.", value: "45 min/day" },
  { id: "uc2", who: "jane", title: "Find the current version of a policy", detail: "One authoritative answer instead of four copies across three sites.", value: "20 min → 9 sec" },
  { id: "uc3", who: "priya", title: "Draft the weekly status and referral letters", detail: "Generate from prior documents and this week's activity, with citations.", value: "3.5 hrs/week" },
  { id: "uc4", who: "priya", title: "Summarise prior research across sites", detail: "Pull the relevant history before writing, without hunting three libraries.", value: "6.4 hrs/week" },
  { id: "uc5", who: "marcus", title: "Deflect repeat tickets with cited answers", detail: "Answer the 40 recurring questions from existing content, with the source attached.", value: "40% of queue" },
  { id: "uc6", who: "marcus", title: "Auto-draft the incident evidence pack", detail: "Assemble timeline, comms and change records into an audit-ready pack.", value: "2 hrs/incident" },
  { id: "uc7", who: "kirk", title: "Prove blast radius before rollout", detail: "Show exactly what a prompt could reach, per site, before anyone is licensed.", value: "pre-flight gate" },
  { id: "uc8", who: "beth", title: "Provable containment of regulated content", detail: "Evidence that PHI cannot surface in a generated answer — not assurance, evidence.", value: "MSA §7.4" }
];


// Shane's facilitated walkthrough — one topic at a time, presented not listed
export const GOV_WALK = [
  { id: "orgwide", n: "01", title: "Org-Wide Sharing", lead: "Let's start where the exposure starts — how sharing is set up across the tenant.",
    head: { v: "41", l: "sites publishing tenant-wide access", tone: "#f87171", note: "threshold for a Copilot go-live is 0" },
    chartTitle: "Sharing links by grant type", chartKind: "bars",
    bars: [
      { l: "Org-wide / EEEU", v: "41 sites", pct: 100, c: "#f87171", flag: "over threshold" },
      { l: "Anonymous “Anyone” links", v: "23 links", pct: 56, c: "#f87171", flag: "no identity" },
      { l: "Guest-scoped", v: "612 guests", pct: 74, c: "#fbbf24", flag: "no expiry" },
      { l: "Specific people (correct)", v: "1,104 sites", pct: 34, c: "#34d399", flag: "healthy" }
    ],
    wrong: [
      "Default link type is set to “People in your organisation” at the tenant level, so every new share starts tenant-wide.",
      "No expiry policy on any link type — 68% of live links are more than a year old.",
      "31 links were created by accounts that have since left the organisation."
    ],
    fix: [
      "Set the org-level default link type to Specific people — one setting, immediate effect on new shares.",
      "Replace the 41 org-wide grants with scoped security groups, staged site by site with recipients notified.",
      "Apply 30-day guest expiry and 90-day internal expiry so this cannot silently re-accumulate."
    ],
    delta: [["Sites publishing tenant-wide", "41", "0"], ["Files reachable tenant-wide", "214,806", "18,240"], ["Governance pillar", "34", "71"]] },

  { id: "locations", n: "02", title: "Overshared Locations", lead: "Now — where that sharing actually landed. This is not evenly spread.",
    head: { v: "3", l: "sites carry 78% of the exposure", tone: "#fbbf24", note: "remediation is smaller than the headline" },
    chartTitle: "Files reachable tenant-wide, by site", chartKind: "bars",
    bars: [
      { l: "Flight Ops – Mission Docs", v: "41,208", pct: 100, c: "#f87171", flag: "EEEU · Edit" },
      { l: "Launch Readiness 2026", v: "22,116", pct: 54, c: "#f87171", flag: "EEEU · Edit" },
      { l: "Clinical Protocols Archive", v: "17,940", pct: 44, c: "#f87171", flag: "EEEU · Read" },
      { l: "Contracts & Legal", v: "8,412", pct: 20, c: "#fbbf24", flag: "EEEU · Read" },
      { l: "HR – People Ops", v: "6,730", pct: 16, c: "#fbbf24", flag: "Org-wide link" },
      { l: "Everything else (36 sites)", v: "118,400", pct: 62, c: "#94a3b8", flag: "mixed" }
    ],
    wrong: [
      "EEEU was applied at site creation from a legacy team template and inherited by every library beneath it.",
      "96 sites have broken permission inheritance, so nobody can answer “who can see this” without reading each library.",
      "None of the top five sites has had an access review since it was provisioned."
    ],
    fix: [
      "Fix the top three sites first — that alone removes 81,264 files from tenant-wide reach.",
      "Restore inheritance wherever the break has no documented reason; replace direct grants with groups.",
      "Add an inheritance check to site provisioning so new sites cannot start life broken."
    ],
    delta: [["Sites over threshold", "41", "0"], ["Top-3 files exposed", "81,264", "0"], ["Broken inheritance points", "128", "12"]] },

  { id: "sensitive", n: "03", title: "Sensitive Data Exposure", lead: "Here's what that content actually is — and this is where it stops being an IT problem.",
    head: { v: "40,480", l: "regulated files with no label", tone: "#f87171", note: "PHI, PII and contractual" },
    chartTitle: "Content by classification · labelled vs not", chartKind: "heat",
    heat: [
      { l: "PHI", v: "38%", sub: "64% labelled", c: "#f87171" },
      { l: "PII", v: "21%", sub: "71% labelled", c: "#fbbf24" },
      { l: "Confidential", v: "27%", sub: "88% labelled", c: "#fbbf24" },
      { l: "General", v: "14%", sub: "0% labelled", c: "#475569" },
      { l: "Clinical libraries", v: "PHI", sub: "64% labelled", c: "#f87171" },
      { l: "Finance libraries", v: "Confidential", sub: "71% labelled", c: "#fbbf24" },
      { l: "Legal libraries", v: "Confidential", sub: "88% labelled", c: "#34d399" },
      { l: "Everything else", v: "Unknown", sub: "0% labelled", c: "#f87171" }
    ],
    wrong: [
      "Three PHI classifiers are still in simulation mode — they report matches and block nothing.",
      "Default labels are not applied at site provisioning, so new content is born unclassified.",
      "Copilot chat history sits outside the retention scheme entirely."
    ],
    fix: [
      "Promote the three classifiers out of simulation after reviewing their match rate on a sample.",
      "Enable default labels at provisioning, then auto-label the 22% backlog starting with clinical and billing.",
      "Turn on label-based encryption for Confidential so a grounded answer inherits its source classification."
    ],
    delta: [["PHI containers labelled", "78%", "99%"], ["Regulated files unlabelled", "40,480", "1,120"], ["Provable containment", "no", "yes"]] },

  { id: "external", n: "04", title: "External Access", lead: "Then the part that reaches outside your MSA boundary altogether.",
    head: { v: "612", l: "guest identities with standing access", tone: "#fbbf24", note: "last access review: never" },
    chartTitle: "Guest access by age of grant", chartKind: "bars",
    bars: [
      { l: "Older than 2 years", v: "242 guests", pct: 100, c: "#f87171", flag: "legacy projects" },
      { l: "1–2 years", v: "184 guests", pct: 76, c: "#fbbf24", flag: "unreviewed" },
      { l: "6–12 months", v: "125 guests", pct: 52, c: "#fbbf24", flag: "unreviewed" },
      { l: "Under 6 months", v: "61 guests", pct: 25, c: "#34d399", flag: "current vendor" }
    ],
    wrong: [
      "48 external domains hold access; the largest single vendor account carries 61 identities.",
      "23 anonymous links have no identity behind them at all — no audit trail, no revocation path.",
      "31 guests were invited by employees who have since left."
    ],
    fix: [
      "Drop the tenant sharing ceiling to authenticated guests only and disable Anyone links.",
      "Enable 90-day guest expiry with owner attestation — 268 clear on the first cycle with no decision required.",
      "Route the external-sharing report to each site owner monthly instead of nobody."
    ],
    delta: [["Guest identities", "612", "344"], ["Anonymous links", "23", "0"], ["External domains", "48", "19"]] },

  { id: "copilot", n: "05", title: "Copilot Exposure", who: "shane", gate: true, lead: "And this is what all of it adds up to the moment Copilot is switched on. This is the go/no-go slide.",
    head: { v: "214,806", l: "files a normal prompt can cite", tone: "#f87171", note: "no elevated rights required" },
    chartTitle: "What a first-line employee's prompt reaches today", chartKind: "heat",
    heat: [
      { l: "Payroll & compensation", v: "reachable", sub: "unlabelled, org-wide link", c: "#f87171" },
      { l: "Executed contracts", v: "reachable", sub: "EEEU · Read", c: "#f87171" },
      { l: "Clinical protocols", v: "reachable", sub: "EEEU · Read, PHI", c: "#f87171" },
      { l: "Mission documentation", v: "reachable", sub: "EEEU · Edit", c: "#f87171" },
      { l: "Denials & revenue cycle", v: "reachable", sub: "org-wide link", c: "#fbbf24" },
      { l: "Board material", v: "protected", sub: "scoped correctly", c: "#34d399" }
    ],
    wrong: [
      "Copilot does not widen access — it makes what is already open trivially findable, with a citation.",
      "22% of what it would ground on carries no label, so no answer inherits a classification warning.",
      "Under MSA §7.4 a PHI disclosure in a generated answer is reportable, not internal."
    ],
    fix: [
      "Close org-wide sharing and label the regulated backlog before the semantic index builds.",
      "Pilot into Finance and Legal only — both are inside a labelled boundary today.",
      "Hold tenant-wide rollout until the governance pillar clears 75."
    ],
    delta: [["Copilot readiness", "34%", "64%"], ["Files citable tenant-wide", "214,806", "18,240"], ["Regulated files citable", "40,480", "1,120"]] }
];


// analyst framing — the same signals, grouped the way a remediation team reads them
export const GOV_WALK_ANALYST = [
  { id: "sharing", n: "A1", title: "Sharing & Link Exposure", who: "kirk", lead: "Analyst view — same estate, grouped the way a remediation team works it. First: every sharing grant, by type.",
    head: { v: "64", l: "standing grants across three workloads", tone: "#f87171", note: "41 org-wide, 23 anonymous" },
    chartTitle: "Grants by type and workload", chartKind: "bars",
    bars: [
      { l: "Org-wide / EEEU · SharePoint", v: "28", pct: 100, c: "#f87171", flag: "site level" },
      { l: "Org-wide / EEEU · Teams", v: "9", pct: 42, c: "#f87171", flag: "channel level" },
      { l: "Org-wide / EEEU · OneDrive", v: "4", pct: 22, c: "#fbbf24", flag: "personal" },
      { l: "Anonymous Anyone links", v: "23", pct: 68, c: "#f87171", flag: "no identity" }
    ],
    wrong: [
      "The tenant default link type is org-wide, so every new share starts at the widest setting available.",
      "EEEU is applied at site level and inherited by every library beneath it — remediation is per site, not per file.",
      "23 anonymous links have no recipient on record; the creator is the only lead you have."
    ],
    fix: [
      "Change the tenant default link type first — it stops new grants without touching existing ones.",
      "Work SharePoint's 28 sites before Teams and OneDrive; they carry the file volume.",
      "Inventory and contact each anonymous link creator before disabling Anyone links tenant-wide."
    ],
    delta: [["Standing grants", "64", "0"], ["Files reachable", "214,806", "18,240"], ["Link expiry", "none", "30 days"]] },

  { id: "channels", n: "A2", title: "Site & Channel Oversharing", who: "jane", lead: "Second: where those grants landed — which sites and channels are actually publishing.",
    head: { v: "94", l: "unmanaged or orphaned channels", tone: "#fbbf24", note: "no owner, no review, no closure" },
    chartTitle: "Oversharing by container", chartKind: "bars",
    bars: [
      { l: "Overshared SharePoint sites", v: "41", pct: 100, c: "#f87171", flag: "of 1,204" },
      { l: "Public Teams channels", v: "17", pct: 41, c: "#f87171", flag: "site exposed" },
      { l: "Unmanaged / orphaned channels", v: "94", pct: 88, c: "#fbbf24", flag: "no owner" },
      { l: "Sites with a named owner", v: "40", pct: 12, c: "#f87171", flag: "3% coverage" }
    ],
    wrong: [
      "Only 40 of 1,204 sites have an owner who could approve, review or revoke anything.",
      "94 channels are orphaned — the team that created them has moved on and nobody closed them.",
      "Site lifecycle reviews are 40 days overdue and run by hand."
    ],
    fix: [
      "Assign an owner to every site before any access review runs; without owners the review has no reviewer.",
      "Convert the 17 public channels to private — members keep access, the tenant loses it.",
      "Archive orphaned channels rather than deleting them, so the content survives the cleanup."
    ],
    delta: [["Overshared sites", "41", "0"], ["Public channels", "17", "2"], ["Sites with an owner", "40", "1,204"]] },

  { id: "labeling", n: "A3", title: "Sensitivity & Labeling Gaps", who: "beth", lead: "Third: classification. This is the one that decides whether an incident is internal or reportable.",
    head: { v: "22%", l: "of content carries no label", tone: "#f87171", note: "40,480 regulated files among it" },
    chartTitle: "Labelling coverage by library class", chartKind: "heat",
    heat: [
      { l: "Clinical libraries", v: "64%", sub: "PHI · 3 classifiers in simulation", c: "#f87171" },
      { l: "Finance libraries", v: "71%", sub: "confidential · partial", c: "#fbbf24" },
      { l: "Legal libraries", v: "88%", sub: "confidential · near complete", c: "#34d399" },
      { l: "Everything else", v: "0%", sub: "unclassified at provisioning", c: "#f87171" },
      { l: "Libraries drifting from policy", v: "19", sub: "label removed or overridden", c: "#fbbf24" },
      { l: "High-risk categories exposed", v: "3", sub: "PII · PHI · financial", c: "#f87171" }
    ],
    wrong: [
      "Three PHI classifiers sit in simulation — they report matches and block nothing.",
      "Default labels are not applied at provisioning, so new content is born unclassified.",
      "19 libraries have drifted off policy through manual label overrides."
    ],
    fix: [
      "Sample 500 classifier matches and measure the false-positive rate before promoting anything.",
      "Turn on default labels at provisioning so the backlog stops growing while you clear it.",
      "Auto-label clinical and billing first — that is where the reportable exposure lives."
    ],
    delta: [["Unlabelled content", "22%", "1%"], ["Regulated files unlabelled", "40,480", "1,120"], ["Classifiers enforcing", "0 of 3", "3 of 3"]] },

  { id: "identity", n: "A4", title: "Identity & Access Risks", who: "kirk", lead: "Fourth: who holds access that nobody is reviewing.",
    head: { v: "612", l: "guest identities with standing access", tone: "#fbbf24", note: "last access review: never" },
    chartTitle: "External identity exposure", chartKind: "bars",
    bars: [
      { l: "External guest accounts", v: "612", pct: 100, c: "#fbbf24", flag: "no expiry" },
      { l: "Unmanaged guest identities", v: "312", pct: 62, c: "#f87171", flag: "no owner" },
      { l: "Federated external domains", v: "48", pct: 44, c: "#fbbf24", flag: "never pruned" },
      { l: "Conditional access gaps", v: "CA01 disabled", pct: 80, c: "#f87171", flag: "Copilot ungoverned" }
    ],
    wrong: [
      "There is no expiry and no attestation cycle on any guest identity in the tenant.",
      "312 guests have no owner, so there is nobody who can meaningfully confirm they are still needed.",
      "No conditional access policy targets the Copilot app — the one path that reads all your content."
    ],
    fix: [
      "Enable a quarterly access review with owner attestation; 268 clear on the first cycle unrenewed.",
      "Prune the domain allow-list to the vendors with a current contract.",
      "Create CA01 in report-only, read two weeks of sign-in logs, then enforce."
    ],
    delta: [["Guest identities", "612", "344"], ["Unmanaged guests", "312", "44"], ["Copilot session policy", "off", "enforced"]] },

  { id: "hygiene", n: "A5", title: "Permission Hygiene", who: "kirk", lead: "Fifth: the structural condition underneath all of it.",
    head: { v: "128", l: "broken inheritance points", tone: "#f87171", note: "nobody can answer “who can see this”" },
    chartTitle: "Permission structure by condition", chartKind: "bars",
    bars: [
      { l: "Broken inheritance", v: "128 libraries", pct: 100, c: "#f87171", flag: "unique ACLs" },
      { l: "Direct user grants (not groups)", v: "1,940", pct: 82, c: "#f87171", flag: "unmaintainable" },
      { l: "Permission sprawl groups", v: "37", pct: 58, c: "#fbbf24", flag: "overlapping" },
      { l: "Nested permission depth", v: "6 levels", pct: 60, c: "#fbbf24", flag: "target 2" }
    ],
    wrong: [
      "1,940 grants are made to individuals rather than groups, so every joiner and leaver is a manual step.",
      "Permission depth reaches six levels — resolving an effective permission means reading the whole chain.",
      "37 overlapping groups mean the same person is often granted access three different ways."
    ],
    fix: [
      "Restore inheritance only where the parent is equal to or narrower than the child — never in bulk.",
      "Replace direct grants with security groups so future changes have one place to happen.",
      "Add an inheritance check to provisioning so new sites cannot start life broken."
    ],
    delta: [["Broken inheritance points", "128", "12"], ["Direct user grants", "1,940", "210"], ["Permission depth", "6 levels", "2 levels"]] },

  { id: "drift", n: "A6", title: "Governance Drift", who: "shane", lead: "Sixth: drift — the gap between what your policy says and what the tenant is doing.",
    head: { v: "47", l: "settings changed outside change control", tone: "#fbbf24", note: "in the last 90 days" },
    chartTitle: "Where the estate has moved off baseline", chartKind: "heat",
    heat: [
      { l: "Sharing defaults", v: "drifted", sub: "tenant default is org-wide", c: "#f87171" },
      { l: "Label inheritance", v: "off", sub: "not applied at provisioning", c: "#f87171" },
      { l: "Guest expiry", v: "not set", sub: "612 standing identities", c: "#f87171" },
      { l: "Library configuration", v: "47 settings", sub: "outside change control", c: "#fbbf24" },
      { l: "Policy compliance", v: "19 libraries", sub: "drifted off policy", c: "#fbbf24" },
      { l: "Conditional access", v: "at baseline", sub: "no drift detected", c: "#34d399" }
    ],
    wrong: [
      "Drift is detected by hand, quarterly — in practice that means it is detected when something breaks.",
      "There is no alert on a new org-wide link, a new anonymous link, or a rising guest count.",
      "Baseline documentation exists but is never compared against live state."
    ],
    fix: [
      "Schedule the Sharing and Data access governance reports monthly.",
      "Alert on the three events that matter: new org-wide link, new anonymous link, guest count +10.",
      "Track reachable-file count month over month — it is the metric that proves governance is holding."
    ],
    delta: [["Settings off baseline", "47", "0"], ["Drift detection", "quarterly", "continuous"], ["Mean time to notice", "~90 days", "24 hours"]] },

  { id: "blast", n: "A7", title: "Copilot Blast Radius", who: "kirk", lead: "Last: what all of it adds up to for a single prompt from a single account.",
    head: { v: "1,876", l: "accounts with identical reach", tone: "#f87171", note: "no elevated rights required" },
    chartTitle: "Reach of one first-line account", chartKind: "bars",
    bars: [
      { l: "Groundable docs with no owner", v: "11,400", pct: 100, c: "#f87171", flag: "never reviewed" },
      { l: "Overshared or unlabelled visible", v: "40,480", pct: 88, c: "#f87171", flag: "regulated" },
      { l: "Files retrievable in total", v: "214,806", pct: 96, c: "#f87171", flag: "citable" },
      { l: "Readiness score impact", v: "−17 pts", pct: 62, c: "#fbbf24", flag: "governance alone" }
    ],
    wrong: [
      "Blast radius is identical for a new hire on day one and a director of twenty years.",
      "There is no way today to answer “what could this person's Copilot see” without running the query we ran.",
      "The semantic index bakes this reach in at build, so remediation after enablement is materially harder."
    ],
    fix: [
      "Measure blast radius per persona before any licence is assigned, and re-measure after each wave.",
      "Hold the semantic index build until org-wide sharing is closed.",
      "Pilot into Finance and Legal, whose content boundary is already labelled."
    ],
    delta: [["Files one account can cite", "214,806", "18,240"], ["Regulated files in reach", "40,480", "1,120"], ["Readiness impact", "−17 pts", "−2 pts"]] }
];

// engine view — the machinery underneath every number in this dialog
export const GOV_WALK_ENGINE = [
  { id: "freshness", n: "E1", title: "Data Freshness", who: "marcus", lead: "Second: how current this is. Nothing on these cards is older than this morning.",
    head: { v: "04:12", l: "this morning's scan completed", tone: "#34d399", note: "01 Aug 2026, tenant local" },
    chartTitle: "Latency by source", chartKind: "heat",
    heat: [
      { l: "Graph — sites & permissions", v: "288 ms", sub: "1,204 sites enumerated", c: "#34d399" },
      { l: "SharePoint admin API", v: "412 ms", sub: "sharing links + inheritance", c: "#34d399" },
      { l: "Purview — labels & DLP", v: "405 ms", sub: "184,000 files evaluated", c: "#fbbf24" },
      { l: "Entra — guests & identity", v: "231 ms", sub: "612 guest identities", c: "#34d399" },
      { l: "Usage reports", v: "24 h lag", sub: "Microsoft-side delay", c: "#fbbf24" },
      { l: "Copilot readiness", v: "264 ms", sub: "derived, not reported", c: "#60a5fa" }
    ],
    wrong: [
      "Usage reporting carries a 24-hour lag on Microsoft's side — that is the only stale number in the set.",
      "Purview classification runs on a crawl, so newly created content can be up to six hours behind.",
      "Nothing here is cached from a prior engagement; every figure was pulled today."
    ],
    fix: [
      "Treat usage figures as day-old and everything else as live when you make decisions in this room.",
      "Re-run the scan after each change window so the evidence pack matches the change record.",
      "Keep the raw JSON — it is exportable and your auditors will ask for it."
    ],
    delta: [["Oldest figure on screen", "24 h", "24 h"], ["Everything else", "this morning", "continuous"], ["Reproducible by your team", "yes", "yes"]] },

  { id: "thresholds", n: "E2", title: "Scoring & Thresholds", who: "shane", lead: "Last: how the score is calculated, so nobody has to trust a number they cannot check.",
    head: { v: "34", l: "governance pillar score today", tone: "#f87171", note: "gate for Copilot is 75" },
    chartTitle: "What moves the governance pillar", chartKind: "bars",
    bars: [
      { l: "Org-wide sharing closed", v: "+30 pts", pct: 100, c: "#34d399", flag: "largest" },
      { l: "Regulated backlog labelled", v: "+14 pts", pct: 47, c: "#34d399", flag: "parallel" },
      { l: "Guest expiry enforced", v: "+7 pts", pct: 24, c: "#6ee7b7", flag: "one week" },
      { l: "Inheritance restored", v: "+4 pts", pct: 14, c: "#6ee7b7", flag: "largest effort" }
    ],
    wrong: [
      "The score is not proprietary — it is a weighted count of reachable regulated content against total content.",
      "A pillar can read healthy while a single site carries most of the exposure, which is why we show sites as well as scores.",
      "The 75 gate is our recommendation, not a Microsoft requirement — you can deploy below it, and own the consequence."
    ],
    fix: [
      "Use the pillar score to sequence work, not to declare victory — the finding list is the real deliverable.",
      "Re-score after each wave and publish the movement to the steering group.",
      "Hold tenant-wide rollout at 75 and pilot below it only inside a labelled boundary."
    ],
    delta: [["Governance pillar", "34", "89"], ["Points from sharing alone", "0", "+30"], ["Gate cleared", "no", "yes"]] }
];

export const GOV_WALK_SETS = { a: GOV_WALK_ANALYST, e: GOV_WALK_ENGINE };
export const walkPillarRef = { current: "governance" };
export function walkSet(key) {
  const s = String(key || "c0");
  const P = walkPillarRef.current;
  const base = P === "licensing" ? LIC_WALK : P === "adoption" ? ADO_WALK : P === "compliance" ? CMP_WALK : P === "health" ? HLT_WALK : P === "security" ? SEC_WALK : P === "copilot" ? CPL_WALK : P === "sow" ? SOW_WALK : P === "docs" ? DOCS_WALK : P === "remediation" ? REM_WALK : P === "timeline" ? TL_WALK : GOV_WALK;
  const sets = P === "licensing" ? { a: LIC_WALK_ANALYST, e: LIC_WALK_ANALYST }
    : P === "adoption" ? { a: ADO_WALK_ANALYST, e: ADO_WALK_ANALYST }
    : P === "compliance" ? { a: CMP_WALK_ANALYST, e: CMP_WALK_ANALYST }
    : P === "health" ? { a: HLT_WALK_ANALYST, e: HLT_WALK_ANALYST }
    : P === "security" ? { a: SEC_WALK_ANALYST, e: SEC_WALK_ANALYST }
    : P === "copilot" ? { a: CPL_WALK_ANALYST, e: CPL_WALK_ANALYST }
    : P === "sow" ? { a: SOW_WALK, e: SOW_WALK }
    : P === "docs" ? { a: DOCS_WALK, e: DOCS_WALK }
    : P === "remediation" ? { a: REM_WALK, e: REM_WALK }
    : P === "timeline" ? { a: TL_WALK, e: TL_WALK }
    : GOV_WALK_SETS;
  if (s[0] === "c") return base;
  return sets[s[0]] || base;
}
export function walkAt(key) { const s = String(key || "c0"); return walkSet(s)[Number(s.slice(1))] || null; }


// Shane's quick wins — safe, reversible things the customer can do themselves today
export const QUICK_WINS = {
  c0: {
    id: "c0", kind: "ui", title: "Stop new org-wide links at the source",
    offer: "Before we go further — this next one you can do yourself this afternoon, and it is the highest-value five minutes in the whole assessment. It stops the bleeding while we plan the cleanup. Want me to walk you through it?",
    why: "Changing the tenant default link type does not touch a single existing link. It only changes what the Share dialog pre-selects for new shares — which is where 41 sites came from in the first place.",
    minutes: "5 minutes", risk: "Reversible · no effect on existing access", owner: "SharePoint administrator",
    steps: [
      { t: "Open the SharePoint admin center and sign in with an account holding the SharePoint Administrator role.", link: { l: "admin.microsoft.com/sharepoint", u: "https://admin.microsoft.com/sharepoint" } },
      { t: "In the left navigation go to Policies → Sharing." },
      { t: "Scroll to “File and folder links”. The current setting reads:", copy: "People in your organization" },
      { t: "Change it to:", copy: "Specific people (only the people the user specifies)" },
      { t: "Under “Choose expiration and permissions options for Anyone links”, set link expiry to:", copy: "30 days" },
      { t: "Click Save. New shares now default to scoped access; nothing existing changes." }
    ],
    sideEffects: [
      "Users will notice the Share dialog now pre-selects Specific people. They can still choose a wider option if they have permission to.",
      "No existing link stops working. Nothing a colleague can open today becomes unavailable.",
      "If you want to force the narrower option rather than default to it, that is a separate setting and we would sequence it after the cleanup."
    ],
    verify: "Re-open Policies → Sharing after saving; the default link type should read Specific people.",
    undo: "Set the default link type back to People in your organization. The change is a single dropdown either way."
  },
  c3: {
    id: "c3", kind: "ui", title: "Turn on guest expiry and attestation",
    offer: "Same deal with this one — you do not need us for it. Turning on guest expiry clears 268 of the 612 standing identities on the first cycle, purely because nobody renews them. Want the steps?",
    why: "Guest expiry does not remove anybody today. It starts a clock and asks the site owner to confirm the guest is still needed. Guests nobody confirms simply lapse.",
    minutes: "10 minutes", risk: "Reversible · nothing revoked immediately", owner: "Identity or access governance",
    steps: [
      { t: "Open the Microsoft Entra admin center with the Global Reader plus Groups Administrator roles at minimum.", link: { l: "entra.microsoft.com", u: "https://entra.microsoft.com" } },
      { t: "Go to Identity → External Identities → External collaboration settings." },
      { t: "Under “Guest user access”, confirm the restriction level is set to:", copy: "Guest users have limited access to properties and memberships of directory objects" },
      { t: "Then go to Identity Governance → Access reviews → New access review, scoped to Guest users." },
      { t: "Set the review recurrence and duration to:", copy: "Quarterly, 14 days, reviewer = group owner" },
      { t: "Under settings, enable “If reviewers don't respond” → Remove access. Save the review." }
    ],
    sideEffects: [
      "Nothing happens on day one. The first removals occur only after a reviewer ignores a 14-day request.",
      "Site owners will receive a review email. If a site has no owner assigned, the review falls back to the administrator — worth assigning owners first.",
      "Guests who lapse can be re-invited in seconds; their content and permissions are re-granted on the new invite."
    ],
    verify: "The access review appears under Identity Governance → Access reviews with a next-run date.",
    undo: "Delete the access review, or change the “no response” action from Remove access to Take recommendations."
  },
  c1: {
    id: "c1", kind: "ps", title: "Inventory every org-wide link yourself",
    offer: "This one I would rather you run than take my word for. It is read-only — it changes nothing, it just prints the same list I am showing you. Want the script?",
    why: "Running it yourself means the numbers on these cards are not something you have to trust. You get the same output, from your own tenant, under your own credentials.",
    minutes: "15 minutes including module install", risk: "Read-only · no writes of any kind", owner: "SharePoint administrator",
    perms: ["SharePoint Administrator role (or Global Reader for the read-only portions)", "PowerShell 7.2 or later", "Microsoft.Online.SharePoint.PowerShell module"],
    prereq: "Install-Module -Name Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser",
    script: "# Org-wide and anonymous sharing inventory — READ ONLY\n# Northline Health · replace the tenant name below\n$tenant = \"contoso\"\nConnect-SPOService -Url \"https://$tenant-admin.sharepoint.com\"\n\n$results = @()\nforeach ($site in Get-SPOSite -Limit All -IncludePersonalSite:$false) {\n    try {\n        $links = Get-SPOSiteSharingLink -Site $site.Url -ErrorAction Stop\n    } catch { continue }\n\n    foreach ($l in $links) {\n        if ($l.LinkKind -in @(\"OrganizationEdit\",\"OrganizationView\",\"AnonymousEdit\",\"AnonymousView\")) {\n            $results += [pscustomobject]@{\n                Site        = $site.Title\n                Url         = $site.Url\n                LinkKind    = $l.LinkKind\n                CreatedBy   = $l.CreatedBy\n                Created     = $l.Created\n                Expiration  = $l.Expiration\n                FileCount   = $site.StorageUsageCurrent\n            }\n        }\n    }\n}\n\n$results | Sort-Object FileCount -Descending |\n    Export-Csv -Path \".\\\\orgwide-links.csv\" -NoTypeInformation\n\nWrite-Host \"$($results.Count) org-wide or anonymous links found\" -ForegroundColor Yellow",
    sideEffects: [
      "Nothing is written. There is no Set- or Remove- cmdlet anywhere in this script.",
      "On 1,204 sites it takes roughly eight to twelve minutes to complete.",
      "Get-SPOSiteSharingLink is throttled on large tenants — the try/catch skips any site that throttles rather than failing the run."
    ],
    verify: "orgwide-links.csv lands in your working directory. The row count should match the 41 sites on this card, give or take links created since this morning.",
    undo: "Nothing to undo — delete the CSV."
  },
  c4: {
    id: "c4", kind: "ps", title: "Measure a real person's blast radius",
    offer: "One more you can run yourself, and honestly it is the one that will land hardest with your leadership. It shows exactly what one named employee's Copilot could reach. Want it?",
    why: "Abstract exposure numbers are easy to discount. The same number attached to a real person's account, run by your own admin, is not.",
    minutes: "10 minutes", risk: "Read-only · runs as the app, not as the user", owner: "Global Reader + SharePoint Administrator",
    perms: ["Microsoft.Graph PowerShell SDK", "Sites.Read.All and User.Read.All (delegated or application)", "Admin consent for the above scopes"],
    prereq: "Install-Module Microsoft.Graph -Scope CurrentUser",
    script: "# Copilot blast radius for a single user — READ ONLY\n$upn = \"aaron.vance@contoso.com\"\n\nConnect-MgGraph -Scopes \"Sites.Read.All\",\"User.Read.All\",\"Files.Read.All\"\n\n$user  = Get-MgUser -UserId $upn\n$sites = Get-MgSite -Search \"*\" -All\n\n$reach = foreach ($s in $sites) {\n    $perms = Get-MgSitePermission -SiteId $s.Id -ErrorAction SilentlyContinue\n    $wide  = $perms | Where-Object {\n        $_.GrantedToIdentitiesV2.SiteGroup.DisplayName -match \"Everyone except external\" -or\n        $_.Roles -contains \"read\"\n    }\n    if ($wide) {\n        [pscustomobject]@{\n            Site      = $s.DisplayName\n            WebUrl    = $s.WebUrl\n            Grant     = ($wide.Roles -join \",\")\n            Reachable = $true\n        }\n    }\n}\n\n$reach | Export-Csv \".\\\\blast-radius-$($user.MailNickname).csv\" -NoTypeInformation\nWrite-Host \"$($reach.Count) sites reachable by $upn\" -ForegroundColor Red",
    sideEffects: [
      "It reads permissions, never file contents. Nothing in the output contains document text.",
      "Run it against a volunteer, not quietly against an executive — the optics of the second one are bad.",
      "Application permissions give a complete picture; delegated permissions give you what your own admin account can see, which is wider than a normal user."
    ],
    verify: "The CSV row count is that person's blast radius. Compare it against the 41 on this card.",
    undo: "Nothing to undo — Disconnect-MgGraph and delete the CSV."
  },
  a1: {
    id: "a1", kind: "ui", title: "Switch drift detection on",
    offer: "This is the one that keeps the work from unravelling after we finish. It is two settings and a distribution list, and you can do it today. Want the steps?",
    why: "Every tenant we clean up drifts back within a year unless somebody is told when it moves. These reports are free, built in, and nobody turns them on.",
    minutes: "10 minutes", risk: "Reporting only · no enforcement", owner: "SharePoint administrator",
    steps: [
      { t: "Open the SharePoint admin center.", link: { l: "admin.microsoft.com/sharepoint", u: "https://admin.microsoft.com/sharepoint" } },
      { t: "Go to Reports → Data access governance." },
      { t: "Run the “Sharing links” report and the “Sites shared with Everyone except external users” report." },
      { t: "In Microsoft Purview, create an activity alert on the sharing operations:", link: { l: "purview.microsoft.com", u: "https://purview.microsoft.com" } },
      { t: "Set the alert's activity filter to:", copy: "SharingSet, AnonymousLinkCreated, AddedToSecureLink" },
      { t: "Route the alert to a monitored distribution list — not an individual, and not a shared mailbox nobody opens." }
    ],
    sideEffects: [
      "These reports are generated on demand and do not affect performance for users.",
      "Purview alerts can be noisy for the first week while legitimate sharing gets flagged; tune the scope rather than switching it off.",
      "The reports show configuration, not content, so they can be shared with a governance group without a data-access review."
    ],
    verify: "You receive an alert the next time anyone creates an org-wide or anonymous link.",
    undo: "Delete the Purview alert policy. The reports can simply be left unrun."
  }
};


// self-service fix profiles — what it takes, what it risks, and what breaks if it is done wrong
export const PILLAR_GLYPH = {
  "Governance": "M12 2l8 5H4l8-5zM6 11v7M10 11v7M14 11v7M18 11v7M4 21h16",
  "Security": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  "Compliance": "M12 3v18M5 7l7-4 7 4M4 21h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l3 7a3 3 0 0 1-6 0z",
  "Licensing": "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  "Adoption": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87",
  "Health": "M22 12h-4l-3 9L9 3l-3 9H2",
  "Copilot": "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"
};

export const FIX_PROFILES = {
  orgwide: {
    detail: {"json":{"before":"{\n  \"sharingCapability\": \"ExternalUserAndGuestSharing\",\n  \"defaultSharingLinkType\": \"Internal\",\n  \"defaultLinkPermission\": \"Edit\",\n  \"requireAnonymousLinksExpireInDays\": -1,\n  \"sitesWithOrgWideLinks\": 41,\n  \"filesReachableTenantWide\": 214806\n}","after":"{\n  \"sharingCapability\": \"ExternalUserSharingOnly\",\n  \"defaultSharingLinkType\": \"Direct\",\n  \"defaultLinkPermission\": \"View\",\n  \"requireAnonymousLinksExpireInDays\": 30,\n  \"sitesWithOrgWideLinks\": 0,\n  \"filesReachableTenantWide\": 18240\n}"},"score":["Governance pillar","34","71"],"score2":["Copilot readiness","34%","64%"],"pos":["196,566 files leave Copilot's general grounding surface","New shares default to scoped access — the problem stops growing the day you save","Link expiry means this cannot silently re-accumulate"],"neg":["Users see the Share dialog behave differently and some will raise tickets","Any workflow that relied on an org-wide link needs a group created first","Staging 41 sites is two weeks of steady work, not an afternoon"],"undo":{"can":"Partly","text":"The tenant-level settings revert with one dropdown each and take effect immediately. Individual site grants that you removed must be re-created by hand — which is why the change log matters. Nothing is deleted, so no content is ever lost."},"roles":[["SharePoint Administrator","required — tenant sharing settings and per-site grants"],["Groups Administrator","required — to create the replacement security groups"],["Global Administrator","not required"],["Global Reader","sufficient for the reporting stage only"]]},
    uiTier: "intermediate", psTier: "expert",
    tiers: [
      { l: "Beginner", c: "#34d399", t: "Set the tenant default link type and turn on link expiry. Two dropdowns in the SharePoint admin center. Nothing existing changes and it stops the problem growing.", who: "Any SharePoint administrator" },
      { l: "Intermediate", c: "#fbbf24", t: "Create the replacement security groups and stage the swap site by site with recipient notification. Needs someone who knows the business well enough to say who the real audience is.", who: "SharePoint admin + site owners" },
      { l: "Expert", c: "#f87171", t: "Unpick the 96 sites with broken inheritance underneath the org-wide grants. Parent and child permissions must be compared per library — get it backwards and you widen access.", who: "Platform engineer · do not delegate" }
    ],
    rows: [["Sites publishing org-wide", "41", "0"], ["Files reachable tenant-wide", "214,806", "18,240"], ["Link expiry", "none", "30 days"], ["Sites with an owner", "40", "1,204"]],
    subject: "org-wide and EEEU sharing links",
    what: "Replace each “Everyone in the organization” / EEEU grant with a security group scoped to the people who actually use the site, then set a default link type and expiry so it cannot re-accumulate.",
    effort: "2 weeks · 41 sites · staged",
    risk: "Medium — access changes are visible to users",
    blast: [
      "Remove a grant before creating the replacement group and every user of that site loses access instantly — for the top three sites that is 81,264 files and roughly 400 people.",
      "Apply it tenant-wide in one action and you will break cross-team workflows that nobody documented, generating a help-desk spike the same afternoon.",
      "Change the default link type without telling anyone and users will assume sharing is broken and route around it with email attachments — which is worse."
    ],
    guard: "Stage it site by site, notify recipients 48 hours ahead, and keep the old grant in place for one working week alongside the new group before removing it.",
    ui: {
      title: "Close org-wide sharing — admin centre",
      steps: [
        { t: "Open the SharePoint admin center with the SharePoint Administrator role.", link: { l: "admin.microsoft.com/sharepoint", u: "https://admin.microsoft.com/sharepoint" } },
        { t: "Go to Policies → Sharing, and set the default file and folder link to:", copy: "Specific people (only the people the user specifies)" },
        { t: "Set link expiry for Anyone links to:", copy: "30 days" },
        { t: "Go to Sites → Active sites and sort by Storage used to find the top three offenders first." },
        { t: "For each site: Membership → add a security group with the real audience, then Sharing → remove the org-wide grant one week later." },
        { t: "Record each change in your change log with the site URL, the group created and the date the old grant was removed." }
      ],
      verify: "Re-run Reports → Data access governance → “Sites shared with Everyone except external users”. The count should fall as each site is completed.",
      undo: "Re-add the EEEU grant on the affected site. Access is restored immediately; nothing is deleted by this process."
    },
    ps: {
      title: "Close org-wide sharing — PowerShell",
      perms: ["SharePoint Administrator", "PowerShell 7.2+", "Microsoft.Online.SharePoint.PowerShell"],
      prereq: "Install-Module Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser",
      script: "# Stage 1 — REPORT ONLY. Run this first and read the CSV before stage 2.\n$tenant = \"contoso\"\nConnect-SPOService -Url \"https://$tenant-admin.sharepoint.com\"\n\n$targets = foreach ($s in Get-SPOSite -Limit All) {\n    $links = Get-SPOSiteSharingLink -Site $s.Url -ErrorAction SilentlyContinue\n    $wide  = $links | Where-Object { $_.LinkKind -like \"Organization*\" -or $_.LinkKind -like \"Anonymous*\" }\n    if ($wide) {\n        [pscustomobject]@{ Url = $s.Url; Title = $s.Title; Links = $wide.Count; Owner = $s.Owner }\n    }\n}\n$targets | Export-Csv .\\\\orgwide-targets.csv -NoTypeInformation\nWrite-Host \"$($targets.Count) sites to remediate\" -ForegroundColor Yellow\n\n# Stage 2 — set the tenant default so no NEW org-wide links are created.\n# This does not touch existing links.\nSet-SPOTenant -DefaultSharingLinkType Direct -DefaultLinkPermission View\nSet-SPOTenant -RequireAnonymousLinksExpireInDays 30\n\n# Stage 3 — per site, ONE AT A TIME, after the replacement group exists.\n# Uncomment and run for a single URL only. Never loop this unattended.\n# $site = \"https://contoso.sharepoint.com/sites/flight-ops-mission-docs\"\n# Set-SPOSite -Identity $site -SharingCapability ExternalUserSharingOnly\n# Remove-SPOSiteSharingLink -Site $site -Confirm:$true",
      verify: "orgwide-targets.csv lists the sites to work through; re-run stage 1 after each site to confirm the count drops.",
      undo: "Set-SPOTenant -DefaultSharingLinkType AnonymousAccess restores the previous default. Per-site grants must be re-added manually."
    }
  },
  anonymous: {
    detail: {"json":{"before":"{\n  \"anonymousLinksLive\": 23,\n  \"identityRecorded\": false,\n  \"auditTrail\": \"none\",\n  \"oldestLinkAgeDays\": 1095,\n  \"linkExpiryDays\": -1\n}","after":"{\n  \"anonymousLinksLive\": 0,\n  \"identityRecorded\": true,\n  \"auditTrail\": \"per-access\",\n  \"oldestLinkAgeDays\": 90,\n  \"linkExpiryDays\": 90\n}"},"score":["Governance pillar","34","48"],"score2":["External exposure","92%","51%"],"pos":["Every external access becomes attributable to a named person","Links expire, so exposure stops being permanent","You gain an audit trail you can hand to a regulator"],"neg":["Recipients must authenticate — some external parties will find this inconvenient","If a link's recipient cannot be identified, that access is simply lost","Any live customer or regulator workflow on an Anyone link will break the moment it is removed"],"undo":{"can":"No — not fully","text":"The tenant setting reverts, but a deleted anonymous link cannot be restored. A new link has a different URL, so anyone holding the old one is locked out permanently. This is why the inventory-and-contact step comes first."},"roles":[["SharePoint Administrator","required — tenant sharing ceiling and link removal"],["Site owner","required — to identify each link's recipient"],["Global Administrator","not required"]]},
    uiTier: "intermediate", psTier: "intermediate",
    tiers: [
      { l: "Beginner", c: "#34d399", t: "Run the Anyone-links report and email each creator to ask who the recipient is. No changes made, and it produces the only record you will ever get.", who: "Anyone with Global Reader" },
      { l: "Intermediate", c: "#fbbf24", t: "Convert each link to a named guest share, then delete the anonymous one. Straightforward per link, but it needs a person to own the follow-up with each creator.", who: "SharePoint administrator" },
      { l: "Expert", c: "#f87171", t: "Flip the tenant sharing ceiling once the list is empty. If anything was missed, an external party loses access with no warning and no way to identify them.", who: "Platform owner with change approval" }
    ],
    rows: [["Anonymous links", "23", "0"], ["Identity recorded", "none", "named"], ["Audit trail", "none", "logged"], ["Oldest link", "3 yrs", "90 days"]],
    subject: "anonymous “Anyone with the link” shares",
    what: "Disable Anyone links at tenant level, convert the 23 live ones to authenticated guest shares, and apply a 90-day expiry with owner attestation.",
    effort: "1 week · 23 links",
    risk: "Low — external recipients are the only people affected",
    blast: [
      "Disable Anyone links without converting the live ones first and 23 external parties lose access with no warning and no way to identify who they were.",
      "If any of those links is in an active customer or regulator workflow, the first you will hear about it is a phone call.",
      "Converting to guest requires the recipient to authenticate — if you have no email address on record for a link, that access cannot be re-established."
    ],
    guard: "Export the live links with their creators first, have each creator confirm who the recipient is, then convert. Only disable the tenant setting once the list is empty.",
    ui: {
      title: "Remove anonymous sharing — admin centre",
      steps: [
        { t: "Open the SharePoint admin center.", link: { l: "admin.microsoft.com/sharepoint", u: "https://admin.microsoft.com/sharepoint" } },
        { t: "Go to Reports → Data access governance → Sharing links, and export the “Anyone” links report." },
        { t: "Email each link creator and ask who the recipient is. Do not skip this — it is the only record you will get." },
        { t: "Re-share to the named recipient as a guest, then delete the anonymous link." },
        { t: "Once the report is empty, go to Policies → Sharing and set external sharing to:", copy: "New and existing guests" },
        { t: "Set guest link expiry to:", copy: "90 days" }
      ],
      verify: "The Anyone links report returns zero rows and the tenant sharing setting reads New and existing guests.",
      undo: "Set external sharing back to Anyone. Deleted links cannot be restored — they must be re-created."
    },
    ps: {
      title: "Remove anonymous sharing — PowerShell",
      perms: ["SharePoint Administrator", "Microsoft.Online.SharePoint.PowerShell"],
      prereq: "Install-Module Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser",
      script: "# Inventory anonymous links — READ ONLY\nConnect-SPOService -Url \"https://contoso-admin.sharepoint.com\"\n\n$anon = foreach ($s in Get-SPOSite -Limit All) {\n    Get-SPOSiteSharingLink -Site $s.Url -ErrorAction SilentlyContinue |\n      Where-Object { $_.LinkKind -like \"Anonymous*\" } |\n      Select-Object @{n=\"Site\";e={$s.Url}}, LinkKind, CreatedBy, Created, Expiration\n}\n$anon | Export-Csv .\\\\anonymous-links.csv -NoTypeInformation\nWrite-Host \"$($anon.Count) anonymous links — contact each creator before removing\" -ForegroundColor Red\n\n# Only after the CSV is worked through:\n# Set-SPOTenant -SharingCapability ExternalUserSharingOnly\n# Set-SPOTenant -RequireAnonymousLinksExpireInDays 30",
      verify: "anonymous-links.csv is empty on a re-run.",
      undo: "Set-SPOTenant -SharingCapability ExternalUserAndGuestSharing restores anonymous sharing; individual links must be re-created."
    }
  },
  guests: {
    detail: {"json":{"before":"{\n  \"guestIdentities\": 612,\n  \"guestsWithNoExpiry\": 612,\n  \"externalDomains\": 48,\n  \"accessReviewConfigured\": false,\n  \"lastAttestation\": null\n}","after":"{\n  \"guestIdentities\": 344,\n  \"guestsWithNoExpiry\": 0,\n  \"externalDomains\": 19,\n  \"accessReviewConfigured\": true,\n  \"lastAttestation\": \"quarterly\"\n}"},"score":["Governance pillar","34","41"],"score2":["Identity hygiene","62","88"],"pos":["268 stale guests clear on the first cycle with no decision required","Site owners become accountable for their own external access","Attestation gives you evidence, not just a setting"],"neg":["Reviewers receive email they did not ask for and will initially ignore it","A guest removed from a group loses everything that group grants, not just one site","Sites with no owner fall back to an administrator, who cannot meaningfully attest"],"undo":{"can":"Yes","text":"Deleting the access review changes no access. Guests already removed can be re-invited in seconds and their permissions are restored on the new invite — the only cost is the round trip."},"roles":[["Identity Governance Administrator","required — to create the access review"],["Groups Administrator","required — if you change group membership directly"],["Global Reader","sufficient for the inventory script"]]},
    uiTier: "beginner", psTier: "beginner",
    tiers: [
      { l: "Beginner", c: "#34d399", t: "Run the guest inventory and sort by age and last sign-in. Read-only, and the never-signed-in rows make the case on their own.", who: "Global Reader" },
      { l: "Intermediate", c: "#fbbf24", t: "Configure the quarterly access review with Take recommendations on the first cycle. Ten minutes, and nothing is revoked until reviewers ignore a request.", who: "Identity Governance administrator" },
      { l: "Expert", c: "#f87171", t: "Switch the no-response action to Remove access, and assign owners to the sites that have none first. Get the order wrong and the review falls to an admin who rubber-stamps it.", who: "Identity owner with business sign-off" }
    ],
    rows: [["Guest identities", "612", "344"], ["With no expiry", "612", "0"], ["External domains", "48", "19"], ["Access review", "never", "quarterly"]],
    subject: "standing guest identities",
    what: "Turn on a quarterly access review for guests with owner attestation, and remove access automatically where a reviewer does not respond.",
    effort: "10 minutes to configure · 90 days to first effect",
    risk: "Low — nothing is revoked on day one",
    blast: [
      "Set the “no response” action to Remove access on a tenant where sites have no owners and the review falls to an administrator who will rubber-stamp or ignore it — either outcome defeats the control.",
      "Run it on a 14-day cycle over a holiday period and you will remove a vendor mid-project.",
      "Guests removed from a group lose access to everything that group grants, not just the site that prompted the review."
    ],
    guard: "Assign site owners before the first review runs, set the first cycle to Take recommendations rather than Remove access, then tighten on the second cycle.",
    ui: {
      title: "Guest expiry and attestation — admin centre",
      steps: [
        { t: "Open the Microsoft Entra admin center.", link: { l: "entra.microsoft.com", u: "https://entra.microsoft.com" } },
        { t: "Go to Identity Governance → Access reviews → New access review." },
        { t: "Scope it to:", copy: "Teams + Groups · All Microsoft 365 groups with guest users" },
        { t: "Set reviewer to Group owners with a fallback administrator, recurrence Quarterly, duration 14 days." },
        { t: "Under Settings → If reviewers don't respond, choose:", copy: "Take recommendations (first cycle) — change to Remove access on cycle two" },
        { t: "Enable “Justification required” and “Mail notifications”, then Create." }
      ],
      verify: "The review appears under Access reviews with a next-run date and a reviewer count greater than zero.",
      undo: "Delete the access review. No access is changed by deleting it."
    },
    ps: {
      title: "Guest inventory — PowerShell",
      perms: ["Global Reader", "Microsoft.Graph PowerShell SDK", "User.Read.All"],
      prereq: "Install-Module Microsoft.Graph -Scope CurrentUser",
      script: "# Guest inventory with last sign-in — READ ONLY\nConnect-MgGraph -Scopes \"User.Read.All\",\"AuditLog.Read.All\"\n\n$guests = Get-MgUser -Filter \"userType eq 'Guest'\" -All -Property Id,DisplayName,Mail,CreatedDateTime,SignInActivity\n\n$guests | Select-Object DisplayName, Mail, CreatedDateTime,\n    @{n=\"LastSignIn\";e={$_.SignInActivity.LastSignInDateTime}},\n    @{n=\"AgeDays\";e={[int]((Get-Date) - $_.CreatedDateTime).TotalDays}} |\n  Sort-Object AgeDays -Descending |\n  Export-Csv .\\\\guest-inventory.csv -NoTypeInformation\n\nWrite-Host \"$($guests.Count) guests — review the oldest first\" -ForegroundColor Yellow",
      verify: "guest-inventory.csv lists every guest with age and last sign-in; the never-signed-in rows are your first removals.",
      undo: "Nothing to undo — read-only."
    }
  },
  labels: {
    detail: {"json":{"before":"{\n  \"phiContainersLabelled\": 0.78,\n  \"regulatedFilesUnlabelled\": 40480,\n  \"classifiersEnforcing\": 0,\n  \"classifiersInSimulation\": 3,\n  \"labelEncryption\": false,\n  \"provableContainment\": false\n}","after":"{\n  \"phiContainersLabelled\": 0.99,\n  \"regulatedFilesUnlabelled\": 1120,\n  \"classifiersEnforcing\": 3,\n  \"classifiersInSimulation\": 0,\n  \"labelEncryption\": false,\n  \"provableContainment\": true\n}"},"score":["Compliance pillar","38","84"],"score2":["Copilot readiness","34%","58%"],"pos":["Grounded answers inherit their source classification","Containment becomes provable rather than asserted — that is the legal difference","Auto-labelling clears the backlog without anyone reading a file"],"neg":["A promoted classifier with a false positive blocks real work, including email to regulators","Auto-labelling 184,000 files runs in a window you cannot pause cleanly","If encryption is enabled too early, service accounts and integrations that cannot authenticate lose access"],"undo":{"can":"Partly","text":"Policies can be switched off instantly and applied labels can be stripped in bulk with a second policy. Encryption is the exception — content encrypted under a label that is later deleted can become unrecoverable, so encryption stays off until the taxonomy is stable."},"roles":[["Compliance Administrator","required — classifiers, labels and auto-labelling policies"],["Compliance Data Administrator","sufficient for review and sampling"],["Global Administrator","not required"]]},
    uiTier: "expert", psTier: "beginner",
    tiers: [
      { l: "Beginner", c: "#34d399", t: "Pull the label and DLP policy export and read which policies are still in simulation. Read-only, and it tells you what is actually enforcing.", who: "Compliance Reader" },
      { l: "Intermediate", c: "#fbbf24", t: "Sample 500 classifier matches and measure the false-positive rate before promoting anything. Slow, but it is the step that prevents a blocked email to a regulator.", who: "Compliance administrator" },
      { l: "Expert", c: "#f87171", t: "Enable label-based encryption. This can lock content away from service accounts and integrations that cannot authenticate — never do it in the same change as auto-labelling.", who: "Compliance owner + platform engineer" }
    ],
    rows: [["Regulated files unlabelled", "40,480", "1,120"], ["PHI containers labelled", "78%", "99%"], ["Classifiers enforcing", "0 of 3", "3 of 3"], ["Provable containment", "no", "yes"]],
    subject: "unlabelled regulated content",
    what: "Promote the three PHI classifiers out of simulation, enable default labels at site provisioning, and auto-label the backlog starting with clinical and billing libraries.",
    effort: "4 weeks · 40,480 files",
    risk: "Medium — labels can encrypt content",
    blast: [
      "Enable label-based encryption before testing and you can lock content away from the very people who need it, including service accounts and third-party integrations that cannot authenticate.",
      "Promote a classifier straight from simulation to enforce and a false positive becomes a blocked email to a regulator, not a log entry.",
      "Auto-labelling at tenant scope in one pass will label 184,000 files in a window you cannot pause cleanly."
    ],
    guard: "Review each classifier's simulation match rate on a 500-file sample first, enable enforcement on one library, and leave encryption off until the label taxonomy has been live for a full cycle.",
    ui: {
      title: "Label the backlog — admin centre",
      steps: [
        { t: "Open Microsoft Purview.", link: { l: "purview.microsoft.com", u: "https://purview.microsoft.com" } },
        { t: "Go to Information protection → Classifiers → Trainable classifiers and review the three PHI classifiers in simulation." },
        { t: "Open each one's match report and sample 500 matches before promoting. Target false-positive rate:", copy: "under 2%" },
        { t: "Go to Information protection → Auto-labeling and create a policy scoped to clinical and billing libraries only." },
        { t: "Run the policy in simulation mode for 7 days, then turn it on.", copy: "Simulation → On after review" },
        { t: "Under Label settings, leave encryption OFF for this phase. Add it once the taxonomy is stable." }
      ],
      verify: "The auto-labeling policy reports labelled item counts rising and the unlabelled percentage falling in Content explorer.",
      undo: "Turn the auto-labeling policy off. Applied labels remain but can be removed in bulk with a second policy."
    },
    ps: {
      title: "Label coverage report — PowerShell",
      perms: ["Compliance Administrator", "ExchangeOnlineManagement module"],
      prereq: "Install-Module ExchangeOnlineManagement -Scope CurrentUser",
      script: "# Sensitivity label coverage — READ ONLY\nConnect-IPPSSession\n\n$labels = Get-Label | Select-Object Name, DisplayName, ContentType\n$policies = Get-LabelPolicy | Select-Object Name, Labels, Enabled\n\n$labels   | Export-Csv .\\\\labels.csv -NoTypeInformation\n$policies | Export-Csv .\\\\label-policies.csv -NoTypeInformation\n\nGet-DlpCompliancePolicy | Select-Object Name, Mode, Enabled, ExchangeLocation, SharePointLocation |\n  Export-Csv .\\\\dlp-policies.csv -NoTypeInformation\n\nWrite-Host \"Check dlp-policies.csv — any policy in TestWithoutNotifications is not enforcing\" -ForegroundColor Yellow",
      verify: "dlp-policies.csv shows each policy's Mode. Anything reading TestWithoutNotifications is in simulation and blocking nothing.",
      undo: "Nothing to undo — read-only."
    }
  },
  ca: {
    detail: {"json":{"before":"{\n  \"policyId\": \"CA01\",\n  \"state\": \"disabled\",\n  \"targetApp\": null,\n  \"grantControls\": [],\n  \"sessionsEvaluated\": 0,\n  \"unmanagedBrowserAccess\": \"allowed\"\n}","after":"{\n  \"policyId\": \"CA01\",\n  \"state\": \"enabledForReportingButNotEnforced\",\n  \"targetApp\": \"Microsoft 365 Copilot\",\n  \"grantControls\": [\"requireCompliantDevice\"],\n  \"sessionsEvaluated\": 1.0,\n  \"unmanagedBrowserAccess\": \"blocked\"\n}"},"score":["Security pillar","51","72"],"score2":["Copilot readiness","34%","45%"],"pos":["Every Copilot session is evaluated for device compliance and location","Report-only tells you the blast radius before you take it","Closes the one access path in the tenant that is currently ungoverned"],"neg":["Enforced today it blocks one user in six — 312 endpoints are outside baseline","Scope it to All cloud apps by mistake and you lock out the tenant, including yourself","Without excluded break-glass accounts a misconfiguration cannot be reversed from inside"],"undo":{"can":"Yes","text":"Setting the policy to Off takes effect within minutes and changes no user or device state. This is the safest item in the report to trial, provided you start in report-only and keep two break-glass accounts excluded."},"roles":[["Conditional Access Administrator","required — to create and enable the policy"],["Security Reader","sufficient to read sign-in logs during report-only"],["Global Administrator","not required — and should not be used for this"]]},
    uiTier: "expert", psTier: "beginner",
    tiers: [
      { l: "Beginner", c: "#34d399", t: "Export the conditional access inventory and confirm no policy targets the Copilot app. Read-only, and it takes five minutes.", who: "Global Reader" },
      { l: "Intermediate", c: "#fbbf24", t: "Create CA01 in report-only with break-glass accounts excluded, then read the sign-in logs for two weeks. Report-only cannot lock anyone out.", who: "Conditional Access administrator" },
      { l: "Expert", c: "#f87171", t: "Move CA01 to enforce. With 312 endpoints outside baseline that blocks one user in six on day one, so the device baseline has to be fixed first.", who: "Identity owner · change board required" }
    ],
    rows: [["Copilot session policy", "off", "enforced"], ["CA policies live", "42", "43"], ["Sessions evaluated", "0%", "100%"], ["Unmanaged browsers", "allowed", "blocked"]],
    subject: "the missing Copilot session policy (CA01)",
    what: "Create a conditional access policy scoped to the Microsoft 365 Copilot app requiring a compliant device, run it report-only for two weeks, then enforce.",
    effort: "1 change window · report-only first",
    risk: "High if enforced without report-only",
    blast: [
      "Enforce a compliant-device grant on day one and every user on a personal or drifted device loses Copilot immediately — with 312 endpoints outside baseline, that is one user in six.",
      "Scope it to All cloud apps by mistake and you lock the tenant out, including the administrator who created the policy.",
      "Without a break-glass account excluded, a misconfiguration cannot be reversed from inside the tenant."
    ],
    guard: "Always exclude two break-glass accounts, always start report-only, and read the sign-in logs for two weeks before enforcing. Fix the device baseline first so the grant does not lock out a sixth of your users.",
    ui: {
      title: "Create CA01 — admin centre",
      steps: [
        { t: "Open the Microsoft Entra admin center with the Conditional Access Administrator role.", link: { l: "entra.microsoft.com", u: "https://entra.microsoft.com" } },
        { t: "Go to Protection → Conditional Access → Policies → New policy. Name it:", copy: "CA01 — Copilot session control" },
        { t: "Users: include All users, and EXCLUDE your two break-glass accounts. Do not skip this step." },
        { t: "Target resources → Cloud apps → Include → Select apps:", copy: "Microsoft 365 Copilot" },
        { t: "Grant → Require device to be marked as compliant. Session → Sign-in frequency 12 hours." },
        { t: "Enable policy: set to Report-only. Save, then review Sign-in logs → Conditional Access for two weeks before switching to On." }
      ],
      verify: "Sign-in logs show CA01 evaluating with a Report-only result on Copilot sessions, and the failure count tells you how many users the enforcement would block today.",
      undo: "Set the policy to Off. Effect is immediate and no user state is changed."
    },
    ps: {
      title: "Conditional access audit — PowerShell",
      perms: ["Global Reader", "Microsoft.Graph PowerShell SDK", "Policy.Read.All"],
      prereq: "Install-Module Microsoft.Graph -Scope CurrentUser",
      script: "# Conditional access inventory — READ ONLY\nConnect-MgGraph -Scopes \"Policy.Read.All\",\"Directory.Read.All\"\n\n$pol = Get-MgIdentityConditionalAccessPolicy -All\n\n$pol | Select-Object DisplayName, State,\n    @{n=\"Apps\";e={$_.Conditions.Applications.IncludeApplications -join \",\"}},\n    @{n=\"Grant\";e={$_.GrantControls.BuiltInControls -join \",\"}},\n    @{n=\"ExcludedUsers\";e={$_.Conditions.Users.ExcludeUsers.Count}} |\n  Sort-Object State |\n  Export-Csv .\\\\ca-policies.csv -NoTypeInformation\n\n$copilot = $pol | Where-Object { $_.Conditions.Applications.IncludeApplications -contains \"fb8d773d-7ef8-4ec0-a117-3d827f2b8dc7\" }\nWrite-Host \"Copilot-scoped policies: $($copilot.Count)\" -ForegroundColor $(if($copilot.Count){\"Green\"}else{\"Red\"})",
      verify: "ca-policies.csv lists all 42 policies with their state and grant. The Copilot count at the end should be zero today.",
      undo: "Nothing to undo — read-only."
    }
  },
  licensing: {
    detail: {
      json: { before: '{\n  "seatsPurchased": 6180,\n  "seatsAssigned": 4872,\n  "unassigned": 1308,\n  "copilotOwned": 25,\n  "copilotAssigned": 2,\n  "annualWaste": 847608\n}',
        after: '{\n  "seatsPurchased": 4872,\n  "seatsAssigned": 4872,\n  "unassigned": 0,\n  "copilotOwned": 400,\n  "copilotAssigned": 400,\n  "annualWaste": 0\n}' },
      score: ["Licensing pillar", "38", "88"], score2: ["Annual waste", "$847,608", "$0"],
      pos: ["$847,608 a year stops leaving the business", "The Copilot pilot funds itself out of the recovery", "Licence position becomes reportable monthly rather than at renewal"],
      neg: ["Reclaiming a seat from an active user is disruptive — the idle list has to be checked", "Right-sizing means some people lose features they had but never used", "The saving only lands if the subscription count is reduced at renewal"],
      undo: { can: "Yes", text: "Re-assigning a licence takes seconds and restores the user's state. Nothing is deleted — mailboxes and OneDrive content are retained inside the grace period." },
      roles: [["License Administrator", "required — assignment and reclamation"], ["Billing Administrator", "required — to change the purchased count at renewal"], ["Global Reader", "sufficient for the usage export"], ["Global Administrator", "not required"]]
    },
    uiTier: "beginner", psTier: "intermediate",
    tiers: [
      { l: "Beginner", c: "#34d399", t: "Export the usage and subscription report and identify the departed and idle accounts. Read-only, and it makes the case on its own.", who: "Global Reader" },
      { l: "Intermediate", c: "#fbbf24", t: "Reclaim the departed accounts and move assignment to groups. Straightforward, but it needs the HR leaver feed wired in to stay fixed.", who: "License Administrator" },
      { l: "Expert", c: "#f87171", t: "Reduce the purchased count at renewal. Get the number wrong and you are short of seats mid-term with no way to true up until the next date.", who: "Billing owner + procurement" }
    ],
    rows: [["Unassigned seats", "1,308", "0"], ["Annual waste", "$847,608", "$0"], ["Copilot assigned", "2", "400"], ["Group-assigned", "62%", "100%"]],
    subject: "the licence position",
    what: "Reclaim what nobody holds, right-size the SKUs against ninety days of real use, and move every assignment to a group so the position cannot drift back.",
    effort: "3 weeks · before the renewal date",
    risk: "Low — reversible in seconds",
    blast: [
      "Reclaim a licence from an active user and they lose Office and mail access immediately — always work from the idle list, never from the unassigned count alone.",
      "Right-size in bulk without checking workload and you will take E5 features from people who quietly depend on one of them.",
      "Reduce the purchased count too aggressively and you cannot add seats back until the next renewal without a new agreement."
    ],
    guard: "Work from ninety days of telemetry, notify managers before reclaiming, and hold the subscription reduction until the assignment change has been live for a full cycle.",
    ui: {
      title: "Correct the licence position — admin centre",
      steps: [
        { t: "Open the Microsoft 365 admin center with the License Administrator role.", link: { l: "admin.microsoft.com", u: "https://admin.microsoft.com" } },
        { t: "Go to Billing → Licenses and note purchased against assigned for each SKU." },
        { t: "Go to Reports → Usage → Microsoft 365 apps and set the period to:", copy: "Last 90 days" },
        { t: "Cross-check the never-active list against HR leavers, then remove those licences first." },
        { t: "Create a Copilot-eligible security group and assign the licence to the group, not to people:", copy: "Copilot-Eligible-Pilot" },
        { t: "At the renewal date, reduce the purchased count to the corrected figure — the saving only lands here." }
      ],
      verify: "Billing → Licenses shows assigned equal to purchased for every SKU, and the Copilot count matches the pilot cohort.",
      undo: "Re-assign the licence. The user's mailbox and OneDrive are retained through the grace period, so nothing is lost."
    },
    ps: {
      title: "Licence position report — PowerShell",
      perms: ["Global Reader or License Administrator", "Microsoft.Graph PowerShell SDK", "Organization.Read.All and Reports.Read.All"],
      prereq: "Install-Module Microsoft.Graph -Scope CurrentUser",
      script: "# Licence position and idle-seat report — READ ONLY\nConnect-MgGraph -Scopes \"Organization.Read.All\",\"Reports.Read.All\",\"User.Read.All\"\n\n# 1. Purchased against assigned, by SKU\nGet-MgSubscribedSku |\n  Select-Object SkuPartNumber,\n    @{n=\"Purchased\";e={$_.PrepaidUnits.Enabled}},\n    @{n=\"Assigned\";e={$_.ConsumedUnits}},\n    @{n=\"Idle\";e={$_.PrepaidUnits.Enabled - $_.ConsumedUnits}} |\n  Sort-Object Idle -Descending |\n  Export-Csv .\\\\sku-position.csv -NoTypeInformation\n\n# 2. Licensed accounts with no sign-in in 90 days\n$cut = (Get-Date).AddDays(-90)\n$idle = Get-MgUser -All -Property Id,DisplayName,UserPrincipalName,AssignedLicenses,SignInActivity,AccountEnabled |\n  Where-Object { $_.AssignedLicenses.Count -gt 0 -and\n    ($_.SignInActivity.LastSignInDateTime -lt $cut -or -not $_.SignInActivity.LastSignInDateTime) }\n\n$idle | Select-Object DisplayName, UserPrincipalName, AccountEnabled,\n    @{n=\"LastSignIn\";e={$_.SignInActivity.LastSignInDateTime}},\n    @{n=\"Licences\";e={($_.AssignedLicenses.SkuId) -join \",\"}} |\n  Export-Csv .\\\\idle-licensed.csv -NoTypeInformation\n\nWrite-Host \"$($idle.Count) licensed accounts idle for 90+ days\" -ForegroundColor Yellow\nWrite-Host \"Check AccountEnabled = False first — those are your leavers.\" -ForegroundColor Cyan",
      verify: "sku-position.csv gives the idle count per SKU; idle-licensed.csv is the reclaim work list. Disabled accounts are the safe first pass.",
      undo: "Nothing to undo — read-only."
    }
  },
  inheritance: {
    detail: {"json":{"before":"{\n  \"brokenInheritancePoints\": 128,\n  \"directUserGrants\": 1940,\n  \"permissionDepth\": 6,\n  \"sitesWithOwner\": 40,\n  \"documentedExceptions\": 12\n}","after":"{\n  \"brokenInheritancePoints\": 12,\n  \"directUserGrants\": 210,\n  \"permissionDepth\": 2,\n  \"sitesWithOwner\": 1204,\n  \"documentedExceptions\": 12\n}"},"score":["Governance pillar","34","45"],"score2":["Permission hygiene","22","81"],"pos":["“Who can see this” becomes answerable in one query","Group-based grants mean joiners and leavers stop being manual steps","Permission depth drops from six levels to two"],"neg":["Restoring inheritance can WIDEN access if the parent is more permissive than the child","Bulk restores expose content that was correctly isolated — HR investigations, board material","Replacing direct grants with groups can silently drop someone who was never in the group"],"undo":{"can":"Yes, but manually","text":"You can re-break inheritance and re-apply the previous permission set — but only if you recorded it first. There is no built-in undo, which is why the before/after log per library is not optional."},"roles":[["SharePoint Administrator","required — site and library permissions"],["Site Collection Administrator","required per site"],["Global Administrator","not required"]]},
    uiTier: "expert", psTier: "intermediate",
    tiers: [
      { l: "Beginner", c: "#34d399", t: "Run the unique-permissions audit and produce the work list. Read-only, and it turns 128 abstract break points into named libraries.", who: "SharePoint administrator" },
      { l: "Intermediate", c: "#fbbf24", t: "Replace direct user grants with security groups where membership is obvious. Safe, incremental, and it removes most of the future maintenance.", who: "SharePoint admin + site owners" },
      { l: "Expert", c: "#f87171", t: "Restore inheritance. Parent permissions may be wider than the child — HR investigations and board material are exactly what gets exposed when this is done in bulk.", who: "Platform engineer · one library at a time" }
    ],
    rows: [["Broken inheritance points", "128", "12"], ["Direct user grants", "1,940", "210"], ["Permission depth", "6 levels", "2 levels"], ["Sites with an owner", "40", "1,204"]],
    subject: "broken permission inheritance",
    what: "Enumerate libraries with unique permissions, restore inheritance where no documented reason exists, and replace direct user grants with groups.",
    effort: "3 weeks · 128 break points",
    risk: "Medium — restoring inheritance changes who can see what",
    blast: [
      "Restore inheritance on a library that was deliberately broken and you widen access rather than narrowing it — the parent may be more permissive than the child.",
      "Bulk-restoring across 128 libraries without reading each one will expose content that was correctly isolated, such as HR investigations or board material.",
      "Replacing direct grants with groups without checking membership can silently drop an individual who was never in the group."
    ],
    guard: "Compare parent and child permissions before restoring any single library. Restore only where the parent is equal to or narrower than the child, and never in bulk.",
    ui: {
      title: "Fix inheritance — admin centre",
      steps: [
        { t: "Open the SharePoint admin center → Reports → Data access governance → Sharing links.", link: { l: "admin.microsoft.com/sharepoint", u: "https://admin.microsoft.com/sharepoint" } },
        { t: "For each site, open Site settings → Site permissions → Advanced permissions settings." },
        { t: "Compare the library's unique permissions against the parent BEFORE changing anything." },
        { t: "Where the parent is narrower or equal, choose:", copy: "Delete unique permissions" },
        { t: "Where the break is legitimate, replace individual user entries with a security group instead of restoring." },
        { t: "Log every restore with the library URL, the before/after permission set, and who approved it." }
      ],
      verify: "The count of libraries with unique permissions falls, and no help-desk tickets follow within 48 hours of each batch.",
      undo: "Re-break inheritance and re-apply the recorded permission set — which is why the before/after log matters."
    },
    ps: {
      title: "Inheritance audit — PowerShell",
      perms: ["SharePoint Administrator", "PnP.PowerShell module"],
      prereq: "Install-Module PnP.PowerShell -Scope CurrentUser",
      script: "# Unique-permission audit — READ ONLY\n$sites = Get-Content .\\\\sites.txt   # one site URL per line\n\n$out = foreach ($url in $sites) {\n    Connect-PnPOnline -Url $url -Interactive\n    foreach ($list in Get-PnPList -Includes HasUniqueRoleAssignments) {\n        if ($list.HasUniqueRoleAssignments) {\n            [pscustomobject]@{\n                Site  = $url\n                List  = $list.Title\n                Items = $list.ItemCount\n                Url   = $list.DefaultViewUrl\n            }\n        }\n    }\n}\n$out | Export-Csv .\\\\broken-inheritance.csv -NoTypeInformation\nWrite-Host \"$($out.Count) libraries with unique permissions\" -ForegroundColor Yellow",
      verify: "broken-inheritance.csv is your work list. Do not automate the fix — each row needs a human decision.",
      undo: "Nothing to undo — read-only."
    }
  }
};

export function fixProfileFor(key) {
  const k = String(key || "").toLowerCase();
  if (walkPillarRef.current === "licensing") return FIX_PROFILES.licensing || FIX_PROFILES.orgwide;
  if (/anonymous|anyone with the link/.test(k)) return FIX_PROFILES.anonymous;
  if (/guest|external/.test(k)) return FIX_PROFILES.guests;
  if (/label|sensitiv|phi|classif|compliance/.test(k)) return FIX_PROFILES.labels;
  if (/conditional|ca01|session/.test(k)) return FIX_PROFILES.ca;
  if (/inherit|permission|hygiene|sprawl/.test(k)) return FIX_PROFILES.inheritance;
  return FIX_PROFILES.orgwide;
}


// the whiteboard reads the answer and picks a glyph that fits it
export const SMART_ICONS = [
  [/rocket|space|aerospace|nasa|satellite|launch|orbit|flight/i, "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91 0zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"],
  [/manufactur|factory|industrial|plant|assembly|production/i, "M2 20h20V9l-6 4V9l-6 4V4H4v9l-2 1zM6 20v-4M10 20v-4M14 20v-4M18 20v-4"],
  [/health|hospital|clinic|medical|patient|phi|care|nurse|physician|provider/i, "M22 12h-4l-3 9L9 3l-3 9H2"],
  [/financ|bank|insur|invest|capital|fintech|payment/i, "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  [/legal|law|counsel|attorney|litigation|contract/i, "M12 3v18M5 7l7-4 7 4M4 21h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l3 7a3 3 0 0 1-6 0z"],
  [/educat|school|universit|college|student|academ/i, "M22 10 12 5 2 10l10 5zM6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5"],
  [/govern(ment)?|federal|agency|public sector|municipal|defen[cs]e|military/i, "M12 2l8 5H4l8-5zM6 11v7M10 11v7M14 11v7M18 11v7M2 22h20M2 11h20"],
  [/retail|commerce|store|shop|consumer|merchand/i, "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"],
  [/energy|utilit|oil|gas|power|grid|renewab/i, "M13 2 3 14h8l-1 8 10-12h-8z"],
  [/tech|software|saas|platform|engineer|developer|it services/i, "M4 4h16v16H4zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"],
  [/logistic|transport|shipping|freight|fleet|supply chain|warehouse/i, "M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 19a2.5 2.5 0 1 0 0-.01M18.5 19a2.5 2.5 0 1 0 0-.01"],
  [/nonprofit|charit|foundation|ngo/i, "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"],
  [/media|broadcast|publish|entertain|studio/i, "M2 4h20v14H2zM8 22h8M12 18v4M10 9l5 2-5 2z"],
  [/construct|building|architect|real estate|property/i, "M2 20h20M4 20V9l8-5 8 5v11M9 20v-6h6v6"],
  [/research|science|lab|pharma|biotech|clinical trial/i, "M9 2v6l-5.5 9.5A2 2 0 0 0 5.2 21h13.6a2 2 0 0 0 1.7-3.5L15 8V2M8 2h8M7 15h10"],
  [/telecom|network|carrier|wireless/i, "M5 12a7 7 0 0 1 14 0M2 12a10 10 0 0 1 20 0M12 12v9M9 21h6"],
  [/agricultur|farm|food|beverage/i, "M12 22V8M12 8c0-3 2-6 6-6 0 4-2 6-6 6zM12 12c0-3-2-6-6-6 0 4 2 6 6 6z"],
  [/mining|resource|metal|steel/i, "M14 3 21 10l-4 4-7-7zM10 7 3 14l7 7 7-7"],
  [/hospitalit|hotel|travel|tourism|restaurant/i, "M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6"],
  [/people|employee|staff|headcount|seat|workforce|team|user/i, "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"],
  [/teams|chat|channel|meeting|collab/i, "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  [/email|outlook|mail|inbox/i, "M4 4h16v16H4zM4 6l8 6 8-6"],
  [/librar|sharepoint|site|document|file/i, "M4 4h7l2 3h7v13H4zM8 12h8M8 16h5"],
  [/onedrive|personal drive|cloud/i, "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"],
  [/external|partner|vendor|guest|supplier/i, "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"],
  [/pii|personal data|identit/i, "M4 5h16v14H4zM8 11a2 2 0 1 0 0-.01M6 16c.6-1.6 2-2.4 3-2.4s2.4.8 3 2.4M14 10h4M14 14h3"],
  [/contract|agreement|msa|sow/i, "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6"],
  [/board|executive|strategic/i, "M3 3v18h18M7 15l4-6 4 4 5-8"],
  [/secur|risk|protect|threat|breach/i, "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  [/complian|regulat|audit|hipaa|gdpr|sox|iso/i, "M12 3v18M5 7l7-4 7 4M4 21h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l3 7a3 3 0 0 1-6 0z"],
  [/licen[cs]|sku|cost|budget|spend|money|savings/i, "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  [/time|hour|week|day|drag|slow|delay/i, "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2"],
  [/success|goal|target|outcome|objective/i, "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"],
  [/owner|responsib|accountab|lead|manager/i, "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"]
];

export function smartIcon(text, fallback) {
  const s = String(text || "");
  if (!s) return fallback;
  for (let i = 0; i < SMART_ICONS.length; i++) {
    if (SMART_ICONS[i][0].test(s)) return SMART_ICONS[i][1];
  }
  return fallback;
}

export const HERO_PHASE = [
  { k: "governance", t: "Governance Scan", sub: "Initializing…", c: "#3B82F6", beam: "rgba(59,130,246,.28)", glow: "rgba(59,130,246,.22)",
    checks: ["Mapping overshared content across SharePoint and Teams", "Detecting org-wide links and anonymous access points", "Analyzing sensitivity label coverage across your libraries", "Tracing permission inheritance drift in high-traffic sites"],
    find: ["41 sites publishing tenant-wide", "128 broken inheritance points"], score: 34, stats: [["1,204", "sites inventoried"], ["41", "overshared sites"], ["214,806", "files reachable"], ["17", "Teams with public channels"]] },
  { k: "licensing", t: "Licensing Scan", sub: "Mapping…", c: "#14B8A6", beam: "rgba(20,184,166,.28)", glow: "rgba(20,184,166,.22)",
    checks: ["Checking Copilot eligibility across all assigned SKUs", "Identifying seat drift and unused licenses", "Validating persona-to-license alignment", "Scanning for duplicate or misconfigured license assignments"],
    find: ["1,308 paid seats unassigned", "25 Copilot licences, 2 in use"], score: 38, stats: [["6,180", "seats provisioned"], ["1,308", "paid, unassigned"], ["$847,608", "annual waste"], ["25 / 2", "Copilot owned / used"]] },
  { k: "adoption", t: "Adoption Scan", sub: "Analysing…", c: "#F97316", beam: "rgba(249,115,22,.28)", glow: "rgba(249,115,22,.2)",
    checks: ["Measuring Teams usage across departments", "Analyzing workflow readiness for Copilot integration", "Detecting shadow collaboration (email-only patterns)", "Mapping persona adoption friction and training gaps"],
    find: ["22% of meetings transcribed", "no named champions"], score: 54, stats: [["1,631", "daily active users"], ["22%", "meetings transcribed"], ["0", "named champions"], ["64%", "files shared in chat"]] },
  { k: "compliance", t: "Compliance Scan", sub: "Running…", c: "#F3F4F6", beam: "rgba(243,244,246,.26)", glow: "rgba(209,213,219,.2)",
    checks: ["Scanning retention policies for gaps and misalignment", "Detecting unlabeled regulated content (PII, PHI, financial)", "Checking audit log completeness across workloads", "Analyzing lifecycle violations in inactive sites and channels"],
    find: ["40,480 regulated files unlabelled", "retention gaps in 3 workloads"], score: 34, stats: [["184,000", "files evaluated"], ["40,480", "regulated, unlabelled"], ["78%", "PHI containers labelled"], ["1,412", "mailboxes outside DLP"]] },
  { k: "health", t: "Health Scan", sub: "Reading telemetry…", c: "#22C55E", beam: "rgba(34,197,94,.26)", glow: "rgba(34,197,94,.2)",
    checks: ["Checking workload stability across Exchange, SharePoint, Teams", "Detecting configuration drift in core services", "Scanning for sync errors and client health issues", "Analyzing tenant hygiene and orphaned resources"],
    find: ["312 endpoints outside baseline", "18 standing global admins"], score: 58, stats: [["1,876", "managed endpoints"], ["312", "outside baseline"], ["94.2%", "device compliance"], ["340", "tickets a week"]] },
  { k: "security", t: "Security Scan", sub: "Starting…", c: "#8B5CF6", beam: "rgba(139,92,246,.28)", glow: "rgba(139,92,246,.22)",
    checks: ["Scanning identity posture for MFA gaps and privilege creep", "Checking Conditional Access baseline alignment", "Detecting legacy authentication protocols still in use", "Mapping DLP coverage and exposure risks"],
    find: ["214,806 files reachable by any account", "no Copilot session policy"], score: 41, stats: [["96%", "MFA coverage"], ["42", "CA policies"], ["0", "Copilot session policies"], ["214,806", "files in blast radius"]] },
  { k: "copilot", t: "Copilot Readiness Model", sub: "Building…", c: "#67E8F9", beam: "rgba(103,232,249,.3)", glow: "rgba(103,232,249,.24)",
    checks: ["Building your Copilot readiness model in real time", "Mapping blast radius based on governance and security signals", "Analyzing workflow alignment for Copilot value paths", "Synthesizing all pillar scores into your readiness index"],
    find: ["readiness 34% against a 75% gate", "nine documents generated"], score: 34, stats: [["34%", "readiness against a 75 gate"], ["3 / 3", "test prompts returned PHI"], ["$2.4M", "PHI exposure priced"], ["9", "documents generated"]] },
  { k: "docs", t: "Document Generation", sub: "Writing…", c: "#A78BFA", beam: "rgba(167,139,250,.28)", glow: "rgba(167,139,250,.22)", doc: true,
    checks: ["Writing the seven pillar reports from your scan output", "Assembling findings tables, playbooks and remediation steps", "Attaching the Copilot test-prompt evidence", "Paginating and indexing every deliverable"],
    find: ["seven pillar reports written", "213 pages generated"], score: 100, stats: [] },
  { k: "sow", t: "SOW Generation", sub: "Scoping…", c: "#38BDF8", beam: "rgba(56,189,248,.28)", glow: "rgba(56,189,248,.22)", doc: true,
    checks: ["Grouping 24 findings into remediation phases", "Sequencing the twelve-week critical path", "Pricing each phase and the monitoring line", "Producing the statement of work and remediation plan"],
    find: ["seven phases scoped", "statement of work ready"], score: 100, stats: [] }
];

export const HERO_SCAN = [
  { k: "governance", l: "Governance scan in progress…", n: "Governance", s: 34, c: "#3B82F6",
    beam: "rgba(59,130,246,.26)", glow: "rgba(59,130,246,.2)", note: "1,204 sites · 41 publishing tenant-wide" },
  { k: "security", l: "Security signals detected…", n: "Security", s: 41, c: "#8B5CF6",
    beam: "rgba(139,92,246,.26)", glow: "rgba(139,92,246,.2)", note: "214,806 files reachable by any account" },
  { k: "compliance", l: "Compliance posture loading…", n: "Compliance", s: 34, c: "#F3F4F6",
    beam: "rgba(243,244,246,.24)", glow: "rgba(209,213,219,.18)", note: "40,480 regulated files carry no label" },
  { k: "licensing", l: "Licensing alignment mapping…", n: "Licensing", s: 38, c: "#14B8A6",
    beam: "rgba(20,184,166,.26)", glow: "rgba(20,184,166,.2)", note: "1,308 paid seats nobody holds" },
  { k: "adoption", l: "Adoption friction identified…", n: "Adoption", s: 54, c: "#F97316",
    beam: "rgba(249,115,22,.22)", glow: "rgba(249,115,22,.16)", note: "22% of meetings transcribed · 0 champions" },
  { k: "health", l: "Health telemetry stabilising…", n: "Tenant Health", s: 58, c: "#22C55E",
    beam: "rgba(34,197,94,.22)", glow: "rgba(34,197,94,.16)", note: "312 endpoints outside baseline" }
];

export const HERO_Q = [
  { id: "industry", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6",
    q: "So — tell me a little about you. What industry are you in?",
    l: "Industry", ph: "Healthcare, financial services, manufacturing…",
    hints: ["Healthcare", "Financial services", "Manufacturing", "Government / public sector", "Professional services"],
    r: "Perfect. That helps me understand your world." },
  { id: "roles", icon: "M20 7h-9M14 17H5M17 14l3 3-3 3M7 10L4 7l3-3",
    q: "And who are they, mostly? Pick the groups that make up the bulk of your day-to-day.",
    l: "Core roles", ph: "Or type anything I've missed…", multi: true,
    lead: "Now let's talk about the people in your organisation. I'm going to show you some persona clusters — pick the ones that match your team.",
    opts: [
      { v: "Clinical & care delivery", d: "clinicians, nurses, allied health", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
      { v: "Operations & scheduling", d: "coordinators, shift and resource planning", icon: "M12 2v20M2 12h20" },
      { v: "Finance & revenue cycle", d: "billing, denials, payer relations", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
      { v: "Legal, risk & compliance", d: "counsel, privacy, audit", icon: "M12 3v18M5 7l7-4 7 4M4 21h16" },
      { v: "IT & engineering", d: "platform, endpoint, support desk", icon: "M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2" },
      { v: "Research & analysis", d: "scientists, data, reporting", icon: "M12 3v3M12 18v3M3 12h3M18 12h3" },
      { v: "Executive & leadership", d: "board, C-suite, directors", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01" },
      { v: "Frontline & field staff", d: "shared devices, shift-based", icon: "M20 7h-9M14 17H5M17 14l3 3-3 3M7 10L4 7l3-3" }
    ],
    r: "Those are the people I'll build into the room with you." },
  { id: "collab", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87",
    q: "How does work actually move between people here?",
    l: "Collaboration", ph: "Or describe it your way…", multi: true,
    lead: "Now let's talk about how your people work together.",
    opts: [
      { v: "Teams channels", d: "most work lives in channel threads", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
      { v: "Email threads", d: "decisions happen in Outlook", icon: "M4 4h16v16H4zM4 7l8 6 8-6" },
      { v: "Shared libraries", d: "SharePoint sites and document sets", icon: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" },
      { v: "Personal drives", d: "OneDrive, then shared out", icon: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" },
      { v: "External partners", d: "vendors, payers, counsel", icon: "M20 7h-9M14 17H5M17 14l3 3-3 3M7 10L4 7l3-3" },
      { v: "Line-of-business apps", d: "outside M365 entirely", icon: "M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" }
    ],
    r: "That tells me where Copilot will actually be reading from." },
  { id: "sensitivity", icon: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    q: "And what kind of sensitive material sits in there?",
    l: "Sensitivity", ph: "Anything else we should know about…", multi: true,
    lead: "This next one decides how careful we have to be.",
    opts: [
      { v: "PHI / patient data", d: "HIPAA, 42 CFR Part 2", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
      { v: "PII / personal data", d: "staff and customer records", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01" },
      { v: "Financial records", d: "billing, claims, payroll", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
      { v: "Contracts & legal", d: "executed agreements, counsel work", icon: "M12 3v18M5 7l7-4 7 4M4 21h16" },
      { v: "Research & IP", d: "protocols, trial data, designs", icon: "M12 3v3M12 18v3M3 12h3M18 12h3" },
      { v: "Board & exec material", d: "strategy, M&A, compensation", icon: "M3 21h18M5 21V7l7-4 7 4v14" }
    ],
    r: "Understood. That raises the bar on what Copilot is allowed to see." },
  { id: "pain", icon: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    q: "What eats the most time in a normal week — the thing everyone complains about?",
    l: "Biggest drag", ph: "Documentation, meetings, chasing files…",
    hints: ["Writing routine documents", "Too many meetings", "Finding the right file", "Email volume", "Repetitive reporting"],
    r: "That's exactly the kind of thing Copilot either fixes or makes worse. We'll find out which." },
  { id: "owner", icon: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    q: "Who owns governance and security decisions in your organisation?",
    l: "Decision owner", ph: "IT, security, compliance, a committee…",
    hints: ["IT owns it", "Security owns it", "Compliance owns it", "A committee decides", "Honestly — nobody"],
    r: "Noted. I'll make sure the findings land in language they can act on." },
  { id: "goal", icon: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1",
    q: "Last one. If Copilot went well, what would be different in six months?",
    l: "Success looks like", ph: "In your own words…",
    hints: ["Give people their week back", "Fewer repetitive tickets", "Faster reporting", "Prove it is safe first", "Measurable ROI"],
    r: "That's the outcome I'll measure everything against today." }
];

export const DOCS = {
  sow: {
    pillar: "Deliverable", color: "#0E7490", accent: "#67e8f9",
    title: "Statement of Work",
    sub: "Northline Health · prepared 01 Aug 2026 · derived from the assessment finding register",
    meta: [["Findings in scope", "24"], ["Phases", "7"], ["Elapsed", "12 weeks"], ["Professional services", "$252,800"]],
    sections: [
      { id: "scope", h: "1 · Scope & Objective", blocks: [
        { t: "p", v: "The objective of this engagement is to clear the Microsoft 365 Copilot deployment gate at 75% readiness within twelve weeks, using controls the client already owns. No finding in this document was authored for it — every one traces to the assessment carried out on 01 August 2026." },
        { t: "kv", rows: [["Objective", "Copilot deployment gate at 75%"], ["Findings carried into scope", "24"], ["Pillars represented", "6"], ["Current readiness", "34%"], ["Readiness on completion", "78%"], ["Elapsed", "12 weeks"]] },
        { t: "callout", tone: "warn", v: "Why this matters: at 34% readiness, enabling Copilot tenant-wide would place ungoverned and unlabelled content in front of every licensed account on the first morning. The gap is composed entirely of controls already licensed and not yet applied." }
      ]},
      { id: "approach", h: "2 · Approach & Sequence", blocks: [
        { t: "kv", rows: [["Critical path", "12 weeks · labelling is the longest pole at 8"], ["Phases running in parallel", "4"], ["Change windows required", "6 · 10 working days each"], ["Change window status", "not yet booked"], ["Re-measure cadence", "weekly reachability re-run"], ["Governance model", "joint · client change board, our delivery lead"]] },
        { t: "p", v: "Sequence is what makes twelve weeks achievable. Sharing and DLP run first because between them they carry 42 readiness points. Labelling starts in week two despite being a smaller lever, because it is the longest pole. CA01 cannot be enforced until the device baseline is corrected." }
      ]},
      { id: "phases", h: "3 · Phase Breakdown & Scope", blocks: [
        { t: "table", head: ["Phase", "Window", "Investment"], rows: "SOWPHASES" },
        { t: "p", v: "Phase 1 is unpriced — the client runs it using the runbooks supplied in the pillar reports. Phase 7 is the only recurring line. Any phase may be removed from scope; the finding it closes then remains on the register as an accepted risk against a named internal owner." },
        { t: "kv", rows: [["Phases in scope", "7 of 7"], ["Professional services total", "$252,800"], ["Recurring monitoring", "$4,800 / month"], ["Readiness delivered", "+44 points"], ["Funded by licence recovery", "yes"]] }
      ]},
      { id: "telemetry", h: "4 · Statement of Work Telemetry", blocks: [
        { t: "kv", rows: [["Findings in scope", "24 of 24 traceable"], ["Objective target", "75% Copilot deployment gate"], ["Elapsed time", "12 weeks"], ["Critical path duration", "8 weeks · labelling"], ["Change window status", "0 of 6 booked"], ["Evidence cadence", "weekly re-measure, phase-close scan"]] },
        { t: "callout", tone: "warn", v: "Change windows are the only variable that can extend the twelve weeks. At ten working days each they should be booked in one pass at signature rather than phase by phase." }
      ]},
      { id: "commercial", h: "5 · Commercial Terms", blocks: [
        { t: "kv", rows: [["Professional services", "$252,800"], ["Copilot pilot licences · 400 seats", "$144,000"], ["Licence recovery, year one", "$1,010,000"], ["New budget required", "$0"], ["Net year-one position", "+$613,200"], ["Payment terms", "on phase completion against written acceptance criteria"], ["Termination", "30 days for convenience"], ["MSA change record", "to be signed before Phase 3 begins"]] },
        { t: "callout", tone: "good", v: "This is a reallocation rather than a budget request. The licence recovery covers the professional services and the pilot licences with $613,200 returned in year one." }
      ]},
      { id: "gate", h: "6 · Governance Gate Status", blocks: [
        { t: "callout", tone: "bad", v: "Copilot Gate — BLOCKED. Readiness 34% against a 75% requirement. Three findings block the gate outright; two gate the success of the pilot rather than its safety." },
        { t: "kv", rows: [["F-GOV-1 · Org-wide and EEEU sharing", "BLOCKING · closed by Phase 2"], ["F-SEC-1 · DLP scope gap", "BLOCKING · closed by Phase 3"], ["F-CMP-1 · Unlabelled regulated content", "BLOCKING · closed by Phase 4"], ["F-HLT-1 · Device baseline drift", "GATING · closed by Phase 5"], ["F-ADO-2 · No champion network", "GATING · closed by Phase 6"], ["Licensing findings", "NON-BLOCKING · fund the programme"]] },
        { t: "p", v: "Removing a phase from scope does not remove its blocker. The gate percentage recalculates and the finding remains open on the register with the client named as owner." }
      ]},
      { id: "sections", h: "7 · Section-by-Section Deliverable Summary", blocks: [
        { t: "kv", rows: [["1 · Scope & Objective", "24 findings in · gate at 75% defined"], ["2 · Approach & Sequence", "6 phases · 12-week critical path agreed"], ["3 · Phase Breakdown", "scope, price and readiness agreed per phase"], ["4 · SOW Telemetry", "every figure sourced and re-derivable"], ["5 · Commercial Terms", "$0 new budget · funded from recovery"], ["6 · Gate Status", "3 blockers, each mapped to a phase"]] },
        { t: "p", v: "Each section stands alone. Sections five and six are written to be taken to an approver or a change board without the remainder of the document." }
      ]},
      { id: "register", h: "8 · Findings by Pillar (Carried Into Scope)", blocks: [
        { t: "table", head: ["Finding", "Pillar", "Phase"], rows: "SOWFINDINGS" },
        { t: "p", v: "Every finding retains the identifier it was given in its pillar report, so the audit trail from assessment to change record to closure is unbroken. Findings are closed at completion, not phases." }
      ]}
    ]
  },
  governance: {
    pillar: "Governance", color: "#3B82F6", accent: "#c4b5fd",
    title: "Microsoft 365 Governance Posture Report",
    sub: "Northline Health · tenant scan 01 Aug 2026 · read-only, Graph + SharePoint admin + Purview",
    meta: [["Governance maturity", "34 / 100"], ["Sites inventoried", "1,204"], ["Overshared", "41"], ["Files reachable", "214,806"]],
    sections: [
      { id: "posture", h: "1 · Governance Posture Summary", blocks: [
        { t: "p", v: "This document defines your tenant's governance posture, identifies every governance gap blocking Copilot readiness, and traces each finding directly to telemetry already surfaced in your assessment." },
        { t: "kv", rows: [["Governance maturity score", "34 / 100"], ["Policy coverage · labels", "78% of PHI containers"], ["Policy coverage · DLP", "62% of egress paths"], ["Policy coverage · retention", "12 labels, unevenly applied"], ["Policy coverage · lifecycle", "none published"], ["Admin role discipline", "18 standing global admins, target 5"], ["Conditional Access baseline", "42 policies, no Copilot session policy"], ["Governance drift indicators", "47 settings outside change control"]] },
        { t: "callout", tone: "bad", v: "Maturity is 34 of 100. The estate is inventoried and largely unmanaged: policies exist, ownership does not, and nothing detects when the tenant moves away from baseline." }
      ]},
      { id: "exposure", h: "2 · Exposure & Oversharing Risks", blocks: [
        { t: "table", head: ["Site", "Grant", "Files", "Sensitivity"], rows: "SP" },
        { t: "kv", rows: [["Org-wide links live", "41 sites"], ["Anonymous “Anyone” links", "23, no expiry"], ["Overshared SharePoint sites", "41 of 1,204"], ["Public Teams channels", "17"], ["Unmanaged guest identities", "612 across 48 domains"], ["Unlabeled content visible to Copilot", "40,480 files"], ["High-risk categories exposed", "PII 18,204 · PHI 9,860 · financial 12,416"]] },
        { t: "callout", tone: "bad", v: "214,806 files are reachable by 1,876 accounts through org-wide or EEEU grants. Copilot honours those permissions exactly as written." }
      ]},
      { id: "framework", h: "3 · Governance Framework Alignment", blocks: [
        { t: "kv", rows: [["Naming conventions", "no enforced taxonomy · 3 competing patterns"], ["Sensitivity label strategy", "published, not applied at provisioning"], ["Retention and records coverage", "12 labels · Copilot history out of scope"], ["Lifecycle · Teams", "no expiry policy · 94 orphaned channels"], ["Lifecycle · SharePoint", "reviews 40 days overdue"], ["Lifecycle · OneDrive", "no leaver retention rule"], ["Privileged access strategy", "no PIM · 14 roles assigned outside it"], ["Role-based access control", "62% group-assigned, 38% direct"]] },
        { t: "p", v: "A framework exists on paper for labels and retention. It does not exist at all for naming, lifecycle or privileged access, which is why drift accumulates without anybody breaching a rule." }
      ]},
      { id: "drift", h: "4 · Drift & Violations", blocks: [
        { t: "table", head: ["Team", "Grant", "Files", "Sensitivity"], rows: "TEAMS" },
        { t: "kv", rows: [["Library configuration drift", "47 settings in 90 days"], ["Policy compliance drift", "19 libraries off label policy"], ["Conditional Access drift", "baseline held · no deviation"], ["Lifecycle violations · inactive sites", "312 with no activity in 180 days"], ["Lifecycle violations · orphaned channels", "94"], ["Naming convention violations", "1,164 of 1,204 sites"]] },
        { t: "callout", tone: "warn", v: "Drift is detected by hand, quarterly. In practice that means it is detected when something breaks — there is no alert on a new org-wide link, a new anonymous link or a rising guest count." }
      ]},
      { id: "automation", h: "5 · Governance Automation Readiness", blocks: [
        { t: "kv", rows: [["Eligible for automated remediation", "link expiry · guest attestation · label defaults"], ["Requires change control approval", "sharing ceiling · CA01 · retention extension"], ["SIA dependencies", "CA01 enforcement · endpoint DLP deployment"], ["RBD conflicts", "Part 2 segregation vs. clinical access convenience"], ["Governance owner sign-off", "not assigned — blocker to automation"]] },
        { t: "p", v: "Three of the six remediation actions can be automated today. The rest need a change record and, in two cases, a security impact assessment. None of them needs new tooling." }
      ]},
      { id: "readiness", h: "6 · Copilot Readiness Impact", blocks: [
        { t: "ai", v: "Prompt run against Flight Ops – Mission Docs: “Summarise what this site contains.” Copilot returned 41,208 citable files and produced an accurate operational summary including unlabelled mission documentation. It did not need elevated rights." },
        { t: "ai", v: "Prompt run against Contracts & Legal: “What are our termination terms with Aerostruct?” Copilot quoted the executed MSA verbatim with a citation. The library is EEEU, so any employee receives the same answer." },
        { t: "kv", rows: [["Governance blockers preventing activation", "2 · org-wide sharing, unlabelled content"], ["Groundable content that is unlabeled", "40,480 files"], ["Groundable content that is overshared", "214,806 files"], ["Gaps affecting Copilot accuracy", "3.4 duplicate versions per active document"], ["Readiness impact from governance", "−17 pts"], ["Actions required to clear the gate", "close org-wide sharing · label the backlog · assign owners"]] },
        { t: "steps", rows: "PATH" }
      ]},
      { id: "fix", h: "7 · Self-Resolution Actions", blocks: [
        { t: "howto", title: "Enforce naming conventions safely", steps: [
          "Publish one taxonomy and apply it to new sites only — never rename an existing site collection URL.",
          "Add the naming policy to the provisioning flow so compliance is automatic rather than audited.",
          "Report the compliance rate monthly and let the legacy estate age out rather than forcing a migration.",
          "Reserve renaming for sites being remediated anyway, so the change is absorbed by other work."
        ], effort: "2 weeks · low risk · owner: platform" },
        { t: "howto", title: "Apply sensitivity labels at scale", steps: [
          "Promote the three PHI classifiers out of simulation after sampling 500 matches for false positives.",
          "Enable default labels at site provisioning so the backlog stops growing while you clear it.",
          "Run auto-labelling across the 22% unlabelled content, starting with clinical and billing libraries.",
          "Leave label-based encryption off until the taxonomy has been live for a full cycle."
        ], effort: "4 weeks · medium risk · owner: compliance" },
        { t: "howto", title: "Correct admin role assignments", steps: [
          "List standing privileged assignments: Get-MgRoleManagementDirectoryRoleAssignment -All.",
          "Reduce standing global administrators to five with a named business justification each.",
          "Move the remaining thirteen to PIM-eligible with approval and an eight-hour maximum activation.",
          "Exclude two break-glass accounts from PIM and store their credentials offline."
        ], effort: "2 weeks · medium risk · owner: identity" },
        { t: "howto", title: "Re-align the Conditional Access baseline", steps: [
          "Export the policy estate and compare against the Microsoft baseline recommendations.",
          "Create CA01 for the Copilot app in report-only, with break-glass accounts excluded.",
          "Read two weeks of sign-in logs before enforcing, and fix the device baseline first.",
          "Promote the sign-in risk policy from report-only to enforce in the same window."
        ], effort: "1 change window · high risk if enforced early · owner: identity" },
        { t: "howto", title: "Clean up oversharing and permission sprawl", steps: [
          "Set the org-level default link type to Specific people and enable 30-day link expiry.",
          "Replace each of the 41 org-wide grants with a scoped security group, staged site by site.",
          "Restore inheritance only where the parent is equal to or narrower than the child — never in bulk.",
          "Assign an owner to every site and make owner attestation a condition of continued sharing."
        ], effort: "4 weeks · medium risk · owner: SharePoint admin" },
        { t: "howto", title: "Implement lifecycle policies consistently", steps: [
          "Publish a Teams expiry policy with owner renewal at 180 days of inactivity.",
          "Archive the 94 orphaned channels rather than deleting them so content survives the cleanup.",
          "Add a leaver rule that transfers OneDrive ownership before the account is removed.",
          "Schedule the site activity report monthly and route it to the site owner, not to IT."
        ], effort: "3 weeks · low risk · owner: platform" }
      ]},
      { id: "exec", h: "8 · Executive Summary", blocks: [
        { t: "callout", tone: "good", v: "Your governance posture is the backbone of your Microsoft 365 environment. It determines how safely Copilot can operate, how predictably your data behaves, and how effectively your security and compliance controls function. Correcting these governance gaps increases readiness, reduces exposure, and restores control." },
        { t: "kv", rows: [["Governance maturity", "34 → 89"], ["Files reachable tenant-wide", "214,806 → 18,240"], ["Regulated files unlabelled", "40,480 → 1,120"], ["Readiness contribution", "+30 pts"], ["Elapsed to corrected posture", "6 weeks"]] }
      ]}
    ]
  },
  licensing: {
    pillar: "Licensing", color: "#14B8A6", accent: "#5eead4",
    title: "Copilot Licensing Alignment Report",
    sub: "Northline Health · tenant scan 01 Aug 2026 · read-only, Graph subscribedSkus + M365 usage reports",
    meta: [["Seats provisioned", "6,180"], ["Paid, unassigned", "1,308"], ["Copilot seats", "25 / 2"], ["Annual waste", "$847,608"]],
    sections: [
      { id: "posture", h: "1 · Licensing Posture Summary", blocks: [
        { t: "p", v: "This document identifies every licensing misalignment preventing Copilot from being deployed safely, consistently and cost-effectively. Every finding traces directly to your tenant telemetry." },
        { t: "table", head: ["User", "Holds", "Should hold", "Monthly delta"], rows: "MISMATCH" },
        { t: "kv", rows: [["Users with incorrect SKUs", "760"], ["Assigned Copilot who do not need it", "3 of 25"], ["Need Copilot but unlicensed", "1,535 eligible"], ["Seat drift across business units", "38% assigned directly"], ["Monthly cost waste from misalignment", "$70,634"]] },
        { t: "callout", tone: "bad", v: "$847,608 a year is spent on seats nobody holds. Twenty-five Copilot licences are owned and two are assigned. The money required to fund the entire remediation programme is already inside your existing bill." }
      ]},
      { id: "eligibility", h: "2 · Eligibility & Coverage Gaps", blocks: [
        { t: "table", head: ["User", "Holds", "Should hold", "Monthly delta"], rows: "NEED" },
        { t: "kv", rows: [["Copilot-eligible, missing base licence", "148"], ["Copilot-ineligible on premium SKUs", "612"], ["Workloads blocked by missing prerequisites", "3 · Teams Premium, Purview, Entra P2"], ["Personas needing Copilot but unlicensed", "4 cohorts · 1,535 seats"]] },
        { t: "p", v: "Eligibility is not the same as entitlement. A user can hold every prerequisite and still be ineligible because the content boundary they work in is unlabelled — that gate is governance, not licensing." }
      ]},
      { id: "drift", h: "3 · Seat Drift Analysis", blocks: [
        { t: "kv", rows: [["Licences outside role-based patterns", "1,940 direct grants"], ["Inherited from legacy groups or templates", "612 · E5 security programme"], ["Over-provisioning from group drift", "888 E5, 220 E3, 65 F3"], ["Under-provisioning from manual error", "148 users"], ["Licensed accounts, departed staff", "47"], ["No interactive sign-in in 90 days", "231"]] },
        { t: "callout", tone: "warn", v: "Drift is not a one-time cleanup problem. Thirty-eight percent of seats are assigned directly rather than by group, which means every joiner, mover and leaver is a manual step somebody can miss." }
      ]},
      { id: "waste", h: "4 · Cost Waste Summary", blocks: [
        { t: "table", head: ["User", "Holds", "Should hold", "Monthly delta"], rows: "OVER" },
        { t: "kv", rows: [["Monthly waste · unused Copilot seats", "$690"], ["Monthly waste · premium SKUs misassigned", "$50,616"], ["Monthly waste · unassigned seats", "$70,634"], ["Savings from normalization", "$847,608 / yr"], ["Savings from duplicate tooling", "$142,000 / yr"], ["Net year-one impact after remediation", "+$613,200"]] },
        { t: "callout", tone: "good", v: "Right-sizing alone funds the Copilot pilot four times over. This is a reallocation conversation, not a budget request." }
      ]},
      { id: "readiness", h: "5 · Copilot Readiness Impact", blocks: [
        { t: "kv", rows: [["Licensing blockers preventing activation", "0 — licensing does not block"], ["Personas unable to use Copilot on SKU gaps", "148 users"], ["Workflows blocked until licensing corrected", "2 of 4"], ["Readiness impact from misalignment", "−7 pts"], ["Readiness with licensing corrected", "41%"]] },
        { t: "p", v: "Licensing is the one pillar that does not block the gate. It gates value rather than safety: the seats exist, the money exists, and correcting the position is what pays for the pillars that do block." }
      ]},
      { id: "fix", h: "6 · Self-Resolution Actions", blocks: [
        { t: "howto", title: "Normalize SKUs across departments", steps: [
          "Pull ninety days of workload telemetry: Get-MgReportOffice365ActiveUserDetail -Period D90 for every licensed account.",
          "Classify each user against the four real profiles in this tenant — frontline (F3), knowledge worker (E3), regulated worker (E5), Copilot candidate.",
          "Move the five mismatched users named in section 1 first; they are unambiguous and prove the method before you scale it.",
          "Re-run the classification quarterly and treat any changed profile as a licence review rather than a ticket."
        ], effort: "2 weeks · low risk · owner: licensing" },
        { t: "howto", title: "Remove unused Copilot licenses safely", steps: [
          "Identify Copilot holders with zero sessions in ninety days from the Copilot usage report.",
          "Confirm with each holder's manager before reclaiming — a dormant seat is not always an unwanted one.",
          "Hold back any seat whose owner works in an unlabelled content boundary; that is a governance decision, not a licensing one.",
          "Return the reclaimed seats to the pilot pool rather than to the subscription until the pilot cohort is final."
        ], effort: "1 week · low risk · owner: licensing" },
        { t: "howto", title: "Assign Copilot correctly by persona readiness", steps: [
          "Score every cohort on content readiness, device compliance and workload fit before assigning a seat.",
          "Start with revenue cycle — 310 seats, labelled content, measurable outcome.",
          "Create a Copilot-eligible security group with membership rules and assign the licence to the group.",
          "Gate group membership on two conditions: labelled content boundary and device inside the compliance baseline."
        ], effort: "1 week · low risk · owner: licensing + platform" },
        { t: "howto", title: "Prevent seat drift going forward", steps: [
          "Move all licence assignment to group-based licensing and retire the 38% of direct assignments.",
          "Wire licence removal to the HR termination event, not to ticket closure.",
          "Alert when purchased-minus-assigned exceeds 5% for any SKU so waste surfaces in weeks rather than at renewal.",
          "Reduce the purchased count at renewal — removing an assignment alone changes nothing on the invoice."
        ], effort: "3 weeks to set up · owner: licensing" },
        { t: "howto", title: "Implement role-based licensing at scale", steps: [
          "Define the four role profiles formally, with the SKU and the entitlement each one carries.",
          "Build dynamic group membership rules from HR attributes rather than manual membership.",
          "Publish the profile catalogue so managers request a role, not a licence.",
          "Review the profile definitions annually against what Microsoft has moved between SKUs."
        ], effort: "4 weeks · owner: licensing + HR systems" }
      ]},
      { id: "exec", h: "7 · Executive Summary", blocks: [
        { t: "callout", tone: "good", v: "Your licensing posture directly affects Copilot readiness, monthly cost efficiency and workflow enablement. Correcting these gaps improves readiness, reduces waste, and ensures Copilot is deployed only where it delivers measurable value." },
        { t: "kv", rows: [["Recoverable in year one", "$1,010,000"], ["Cost of the 400-seat pilot", "$144,000"], ["New budget required", "$0"], ["Readiness contribution", "+7 pts"], ["Elapsed to corrected position", "3 weeks"]] }
      ]}
    ]
  },
  adoption: {
    pillar: "Adoption", color: "#F97316", accent: "#FDBA74",
    title: "Copilot Adoption & Workflow Readiness Report",
    sub: "Northline Health · tenant scan 01 Aug 2026 · read-only, M365 usage reports + Teams analytics",
    meta: [["Adoption readiness", "54 / 100"], ["Daily active users", "1,631"], ["Meetings transcribed", "22%"], ["Named champions", "0"]],
    sections: [
      { id: "posture", h: "1 · Adoption Posture Summary", blocks: [
        { t: "p", v: "This document evaluates how ready your people, workflows and collaboration patterns are to benefit from Copilot. Every finding traces directly to persona telemetry, workflow alignment signals and Teams usage data surfaced in your assessment." },
        { t: "kv", rows: [["Adoption readiness score", "54 / 100"], ["Personas ready", "1 of 4 · compliance officers"], ["Personas needing training", "2 of 4 · nurse managers, revenue cycle"], ["Personas not ready", "1 of 4 · attending clinicians"], ["Workflow alignment score", "48 / 100"], ["Teams usage maturity", "88% active · chat-dominant"], ["Collaboration pattern risk", "64% of files shared in chat, not libraries"]] },
        { t: "callout", tone: "warn", v: "The usage base is strong and the scaffolding is absent. 87% of seats touch Teams every day, and there is no champion network, no role-based enablement and no adoption measurement of any kind." }
      ]},
      { id: "personas", h: "2 · Persona Readiness Analysis", blocks: [
        { t: "table", head: ["Persona", "State", "Why"], rows: "INV:adoption.personas" },
        { t: "kv", rows: [["Fully ready", "Compliance officers · 40 seats"], ["Partially ready, workflow-blocked", "Revenue cycle · 310 seats"], ["Partially ready, training-blocked", "Nurse managers · 480 seats"], ["Not ready", "Attending clinicians · 2,140 seats · PHI boundary unlabelled"], ["Highest-value workflows, unlicensed", "Clinicians · 3.5 hrs/wk documentation"]] },
        { t: "p", v: "The largest cohort is the least ready, because clinicians work inside the PHI boundary that has not been labelled. Pilot selection by volunteer would pick precisely the wrong population." }
      ]},
      { id: "workflows", h: "3 · Workflow Alignment Assessment", blocks: [
        { t: "table", head: ["Workflow", "Return", "Detail"], rows: "INV:adoption.flows" },
        { t: "kv", rows: [["Improvable immediately", "Meeting recap · once transcription is on"], ["Improvable after modernization", "Document drafting · needs labelled sources"], ["Requires training or process change", "Prior-work retrieval · needs library discipline"], ["Cross-department inconsistency", "4 different handover formats across clinics"], ["Automation-eligible but adoption-blocked", "Ticket deflection · 136 a week"]] },
        { t: "callout", tone: "bad", v: "The highest-return workflow depends on labelled content, so adoption is gated by governance rather than by training. Enablement started before governance closes produces a bad first experience." }
      ]},
      { id: "teams", h: "4 · Collaboration & Teams Usage", blocks: [
        { t: "table", head: ["Signal", "Value", "Reading"], rows: "INV:adoption.teams" },
        { t: "kv", rows: [["Teams usage · clinical", "91%"], ["Teams usage · revenue cycle", "84%"], ["Teams usage · compliance", "96%"], ["Channels vs chats vs meetings", "22% · 64% · 14%"], ["File collaboration maturity", "29% in owned libraries"], ["Shadow collaboration", "email-only workflows in 3 departments"], ["Duplicate versions per active document", "3.4"]] },
        { t: "callout", tone: "bad", v: "Only 22% of meetings are transcribed, and transcription is off by default at tenant level. Without a transcript there is nothing for Copilot to recap, which gates the highest-frequency use case in the tenant." }
      ]},
      { id: "gaps", h: "5 · Training & Enablement Gaps", blocks: [
        { t: "table", head: ["Gap", "State", "Detail"], rows: "INV:adoption.gaps" },
        { t: "kv", rows: [["Need Copilot fundamentals", "4 cohorts · 2,970 seats"], ["Need workflow modernization training", "2 cohorts · 790 seats"], ["Departments with no enablement", "clinical, nursing, revenue cycle"], ["Recommended sequence", "revenue cycle → nursing → clinical → compliance"], ["Training impact on readiness", "+8 pts"], ["Champions required", "38 · one per fifty seats"]] },
        { t: "p", v: "One generic enablement deck currently serves four very different roles. A pilot launched on that basis typically decays to under 20% active by week six." }
      ]},
      { id: "readiness", h: "6 · Copilot Readiness Impact", blocks: [
        { t: "kv", rows: [["Adoption blockers preventing activation", "0 — adoption gates value, not safety"], ["Personas unable to benefit on workflow gaps", "2,140 clinicians"], ["Workflows Copilot cannot ground on", "meeting recap · 78% untranscribed"], ["Readiness impact from adoption posture", "−8 pts"], ["Actions required to clear the gate", "transcription on · 38 champions · 4 role tracks"]] },
        { t: "callout", tone: "warn", v: "Adoption is the only pillar that does not block enablement and the one most likely to make it fail. Buying seats is not the same as landing them." }
      ]},
      { id: "fix", h: "7 · Self-Resolution Actions", blocks: [
        { t: "howto", title: "Increase Teams usage safely and consistently", steps: [
          "Turn transcription on by default with a clear notice, and let users opt out rather than opt in.",
          "Apply a retention label to recordings so recaps remain available through the pilot window.",
          "Ask the top thirty meeting organisers to add agendas — it measurably improves recap quality.",
          "Report transcription rate weekly to the same group that receives the readiness score."
        ], effort: "1 week · low risk · owner: collaboration" },
        { t: "howto", title: "Modernize workflows for Copilot alignment", steps: [
          "Declare one authoritative library per team and move the recurring documents into it.",
          "Turn off file attachment in chat for the pilot cohort — share links instead.",
          "Assign owners to the top hundred documents by access volume.",
          "Standardise the four competing handover formats into one before enabling recap."
        ], effort: "4 weeks · medium risk · owner: platform + team leads" },
        { t: "howto", title: "Train personas on Copilot fundamentals", steps: [
          "Build four ninety-minute role tracks grounded in each role's real workflow.",
          "Publish a prompt library of twenty prompts per role before day one.",
          "Run the revenue-cycle track first and use its results to tune the other three.",
          "Record every session so joiners are enabled without scheduling a repeat."
        ], effort: "6 weeks · low risk · owner: enablement" },
        { t: "howto", title: "Eliminate shadow collaboration patterns", steps: [
          "Identify email-only workflows from the mail-flow report and name an owner for each.",
          "Move the three worst offenders into channels with a documented format.",
          "Set an expectation that attachments are replaced by links inside the pilot cohort.",
          "Review the pattern monthly rather than mandating a policy nobody enforces."
        ], effort: "3 weeks · low risk · owner: team leads" },
        { t: "howto", title: "Run monthly adoption reviews", steps: [
          "Capture the baseline this month, before any seat is assigned.",
          "Report week-three retention and hours returned, not licence count or day-one logins.",
          "Name an adoption owner with the same standing as the security owner.",
          "Review the champion network's escalations at the same meeting."
        ], effort: "1 week to set up · owner: adoption owner" }
      ]},
      { id: "exec", h: "8 · Executive Summary", blocks: [
        { t: "callout", tone: "good", v: "Copilot only delivers value when people use it. Adoption determines whether Copilot succeeds or fails. Modern workflows, consistent Teams usage and persona readiness are essential prerequisites. Correcting these adoption gaps increases readiness, accelerates value, and ensures Copilot improves the work your people actually do." },
        { t: "kv", rows: [["Adoption readiness", "54 → 86"], ["Meetings transcribed", "22% → 85%"], ["Named champions", "0 → 38"], ["Hours returned weekly", "0 → 1,140"], ["Readiness contribution", "+8 pts"]] }
      ]}
    ]
  },
  compliance: {
    pillar: "Compliance", color: "#F3F4F6", accent: "#c4b5fd",
    title: "Microsoft 365 Compliance & Regulatory Alignment Report",
    sub: "Northline Health · tenant scan 01 Aug 2026 · read-only, Purview + audit log + policy estate",
    meta: [["Compliance maturity", "38 / 100"], ["Regulated files unlabelled", "40,480"], ["Audit retention", "180 days"], ["Regimes in scope", "4"]],
    sections: [
      { id: "posture", h: "1 · Compliance Posture Summary", blocks: [
        { t: "p", v: "This document evaluates your tenant's compliance posture across regulatory, retention, labeling, auditing and lifecycle controls. Every finding traces directly to compliance telemetry surfaced in your assessment and directly affects Copilot readiness." },
        { t: "kv", rows: [["Compliance maturity score", "38 / 100"], ["HIPAA / HITECH", "partial · PHI reachable unlabelled"], ["42 CFR Part 2", "at risk · SUD records not segregated"], ["State breach law", "partial · 72-hour clock, manual detection"], ["Joint Commission", "met · documentation current"], ["Retention alignment", "12 labels · Copilot history out of scope"], ["Records management posture", "no formal records schedule"], ["Compliance drift indicators", "19 libraries off label policy"]] },
        { t: "callout", tone: "bad", v: "Maturity is 38 of 100. Containment is asserted rather than provable: 40,480 regulated files carry no label, and Copilot prompts are evaluated by no DLP policy at all." }
      ]},
      { id: "regulatory", h: "2 · Regulatory Alignment Assessment", blocks: [
        { t: "kv", rows: [["Required controls missing", "AI-use control · Part 2 segregation · Copilot retention"], ["Retention gaps on regulated content", "audit 180 days against a 7-year obligation"], ["Labeling gaps by category", "PHI 22% · financial 29% · contractual 12%"], ["Audit log coverage", "Exchange, SharePoint, Entra covered · Copilot not"], ["Blocked for Copilot on regulatory grounds", "42 CFR Part 2 records · unsegregated"]] },
        { t: "callout", tone: "bad", v: "A PHI disclosure in a generated answer is reportable under MSA §7.4. That converts a technical issue into a legal one, and it is the reason a tenant-wide enablement cannot be defended today." }
      ]},
      { id: "lifecycle", h: "3 · Data Lifecycle & Records Management", blocks: [
        { t: "kv", rows: [["Retention policies applied", "12 of an estimated 19 required"], ["Inactive sites violating lifecycle", "312 with no activity in 180 days"], ["Orphaned channels", "94"], ["Records management coverage", "clinical partial · finance none · legal complete"], ["Auto-classification gaps", "3 PHI classifiers in simulation"], ["Lifecycle inconsistencies affecting grounding", "3.4 duplicate versions per active document"]] },
        { t: "p", v: "Copilot grounds on whichever copy it can reach. Without a lifecycle rule, the authoritative version and three superseded ones are equally citable." }
      ]},
      { id: "labeling", h: "4 · Sensitivity & Labeling Compliance", blocks: [
        { t: "kv", rows: [["Sensitive data stored without a label", "40,480 files"], ["Regulated categories not covered by DLP", "Teams chat · Copilot prompts · endpoint"], ["Label inheritance gaps", "not applied at site provisioning"], ["Label drift", "19 libraries with manual overrides"], ["Copilot exposure to unlabeled regulated content", "40,480 files reachable"]] },
        { t: "callout", tone: "warn", v: "Labels are what make containment provable. Without them a grounded answer inherits no classification, so there is no way to demonstrate to a regulator that PHI could not surface." }
      ]},
      { id: "drift", h: "5 · Compliance Drift & Violations", blocks: [
        { t: "kv", rows: [["Retention policy drift", "Copilot chat history outside the scheme"], ["Labeling drift", "19 libraries inconsistent"], ["DLP drift", "3 rules in simulation · 2 policy sets unscoped"], ["Audit log gaps", "Copilot interactions not logged as a workload"], ["Lifecycle violations", "312 inactive sites · 94 orphaned channels"], ["Legal hold coverage", "41% · applied manually"]] },
        { t: "p", v: "Drift here is not deliberate. Every one of these is a control that was configured once, scoped to a pilot, and never widened as the estate grew around it." }
      ]},
      { id: "readiness", h: "6 · Copilot Readiness Impact", blocks: [
        { t: "kv", rows: [["Compliance blockers preventing activation", "2 · unlabelled regulated content, no DLP over Copilot"], ["Regulated content unsafe to ground on", "40,480 files"], ["Gaps affecting accuracy and safety", "no classification warning on any generated answer"], ["Readiness impact from compliance posture", "−12 pts"], ["Actions required to clear the gate", "label the backlog · DLP over Copilot · retain chat history"]] },
        { t: "callout", tone: "bad", v: "Provable containment is the standard, not best-effort assurance. Today the tenant cannot prove it, which makes a scoped pilot inside a labelled boundary the only defensible position." }
      ]},
      { id: "fix", h: "7 · Self-Resolution Actions", blocks: [
        { t: "howto", title: "Align retention with regulatory requirements", steps: [
          "Map each regime's retention obligation against the labels currently published.",
          "Extend audit retention to match the longest obligation the tenant carries.",
          "Bring Copilot interactions into the retention scheme before the pilot starts.",
          "Automate legal hold from the matter record rather than from a ticket."
        ], effort: "3 weeks · low risk · owner: compliance" },
        { t: "howto", title: "Apply sensitivity labels consistently", steps: [
          "Sample 500 classifier matches and measure the false-positive rate before promoting anything.",
          "Enable default labels at site provisioning so the backlog stops growing while you clear it.",
          "Auto-label clinical and billing libraries first — that is where the reportable exposure lives.",
          "Leave label-based encryption off until the taxonomy has been stable for a full cycle."
        ], effort: "4 weeks · medium risk · owner: compliance" },
        { t: "howto", title: "Correct DLP coverage gaps", steps: [
          "Extend the two unscoped policy sets to finance and legal rather than authoring new ones.",
          "Add Copilot as a DLP location so prompts and responses are evaluated like any other egress.",
          "Promote the three simulation rules to enforce in the next change window.",
          "Deploy endpoint DLP to the pilot cohort as a condition of entry."
        ], effort: "2 weeks · medium risk · owner: security + compliance" },
        { t: "howto", title: "Restore audit log completeness", steps: [
          "Confirm every workload is emitting to the unified audit log, Copilot included.",
          "Extend retention beyond 180 days for the workloads carrying regulated content.",
          "Write a search-and-export runbook so an evidence pack takes hours rather than weeks.",
          "Test the export quarterly against a simulated regulator request."
        ], effort: "2 weeks · low risk · owner: compliance" },
        { t: "howto", title: "Enforce lifecycle policies for regulated content", steps: [
          "Publish a records schedule that names the retention period for each regulated class.",
          "Segregate 42 CFR Part 2 records into a labelled boundary excluded from Copilot grounding.",
          "Archive the 94 orphaned channels rather than deleting them so content survives the cleanup.",
          "Add an inactivity review at 180 days routed to the site owner, not to IT."
        ], effort: "4 weeks · medium risk · owner: compliance + platform" },
        { t: "howto", title: "Run quarterly compliance posture reviews", steps: [
          "Re-run the scan at each quarter close and attach the delta to the evidence pack.",
          "Rehearse the AI-disclosure breach scenario against the 72-hour clock.",
          "Report the position to the board alongside the readiness score.",
          "Record every control test as evidence rather than as a status update."
        ], effort: "1 week to set up · owner: compliance owner" }
      ]},
      { id: "exec", h: "8 · Executive Summary", blocks: [
        { t: "callout", tone: "good", v: "Compliance determines whether Copilot can legally operate in your environment. Retention, labeling, DLP and lifecycle controls must be aligned before Copilot can be deployed safely. Correcting these compliance gaps increases readiness, reduces regulatory risk, and ensures Copilot operates within your legal and governance boundaries." },
        { t: "kv", rows: [["Compliance maturity", "38 → 84"], ["Regulated files unlabelled", "40,480 → 1,120"], ["Copilot prompt coverage", "0% → 100%"], ["Provable containment", "no → yes"], ["Readiness contribution", "+12 pts"]] }
      ]}
    ]
  },
  health: {
    pillar: "Tenant Health", color: "#22C55E", accent: "#4ADE80",
    title: "Microsoft 365 Operational Health & Service Integrity Report",
    sub: "Northline Health · tenant scan 01 Aug 2026 · read-only, Intune + service health + ticket queue",
    meta: [["Operational health", "58 / 100"], ["Endpoints off baseline", "312"], ["Tickets per week", "340"], ["SLA compliance", "99%"]],
    sections: [
      { id: "posture", h: "1 · Health Posture Summary", blocks: [
        { t: "p", v: "This document evaluates the operational health of your Microsoft 365 tenant across service availability, configuration correctness, workload stability and platform hygiene. Every finding traces directly to Health Engine telemetry surfaced in your assessment." },
        { t: "kv", rows: [["Operational health score", "58 / 100"], ["Exchange Online", "stable · no advisories"], ["SharePoint Online", "stable · storage at 61%"], ["Teams", "stable · transcription disabled by policy"], ["OneDrive", "stable · 94 sync errors open"], ["Service availability, 30 days", "99.98%"], ["Configuration correctness", "312 endpoints off baseline · 47 settings drifted"], ["Health trend", "degrading · ticket aging climbing"]] },
        { t: "callout", tone: "warn", v: "The platform itself is healthy. What is degrading is the configuration around it — 312 endpoints outside baseline, 47 settings changed outside change control, and no automated remediation anywhere." }
      ]},
      { id: "availability", h: "2 · Service Availability & Reliability", blocks: [
        { t: "table", head: ["Signal", "Value", "Reading"], rows: "INV:health.service" },
        { t: "kv", rows: [["Exchange Online", "healthy · 0 advisories in 30 days"], ["SharePoint Online", "healthy · 1 degradation, 42 minutes"], ["Teams · meetings, chat, channels", "healthy · 0 advisories"], ["OneDrive", "healthy · sync errors are client-side"], ["Outage history, 90 days", "2 Microsoft-side, both resolved"], ["Impact on Copilot readiness", "none — availability is not the constraint"]] },
        { t: "p", v: "Service availability is not a blocker. The constraint is the client estate and the operational capacity around it, not Microsoft's platform." }
      ]},
      { id: "config", h: "3 · Configuration Correctness", blocks: [
        { t: "kv", rows: [["Endpoints outside compliance baseline", "312 · autopilot profile re-scoped"], ["Baseline age", "11 days · re-publish required"], ["Devices in no policy group", "94"], ["Conditional Access misalignment", "no Copilot session policy"], ["Authentication configuration", "MFA 96% · legacy auth blocked"], ["Identity configuration gaps", "18 standing global admins · 14 roles outside PIM"], ["Configuration drift", "47 settings in 90 days"]] },
        { t: "callout", tone: "bad", v: "Enforcing the Copilot device-compliance policy today would block one user in six. The baseline has to be corrected before conditional access is tightened, not after." }
      ]},
      { id: "hygiene", h: "4 · Tenant Hygiene & Operational Cleanliness", blocks: [
        { t: "kv", rows: [["Orphaned sites", "312 with no activity in 180 days"], ["Orphaned channels", "94"], ["Groups with no owner", "1,164 of 1,204 sites"], ["Storage position", "61% of tenant quota"], ["Sync errors open", "94 · client-side"], ["Duplicate versions per active document", "3.4"], ["Hygiene impact on grounding", "Copilot cannot distinguish the authoritative copy"]] },
        { t: "p", v: "Hygiene is where health and governance meet. Orphaned containers are an operational problem until Copilot is enabled, at which point they become a grounding problem." }
      ]},
      { id: "drift", h: "5 · Health Drift & Violations", blocks: [
        { t: "table", head: ["Signal", "Value", "Reading"], rows: "INV:health.drift" },
        { t: "kv", rows: [["Exchange configuration drift", "3 transport rules outside change control"], ["SharePoint configuration drift", "47 library settings"], ["Teams configuration drift", "transcription policy default off"], ["Policy drift affecting stability", "patch ring 3 two cycles behind"], ["Service-level violations", "none · SLA at 99%"], ["Authentication drift", "none detected · baseline held"], ["Health Engine drift signals", "rising over 90 days"]] },
        { t: "callout", tone: "warn", v: "Drift is detected by hand and quarterly, which in practice means it is detected when something breaks. There is no continuous comparison against the documented baseline." }
      ]},
      { id: "readiness", h: "6 · Copilot Readiness Impact", blocks: [
        { t: "kv", rows: [["Health blockers preventing activation", "0 — health gates enforcement, not enablement"], ["Workloads Copilot cannot rely on", "none · platform is stable"], ["Configuration gaps affecting accuracy", "duplicate versions · no authoritative copy"], ["Devices that would be blocked at enforcement", "312 · one in six"], ["Readiness impact from health posture", "−9 pts"], ["Actions required to clear the gate", "re-publish baseline · automate top 5 alerts · book change windows"]] },
        { t: "callout", tone: "warn", v: "Health does not block Copilot on its own. It decides whether enforcing the security controls locks people out, and whether the support team can absorb a launch." }
      ]},
      { id: "fix", h: "7 · Self-Resolution Actions", blocks: [
        { t: "howto", title: "Correct workload misconfigurations safely", steps: [
          "Re-publish the compliance baseline and re-assign the 94 orphaned device groups.",
          "Bring patch ring 3 current before the pilot cohort is selected.",
          "Exclude the twelve out-of-support devices from the pilot population explicitly.",
          "Re-measure compliance daily during remediation rather than weekly."
        ], effort: "3 weeks · low risk · owner: platform" },
        { t: "howto", title: "Restore baseline settings across services", steps: [
          "Export the current configuration and diff it against the documented baseline.",
          "Bring the 47 drifted settings back inside change control with a recorded justification for any exception.",
          "Turn on continuous drift detection so the comparison is automatic.",
          "Require a rollback plan on every change touching identity or sharing."
        ], effort: "2 weeks · medium risk · owner: platform + change board" },
        { t: "howto", title: "Eliminate operational hygiene issues", steps: [
          "Archive the 94 orphaned channels rather than deleting them so content survives.",
          "Assign an owner to every site and route the inactivity report to them, not to IT.",
          "Resolve the 94 open sync errors — most are a single client version.",
          "Declare one authoritative library per team to remove duplicate versions."
        ], effort: "4 weeks · low risk · owner: platform + team leads" },
        { t: "howto", title: "Reduce service instability and degradation", steps: [
          "Automate the top five recurring alerts — roughly forty after-hours interruptions a week returned.",
          "Publish a Copilot escalation path before day one so issues do not land in the general queue.",
          "Run a restore test this quarter and record the elapsed time as the working RTO.",
          "Book the remediation change windows in one pass so the sequence is not blocked by process."
        ], effort: "4 weeks · low risk · owner: operations" },
        { t: "howto", title: "Run monthly health posture reviews", steps: [
          "Report ticket volume, aging and deflection rate alongside the readiness score.",
          "Review drift signals monthly rather than quarterly.",
          "Re-run the endpoint compliance report at each phase close.",
          "Track after-hours alert volume as the measure of whether automation is working."
        ], effort: "1 week to set up · owner: operations lead" }
      ]},
      { id: "exec", h: "8 · Executive Summary", blocks: [
        { t: "callout", tone: "good", v: "Operational health determines whether Copilot can function reliably. Stable workloads, correct configurations and clean tenant hygiene are prerequisites for Copilot readiness. Correcting these health gaps increases stability, reduces risk, and ensures Copilot can operate consistently across your environment." },
        { t: "kv", rows: [["Operational health", "58 → 88"], ["Endpoints off baseline", "312 → 41"], ["Tickets per week", "340 → 204"], ["Automated runbooks", "0 → 5"], ["Readiness contribution", "+9 pts"]] }
      ]}
    ]
  },
  security: {
    pillar: "Security", color: "#8B5CF6", accent: "#fca5a5",
    title: "Microsoft 365 Security Posture & Blast Radius Report",
    sub: "Northline Health · tenant scan 01 Aug 2026 · read-only, Entra + Defender + Purview + Intune",
    meta: [["Security maturity", "51 / 100"], ["Files one account can reach", "214,806"], ["Standing global admins", "18"], ["Open chain links", "4"]],
    sections: [
      { id: "posture", h: "1 · Security Posture Summary", blocks: [
        { t: "p", v: "This document evaluates your tenant's security posture across identity, access, data protection, device compliance and conditional access. Every finding traces directly to security telemetry surfaced in your assessment and directly affects Copilot readiness." },
        { t: "kv", rows: [["Security maturity score", "51 / 100"], ["Identity hygiene", "MFA 96% · legacy auth blocked"], ["Privileged access discipline", "18 standing global admins · target 5"], ["Conditional Access baseline", "42 policies · no Copilot session policy"], ["Device compliance coverage", "94.2% · 312 endpoints drifted"], ["Defender coverage", "98.4% · 0 open high alerts"], ["Security drift indicators", "14 roles assigned outside PIM"]] },
        { t: "callout", tone: "bad", v: "The identity perimeter is strong and the content estate is not. That distinction matters, because content is exactly what Copilot reads." }
      ]},
      { id: "identity", h: "2 · Identity & Access Risks", blocks: [
        { t: "kv", rows: [["Permanent admin accounts", "18 global administrators"], ["Admin role over-assignment", "14 privileged roles outside PIM"], ["MFA gaps · users", "4% of the estate"], ["MFA gaps · admins", "0% · all privileged accounts covered"], ["Legacy authentication", "blocked tenant-wide · no exclusions"], ["Conditional Access gaps", "CA01 disabled · sign-in risk policy report-only"], ["Risky sign-ins unchallenged", "41 in the last 30 days"], ["OAuth app grants", "94 · reviewed quarterly"]] },
        { t: "callout", tone: "warn", v: "Eighteen accounts can change anything in this tenant permanently, with no elevation step and no time limit. That is four percent of the identity estate holding unrestricted authority." }
      ]},
      { id: "blast", h: "3 · Data Exposure & Blast Radius", blocks: [
        { t: "table", head: ["Site", "Grant", "Files", "Sensitivity"], rows: "SP" },
        { t: "kv", rows: [["Files one ordinary account can retrieve", "214,806"], ["Accounts holding that reach", "1,876 · every licensed user"], ["PII clusters accessible", "18,204 files"], ["PHI clusters accessible", "9,860 files"], ["Financial clusters accessible", "12,416 files"], ["Unlabeled sensitive content visible to Copilot", "40,480 files"], ["Libraries with broken inheritance", "128"], ["Time to first citation", "9 seconds · was 20 minutes"]] },
        { t: "callout", tone: "bad", v: "Blast radius is identical for a new hire on day one and a director of twenty years. Copilot does not widen access — it collapses the time it takes to find what is already open." }
      ]},
      { id: "devices", h: "4 · Device & Endpoint Compliance", blocks: [
        { t: "kv", rows: [["Non-compliant devices reaching cloud workloads", "312"], ["Devices missing the security baseline", "218"], ["Devices in no policy group", "94"], ["Compliance policy drift", "baseline 11 days old · detection manual"], ["CA enforcement gap for device state", "no device-compliance grant on Copilot"], ["Unmanaged browser sessions", "allowed · no session controls"], ["Endpoint DLP", "licensed · not deployed"]] },
        { t: "callout", tone: "warn", v: "Enforcing a device-compliance grant on the Copilot app today would block one user in six. Endpoint posture has to be corrected before the control is tightened." }
      ]},
      { id: "drift", h: "5 · Security Drift & Violations", blocks: [
        { t: "kv", rows: [["Conditional Access drift", "CA01 never created · sign-in risk left report-only"], ["Identity drift · privilege creep", "14 roles assigned outside PIM, no expiry"], ["Authentication drift", "none · legacy protocols remain blocked"], ["DLP drift", "2 policy sets unscoped · 3 rules in simulation"], ["Detection drift", "no rule references Copilot"], ["Security Engine drift signals", "rising · privileged assignments up 4 in 90 days"]] },
        { t: "p", v: "Nothing here was misconfigured deliberately. Each is a control created once, scoped to a pilot or a project, and never revisited as the estate grew around it." }
      ]},
      { id: "readiness", h: "6 · Copilot Readiness Impact", blocks: [
        { t: "steps", rows: "PATH" },
        { t: "kv", rows: [["Security blockers preventing activation", "2 · DLP scope gap, no Copilot session policy"], ["Sensitive content Copilot can ground on", "40,480 regulated files"], ["Identity gaps affecting Copilot safety", "18 standing admins · 41 unchallenged risky sign-ins"], ["Readiness impact from security posture", "−14 pts"], ["Actions required to clear the gate", "close DLP scope · enforce CA01 after baseline · break the chain"]] },
        { t: "callout", tone: "bad", v: "Read the chain in sequence rather than as a list: no egress control, content reachable by everyone, no session boundary, disclosure becomes reportable. Break any link and the chain stops." }
      ]},
      { id: "fix", h: "7 · Self-Resolution Actions", blocks: [
        { t: "howto", title: "Correct admin role assignments", steps: [
          "List standing privileged assignments: Get-MgRoleManagementDirectoryRoleAssignment -All.",
          "Reduce standing global administrators to five with a named business justification each.",
          "Move the remaining thirteen to PIM-eligible with approval and an eight-hour maximum activation.",
          "Exclude two break-glass accounts from PIM and store their credentials offline."
        ], effort: "2 weeks · medium risk · owner: identity" },
        { t: "howto", title: "Enforce MFA across all identities", steps: [
          "Identify the 4% without MFA and separate service accounts from human accounts.",
          "Move service accounts to workload identities or managed identities rather than exempting them.",
          "Require phishing-resistant MFA for every privileged role — FIDO2 or Windows Hello.",
          "Promote the sign-in risk policy from report-only to enforce in the same window."
        ], effort: "3 weeks · medium risk · owner: identity" },
        { t: "howto", title: "Re-align the Conditional Access baseline", steps: [
          "Create CA01 targeting the Microsoft 365 Copilot app, with break-glass accounts excluded.",
          "Set the grant to require a compliant device and a 12-hour sign-in frequency.",
          "Run report-only for two weeks and read the sign-in logs before enforcing.",
          "Fix the device baseline first so enforcement does not block one user in six."
        ], effort: "1 change window · high risk if enforced early · owner: identity" },
        { t: "howto", title: "Eliminate privilege creep", steps: [
          "Enable access reviews on every privileged role with a 90-day recurrence.",
          "Set the no-response action to remove after the first cycle has been observed.",
          "Move OAuth grant review from quarterly to continuous with an alert on new high-privilege consent.",
          "Record every standing assignment that survives review with its justification."
        ], effort: "3 weeks · low risk · owner: identity governance" },
        { t: "howto", title: "Restore device compliance coverage", steps: [
          "Re-publish the compliance baseline and re-assign the 94 orphaned device groups.",
          "Bring patch ring 3 current before the pilot cohort is selected.",
          "Deploy endpoint DLP to the pilot cohort as a condition of entry.",
          "Add session controls for unmanaged browsers — read-only, no download."
        ], effort: "3 weeks · medium risk · owner: platform + security" },
        { t: "howto", title: "Run monthly security posture reviews", steps: [
          "Write detections for anomalous Copilot retrieval volume and unusual grounding patterns.",
          "Re-measure blast radius per persona after each remediation wave and publish the number.",
          "Extend audit retention so an investigation can look back far enough to matter.",
          "Rehearse the AI-disclosure incident scenario before the pilot widens."
        ], effort: "1 week to set up · owner: security owner" }
      ]},
      { id: "exec", h: "8 · Executive Summary", blocks: [
        { t: "callout", tone: "good", v: "Security determines whether Copilot can operate safely. Identity, access, device compliance and conditional access must be aligned before Copilot can be deployed. Correcting these security gaps reduces blast radius, restores control, and ensures Copilot operates within your security boundaries." },
        { t: "kv", rows: [["Security maturity", "51 → 89"], ["Files one account can reach", "214,806 → 18,240"], ["Standing global admins", "18 → 5"], ["Open chain links", "4 → 0"], ["Readiness contribution", "+14 pts"]] }
      ]}
    ]
  },
  copilot: {
    pillar: "Copilot", color: "#67E8F9", accent: "#67e8f9",
    title: "Copilot Readiness, Safety & Enablement Report",
    sub: "Northline Health · tenant scan 01 Aug 2026 · every pillar folded into one decision",
    meta: [["Copilot readiness", "34%"], ["Deployment gate", "75%"], ["Blocking findings", "3"], ["Priced exposure", "$4.1M"]],
    sections: [
      { id: "summary", h: "1 · Copilot Readiness Summary", blocks: [
        { t: "p", v: "This document evaluates your tenant's readiness to safely deploy Microsoft Copilot. It measures governance, security, compliance, adoption, licensing and health signals that directly affect Copilot's accuracy, safety and value. Every finding traces to telemetry surfaced in your assessment and directly impacts the Copilot Gate." },
        { t: "callout", tone: "bad", v: "Copilot Gate — BLOCKED. Readiness 34% against a 75% requirement. Three findings block the gate outright; two gate the success of a pilot rather than its safety." },
        { t: "kv", rows: [["Copilot readiness score", "34%"], ["Gate status", "BLOCKED"], ["Governance contribution", "34 of 89 · largest gap"], ["Security contribution", "51 of 89"], ["Compliance contribution", "38 of 84"], ["Adoption contribution", "54 of 86"], ["Health contribution", "58 of 88"], ["Licensing contribution", "38 of 92 · non-blocking"], ["Copilot blast radius", "214,806 files · 1,876 accounts"], ["Personas ready today", "1 of 4 · compliance officers, 40 seats"]] }
      ]},
      { id: "safety", h: "2 · Copilot Safety & Exposure", blocks: [
        { t: "ai", v: "Prompt run against Flight Ops – Mission Docs: “Summarise what this site contains.” Copilot returned 41,208 citable files including unlabelled mission documentation. No elevated rights were required." },
        { t: "ai", v: "Prompt run against Contracts & Legal: “What are our termination terms with Aerostruct?” Copilot quoted the executed MSA verbatim with a citation. The library is EEEU, so any employee receives the same answer." },
        { t: "kv", rows: [["Sensitive content Copilot can ground on", "40,480 regulated files"], ["Unlabeled content visible to Copilot", "40,480 files · 22% of the estate"], ["Overshared content visible to Copilot", "214,806 files across 41 sites"], ["Regulated categories accessible", "PII 18,204 · PHI 9,860 · financial 12,416"], ["External exposure affecting grounding", "612 guests · 23 anonymous links"], ["Permission sprawl expanding blast radius", "128 broken inheritance points · 37 sprawl groups"], ["Priced exposure", "$4.1M"]] },
        { t: "callout", tone: "bad", v: "The exposure already exists. Copilot changes the retrieval time from twenty minutes to nine seconds and attaches your tenant's authority to the answer." }
      ]},
      { id: "value", h: "3 · Workflow Enablement & Value", blocks: [
        { t: "table", head: ["Workflow", "Return", "Detail"], rows: "INV:adoption.flows" },
        { t: "kv", rows: [["Improvable immediately", "meeting recap · once transcription is on"], ["Blocked by governance", "document drafting · needs labelled sources"], ["Blocked by adoption", "prior-work retrieval · needs library discipline"], ["Highest-value personas", "clinicians 3.5 hrs/wk · support 136 tickets/wk"], ["Lowest-readiness department", "clinical · PHI boundary unlabelled"], ["Cross-department inconsistency", "4 handover formats across clinics"], ["Annual value at full adoption", "$4.1M · 1,140 hours weekly"]] }
      ]},
      { id: "prereq", h: "4 · Technical Prerequisites & Platform Alignment", blocks: [
        { t: "kv", rows: [["Licensing prerequisite", "M365 E3 or E5 base · held by 4,395 users"], ["Copilot seats owned / assigned", "25 / 2"], ["Conditional Access requirement", "Copilot session policy · not present"], ["Authentication alignment", "MFA 96% · legacy auth blocked · compliant"], ["Device compliance requirement", "94.2% · 312 endpoints would be blocked"], ["Workload stability for grounding", "platform healthy · no advisories"], ["Semantic index", "queued · builds on first enablement"]] },
        { t: "callout", tone: "warn", v: "The semantic index bakes current reach in at build time, which is why remediation after enablement is materially harder than remediation before it." }
      ]},
      { id: "drift", h: "5 · Copilot Drift & Violations", blocks: [
        { t: "kv", rows: [["Governance drift affecting safety", "47 settings outside change control"], ["Security drift affecting access", "14 privileged roles outside PIM"], ["Compliance drift affecting regulated content", "3 classifiers in simulation · 19 libraries off policy"], ["Adoption drift affecting alignment", "64% of files shared in chat, not libraries"], ["Health drift affecting reliability", "312 endpoints off baseline · 11-day-old baseline"], ["Detection drift", "no rule anywhere references Copilot"]] },
        { t: "p", v: "Drift is detected by hand across every pillar. Without continuous comparison against baseline, a remediated tenant returns to this position within a year." }
      ]},
      { id: "blockers", h: "6 · Gate Blockers & Remediation Path", blocks: [
        { t: "kv", rows: [["F-GOV-1 · Org-wide and EEEU sharing", "BLOCKING · close org-wide sharing, assign owners"], ["F-SEC-1 · DLP scope gap", "BLOCKING · extend policy sets, add Copilot as a location"], ["F-CMP-1 · Unlabelled regulated content", "BLOCKING · promote classifiers, auto-label the backlog"], ["F-HLT-1 · Device baseline drift", "GATING · re-publish baseline before CA01 is enforced"], ["F-ADO-2 · No champion network", "GATING · 38 champions, 4 role tracks"], ["Licensing corrections", "NON-BLOCKING · reclaim seats, assign the pilot cohort"]] },
        { t: "steps", rows: "PATH" },
        { t: "callout", tone: "good", v: "No-go is not the same as no. It is a sequence and a date — twelve weeks, using controls already licensed, funded entirely from the licence recovery." }
      ]},
      { id: "fix", h: "7 · Self-Resolution Actions", blocks: [
        { t: "howto", title: "Reduce Copilot blast radius safely", steps: [
          "Close the 41 org-wide grants — that single action removes 196,566 files from general reach.",
          "Measure blast radius per persona before any licence is assigned, and re-measure after each wave.",
          "Hold the semantic index build until org-wide sharing is closed.",
          "Publish the reachable-file count monthly as the security metric."
        ], effort: "4 weeks · medium risk · owner: platform + security" },
        { t: "howto", title: "Label and protect Copilot-visible content", steps: [
          "Promote the three PHI classifiers out of simulation after sampling 500 matches.",
          "Enable default labels at provisioning so the backlog stops growing while you clear it.",
          "Auto-label clinical and billing libraries first — that is where the reportable exposure lives.",
          "Add Copilot as a DLP location so prompts and responses are evaluated like any other egress."
        ], effort: "6 weeks · medium risk · owner: compliance" },
        { t: "howto", title: "Modernize workflows for Copilot alignment", steps: [
          "Turn transcription on by default at least four weeks before the pilot so there is history to recap.",
          "Declare one authoritative library per team and move the recurring documents into it.",
          "Standardise the four competing handover formats into one.",
          "Instrument two workflows properly rather than claiming all four."
        ], effort: "4 weeks · low risk · owner: enablement + platform" },
        { t: "howto", title: "Correct licensing gaps for Copilot eligibility", steps: [
          "Reclaim the 1,308 unassigned seats and the 47 departed accounts.",
          "Create a Copilot-eligible security group with membership rules and assign the licence to the group.",
          "Gate membership on two conditions: labelled content boundary and compliant device.",
          "Fund the pilot and the remediation from the recovery rather than from new budget."
        ], effort: "3 weeks · low risk · owner: licensing" },
        { t: "howto", title: "Enforce Conditional Access for Copilot workloads", steps: [
          "Create CA01 targeting the Microsoft 365 Copilot app with break-glass accounts excluded.",
          "Require a compliant device and set sign-in frequency to 12 hours.",
          "Run report-only for two weeks and read the sign-in logs before enforcing.",
          "Fix the device baseline first so enforcement does not block one user in six."
        ], effort: "1 change window · high risk if enforced early · owner: identity" },
        { t: "howto", title: "Run monthly Copilot readiness reviews", steps: [
          "Re-run the three test prompts after each wave as the acceptance test and retain the output.",
          "Report readiness, blast radius and hours returned together, not separately.",
          "Re-price the exposure at each phase close so the trend is visible.",
          "Review the position with the same group that approved the programme."
        ], effort: "1 week to set up · owner: programme owner" }
      ]},
      { id: "exec", h: "8 · Executive Summary", blocks: [
        { t: "callout", tone: "good", v: "Copilot is only safe and effective when your environment is ready. Governance, security, compliance, adoption, licensing and health must be aligned before Copilot can be deployed. Correcting these gaps increases readiness, reduces risk, and ensures Copilot delivers measurable value across your organization." },
        { t: "kv", rows: [["Copilot readiness", "34% → 78%"], ["Gate status", "BLOCKED → PASSING"], ["Priced exposure", "$4.1M → $164K"], ["Annual value", "$0 → $4.1M"], ["Net year-one position", "+$613,200"], ["Elapsed to gate", "12 weeks"]] }
      ]}
    ]
  },
};

export const DIVE_INV = {
  adoption: {
    title: "Who is actually ready",
    tabs: [["personas", "Not ready"], ["teams", "Teams usage"], ["flows", "Workflows"], ["gaps", "Training gaps"]],
    rows: {
      personas: [
        { name: "Maya Torres · Flight controller", tag: "NOT READY", tone: "warn", note: "High-value use case, zero enablement. Sits in 41 channels and writes 6 routine documents a week — the return is there, the training is not." },
        { name: "Ellis Wren · Support lead", tag: "PARTIAL", tone: "warn", note: "Self-taught prompting, no grounding literacy. Will hit unlabelled content and trust the answer." },
        { name: "P. Yancey · Warehouse supervisor", tag: "OUT OF SCOPE", tone: "mute", note: "No Office workload — should not be in the pilot cohort at all." },
        { name: "Revenue-cycle team (31 seats)", tag: "NOT READY", tone: "bad", note: "Highest modelled hours saved in the tenant, and the only cohort with no named champion." },
        { name: "Clinical educators (18 seats)", tag: "READY", tone: "good", note: "Already using Teams and Word daily with labelled content; can start the week governance closes." }
      ],
      teams: [
        { name: "Daily active users", tag: "1,631 / 1,876", tone: "good", note: "87% of licensed seats touch Teams every working day." },
        { name: "Channels per active user", tag: "41 avg", tone: "warn", note: "Twelve active before lunch for a floor role — this is the noise Copilot is meant to triage." },
        { name: "Meetings recorded and transcribed", tag: "22%", tone: "bad", note: "Without transcripts there is nothing for Copilot to recap; this is the cheapest adoption win available." },
        { name: "Files shared in chat vs library", tag: "64% chat", tone: "bad", note: "Content in chat is weakly governed and poorly indexed — it degrades both grounding and compliance." }
      ],
      flows: [
        { name: "Shift handover summary", tag: "HIGH", tone: "good", note: "6 hrs/wk per controller. Grounded on Teams transcripts and the shift log — needs recording enabled." },
        { name: "Routine clinical documentation", tag: "HIGH", tone: "good", note: "9 hrs/wk. Requires labelled templates so the output inherits the right classification." },
        { name: "Denials and remittance analysis", tag: "MEDIUM", tone: "warn", note: "Excel-heavy; return is real but depends on finance content being inside the labelled boundary." },
        { name: "Support answer deflection", tag: "HIGH", tone: "good", note: "Top 40 repeat questions answerable from governed content — measurable within one month." },
        { name: "Policy lookup", tag: "BLOCKED", tone: "bad", note: "Blocked until there is one owned source per policy; today there are four versions in three sites." }
      ],
      gaps: [
        { name: "No role-based enablement paths", tag: "GAP", tone: "bad", note: "One generic 30-minute deck for every role. Clinicians and revenue-cycle staff need different tracks." },
        { name: "No champion network", tag: "GAP", tone: "bad", note: "Zero named champions. Target is 1 per 50 seats with a monthly cadence." },
        { name: "No prompt library", tag: "GAP", tone: "warn", note: "Users invent prompts alone, which is how bad grounding habits form." },
        { name: "No measurement of usage", tag: "GAP", tone: "warn", note: "No adoption telemetry review scheduled, so nobody would notice the pilot failing." }
      ]
    },
    toggle: { id: "flowready", label: "Enable workflow readiness", note: "Turn on recording, transcripts and labelled templates so the five workflows above have something to ground on." },
    button: { id: "training", idle: "Simulate persona training", busy: "Running enablement…", done: "Training modelled",
      out: ["Role-based paths run for 4 cohorts: 1,631 active users reached, 87% completion modelled on your historical training data.",
            "Not-ready personas drop from 4 to 1 — the remaining cohort is blocked on governance, not on skill.",
            "Modelled adoption lift: +22 points, worth 4.1 hrs/wk per trained seat once workflow readiness is on."] }
  },
  compliance: {
    title: "What legal is actually exposed to",
    tabs: [["files", "Exposed files"], ["labels", "Labeling gaps"], ["reg", "Regulatory"], ["msa", "MSA"]],
    rows: {
      files: [
        { name: "Payroll_FY26_Draft.xlsx · HR – People Ops", tag: "CONFIDENTIAL", tone: "bad", note: "Reachable via an org-wide link. Contains compensation for 1,876 employees and carries no label." },
        { name: "Executed_MSA_Aerostruct.pdf · Contracts & Legal", tag: "CONFIDENTIAL", tone: "bad", note: "EEEU on the library. Copilot can quote contractual terms back to anyone in the tenant." },
        { name: "Remittance_Advice_Q2.pdf · OneDrive (Revenue Cycle)", tag: "PHI", tone: "bad", note: "Anonymous link, no expiry. Member IDs in plain text — reportable the moment it is cited." },
        { name: "Discharge_Summaries_Working · OneDrive (Clinical Ops)", tag: "PHI", tone: "bad", note: "Six external case managers hold standing access to a working folder of clinical summaries." },
        { name: "Incident_Review_2025.docx · Launch Readiness", tag: "SENSITIVE", tone: "warn", note: "Partial labelling — the parent site is unlabelled, so inheritance does nothing." }
      ],
      labels: [
        { name: "Content with no sensitivity label", tag: "22%", tone: "bad", note: "One in five files Copilot can reach is unclassified, so any answer built from it is unclassified too." },
        { name: "Label inheritance at site provisioning", tag: "OFF", tone: "bad", note: "New sites are created unlabelled by default; the estate degrades every week this stays off." },
        { name: "Auto-labelling policies in simulation", tag: "0 live", tone: "warn", note: "Three PHI classifiers built and never promoted out of simulation mode." },
        { name: "Copilot chat history retention labels", tag: "NOT APPLIED", tone: "warn", note: "Prompts and responses fall outside the retention scheme entirely." }
      ],
      reg: [
        { name: "HIPAA / HITECH", tag: "AT RISK", tone: "bad", note: "PHI reachable through unexpired anonymous links is an access-control failure regardless of whether anyone opened it." },
        { name: "42 CFR Part 2", tag: "AT RISK", tone: "bad", note: "Substance-use records in the clinical working folders have no segregation from general clinical content." },
        { name: "State PHI breach notification", tag: "EXPOSED", tone: "bad", note: "A grounded citation is disclosure. Notification clocks start at discovery, not at harm." },
        { name: "Joint Commission evidence", tag: "PARTIAL", tone: "warn", note: "Audit retention covers 180 days, but queries are run by hand rather than on schedule." }
      ],
      msa: [
        { name: "§7.4 — Reportable events", tag: "OPEN", tone: "bad", note: "Deploying above pilot scope before DLP closes moves the exposure onto your side of the line." },
        { name: "§4.1 — Change control", tag: "UNSIGNED", tone: "warn", note: "The change record is drafted with a named approver and has not been signed." },
        { name: "§9.2 — Audit evidence", tag: "MET", tone: "good", note: "180-day retention means every interaction in the pilot window is reconstructable." },
        { name: "§11.6 — Subprocessor disclosure", tag: "MET", tone: "good", note: "Copilot processing is inside the existing Microsoft data-processing terms." }
      ]
    },
    toggle: { id: "labelenforce", label: "Simulate labeling enforcement", note: "Promote the three PHI classifiers, turn on inheritance at provisioning, and back-label the estate." },
    button: { id: "sensscan", idle: "Run sensitivity scan", busy: "Classifying content…", done: "Scan complete",
      out: ["Scanned 184,000 reachable files. 40,480 carry regulated content with no label — 61% of them sit in the five sites on your exposure list.",
            "Highest-risk single file: Remittance_Advice_Q2.pdf. Member IDs, PHI classifier match at 0.96 confidence, anonymous link with no expiry, and no label to stop a Copilot citation carrying it.",
            "With enforcement on, 38,100 of those files inherit a label automatically and drop out of Copilot's ungoverned surface."] }
  }
};

DIVE_INV.health = {
  title: "What the tenant costs you to run",
  tabs: [["drift", "Drift"], ["baseline", "Baseline gaps"], ["identity", "Identity"], ["service", "Service health"]],
  rows: {
    drift: [
      { name: "Endpoints outside the compliance baseline", tag: "312", tone: "bad", note: "One in six devices. Each one is a session Copilot answers into without a known posture." },
      { name: "Configuration drift since last baseline", tag: "47 settings", tone: "bad", note: "Tenant settings changed outside change control in the last 90 days — nobody owns the diff." },
      { name: "Devices outside the patch ring", tag: "29%", tone: "warn", note: "Patch compliance is measured monthly, so drift is invisible for up to four weeks." },
      { name: "Recurring incidents from the same root cause", tag: "6/mo", tone: "warn", note: "The same five alerts drive most of the after-hours queue and have no runbook." }
    ],
    baseline: [
      { name: "Intune compliance policy coverage", tag: "84%", tone: "warn", note: "Sixteen percent of enrolled devices match no policy at all — they are simply unevaluated." },
      { name: "Security baseline assigned to all rings", tag: "PARTIAL", tone: "bad", note: "Applied to corporate laptops only. Shared clinical kiosks and BYOD sit outside it." },
      { name: "Automated remediation runbooks", tag: "0 live", tone: "bad", note: "Every drift correction today is a person doing it by hand, after someone notices." },
      { name: "Drift detection cadence", tag: "MANUAL", tone: "warn", note: "Reviewed when a ticket forces it, not on a schedule." }
    ],
    identity: [
      { name: "MFA coverage", tag: "96%", tone: "good", note: "Strong, but the remaining 4% includes four service accounts with mailbox access." },
      { name: "Standing global admins", tag: "18", tone: "bad", note: "Eighteen permanent global admins against a target of five with PIM elevation." },
      { name: "Legacy authentication", tag: "BLOCKED", tone: "good", note: "Fully blocked with no excluded principals remaining." },
      { name: "Risky sign-ins in the last 30 days", tag: "41", tone: "warn", note: "Sign-in risk policy is still in report-only, so none of these were challenged." }
    ],
    service: [
      { name: "SLA compliance", tag: "99.2%", tone: "good", note: "Well inside contract across all workloads." },
      { name: "Ticket aging, 90th percentile", tag: "11 days", tone: "warn", note: "Long tail is Outlook and Teams issues — exactly the surfaces a Copilot pilot lands on." },
      { name: "Automation success rate", tag: "98%", tone: "good", note: "The automation that exists works; there simply is not enough of it." },
      { name: "Backup and restore health", tag: "VERIFIED", tone: "good", note: "Restore tested this quarter with a documented result." }
    ]
  },
  toggle: { id: "baseenforce", label: "Simulate baseline enforcement", note: "Assign the security baseline to every ring including kiosks and BYOD, and put drift detection on a daily schedule." },
  button: { id: "reducedrift", idle: "Reduce drift", busy: "Applying runbooks…", done: "Drift reduction modelled",
    out: ["312 non-compliant endpoints resolve to 41 — the residual is hardware that cannot meet the baseline and needs a replacement plan, not a policy.",
          "47 drifted settings return to the baseline; the five recurring alerts get runbooks and drop out of the after-hours queue.",
          "Copilot reliability follows directly: grounded answers stop being served into sessions with unknown device posture."] }
};

DIVE_INV.security = {
  title: "Why Copilot is blocked, in your own data",
  tabs: [["dlp", "DLP gaps"], ["ca", "CA gaps"], ["paths", "Exposure paths"], ["chain", "Risk chain"]],
  rows: {
    dlp: [
      { name: "Policy sets that never evaluate", tag: "2 UNSCOPED", tone: "bad", note: "Finance and Legal mail flow is outside every DLP rule. 1,412 mailboxes, 8.4M messages, zero egress checks." },
      { name: "PHI classifiers in simulation mode", tag: "3", tone: "bad", note: "Built, tested, never promoted. They report matches and block nothing." },
      { name: "Endpoint DLP", tag: "NOT DEPLOYED", tone: "warn", note: "Copy to USB and personal cloud sync are entirely uncontrolled on 312 drifted devices." },
      { name: "Copilot interaction scope", tag: "OUT OF SCOPE", tone: "bad", note: "Prompts and grounded responses are not evaluated by any DLP policy today." }
    ],
    ca: [
      { name: "Copilot session policy", tag: "MISSING", tone: "bad", note: "No conditional-access policy governs the Copilot session itself — 1,876 users, 100% of grounded answers." },
      { name: "Unmanaged browser session controls", tag: "NONE", tone: "bad", note: "A user on a personal device gets the same grounded access as a managed clinical workstation." },
      { name: "Risk-based access", tag: "REPORT-ONLY", tone: "warn", note: "Sign-in risk is measured and never enforced; 41 risky sign-ins went unchallenged last month." },
      { name: "Guest access policy", tag: "PARTIAL", tone: "warn", note: "612 guests hold standing access with no re-attestation cycle." }
    ],
    paths: [
      { name: "Remittance PDFs → anonymous link → Copilot citation", tag: "OPEN", tone: "bad", note: "PHI reachable with no authentication, no expiry, no label, no DLP evaluation. Four controls, none of them present." },
      { name: "Executed MSAs → EEEU library → grounded answer", tag: "OPEN", tone: "bad", note: "Any employee can ask for contract terms and get them quoted, with the source cited." },
      { name: "Payroll drafts → org-wide link → semantic index", tag: "OPEN", tone: "bad", note: "Compensation for 1,876 employees, unlabelled, indexed and retrievable." },
      { name: "Clinical summaries → external guest → export", tag: "OPEN", tone: "bad", note: "Six external case managers can export content Copilot will happily summarise for them." }
    ],
    chain: [
      { name: "1 · No egress control", tag: "OPEN", tone: "bad", note: "Two unscoped DLP policy sets. Nothing evaluates what leaves." },
      { name: "2 · Reachable content", tag: "OPEN", tone: "bad", note: "41 overshared sites, 214K files, 40,480 of them carrying regulated content with no label." },
      { name: "3 · No session boundary", tag: "OPEN", tone: "bad", note: "No Copilot conditional-access policy, so the grounded answer travels wherever the session does." },
      { name: "4 · Contractual exposure", tag: "MSA §7.4", tone: "bad", note: "The three links above convert a technical gap into a reportable event the moment a citation lands." }
    ]
  },
  toggle: { id: "caenforce", label: "Simulate CA enforcement", note: "Add the Copilot session policy, enforce sign-in risk, and require a managed device for grounded access." },
  button: { id: "dlptest", idle: "Run DLP test prompt", busy: "Attempting retrieval…", done: "Test complete",
    out: ["Prompt: “Summarise the Q2 remittance advice for the Northside clinic.” Copilot retrieved Remittance_Advice_Q2.pdf and returned member IDs in the response body.",
          "DLP verdict: NOT BLOCKED. The file sits in a mailbox and library outside both policy sets, so no rule was ever evaluated. There was nothing to stop.",
          "With the scope closed and the classifiers promoted, the same prompt returns a policy-tip refusal and logs the attempt — which is the evidence legal actually needs."] }
};

export const DIVES = {
  adoption: {
    color: "#F97316", accent: "#FDBA74", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87",
    kicker: "Pillar deep-dive · usage telemetry", title: "Adoption — who actually uses what you own", score: 54,
    metrics: [
      { key: "active", label: "Teams monthly active users", base: 61, unit: "%", dir: "up" },
      { key: "reuse", label: "Documents reused rather than recreated", base: 34, unit: "%", dir: "up" },
      { key: "trained", label: "Staff through role-based enablement", base: 42, unit: "%", dir: "up" },
      { key: "shadow", label: "Seats still on duplicate third-party tools", base: 1180, unit: "", dir: "down" }
    ],
    levers: [
      { id: "paths", title: "Role-based enablement paths", detail: "Clinician, nurse manager, revenue-cycle and support tracks — 90 minutes each.", owner: "Ellis · enablement", effort: "6 weeks", risk: "Low", score: 9, d: { trained: 38, active: 12 } },
      { id: "champs", title: "Champion network, 1 per 50 seats", detail: "Named champions with a monthly cadence and a direct escalation path.", owner: "Maya · platform", effort: "4 weeks", risk: "Low", score: 7, d: { reuse: 9, active: 6 } },
      { id: "retire", title: "Retire duplicate third-party tools", detail: "Consolidate file share, meetings and chat onto entitlements you already pay for.", owner: "Shane · programme", effort: "8 weeks", risk: "Medium — change comms required", score: 6, d: { shadow: -980, active: 14 } },
      { id: "nudge", title: "In-product usage nudges", detail: "Viva-style prompts surfacing the two features each role never opened.", owner: "Ellis · enablement", effort: "2 weeks", risk: "Low", score: 4, d: { active: 6, reuse: 5 } }
    ]
  },
  compliance: {
    color: "#F3F4F6", accent: "#c4b5fd", icon: "M12 3v18M5 7l7-4 7 4M4 21h16",
    kicker: "Pillar deep-dive · regulated content", title: "Compliance — what a regulator would find", score: 45,
    metrics: [
      { key: "retention", label: "PHI covered by a retention policy", base: 68, unit: "%", dir: "up" },
      { key: "labels", label: "Content carrying a sensitivity label", base: 32, unit: "%", dir: "up" },
      { key: "dlp", label: "Mail and endpoint egress under DLP", base: 62, unit: "%", dir: "up" },
      { key: "audit", label: "Audit log retention", base: 90, unit: " days", dir: "up" }
    ],
    levers: [
      { id: "autolabel", title: "Auto-label PHI and PII at rest", detail: "Purview classifiers across clinical, billing and legal libraries, simulation first.", owner: "Beth · compliance", effort: "4 weeks", risk: "Medium", score: 8, d: { labels: 51, retention: 14 } },
      { id: "dlpscope", title: "Scope DLP to finance and legal mail", detail: "Close the two unscoped policy sets that never evaluate egress.", owner: "Kirk · security", effort: "1 week", risk: "Low", score: 9, d: { dlp: 33 } },
      { id: "auditret", title: "Extend audit retention to 365 days", detail: "Covers the full regulatory look-back rather than one quarter.", owner: "Beth · compliance", effort: "2 days", risk: "Low", score: 5, d: { audit: 275 } },
      { id: "chatret", title: "Retention policy for Copilot interactions", detail: "Every generated answer reconstructable, with the same policy as mail.", owner: "Shane · Copilot rollout", effort: "1 week", risk: "Low", score: 6, d: { retention: 18, audit: 0 } }
    ]
  },
  health: {
    color: "#22C55E", accent: "#4ADE80", icon: "M22 12h-4l-3 9L9 3l-3 9H2",
    kicker: "Pillar deep-dive · service telemetry", title: "Health — what the tenant costs you to run", score: 58,
    metrics: [
      { key: "backlog", label: "Support tickets per week", base: 340, unit: "", dir: "down" },
      { key: "mttr", label: "Mean time to resolve", base: 26, unit: " h", dir: "down" },
      { key: "auto", label: "Automated remediation success", base: 58, unit: "%", dir: "up" },
      { key: "patch", label: "Endpoints inside the patch ring", base: 71, unit: "%", dir: "up" }
    ],
    levers: [
      { id: "deflect", title: "Deflect repeat questions with cited answers", detail: "Ground the top 40 questions on governed content; humans see the rest.", owner: "Ellis · support", effort: "3 weeks", risk: "Low", score: 7, d: { backlog: -136, mttr: -6 } },
      { id: "autorem", title: "Auto-remediate the top five alerts", detail: "Runbooks for the alerts that account for most of the after-hours queue.", owner: "Maya · platform", effort: "4 weeks", risk: "Medium", score: 6, d: { auto: 29, mttr: -5 } },
      { id: "patchring", title: "Staged patch rings", detail: "Pilot, broad and critical rings with automatic rollback.", owner: "Maya · platform", effort: "3 weeks", risk: "Low", score: 5, d: { patch: 25 } },
      { id: "rca", title: "Root-cause review cadence", detail: "Weekly review on repeat incidents with a named owner per class.", owner: "Ellis · support", effort: "ongoing", risk: "Low", score: 5, d: { backlog: -48, auto: 6 } }
    ]
  },
  security: {
    color: "#0078D4", accent: "#7dd3fc", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    kicker: "Pillar deep-dive · attack surface", title: "Security — what an attacker or a prompt can reach", score: 41,
    metrics: [
      { key: "mfa", label: "Accounts on phishing-resistant MFA", base: 58, unit: "%", dir: "up" },
      { key: "admins", label: "Standing global administrators", base: 18, unit: "", dir: "down" },
      { key: "legacy", label: "Endpoints still allowing legacy auth", base: 46, unit: "", dir: "down" },
      { key: "ca", label: "Sign-ins covered by conditional access", base: 63, unit: "%", dir: "up" }
    ],
    levers: [
      { id: "fido", title: "Phishing-resistant MFA for privileged roles", detail: "FIDO2 or Windows Hello for every admin and clinical lead.", owner: "Kirk · security", effort: "3 weeks", risk: "Low", score: 8, d: { mfa: 34 } },
      { id: "pim", title: "Cut standing global admins to five, PIM the rest", detail: "Just-in-time elevation with approval and a full audit trail.", owner: "Kirk · security", effort: "2 weeks", risk: "Medium", score: 9, d: { admins: -13 } },
      { id: "legacyauth", title: "Block legacy authentication", detail: "Retire basic auth endpoints that bypass conditional access entirely.", owner: "Maya · platform", effort: "2 weeks", risk: "Medium — service accounts first", score: 7, d: { legacy: -46, ca: 18 } },
      { id: "devcomp", title: "Require compliant devices for Copilot", detail: "No grounded answers to unmanaged browsers or non-compliant endpoints.", owner: "Shane · Copilot rollout", effort: "1 week", risk: "Low", score: 6, d: { ca: 14, mfa: 4 } }
    ]
  }
};

export const LIC_PEOPLE = [
  { id: "p1", cat: "mismatch", name: "J. Alvarez", role: "Revenue cycle analyst", held: "E5", should: "E3", why: "Holds E5 for a security stack she has never used; her workload is Excel and Outlook.", save: 21 },
  { id: "p2", cat: "mismatch", name: "T. Boyd", role: "Facilities coordinator", held: "E5", should: "F3", why: "Frontline shift worker on a shared kiosk — F3 covers the whole workflow.", save: 49 },
  { id: "p3", cat: "mismatch", name: "R. Nakamura", role: "Clinical educator", held: "E3", should: "E5", why: "Handles PHI in Teams daily; needs the E5 compliance controls before Copilot grounding.", save: -21 },
  { id: "p4", cat: "mismatch", name: "L. Fenwick", role: "Contract nurse (ended)", held: "E3", should: "None", why: "Assignment ended in March; account still licensed and still counts against your bill.", save: 36 },
  { id: "p5", cat: "mismatch", name: "D. Okafor", role: "Case manager", held: "E5", should: "E3", why: "Duplicate licence — also covered under the clinical group assignment.", save: 57 },

  { id: "c1", cat: "over", name: "P. Yancey", role: "Warehouse supervisor", held: "Copilot", should: "No Copilot", why: "Zero Copilot sessions in 90 days; workload is scanning and shift notes.", save: 30 },
  { id: "c2", cat: "over", name: "M. Rios", role: "Facilities tech", held: "Copilot", should: "No Copilot", why: "No Office usage at all — licence assigned during the blanket pilot rollout.", save: 30 },
  { id: "c3", cat: "over", name: "S. Whitfield", role: "HR generalist", held: "Copilot", should: "Hold", why: "Works in unlabelled compensation files; grounding is unsafe until governance closes.", save: 30 },

  { id: "n1", cat: "need", name: "Maya Torres", role: "Flight controller", held: "E3", should: "Copilot", why: "Writes 6 routine documents a week and triages 41 channels — highest modelled return in the tenant.", save: -30 },
  { id: "n2", cat: "need", name: "A. Delacroix", role: "Research scientist", held: "E5", should: "Copilot", why: "Spends 9 hrs/wk summarising protocol literature that Copilot can ground on governed content.", save: -30 },
  { id: "n3", cat: "need", name: "Ellis Wren", role: "Support lead", held: "E3", should: "Copilot", why: "Top 40 repeat questions are answerable from governed content; deflection is measurable.", save: -30 },
  { id: "n4", cat: "need", name: "B. Iyer", role: "Revenue cycle manager", held: "E5", should: "Copilot", why: "Denials analysis is manual today; already inside the labelled finance boundary.", save: -30 }
];

export const LIC_SKUS = [
  { id: "e3", name: "Microsoft 365 E3", purchased: 4200, assigned: 3980, cost: 36, step: 50, note: "Core productivity — the floor for every clinical seat." },
  { id: "e5", name: "Microsoft 365 E5", purchased: 1500, assigned: 612, cost: 57, step: 50, note: "Bought for the security stack; 888 seats never assigned." },
  { id: "copilot", name: "Copilot for Microsoft 365", purchased: 25, assigned: 2, cost: 30, step: 25, invest: true, note: "2 of 25 assigned. The pilot never left the sponsor's team." },
  { id: "exo", name: "Exchange Online Plan 1", purchased: 620, assigned: 118, cost: 4, step: 25, note: "Legacy overlap — most holders also carry E3." },
  { id: "pbi", name: "Power BI Pro", purchased: 900, assigned: 341, cost: 10, step: 25, note: "Standalone seats bought before E5 entitlement landed." },
  { id: "visio", name: "Visio Plan 2", purchased: 300, assigned: 46, cost: 15, step: 25, note: "Departmental purchase, never reconciled." },
  { id: "p2", name: "Entra ID P2", purchased: 1500, assigned: 1500, cost: 9, step: 50, note: "Fully assigned — no action needed." }
];
export const COPILOT_RETURN = 2960; // modelled annual return per assigned Copilot seat

export const COPILOT_BASE = 28;

export const ONEDRIVE = [
  { id: "od1", type: "OneDrive", name: "j.alvarez@northline (Revenue Cycle)", exposure: "Anyone links", files: "1,842", ext: 14, sens: "Unlabelled", risk: "critical", note: "Two anonymous links on a folder of remittance advice PDFs containing member IDs. No expiry set." },
  { id: "od2", type: "OneDrive", name: "d.okafor@northline (Clinical Ops)", exposure: "External guests", files: "912", ext: 6, sens: "Partial", risk: "high", note: "Shared a discharge-summary working folder with six external case managers; links have never been reviewed." },
  { id: "od3", type: "OneDrive", name: "s.whitfield@northline (HR)", exposure: "Org-wide link", files: "480", ext: 0, sens: "Confidential", risk: "high", note: "Org-wide link on an offer-letter folder — every employee can read compensation drafts, and so can Copilot." },
  { id: "od4", type: "OneDrive", name: "m.chen@northline (Legal)", exposure: "External guests", files: "1,204", ext: 3, sens: "Confidential", risk: "medium", note: "Outside counsel retains standing access to a matter folder closed in 2024." }
];

export const GOV_EXPOSURE_PATH = [
  ["File sits in a library", "No sensitivity label, inherited site permissions"],
  ["Site grants EEEU", "'Everyone except external users' resolves to 1,876 accounts"],
  ["Graph permission check passes", "Copilot honours ACLs — and this ACL says yes"],
  ["Semantic index ingests it", "Content becomes retrievable for every one of those users"],
  ["A grounded answer cites it", "The citation carries the file's content, not just a link"]
];


// tenant changes the customer can mock in-conversation — each one moves the model
export const CHANGES = {
  ca01:      { label: "CA01 — Copilot session policy", verb: "Enable CA01", match: /ca ?01|copilot session policy/i, gov: 10, ready: 7, sec: 4, note: "Every Copilot session evaluated for device compliance." },
  ca02:      { label: "CA02 — block legacy auth", verb: "Enable CA02", match: /ca ?02|legacy auth/i, gov: 0, ready: 1, sec: 8, note: "Legacy authentication paths closed tenant-wide." },
  dlpscope:  { label: "DLP scope closure", verb: "Enable DLP on finance & legal", match: /dlp scope|scope dlp|enable dlp|dlp on finance/i, gov: 2, ready: 3, sec: 14, note: "1,412 mailboxes brought into egress evaluation." },
  dlpcopilot:{ label: "DLP over Copilot prompts", verb: "Extend DLP to Copilot", match: /dlp (over|for|to) copilot|copilot prompts/i, gov: 1, ready: 1, sec: 9, note: "Prompts and responses evaluated like any other egress." },
  eeeu:      { label: "EEEU off at tenant level", verb: "Turn off EEEU tenant-wide", match: /eeeu|everyone except external|org-?wide link/i, gov: 24, ready: 13, sec: 6, sites: -41, docs: -8300, note: "196,566 files leave Copilot's general grounding surface." },
  anonoff:   { label: "Anonymous links disabled", verb: "Disable anonymous links", match: /anonymous|anyone (with the )?link/i, gov: 5, ready: 1, sec: 7, note: "Every external share now carries a named identity." },
  guestexp:  { label: "Guest expiry + attestation", verb: "Turn on guest expiry", match: /guest expiry|guest attestation|access review/i, gov: 5, ready: 1, sec: 5, guests: -268, note: "268 stale guests clear on the first cycle." },
  labels:    { label: "Auto-label the regulated backlog", verb: "Enable auto-labelling", match: /auto-?label|sensitivity label|label the backlog/i, gov: 14, ready: 12, sec: 4, labelled: 21, note: "40,480 regulated files classified; containment becomes provable." },
  inherit:   { label: "Inheritance restored", verb: "Fix broken inheritance", match: /inheritance|permission sprawl/i, gov: 8, ready: 1, sec: 3, docs: -8300, note: "“Who can see this” becomes answerable in one query." },
  riskpol:   { label: "Sign-in risk policy enforced", verb: "Enforce sign-in risk policy", match: /risky sign-?in|risk policy|report-?only/i, gov: 9, ready: 2, sec: 11, note: "41 risky sign-ins a month get challenged instead of logged." },
  oauth:     { label: "OAuth grants reviewed continuously", verb: "Review OAuth continuously", match: /oauth|app grant|consent|attack surface/i, gov: 7, ready: 1, sec: 8, note: "An over-permissioned app is caught in hours rather than in ninety days." },
  session:   { label: "Session controls on unmanaged browsers", verb: "Add session controls", match: /session control|unmanaged browser/i, gov: 6, ready: 2, sec: 7, note: "Read-only, no download, on any device the tenant does not manage." },
  aidetect:  { label: "AI-specific detections written", verb: "Write AI detections", match: /detection|mean time to detect|incident drill|anomalous/i, gov: 6, ready: 1, sec: 9, note: "Anomalous retrieval volume and unusual grounding patterns become visible." },
  runbooks:  { label: "Top five alerts automated", verb: "Automate the top 5 alerts", match: /runbook|automat|after-?hours|alert/i, gov: 12, ready: 2, sec: 3, note: "Roughly forty after-hours interruptions a week returned to the team." },
  pimadmins: { label: "Standing admins cut to five", verb: "Cut standing admins to 5", match: /global admin|standing admin|pim|change control|rollback/i, gov: 10, ready: 1, sec: 9, note: "Eighteen standing global admins become five, the rest PIM-eligible with approval." },
  restore:   { label: "Restore tested and RTO agreed", verb: "Test restore, set an RTO", match: /restore|backup|resilien|recovery/i, gov: 8, ready: 1, sec: 2, note: "A backup nobody has restored becomes a control you can evidence." },
  part2:     { label: "Part 2 records segregated", verb: "Segregate Part 2 records", match: /part 2|42 cfr|sud|segregat/i, gov: 12, ready: 3, sec: 6, note: "SUD records moved into a labelled boundary excluded from grounding." },
  retention: { label: "Copilot history under retention", verb: "Retain Copilot history", match: /retention|audit log|chat history|legal hold/i, gov: 10, ready: 3, sec: 4, note: "Every prompt and response becomes reconstructable for seven years." },
  aicontrol: { label: "AI-use control written", verb: "Write the AI control", match: /ai-?specific|evidence|defensib|policy estate|control testing/i, gov: 8, ready: 2, sec: 3, note: "The policy estate finally has something to point a regulator at." },
  transcribe:{ label: "Transcription on by default", verb: "Turn on transcription", match: /transcri|recap|meeting intelligence/i, gov: 14, ready: 5, sec: 0, note: "85% of meetings become recap-eligible — 1,140 hours a week in reach." },
  champions: { label: "Champion network named", verb: "Name 38 champions", match: /champion|enablement|manager brief/i, gov: 10, ready: 3, sec: 0, note: "One champion per fifty seats, with a monthly cadence." },
  roletracks:{ label: "Role-based enablement tracks", verb: "Build the 4 role tracks", match: /role track|training|prompt librar|generic deck/i, gov: 8, ready: 3, sec: 0, note: "Ninety minutes per role, grounded in that role's real workflow." },
  libraries: { label: "Work moved into owned libraries", verb: "Move work into libraries", match: /chat|librar|duplicate version|content readiness/i, gov: 12, ready: 4, sec: 1, note: "Copilot grounds on the authoritative copy instead of the latest chat attachment." },
  measure:   { label: "Adoption measurement in place", verb: "Instrument adoption", match: /measure|retention|baseline|metric/i, gov: 6, ready: 1, sec: 0, note: "Week-three retention and hours returned reported monthly." },
  reclaim:   { label: "Unassigned seats reclaimed", verb: "Reclaim unassigned seats", match: /unassigned|reclaim|idle seat|departed/i, gov: 18, ready: 1, sec: 0, note: "1,308 paid seats returned — $847,608 a year." },
  rightsize: { label: "E5 right-sized to real use", verb: "Right-size E5", match: /right-?size|e5|sku|mis-?fit|over-?licens/i, gov: 22, ready: 2, sec: 0, note: "612 over-licensed users moved to the SKU their workload justifies." },
  groupassign:{ label: "Group-based licensing", verb: "Move to group assignment", match: /group-?based|direct assign|lifecycle|joiner|leaver/i, gov: 8, ready: 1, sec: 2, note: "Joiner, mover and leaver stop being manual steps." },
  copilotseats:{ label: "Copilot pilot cohort assigned", verb: "Assign the pilot cohort", match: /copilot seat|pilot cohort|copilot licen|eligib/i, gov: 6, ready: 6, sec: 0, note: "400 seats assigned by group, gated on labelling and device compliance." },
  toolconsol:{ label: "Duplicate tooling retired", verb: "Retire duplicate tooling", match: /duplicate|third-?party|tooling|overlap/i, gov: 6, ready: 0, sec: 1, note: "1,180 seats come off tools E5 already covers — $142,000 a year." },
  baseline:  { label: "Device baseline enforced", verb: "Enforce device baseline", match: /device baseline|intune|endpoint compliance/i, gov: 0, ready: 0, sec: 12, note: "312 drifted endpoints brought back inside policy." }
};


// Health thresholds for governance telemetry — aligned to Microsoft's Copilot
// deployment guidance (permissions-first), SharePoint oversharing guidance,
// Purview labelling coverage targets and CIS M365 Benchmark identity controls.
// good = within guidance · meh = drifting, remediate before rollout · bad = blocks a tenant-wide go-live
export const TELEMETRY_BANDS = [
  { m: /eeeu|everyone except external/i, kind: "yesno", bad: "yes", why: "Microsoft's Copilot readiness guidance treats EEEU as a tenant-wide read grant — it must be removed before broad enablement." },
  { m: /eeeu risk level/i, kind: "word", good: /none|low/i, meh: /medium|moderate/i, why: "Risk rating carried into the readiness gate." },
  { m: /organization.? links|org-?wide links/i, kind: "count", good: 0, meh: 10, bad: 20, why: "Any org-wide link is a standing tenant-wide grant; guidance is zero before enablement, and above 20 the exposure is systemic rather than incidental." },
  { m: /anonymous/i, kind: "count", good: 0, meh: 3, bad: 10, why: "Anonymous links carry no identity, so there is no audit trail. CIS M365 Benchmark recommends disabling them outright." },
  { m: /overshared sharepoint sites/i, kind: "count", good: 0, meh: 10, bad: 25, why: "Each overshared site multiplies Copilot's grounding surface." },
  { m: /public teams channels/i, kind: "count", good: 2, meh: 8, bad: 15, why: "A public channel exposes its connected SharePoint site to the whole tenant." },
  { m: /orphaned channels|channel sprawl|unmanaged or orphaned/i, kind: "count", good: 10, meh: 40, bad: 80, why: "Ownerless channels never get reviewed and never get closed." },
  { m: /no sensitivity label|unlabelled file percentage/i, kind: "pct", good: 5, meh: 15, bad: 20, invert: true, why: "Purview guidance targets near-complete labelling of regulated content before Copilot grounding; above 20% unlabelled, containment cannot be demonstrated." },
  { m: /mission-critical libraries unlabelled|libraries drifting/i, kind: "count", good: 0, meh: 3, bad: 10, why: "Regulated libraries must be labelled first." },
  { m: /high-risk data exposed|high-risk categories/i, kind: "word", good: /labelled|none/i, meh: /^1$|financial only/i, why: "PII, PHI and financial content reachable without a label." },
  { m: /external guest accounts|external guest identities/i, kind: "count", good: 100, meh: 350, bad: 500, why: "Guests are real identities; CIS recommends periodic access review and expiry." },
  { m: /unmanaged guest identities/i, kind: "count", good: 0, meh: 50, bad: 150, why: "A guest with no owner and no review cannot be attested." },
  { m: /external domains|federated external domains|external domain exposure/i, kind: "count", good: 10, meh: 25, bad: 40, why: "Each allowed domain widens the collaboration boundary." },
  { m: /documents copilot can see with no owner|groundable docs|no owner/i, kind: "count", good: 500, meh: 4000, bad: 8000, why: "Ownerless content is never reviewed and stays citable indefinitely." },
  { m: /unlabelled content visible to copilot|overshared or unlabelled visible|overshared \/ unlabelled visible/i, kind: "count", good: 2000, meh: 15000, bad: 30000, why: "This is the volume Copilot can ground on without a classification." },
  { m: /readiness blocked by governance|readiness score impact/i, kind: "pts", good: 3, meh: 10, bad: 15, why: "Points held down by governance findings alone." },
  { m: /permission sprawl groups|sprawl groups/i, kind: "count", good: 10, meh: 25, bad: 35, why: "Sprawl makes effective permissions unanswerable." },
  { m: /broken inheritance|inheritance breaks/i, kind: "count", good: 15, meh: 60, bad: 100, why: "Unique permissions defeat inheritance-based governance." },
  { m: /nested|legacy depth|permission depth/i, kind: "count", good: 2, meh: 4, bad: 5, why: "Microsoft guidance is to keep permission depth shallow — two levels is the practical target." },
  { m: /conditional access gaps/i, kind: "gap", why: "A missing Copilot session policy leaves the one path that reads all content ungoverned." },
  { m: /library configuration drift|policy compliance drift|labeling drift/i, kind: "count", good: 0, meh: 10, bad: 25, why: "Drift outside change control." },
  { m: /services affected/i, kind: "word", good: /none/i, why: "Number of workloads carrying the exposure." }
];

export function bandFor(label, value) {
  const cfg = TELEMETRY_BANDS.find(b => b.m.test(label));
  if (!cfg) return null;
  const raw = String(value);
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  let tone = "meh";
  if (cfg.kind === "yesno") tone = /^(yes|true|enabled)$/i.test(raw.trim()) ? "bad" : "good";
  else if (cfg.kind === "gap") tone = /none|0|enabled/i.test(raw) ? "good" : "bad";
  else if (cfg.kind === "word") tone = cfg.good && cfg.good.test(raw) ? "good" : (cfg.meh && cfg.meh.test(raw) ? "meh" : "bad");
  else if (isNaN(n)) tone = "meh";
  else if (cfg.invert) tone = n <= cfg.good ? "good" : n < cfg.bad ? "meh" : "bad";
  else tone = n <= cfg.good ? "good" : n < (cfg.bad === undefined ? Infinity : cfg.bad) ? "meh" : "bad";
  const ink = tone === "good" ? "#34d399" : tone === "meh" ? "#fbbf24" : "#f87171";
  const word = tone === "good" ? "WITHIN GUIDANCE" : tone === "meh" ? "DRIFTING" : "BLOCKS ROLLOUT";
  return { tone: tone, ink: ink, word: word, why: cfg.why };
}


// each sub-topic maps to the concrete tenant settings that move it
export const SECTION_CHANGES = {
  "the verdict": ["eeeu", "labels", "dlpscope"],
  "blast radius, priced": ["eeeu", "labels", "dlpcopilot"],
  "prove it with copilot": ["eeeu", "labels"],
  "the value on the other side": ["copilotseats", "transcribe", "champions"],
  "go / no-go": ["eeeu", "labels", "ca01"],
  "remediation sequence": ["eeeu", "dlpscope", "labels"],
  "what if we do nothing": ["reclaim", "eeeu"],
  "identity perimeter": ["pimadmins", "riskpol"],
  "reachability, not posture": ["eeeu", "labels"],
  "egress & data loss": ["dlpscope", "dlpcopilot"],
  "the risk chain": ["dlpscope", "eeeu", "ca01"],
  "security & the copilot gate": ["ca01", "dlpcopilot", "pimadmins"],
  "attack surface": ["oauth", "session", "guestexp"],
  "detection & response": ["aidetect", "retention"],
  "device baseline": ["baseline"],
  "service health & incidents": ["runbooks"],
  "change & configuration": ["pimadmins"],
  "backup & resilience": ["restore"],
  "health & the copilot gate": ["baseline", "runbooks", "pimadmins"],
  "endpoint estate": ["baseline"],
  "operational readiness": ["runbooks", "restore"],
  "classification coverage": ["labels"],
  "data loss prevention": ["dlpscope", "dlpcopilot"],
  "retention & audit": ["retention"],
  "regulatory exposure": ["part2", "retention"],
  "compliance & the copilot gate": ["labels", "dlpcopilot", "retention"],
  "policy estate": ["dlpscope", "dlpcopilot"],
  "evidence & defensibility": ["aicontrol", "retention"],
  "usage reality": ["libraries", "measure"],
  "meeting intelligence": ["transcribe"],
  "champions & enablement": ["champions", "roletracks"],
  "workflows worth automating": ["transcribe", "measure"],
  "adoption & the copilot gate": ["champions", "roletracks", "transcribe"],
  "cohort readiness": ["roletracks", "champions"],
  "content readiness": ["libraries"],
  "measurement & retention": ["measure"],
  "licence position": ["reclaim", "rightsize"],
  "licence fit": ["rightsize", "groupassign"],
  "copilot seat readiness": ["copilotseats", "rightsize"],
  "cost recovery": ["reclaim", "toolconsol"],
  "licensing & the copilot gate": ["reclaim", "rightsize", "copilotseats"],
  "sku distribution": ["rightsize", "reclaim"],
  "licence lifecycle": ["groupassign", "reclaim"],
  "tooling overlap": ["toolconsol"],
  "forecast & renewal": ["reclaim", "rightsize", "toolconsol"],
  "org-wide sharing": ["eeeu", "anonoff"],
  "sharing & link exposure": ["eeeu", "anonoff"],
  "oversharing engine": ["eeeu", "anonoff", "inherit"],
  "overshared locations": ["eeeu", "inherit"],
  "site & channel oversharing": ["eeeu", "inherit"],
  "sensitive data exposure": ["labels", "dlpscope"],
  "sensitivity & labeling gaps": ["labels", "dlpscope"],
  "sensitivity label engine": ["labels"],
  "data exposure engine": ["labels", "dlpcopilot", "guestexp"],
  "external access": ["guestexp", "anonoff"],
  "identity & access risks": ["guestexp", "ca01"],
  "identity & access engine": ["guestexp", "ca01", "ca02"],
  "copilot exposure": ["eeeu", "labels", "ca01"],
  "copilot blast radius": ["eeeu", "labels", "ca01"],
  "copilot readiness engine": ["eeeu", "labels", "ca01"],
  "permission hygiene": ["inherit"],
  "permission sprawl engine": ["inherit"],
  "governance drift": ["inherit", "guestexp"],
  "drift engine": ["inherit", "baseline"]
};
export function changesForSection(h) {
  const k = String(h || "").toLowerCase();
  if (SECTION_CHANGES[k]) return SECTION_CHANGES[k];
  const hit = Object.keys(SECTION_CHANGES).find(x => k.indexOf(x) >= 0 || x.indexOf(k) >= 0);
  return hit ? SECTION_CHANGES[hit] : [];
}


// ── Licensing walkthrough — same shape as governance ─────────────────────────
export const LIC_WALK = [
  { id: "position", n: "01", title: "Licence Position", who: "shane", lead: "Let's start with what you're actually paying for, against what is actually being used.",
    head: { v: "$847,608", l: "a year on seats nobody holds", tone: "#f87171", note: "before a single Copilot licence is bought" },
    chartTitle: "Purchased against assigned, by SKU", chartKind: "bars",
    bars: [
      { l: "E5", v: "1,500 / 612", pct: 100, c: "#f87171", flag: "888 unassigned" },
      { l: "E3", v: "4,200 / 3,980", pct: 34, c: "#fbbf24", flag: "220 unassigned" },
      { l: "F3", v: "480 / 415", pct: 22, c: "#fbbf24", flag: "65 unassigned" },
      { l: "Copilot", v: "25 / 2", pct: 76, c: "#f87171", flag: "23 idle" }
    ],
    wrong: [
      "888 E5 seats are provisioned and unassigned — the single largest line of waste in the tenant.",
      "231 licensed accounts have not signed in for ninety days; 47 of those belong to people who have left.",
      "Removing an assignment does not reduce the bill — the subscription count has never been trued up at renewal."
    ],
    fix: [
      "Reclaim the departed accounts first — they are unambiguous and need no conversation.",
      "Place the 184 genuinely idle accounts on 30-day notice to their manager before reclaiming.",
      "Reduce the purchased count at the renewal date, not just the assignment."
    ],
    delta: [["Annual waste", "$847,608", "$0"], ["Unassigned seats", "1,308", "0"], ["Cost efficiency", "41", "84"]] },

  { id: "fit", n: "02", title: "Licence Fit", who: "marcus", lead: "Second — whether the people who hold a licence are holding the right one.",
    head: { v: "38%", l: "of seats assigned directly, not by group", tone: "#fbbf24", note: "every leaver is a manual step" },
    chartTitle: "Fit measured against ninety days of use", chartKind: "heat",
    heat: [
      { l: "Over-licensed", v: "612", sub: "E5 held, E3 workload", c: "#fbbf24" },
      { l: "Under-licensed", v: "148", sub: "F3 held, knowledge work", c: "#f87171" },
      { l: "Correctly fitted", v: "4,192", sub: "no action needed", c: "#34d399" },
      { l: "Departed, still licensed", v: "47", sub: "$20,304 a year", c: "#f87171" },
      { l: "Idle 90+ days", v: "184", sub: "assigned, unused", c: "#fbbf24" },
      { l: "Group-assigned", v: "62%", sub: "target is 100%", c: "#fbbf24" }
    ],
    wrong: [
      "Fit is assigned on job title rather than on measured workload use.",
      "148 people are under-licensed — they cannot do the work Copilot is meant to accelerate.",
      "Direct assignment means the joiner-mover-leaver process depends on somebody remembering."
    ],
    fix: [
      "Classify every account against the four real profiles in this tenant using ninety-day telemetry.",
      "Move all assignment to group-based licensing and retire direct grants.",
      "Wire licence removal to the HR termination event rather than to ticket closure."
    ],
    delta: [["Direct assignments", "38%", "0%"], ["Mis-fitted users", "760", "0"], ["Licence review", "never", "quarterly"]] },

  { id: "copilotseats", n: "03", title: "Copilot Seat Readiness", who: "shane", lead: "Third — Copilot itself. You already own seats you are not using.",
    head: { v: "2 of 25", l: "Copilot licences actually assigned", tone: "#f87171", note: "a 400-seat pilot needs 400" },
    chartTitle: "Copilot seat position", chartKind: "bars",
    bars: [
      { l: "Owned", v: "25", pct: 100, c: "#60a5fa", flag: "paid for" },
      { l: "Assigned", v: "2", pct: 8, c: "#f87171", flag: "8% used" },
      { l: "Eligible under current governance", v: "0", pct: 4, c: "#f87171", flag: "blocked" },
      { l: "Required for the pilot", v: "400", pct: 90, c: "#fbbf24", flag: "$144,000" }
    ],
    wrong: [
      "Nobody is eligible today — the content boundary is not labelled and the device baseline is not enforced.",
      "Twenty-three paid Copilot seats sit idle while the readiness conversation runs.",
      "The pilot cohort has not been defined, so there is no list to assign to when the gate clears."
    ],
    fix: [
      "Define the pilot cohort now — Finance and Legal, both inside a labelled boundary.",
      "Create a Copilot-eligible group with membership rules gated on labelling and device compliance.",
      "Assign the licence to the group so eligibility and entitlement can never diverge."
    ],
    delta: [["Copilot assigned", "2", "400"], ["Eligible users", "0", "1,535"], ["Licensing meter", "38%", "88%"]] },

  { id: "waste", n: "04", title: "Cost Recovery", who: "beth", lead: "Fourth — what comes back when this is corrected, and where it goes.",
    head: { v: "$1,010,000", l: "recoverable in the first year", tone: "#34d399", note: "against a $144,000 pilot" },
    chartTitle: "Recoverable spend by source", chartKind: "bars",
    bars: [
      { l: "E5 right-sizing", v: "$607,392", pct: 100, c: "#34d399", flag: "largest" },
      { l: "Unassigned seats", v: "$240,216", pct: 40, c: "#34d399", flag: "reclaim" },
      { l: "Duplicate third-party tooling", v: "$142,000", pct: 24, c: "#6ee7b7", flag: "overlap" },
      { l: "Departed accounts", v: "$20,304", pct: 5, c: "#6ee7b7", flag: "immediate" }
    ],
    wrong: [
      "1,180 seats still carry third-party tools that E5 already covers.",
      "The recovery has never been quantified, so it has never been argued for at renewal.",
      "Waste is discovered at renewal rather than monitored monthly."
    ],
    fix: [
      "Take the departed accounts and duplicate tooling first — they need no negotiation.",
      "Argue the right-sizing at renewal with ninety days of evidence attached.",
      "Alert when purchased-minus-assigned exceeds 5% for any SKU so this cannot re-accumulate."
    ],
    delta: [["Recoverable", "$0 claimed", "$1,010,000"], ["Pilot funding gap", "$144,000", "self-funded"], ["Review cadence", "at renewal", "monthly"]] },

  { id: "licgate", n: "05", title: "Licensing & the Copilot Gate", who: "shane", gate: true, lead: "And this is what licensing means for the go/no-go. This is the money slide.",
    head: { v: "$0", l: "of new budget required", tone: "#34d399", note: "the programme funds itself" },
    chartTitle: "Where the money already is", chartKind: "heat",
    heat: [
      { l: "Annual spend as provisioned", v: "$3.2M", sub: "current position", c: "#94a3b8" },
      { l: "Spent on unassigned seats", v: "$847K", sub: "recoverable", c: "#f87171" },
      { l: "Cost of a 400-seat pilot", v: "$144K", sub: "one-off", c: "#fbbf24" },
      { l: "Recovery against pilot", v: "7×", sub: "funds it over", c: "#34d399" },
      { l: "Remediation programme", v: "$0 new", sub: "inside recovery", c: "#34d399" },
      { l: "Net first-year position", v: "+$866K", sub: "returned", c: "#34d399" }
    ],
    wrong: [
      "Licensing is not what blocks Copilot here — governance is. But licensing is what pays for fixing it.",
      "Presented as a budget request, this programme fails. Presented as a reallocation, it is already funded.",
      "Every month the position is not corrected costs roughly $70,000."
    ],
    fix: [
      "Right-size and reclaim before the renewal date to lock the recovery in.",
      "Fund the pilot and the remediation from the recovery rather than from new budget.",
      "Report the licence position monthly alongside the readiness score."
    ],
    delta: [["New budget required", "$144,000", "$0"], ["Licensing meter", "38%", "88%"], ["Copilot readiness", "34%", "41%"]] }
];

export const LIC_WALK_ANALYST = [
  { id: "skus", n: "A1", title: "SKU Distribution", who: "marcus", lead: "Analyst view — the same spend, grouped the way procurement works it. First: SKU distribution.",
    head: { v: "6,180", l: "seats across four SKUs", tone: "#fbbf24", note: "1,308 of them unassigned" },
    chartTitle: "Assignment rate by SKU", chartKind: "bars",
    bars: [
      { l: "E5 assigned", v: "41%", pct: 41, c: "#f87171", flag: "888 idle" },
      { l: "E3 assigned", v: "95%", pct: 95, c: "#34d399", flag: "healthy" },
      { l: "F3 assigned", v: "86%", pct: 86, c: "#fbbf24", flag: "65 idle" },
      { l: "Copilot assigned", v: "8%", pct: 8, c: "#f87171", flag: "23 idle" }
    ],
    wrong: [
      "E5 was bought for a compliance programme that was scoped down and never re-negotiated.",
      "No SKU has a named owner accountable for its assignment rate.",
      "Assignment rate is not reported anywhere between renewals."
    ],
    fix: [
      "Set an assignment-rate floor of 95% per SKU and report against it monthly.",
      "Give each SKU an owner who signs off the count at renewal.",
      "Re-baseline E5 to the population that genuinely needs it."
    ],
    delta: [["E5 assignment rate", "41%", "97%"], ["Unassigned seats", "1,308", "0"], ["SKU owners named", "0", "4"]] },

  { id: "lifecycle", n: "A2", title: "Licence Lifecycle", who: "marcus", lead: "Second: how licences arrive and how they leave — this is where the drift comes from.",
    head: { v: "47", l: "licensed accounts belong to departed staff", tone: "#f87171", note: "the oldest is 14 months" },
    chartTitle: "Lifecycle integrity", chartKind: "heat",
    heat: [
      { l: "Joiner automation", v: "partial", sub: "manual for E5", c: "#fbbf24" },
      { l: "Mover process", v: "none", sub: "SKU never revisited", c: "#f87171" },
      { l: "Leaver automation", v: "at ticket close", sub: "not at HR event", c: "#f87171" },
      { l: "Group-based assignment", v: "62%", sub: "target 100%", c: "#fbbf24" },
      { l: "Reclaim SLA", v: "none", sub: "no target set", c: "#f87171" },
      { l: "Renewal true-up", v: "never", sub: "count only grows", c: "#f87171" }
    ],
    wrong: [
      "There is no mover process at all — a person changing role keeps whatever they had.",
      "Leaver reclaim happens when a ticket closes, which can be weeks after the person left.",
      "The purchased count has only ever gone up."
    ],
    fix: [
      "Trigger licence removal from the HR termination event directly.",
      "Add a mover step that re-evaluates SKU on any role change.",
      "Set a 5-day reclaim SLA and report against it."
    ],
    delta: [["Departed, licensed", "47", "0"], ["Reclaim SLA", "none", "5 days"], ["Group-assigned", "62%", "100%"]] },

  { id: "overlap", n: "A3", title: "Tooling Overlap", who: "shane", lead: "Third: what you are buying twice.",
    head: { v: "1,180", l: "seats on tools E5 already covers", tone: "#fbbf24", note: "$142,000 a year" },
    chartTitle: "Duplicate spend by category", chartKind: "bars",
    bars: [
      { l: "eSignature", v: "$58,000", pct: 100, c: "#fbbf24", flag: "E5 covers" },
      { l: "Secure file transfer", v: "$41,000", pct: 71, c: "#fbbf24", flag: "E5 covers" },
      { l: "Meeting transcription", v: "$28,000", pct: 48, c: "#fbbf24", flag: "Teams covers" },
      { l: "eDiscovery add-on", v: "$15,000", pct: 26, c: "#6ee7b7", flag: "Purview covers" }
    ],
    wrong: [
      "Each tool was bought by a different department with its own budget line.",
      "Nobody has mapped third-party spend against E5 entitlement.",
      "Contract end dates are not tracked centrally, so renewals happen by default."
    ],
    fix: [
      "Map every third-party contract against E5 entitlement before its next renewal date.",
      "Migrate the two largest overlaps first — they account for $99,000 of the $142,000.",
      "Hold departmental tool purchases behind an entitlement check."
    ],
    delta: [["Duplicate spend", "$142,000", "$0"], ["Tools overlapping E5", "4", "0"], ["Entitlement check", "none", "required"]] },

  { id: "forecast", n: "A4", title: "Forecast & Renewal", who: "shane", lead: "Last: what this looks like at the renewal date if nothing changes.",
    head: { v: "$3.4M", l: "next-year spend on the current path", tone: "#f87171", note: "against $2.2M corrected" },
    chartTitle: "Twelve-month forecast", chartKind: "bars",
    bars: [
      { l: "Current path", v: "$3.4M", pct: 100, c: "#f87171", flag: "no change" },
      { l: "Reclaim only", v: "$2.9M", pct: 74, c: "#fbbf24", flag: "easy wins" },
      { l: "Reclaim + right-size", v: "$2.4M", pct: 52, c: "#6ee7b7", flag: "recommended" },
      { l: "Plus tooling consolidation", v: "$2.2M", pct: 42, c: "#34d399", flag: "full" }
    ],
    wrong: [
      "The renewal date is inside the remediation window, so the decision has to be made before the work finishes.",
      "Without evidence, the vendor conversation defaults to last year's count plus growth.",
      "Copilot seats bought at the wrong time sit idle through the governance work."
    ],
    fix: [
      "Take the ninety-day evidence into the renewal rather than the historic count.",
      "Stage Copilot seat purchase to the pilot date, not to the renewal date.",
      "Lock the corrected baseline into the contract so it cannot drift back."
    ],
    delta: [["Next-year spend", "$3.4M", "$2.2M"], ["Evidence at renewal", "none", "90 days"], ["Copilot timing", "unaligned", "staged"]] }
];

export const DIVE_CFG = {
  governance: { word: "GOVERNANCE", color: "#3B82F6", ink: "#60A5FA", soft: "#93C5FD",
    icon: "M12 2l8 5H4l8-5zM6 11v7M10 11v7M14 11v7M18 11v7M2 22h20M2 11h20",
    kicker: "Pillar deep-dive · live telemetry", title: "Governance Exposure & Oversharing", sub: "What Copilot can see today",
    base: 34, cap: 89, readyCap: 64, nextPillar: "licensing", nextLabel: "licensing" },
  sow: { word: "STATEMENT OF WORK", color: "#0E7490", ink: "#67e8f9", soft: "#a5f3fc", grad: true,
    icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6",
    kicker: "The deliverable · scoped with you", title: "Statement of Work", sub: "What we will do, in what order, for what",
    base: 34, cap: 78, readyCap: 78, nextPillar: null, nextLabel: "signature" },
  copilot: { word: "COPILOT", color: "#67E8F9", ink: "#A5F3FC", soft: "#CFFAFE", grad: true,
    icon: "M12 2.5 14.2 8.9 20.6 11 14.2 13.1 12 19.5 9.8 13.1 3.4 11 9.8 8.9zM18.5 3 19.3 5.2 21.5 6 19.3 6.8 18.5 9 17.7 6.8 15.5 6 17.7 5.2zM6 15.5 6.6 17.2 8.3 17.8 6.6 18.4 6 20.1 5.4 18.4 3.7 17.8 5.4 17.2z",
    kicker: "The decision · every pillar folded in", title: "Copilot Readiness — Go / No-Go", sub: "What it would expose, what it would return",
    base: 34, cap: 78, readyCap: 78, nextPillar: null, nextLabel: "the statement of work" },
  timeline: { word: "TIMELINE", color: "#0078D4", ink: "#7dd3fc", soft: "#bae6fd",
    icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    kicker: "Gate clearance · week by week", title: "Copilot Gate Remediation Timeline", sub: "The 12-week critical path",
    base: 34, cap: 78, readyCap: 78, nextPillar: null, nextLabel: "certification" },
  remediation: { word: "REMEDIATION PLAN", color: "#34d399", ink: "#6ee7b7", soft: "#a7f3d0",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    kicker: "Gate clearance · every action, sequenced", title: "Full Remediation Guide", sub: "What has to happen, in what order, to clear the gate",
    base: 34, cap: 78, readyCap: 78, nextPillar: null, nextLabel: "certification" },
  docs: { word: "DOCUMENTS", color: "#0078D4", ink: "#7dd3fc", soft: "#bae6fd",
    icon: "M4 4h7l2 3h7v13H4zM8 12h8M8 16h5",
    kicker: "Every deliverable · produced from the scan", title: "Assessment Documents", sub: "Seven reports and the statement of work",
    base: 34, cap: 78, readyCap: 78, nextPillar: null, nextLabel: "signature" },
  security: { word: "SECURITY", color: "#8B5CF6", ink: "#A78BFA", soft: "#C4B5FD",
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    kicker: "Pillar deep-dive · live telemetry", title: "Security & Blast Radius", sub: "Reachability, not posture scores",
    base: 51, cap: 89, readyCap: 48, nextPillar: "copilot", nextLabel: "the Copilot decision" },
  health: { word: "TENANT HEALTH", color: "#22C55E", ink: "#4ADE80", soft: "#fed7aa",
    icon: "M22 12h-4l-3 9L9 3l-3 9H2",
    kicker: "Pillar deep-dive · live telemetry", title: "Tenant Health & Operations", sub: "Whether this survives contact with a Tuesday",
    base: 58, cap: 88, readyCap: 43, nextPillar: "security", nextLabel: "security" },
  compliance: { word: "COMPLIANCE", color: "#F3F4F6", ink: "#c4b5fd", soft: "#ddd6fe",
    icon: "M12 3v18M5 7l7-4 7 4M4 21h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l3 7a3 3 0 0 1-6 0z",
    kicker: "Pillar deep-dive · live telemetry", title: "Compliance & Regulatory Position", sub: "Whether containment is provable",
    base: 38, cap: 84, readyCap: 46, nextPillar: "health", nextLabel: "tenant health" },
  adoption: { word: "ADOPTION", color: "#F97316", ink: "#FDBA74", soft: "#bbf7d0",
    icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    kicker: "Pillar deep-dive · live telemetry", title: "Copilot Adoption & Enablement", sub: "Whether your people would actually use it",
    base: 54, cap: 86, readyCap: 44, nextPillar: "compliance", nextLabel: "compliance" },
  licensing: { word: "LICENSING", color: "#14B8A6", ink: "#5eead4", soft: "#99f6e4",
    icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
    kicker: "Pillar deep-dive · live telemetry", title: "Copilot Licensing Alignment", sub: "What you are paying for today",
    base: 38, cap: 92, readyCap: 41, nextPillar: "adoption", nextLabel: "adoption" }
};




// ── Adoption walkthrough — same shape as governance and licensing ────────────
export const ADO_WALK = [
  { id: "usage", n: "01", title: "Usage Reality", who: "marcus", lead: "Let's start with what your people actually do all day, measured rather than assumed.",
    head: { v: "1,631", l: "daily active users of 1,876", tone: "#34d399", note: "the base is there — the habits are not" },
    chartTitle: "Workload use, daily active", chartKind: "bars",
    bars: [
      { l: "Outlook", v: "96%", pct: 96, c: "#34d399", flag: "universal" },
      { l: "Teams", v: "88%", pct: 88, c: "#34d399", flag: "strong" },
      { l: "Word / Excel", v: "72%", pct: 72, c: "#fbbf24", flag: "mixed" },
      { l: "SharePoint / OneDrive", v: "59%", pct: 59, c: "#fbbf24", flag: "weak" },
      { l: "Copilot", v: "31%", pct: 31, c: "#f87171", flag: "of the 25 licensed" }
    ],
    wrong: [
      "Work happens in chat rather than in libraries — 64% of files are shared in a Teams message, not saved to a site.",
      "Content shared in chat is weakly governed and weakly indexed, so Copilot grounds on the worst copy of a document.",
      "Adoption has never been measured against a target, so nobody can say whether it is improving."
    ],
    fix: [
      "Set a file-in-library target and report against it monthly — this is the single behaviour that most improves grounding.",
      "Move the top twenty recurring documents into owned libraries before the pilot starts.",
      "Publish an adoption baseline now so the pilot has something to be measured against."
    ],
    delta: [["Files shared in chat", "64%", "25%"], ["Copilot active users", "31%", "78%"], ["Adoption pillar", "54", "86"]] },

  { id: "meetings", n: "02", title: "Meeting Intelligence", who: "marcus", lead: "Second — meetings, because this is where Copilot pays back fastest and where you are most blocked.",
    head: { v: "22%", l: "of meetings are transcribed", tone: "#f87171", note: "no transcript, no recap" },
    chartTitle: "Meeting signal available to Copilot", chartKind: "heat",
    heat: [
      { l: "Meetings per week", v: "4,180", sub: "across the tenant", c: "#94a3b8" },
      { l: "Transcribed", v: "22%", sub: "policy set to off by default", c: "#f87171" },
      { l: "Recorded", v: "18%", sub: "ad hoc, no retention rule", c: "#f87171" },
      { l: "With an agenda", v: "31%", sub: "weak prompt context", c: "#fbbf24" },
      { l: "Recap-eligible", v: "22%", sub: "matches transcription", c: "#f87171" },
      { l: "Channel meetings", v: "44%", sub: "content lands in the site", c: "#34d399" }
    ],
    wrong: [
      "Transcription is off by default at tenant level, so the highest-frequency Copilot use case has nothing to read.",
      "Recording has no retention rule, so what is captured is deleted unpredictably.",
      "Without agendas, recaps have no structure to summarise against."
    ],
    fix: [
      "Turn transcription on by default with a clear notice, and let users opt out rather than opt in.",
      "Apply a retention label to recordings so recaps remain available for the pilot window.",
      "Ask the top thirty meeting organisers to add agendas — it measurably improves recap quality."
    ],
    delta: [["Meetings transcribed", "22%", "85%"], ["Recap-eligible", "22%", "85%"], ["Hours returned weekly", "0", "1,140"]] },

  { id: "champions", n: "03", title: "Champions & Enablement", who: "jane", lead: "Third — the human layer. This is what decides whether the licence gets used in week three.",
    head: { v: "0", l: "named champions across 1,876 seats", tone: "#f87171", note: "the target is one per fifty" },
    chartTitle: "Enablement readiness", chartKind: "bars",
    bars: [
      { l: "Champions needed", v: "38", pct: 100, c: "#f87171", flag: "0 today" },
      { l: "Role-based tracks built", v: "0 of 4", pct: 92, c: "#f87171", flag: "one generic deck" },
      { l: "Managers briefed", v: "12%", pct: 24, c: "#fbbf24", flag: "sponsorship gap" },
      { l: "Prompt library published", v: "no", pct: 88, c: "#f87171", flag: "blank page problem" }
    ],
    wrong: [
      "One generic enablement deck is used for every role — a clinician does not care about denials analysis.",
      "Nobody owns adoption after go-live, so usage decays quietly from week three.",
      "There is no prompt library, so users face a blank box and give up."
    ],
    fix: [
      "Name 38 champions — one per fifty seats — with a monthly cadence and a direct escalation path.",
      "Build four ninety-minute role tracks grounded in each role's real workflow.",
      "Publish a prompt library of twenty prompts per role before day one."
    ],
    delta: [["Named champions", "0", "38"], ["Role tracks", "0", "4"], ["Week-3 retention", "unknown", "measured"]] },

  { id: "workflows", n: "04", title: "Workflows Worth Automating", who: "marcus", lead: "Fourth — where the hours actually are, and which of them Copilot can genuinely take.",
    head: { v: "6.4 hrs", l: "per person per week on routine documentation", tone: "#fbbf24", note: "measured across 1,876 seats" },
    chartTitle: "Return by workflow", chartKind: "bars",
    bars: [
      { l: "Drafting routine documents", v: "3.5 hrs/wk", pct: 100, c: "#34d399", flag: "highest return" },
      { l: "Meeting recap and actions", v: "1.6 hrs/wk", pct: 46, c: "#34d399", flag: "needs transcripts" },
      { l: "Finding prior work", v: "0.9 hrs/wk", pct: 26, c: "#6ee7b7", flag: "needs governance" },
      { l: "Ticket deflection", v: "136 /wk", pct: 62, c: "#34d399", flag: "support team" }
    ],
    wrong: [
      "The highest-return workflow depends on labelled content, so adoption is gated by governance, not by training.",
      "Recap value is capped at 22% until transcription is turned on.",
      "None of these has a named owner who will measure it after go-live."
    ],
    fix: [
      "Sequence enablement behind the governance work so the first experience is a good one.",
      "Instrument each workflow with a before-and-after measure taken from real usage.",
      "Pick two workflows for the pilot rather than all four — proof beats breadth."
    ],
    delta: [["Hours returned weekly", "0", "1,140"], ["Annualised value", "$0", "$4.1M"], ["Workflows instrumented", "0", "4"]] },

  { id: "adogate", n: "05", title: "Adoption & the Copilot Gate", who: "shane", gate: true, lead: "And this is what adoption means for the go/no-go. Buying seats is not the same as landing them.",
    head: { v: "31%", l: "of licensed users are active in Copilot", tone: "#f87171", note: "the benchmark for a successful pilot is 70%" },
    chartTitle: "What decides whether the pilot lands", chartKind: "heat",
    heat: [
      { l: "Daily active base", v: "87%", sub: "strong foundation", c: "#34d399" },
      { l: "Transcription", v: "22%", sub: "gates recaps", c: "#f87171" },
      { l: "Champions", v: "0", sub: "gates retention", c: "#f87171" },
      { l: "Role tracks", v: "0 of 4", sub: "gates first experience", c: "#f87171" },
      { l: "Governed content", v: "78%", sub: "gates answer quality", c: "#fbbf24" },
      { l: "Executive sponsor", v: "named", sub: "in place", c: "#34d399" }
    ],
    wrong: [
      "Adoption is the pillar that decides whether the money spent on licences turns into hours returned.",
      "A pilot launched without champions and role tracks typically decays to under 20% active by week six.",
      "Every hour of enablement not done before go-live costs roughly four hours of support afterwards."
    ],
    fix: [
      "Do not start the pilot until champions are named and the role tracks exist.",
      "Turn transcription on at least four weeks ahead so there is history to recap against.",
      "Measure week-three retention as the success metric, not day-one logins."
    ],
    delta: [["Copilot active", "31%", "78%"], ["Adoption pillar", "54", "86"], ["Copilot readiness", "34%", "44%"]] }
];

export const ADO_WALK_ANALYST = [
  { id: "cohorts", n: "A1", title: "Cohort Readiness", who: "jane", lead: "Analyst view — the same population, grouped by who is ready to be given a seat. First: cohorts.",
    head: { v: "4", l: "distinct role cohorts in the tenant", tone: "#fbbf24", note: "one enablement deck covers all four" },
    chartTitle: "Readiness by cohort", chartKind: "bars",
    bars: [
      { l: "Attending clinicians · 2,140", v: "38%", pct: 38, c: "#f87171", flag: "PHI boundary" },
      { l: "Nurse managers · 480", v: "61%", pct: 61, c: "#fbbf24", flag: "shift handover" },
      { l: "Revenue cycle · 310", v: "72%", pct: 72, c: "#fbbf24", flag: "labelled content" },
      { l: "Compliance · 40", v: "84%", pct: 84, c: "#34d399", flag: "pilot-ready" }
    ],
    wrong: [
      "The largest cohort is the least ready — clinicians work inside the PHI boundary that is not yet labelled.",
      "Cohort readiness has never been calculated, so pilot selection would be by volunteer rather than by fit.",
      "Compliance is the most ready cohort and the smallest — a pilot there proves little."
    ],
    fix: [
      "Pilot revenue cycle first — 310 seats, labelled content, measurable outcome.",
      "Bring clinicians in only after the PHI backlog is labelled.",
      "Score every cohort on content readiness, device compliance and workload fit before assigning seats."
    ],
    delta: [["Cohorts scored", "0", "4"], ["Pilot-ready seats", "40", "350"], ["Selection basis", "volunteer", "measured"]] },

  { id: "content", n: "A2", title: "Content Readiness", who: "jane", lead: "Second: whether the content those people work in is fit for Copilot to read.",
    head: { v: "64%", l: "of files are shared in chat, not libraries", tone: "#f87171", note: "the worst copy wins" },
    chartTitle: "Where the work actually lives", chartKind: "heat",
    heat: [
      { l: "Shared in Teams chat", v: "64%", sub: "weakly indexed", c: "#f87171" },
      { l: "In owned libraries", v: "29%", sub: "ideal for grounding", c: "#34d399" },
      { l: "In personal OneDrive", v: "7%", sub: "invisible to colleagues", c: "#fbbf24" },
      { l: "Duplicate versions", v: "3.4 avg", sub: "per active document", c: "#f87171" },
      { l: "With an owner", v: "31%", sub: "nobody to ask", c: "#f87171" },
      { l: "Labelled", v: "78%", sub: "improving", c: "#fbbf24" }
    ],
    wrong: [
      "An average active document exists in 3.4 versions, and Copilot has no way to know which is current.",
      "Chat-shared files inherit no site governance and no retention.",
      "Without owners, no version can be declared authoritative."
    ],
    fix: [
      "Declare one authoritative library per team and move the recurring documents into it.",
      "Turn off file attachment in chat for the pilot cohort — share links instead.",
      "Assign owners to the top hundred documents by access volume."
    ],
    delta: [["Files in libraries", "29%", "75%"], ["Duplicate versions", "3.4", "1.2"], ["Documents with an owner", "31%", "100%"]] },

  { id: "measure", n: "A3", title: "Measurement & Retention", who: "shane", lead: "Last: how you will know whether any of this worked.",
    head: { v: "0", l: "adoption metrics currently reported", tone: "#f87171", note: "no baseline, no target, no owner" },
    chartTitle: "Instrumentation in place", chartKind: "bars",
    bars: [
      { l: "Baseline captured", v: "no", pct: 100, c: "#f87171", flag: "start here" },
      { l: "Week-3 retention tracked", v: "no", pct: 88, c: "#f87171", flag: "the real metric" },
      { l: "Per-workflow measure", v: "no", pct: 76, c: "#f87171", flag: "no proof" },
      { l: "Executive report", v: "monthly", pct: 30, c: "#34d399", flag: "channel exists" }
    ],
    wrong: [
      "Day-one logins get reported and week-three retention does not — the first number always looks good.",
      "Without a baseline taken before the pilot, no improvement can be attributed to Copilot.",
      "There is no owner for adoption after go-live."
    ],
    fix: [
      "Capture the baseline this month, before any seat is assigned.",
      "Report week-three retention and hours returned, not licence count.",
      "Name an adoption owner with the same standing as the security owner."
    ],
    delta: [["Metrics reported", "0", "4"], ["Baseline", "none", "captured"], ["Adoption owner", "none", "named"]] }
];


// ── Compliance walkthrough — same shape as the other pillars ─────────────────
export const CMP_WALK = [
  { id: "classification", n: "01", title: "Classification Coverage", who: "beth", lead: "Let's start with what your regulated content is labelled as, because everything legal turns on that.",
    head: { v: "40,480", l: "regulated files carrying no label", tone: "#f87171", note: "PHI, PII and contractual" },
    chartTitle: "Label coverage by content class", chartKind: "bars",
    bars: [
      { l: "PHI containers", v: "78%", pct: 78, c: "#fbbf24", flag: "22% exposed" },
      { l: "Financial records", v: "71%", pct: 71, c: "#fbbf24", flag: "partial" },
      { l: "Contractual", v: "88%", pct: 88, c: "#34d399", flag: "near complete" },
      { l: "Everything else", v: "0%", pct: 4, c: "#f87171", flag: "unclassified at birth" }
    ],
    wrong: [
      "Default labels are not applied at provisioning, so every new document is born unclassified.",
      "Three PHI classifiers sit in simulation mode — they report matches and block nothing.",
      "Without a label, a grounded answer inherits no protection and no classification warning."
    ],
    fix: [
      "Promote the three classifiers out of simulation after sampling 500 matches for false positives.",
      "Enable default labels at site provisioning so the backlog stops growing while you clear it.",
      "Auto-label the regulated backlog starting with clinical and billing libraries."
    ],
    delta: [["Regulated files unlabelled", "40,480", "1,120"], ["Classifiers enforcing", "0 of 3", "3 of 3"], ["Compliance pillar", "38", "84"]] },

  { id: "dlp", n: "02", title: "Data Loss Prevention", who: "kirk", lead: "Second — whether anything actually stops regulated content leaving.",
    head: { v: "2", l: "policy sets that never evaluate", tone: "#f87171", note: "1,412 mailboxes uncovered" },
    chartTitle: "DLP coverage by surface", chartKind: "heat",
    heat: [
      { l: "Exchange egress", v: "62%", sub: "finance and legal uncovered", c: "#f87171" },
      { l: "SharePoint / OneDrive", v: "74%", sub: "partial scope", c: "#fbbf24" },
      { l: "Teams messages", v: "58%", sub: "chat not evaluated", c: "#f87171" },
      { l: "Endpoint DLP", v: "0%", sub: "not deployed", c: "#f87171" },
      { l: "Copilot prompts", v: "0%", sub: "outside scope entirely", c: "#f87171" },
      { l: "Rules in enforce mode", v: "15 of 18", sub: "3 in simulation", c: "#fbbf24" }
    ],
    wrong: [
      "Copilot prompts and responses are not evaluated by any DLP policy — the newest egress path is the only ungoverned one.",
      "Two policy sets were scoped to pilot groups in 2023 and never widened.",
      "Three rules remain in simulation, reporting matches and blocking nothing."
    ],
    fix: [
      "Extend the existing policies to finance and legal rather than writing new ones.",
      "Add Copilot as a location so prompts and responses are evaluated like any other egress.",
      "Promote the three simulation rules to enforce in the next change window."
    ],
    delta: [["Mailboxes uncovered", "1,412", "0"], ["Copilot prompt coverage", "0%", "100%"], ["Rules enforcing", "15 of 18", "18 of 18"]] },

  { id: "retention", n: "03", title: "Retention & Audit", who: "beth", lead: "Third — whether you could reconstruct what happened if a regulator asked.",
    head: { v: "180 days", l: "of audit retention", tone: "#fbbf24", note: "your obligation is seven years" },
    chartTitle: "Evidence position", chartKind: "bars",
    bars: [
      { l: "Audit log retention", v: "180 days", pct: 22, c: "#fbbf24", flag: "short" },
      { l: "Retention labels published", v: "12", pct: 55, c: "#fbbf24", flag: "unevenly applied" },
      { l: "Copilot chat history", v: "unmanaged", pct: 96, c: "#f87171", flag: "no retention rule" },
      { l: "Legal hold coverage", v: "41%", pct: 41, c: "#f87171", flag: "manual" }
    ],
    wrong: [
      "Copilot chat history sits outside the retention scheme entirely — the record of what was asked and answered is not kept.",
      "Audit retention is 180 days against a seven-year obligation for clinical records.",
      "Legal hold is applied by hand, so coverage depends on somebody remembering."
    ],
    fix: [
      "Bring Copilot interactions into the retention scheme before the pilot starts.",
      "Extend audit retention to match the longest regulatory obligation you carry.",
      "Automate legal hold from the matter record rather than from a ticket."
    ],
    delta: [["Audit retention", "180 days", "7 years"], ["Copilot history retained", "no", "yes"], ["Legal hold coverage", "41%", "100%"]] },

  { id: "regulatory", n: "04", title: "Regulatory Exposure", who: "beth", lead: "Fourth — what the regulations you operate under actually require of an AI system.",
    head: { v: "4", l: "regimes in scope for this tenant", tone: "#fbbf24", note: "HIPAA, 42 CFR Part 2, state breach law, Joint Commission" },
    chartTitle: "Obligation against current position", chartKind: "heat",
    heat: [
      { l: "HIPAA / HITECH", v: "partial", sub: "PHI reachable unlabelled", c: "#f87171" },
      { l: "42 CFR Part 2", v: "at risk", sub: "SUD records not segregated", c: "#f87171" },
      { l: "State breach law", v: "partial", sub: "72-hour clock, manual detection", c: "#fbbf24" },
      { l: "Joint Commission", v: "met", sub: "documentation current", c: "#34d399" },
      { l: "MSA §7.4", v: "at risk", sub: "disclosure becomes reportable", c: "#f87171" },
      { l: "Breach notification drill", v: "never run", sub: "untested", c: "#f87171" }
    ],
    wrong: [
      "A PHI disclosure in a generated answer is reportable under the MSA — internal handling is not an option.",
      "42 CFR Part 2 records are not segregated, so they sit inside the same grounding surface as everything else.",
      "The breach notification process has never been rehearsed against a 72-hour clock."
    ],
    fix: [
      "Segregate Part 2 records into a labelled boundary excluded from Copilot grounding.",
      "Run a tabletop breach drill with the AI disclosure scenario before the pilot widens.",
      "Record the compliance position as evidence at each remediation wave."
    ],
    delta: [["Regimes fully met", "1 of 4", "4 of 4"], ["Reportable exposure", "open", "closed"], ["Breach drill", "never", "quarterly"]] },

  { id: "cmpgate", n: "05", title: "Compliance & the Copilot Gate", who: "beth", gate: true, lead: "And this is the legal position on go/no-go. This is the slide your counsel will read.",
    head: { v: "reportable", l: "if PHI surfaces in a generated answer today", tone: "#f87171", note: "not an internal incident" },
    chartTitle: "What has to be true before enablement", chartKind: "heat",
    heat: [
      { l: "Regulated content labelled", v: "78%", sub: "target 99%", c: "#f87171" },
      { l: "DLP over Copilot", v: "none", sub: "required", c: "#f87171" },
      { l: "Copilot history retained", v: "no", sub: "required", c: "#f87171" },
      { l: "Part 2 segregated", v: "no", sub: "required", c: "#f87171" },
      { l: "Change record signed", v: "drafted", sub: "approver named", c: "#fbbf24" },
      { l: "Audit trail", v: "180 days", sub: "reconstructable", c: "#34d399" }
    ],
    wrong: [
      "Provable containment is the standard, not best-effort assurance. Today you cannot prove it.",
      "Every one of these is a control that exists in the licences you already hold.",
      "A scoped pilot inside a labelled boundary is defensible. A tenant-wide rollout today is not."
    ],
    fix: [
      "Close labelling and DLP scope, then pilot inside Finance and Legal under audit retention.",
      "Sign the change record once DLP closes, not before.",
      "Re-run the evidence pack after each wave so the position is documented, not asserted."
    ],
    delta: [["Provable containment", "no", "yes"], ["Compliance pillar", "38", "84"], ["Copilot readiness", "34%", "46%"]] }
];

export const CMP_WALK_ANALYST = [
  { id: "policy", n: "A1", title: "Policy Estate", who: "kirk", lead: "Analyst view — the same obligations, grouped by the policy objects that carry them.",
    head: { v: "18", l: "DLP rules across 6 policy sets", tone: "#fbbf24", note: "3 still in simulation" },
    chartTitle: "Policy objects by state", chartKind: "bars",
    bars: [
      { l: "Enforcing", v: "15", pct: 83, c: "#34d399", flag: "live" },
      { l: "Simulation", v: "3", pct: 34, c: "#fbbf24", flag: "blocking nothing" },
      { l: "Unscoped locations", v: "4", pct: 44, c: "#f87171", flag: "gaps" },
      { l: "Rules with no owner", v: "7", pct: 62, c: "#fbbf24", flag: "unreviewed" }
    ],
    wrong: [
      "Seven rules have no owner, so nobody reviews their match rate or their false positives.",
      "Four locations are simply not covered by any policy — Teams chat and Copilot among them.",
      "Policy changes are not tied to change control, so scope drifts silently."
    ],
    fix: [
      "Assign an owner to every rule and review match rates monthly.",
      "Cover the four uncovered locations with the existing policy rather than new ones.",
      "Bring policy edits inside the change process so scope cannot drift."
    ],
    delta: [["Rules enforcing", "15", "18"], ["Uncovered locations", "4", "0"], ["Rules with an owner", "11", "18"]] },

  { id: "evidence", n: "A2", title: "Evidence & Defensibility", who: "beth", lead: "Second: whether the position is provable rather than asserted.",
    head: { v: "0", l: "evidence packs produced this year", tone: "#f87171", note: "the position exists only in slides" },
    chartTitle: "Defensibility of the current position", chartKind: "heat",
    heat: [
      { l: "Scan output retained", v: "yes", sub: "raw JSON exportable", c: "#34d399" },
      { l: "Change records signed", v: "no", sub: "drafted only", c: "#f87171" },
      { l: "Control testing", v: "annual", sub: "should be continuous", c: "#fbbf24" },
      { l: "AI-specific controls", v: "none", sub: "no policy covers Copilot", c: "#f87171" },
      { l: "Board reporting", v: "quarterly", sub: "channel exists", c: "#34d399" },
      { l: "Regulator-ready pack", v: "no", sub: "would take weeks", c: "#f87171" }
    ],
    wrong: [
      "No policy in the estate mentions AI, so there is nothing to point a regulator at.",
      "Assembling a regulator-ready pack today would take weeks of manual work.",
      "Control testing is annual, which means the evidence is stale for eleven months of the year."
    ],
    fix: [
      "Write an AI-use control into the policy estate before the pilot, not after.",
      "Automate the evidence pack from the scan output so it is always current.",
      "Move control testing to continuous, aligned to the monitoring cadence."
    ],
    delta: [["AI-specific controls", "0", "3"], ["Evidence pack", "weeks", "on demand"], ["Control testing", "annual", "continuous"]] }
];


// ── Tenant Health walkthrough — same shape as the other pillars ──────────────
export const HLT_WALK = [
  { id: "baseline", n: "01", title: "Device Baseline", who: "marcus", lead: "Let's start with the endpoints, because that is where every prompt and every answer is actually rendered.",
    head: { v: "312", l: "endpoints outside the compliance baseline", tone: "#f87171", note: "one device in six" },
    chartTitle: "Endpoint posture", chartKind: "bars",
    bars: [
      { l: "Compliant", v: "1,564", pct: 84, c: "#34d399", flag: "94.2%" },
      { l: "Drifted since re-scope", v: "312", pct: 100, c: "#f87171", flag: "autopilot profile" },
      { l: "Behind patch ring 3", v: "218", pct: 62, c: "#fbbf24", flag: "two cycles" },
      { l: "Unassigned to a group", v: "94", pct: 34, c: "#fbbf24", flag: "no policy applies" }
    ],
    wrong: [
      "312 devices fell out of compliance when the autopilot profile was re-scoped and nobody re-published the baseline.",
      "The baseline itself is eleven days old and drift detection runs by hand.",
      "94 devices belong to no group at all, so no policy evaluates them."
    ],
    fix: [
      "Re-publish the compliance baseline and re-assign the orphaned device groups.",
      "Move drift detection to continuous rather than a manual check.",
      "Bring patch ring 3 current before the pilot starts."
    ],
    delta: [["Endpoints drifted", "312", "41"], ["Baseline age", "11 days", "continuous"], ["Health pillar", "58", "88"]] },

  { id: "service", n: "02", title: "Service Health & Incidents", who: "marcus", lead: "Second — whether the platform itself is steady enough to carry a new workload.",
    head: { v: "340", l: "tickets a week", tone: "#fbbf24", note: "40% answerable from existing content" },
    chartTitle: "Where the support load sits", chartKind: "heat",
    heat: [
      { l: "Tickets per week", v: "340", sub: "steady, not spiking", c: "#fbbf24" },
      { l: "Self-answerable", v: "40%", sub: "136 a week", c: "#f87171" },
      { l: "Ticket aging", v: "climbing", sub: "access issues dominate", c: "#f87171" },
      { l: "SLA compliance", v: "99%", sub: "holding", c: "#34d399" },
      { l: "Service incidents", v: "nominal", sub: "no open Microsoft advisories", c: "#34d399" },
      { l: "Automated runbooks", v: "0", sub: "every fix is manual", c: "#f87171" }
    ],
    wrong: [
      "Four tickets in ten could be answered from content the tenant already holds — if that content were findable.",
      "There are no automated runbooks, so the same five alerts are worked by hand every week.",
      "Ticket aging is climbing while the team firefights access problems created by the sharing model."
    ],
    fix: [
      "Automate the top five recurring alerts before adding a new workload.",
      "Deflect the 136 self-answerable tickets with grounded answers once governance closes.",
      "Publish an escalation path for Copilot issues before the pilot, not after."
    ],
    delta: [["Tickets per week", "340", "204"], ["Automated runbooks", "0", "5"], ["Ticket aging", "climbing", "flat"]] },

  { id: "change", n: "03", title: "Change & Configuration", who: "marcus", lead: "Third — whether the tenant stays where you put it.",
    head: { v: "47", l: "settings changed outside change control", tone: "#fbbf24", note: "in the last 90 days" },
    chartTitle: "Change discipline", chartKind: "bars",
    bars: [
      { l: "Changes outside control", v: "47", pct: 100, c: "#fbbf24", flag: "90 days" },
      { l: "Standing global admins", v: "18", pct: 88, c: "#f87171", flag: "target 5" },
      { l: "Changes with a rollback plan", v: "31%", pct: 31, c: "#f87171", flag: "weak" },
      { l: "Change window length", v: "10 days", pct: 44, c: "#fbbf24", flag: "no room" }
    ],
    wrong: [
      "Eighteen standing global admins against a target of five, with no PIM elevation in between.",
      "Fewer than a third of changes carry a rollback plan, which is why the change board is cautious.",
      "A ten-working-day change window leaves no room for the remediation sequence unless it is planned now."
    ],
    fix: [
      "Cut standing global admins to five and move the rest to PIM with approval.",
      "Require a rollback plan on every change touching identity or sharing.",
      "Book the remediation change windows now so the sequence is not blocked by process."
    ],
    delta: [["Standing global admins", "18", "5"], ["Changes outside control", "47", "0"], ["Rollback coverage", "31%", "100%"]] },

  { id: "resilience", n: "04", title: "Backup & Resilience", who: "marcus", lead: "Fourth — what happens when something goes wrong, which it will.",
    head: { v: "97%", l: "backup success rate", tone: "#34d399", note: "restore has never been tested" },
    chartTitle: "Resilience position", chartKind: "heat",
    heat: [
      { l: "Backup success", v: "97%", sub: "nightly, healthy", c: "#34d399" },
      { l: "Restore tested", v: "never", sub: "untested is unproven", c: "#f87171" },
      { l: "Retention of backups", v: "30 days", sub: "below obligation", c: "#fbbf24" },
      { l: "Recovery time objective", v: "undefined", sub: "no target agreed", c: "#f87171" },
      { l: "Incident recurrence", v: "6%", sub: "low", c: "#34d399" },
      { l: "Runbook coverage", v: "0", sub: "no documented recovery", c: "#f87171" }
    ],
    wrong: [
      "A backup that has never been restored is a hypothesis, not a control.",
      "There is no agreed recovery time objective, so nobody can say what \"recovered\" means.",
      "Backup retention is 30 days against regulatory obligations measured in years."
    ],
    fix: [
      "Run a restore test this quarter and record the elapsed time as the working RTO.",
      "Extend backup retention to match the longest obligation the tenant carries.",
      "Document a recovery runbook for the three most business-critical workloads."
    ],
    delta: [["Restore tested", "never", "quarterly"], ["RTO", "undefined", "4 hours"], ["Backup retention", "30 days", "1 year"]] },

  { id: "hltgate", n: "05", title: "Health & the Copilot Gate", who: "shane", gate: true, lead: "And this is what health means for go/no-go. This is the pillar that decides whether the rest survives.",
    head: { v: "1 in 6", l: "devices would be blocked by the Copilot policy today", tone: "#f87171", note: "312 endpoints outside baseline" },
    chartTitle: "What health gates", chartKind: "heat",
    heat: [
      { l: "Device compliance", v: "94.2%", sub: "gates CA01 enforcement", c: "#fbbf24" },
      { l: "Drifted endpoints", v: "312", sub: "would lose Copilot", c: "#f87171" },
      { l: "Support capacity", v: "340/wk", sub: "no headroom for a launch", c: "#fbbf24" },
      { l: "Change windows", v: "10 days", sub: "sequence must be booked", c: "#fbbf24" },
      { l: "Service health", v: "nominal", sub: "no platform blocker", c: "#34d399" },
      { l: "SLA compliance", v: "99%", sub: "holding", c: "#34d399" }
    ],
    wrong: [
      "Health does not block Copilot on its own — it decides whether enforcing the security controls locks people out.",
      "Turn on the Copilot device-compliance policy today and one user in six loses access on the first morning.",
      "A support team already at capacity cannot absorb a launch without deflection in place first."
    ],
    fix: [
      "Fix the device baseline before conditional access is enforced, not after.",
      "Automate the top five alerts so the team has headroom for the pilot.",
      "Book the change windows for the whole remediation sequence in one pass."
    ],
    delta: [["Devices blocked at enforcement", "312", "41"], ["Health pillar", "58", "88"], ["Copilot readiness", "34%", "43%"]] }
];

export const HLT_WALK_ANALYST = [
  { id: "endpoints", n: "A1", title: "Endpoint Estate", who: "marcus", lead: "Analyst view — the estate grouped by what has to be touched to fix it.",
    head: { v: "94", l: "devices belonging to no policy group", tone: "#f87171", note: "nothing evaluates them at all" },
    chartTitle: "Devices by remediation action", chartKind: "bars",
    bars: [
      { l: "Re-apply baseline", v: "218", pct: 100, c: "#f87171", flag: "config only" },
      { l: "Re-assign to a group", v: "94", pct: 44, c: "#fbbf24", flag: "membership" },
      { l: "Patch to ring 3", v: "218", pct: 84, c: "#fbbf24", flag: "scheduled" },
      { l: "Replace or retire", v: "12", pct: 8, c: "#94a3b8", flag: "out of support" }
    ],
    wrong: [
      "Most of the drift is configuration rather than hardware — it is a re-publish, not a refresh cycle.",
      "The 94 ungrouped devices are the ones nobody will notice until a policy is enforced.",
      "Twelve devices are out of support entirely and should not be in the pilot population."
    ],
    fix: [
      "Re-publish the baseline first — it clears the bulk of the drift in one action.",
      "Fix group membership before enforcing anything, or the ungrouped devices fail silently.",
      "Exclude the out-of-support devices from the pilot cohort explicitly."
    ],
    delta: [["Devices needing action", "312", "41"], ["Ungrouped devices", "94", "0"], ["Out-of-support in pilot", "12", "0"]] },

  { id: "operations", n: "A2", title: "Operational Readiness", who: "marcus", lead: "Second: whether the team can carry a launch on top of what it already runs.",
    head: { v: "0", l: "runbooks automated", tone: "#f87171", note: "every fix is a person" },
    chartTitle: "Operational headroom", chartKind: "heat",
    heat: [
      { l: "Tickets per week", v: "340", sub: "at capacity", c: "#fbbf24" },
      { l: "Automated runbooks", v: "0", sub: "top 5 are repeatable", c: "#f87171" },
      { l: "After-hours alerts", v: "62/wk", sub: "mostly the same five", c: "#f87171" },
      { l: "Copilot escalation path", v: "none", sub: "needed before day one", c: "#f87171" },
      { l: "SLA compliance", v: "99%", sub: "holding for now", c: "#34d399" },
      { l: "Change board cadence", v: "weekly", sub: "workable", c: "#34d399" }
    ],
    wrong: [
      "Sixty-two after-hours alerts a week, most of them the same five, none of them automated.",
      "No escalation path exists for Copilot issues, so they will land in the general queue.",
      "SLA is holding, but there is no headroom to absorb a launch."
    ],
    fix: [
      "Automate the top five alerts — that is roughly forty after-hours interruptions a week returned.",
      "Define the Copilot escalation path and publish it with the pilot comms.",
      "Re-measure capacity after deflection lands rather than assuming it."
    ],
    delta: [["Automated runbooks", "0", "5"], ["After-hours alerts", "62/wk", "22/wk"], ["Escalation path", "none", "published"]] }
];


// ── Security walkthrough — reachability, not posture scores ──────────────────
export const SEC_WALK = [
  { id: "identity", n: "01", title: "Identity Perimeter", who: "kirk", lead: "Let's start where every attacker starts, and where every Copilot session is authorised.",
    head: { v: "18", l: "standing global admins against a target of 5", tone: "#f87171", note: "no PIM elevation in between" },
    chartTitle: "Identity controls, measured", chartKind: "bars",
    bars: [
      { l: "MFA coverage", v: "96%", pct: 96, c: "#34d399", flag: "strong" },
      { l: "Legacy auth blocked", v: "yes", pct: 92, c: "#34d399", flag: "closed" },
      { l: "Standing global admins", v: "18", pct: 88, c: "#f87171", flag: "target 5" },
      { l: "Privileged roles drifted", v: "14", pct: 62, c: "#f87171", flag: "outside PIM" },
      { l: "Risky sign-ins unchallenged", v: "41", pct: 44, c: "#fbbf24", flag: "report-only" }
    ],
    wrong: [
      "Eighteen accounts hold global administrator permanently — four percent of the identity estate can change anything.",
      "The sign-in risk policy is still report-only, so 41 risky sign-ins were observed and none were challenged.",
      "Fourteen privileged roles were assigned outside PIM and have no expiry."
    ],
    fix: [
      "Cut standing global admins to five and move the rest to PIM with approval and a time limit.",
      "Promote the sign-in risk policy from report-only to enforce.",
      "Require phishing-resistant MFA for every privileged role."
    ],
    delta: [["Standing global admins", "18", "5"], ["Roles outside PIM", "14", "0"], ["Security pillar", "51", "89"]] },

  { id: "reach", n: "02", title: "Reachability, Not Posture", who: "kirk", lead: "Second — and this is the one that matters. Not what your posture score says. What a single account can actually reach.",
    head: { v: "214,806", l: "files one first-line account can retrieve", tone: "#f87171", note: "no elevated rights required" },
    chartTitle: "Reach of one ordinary identity", chartKind: "heat",
    heat: [
      { l: "Payroll & compensation", v: "reachable", sub: "unlabelled, org-wide link", c: "#f87171" },
      { l: "Executed contracts", v: "reachable", sub: "EEEU · Read", c: "#f87171" },
      { l: "Clinical protocols", v: "reachable", sub: "EEEU · Read, PHI", c: "#f87171" },
      { l: "Mission documentation", v: "reachable", sub: "EEEU · Edit", c: "#f87171" },
      { l: "Board material", v: "protected", sub: "scoped correctly", c: "#34d399" },
      { l: "Identities with this reach", v: "1,876", sub: "every licensed account", c: "#f87171" }
    ],
    wrong: [
      "Blast radius is identical for a new hire on day one and a director of twenty years.",
      "Posture scoring measures configuration. Reachability measures consequence — and only one of those appears in an incident report.",
      "There is no way today to answer “what could this person reach” without running the query we ran."
    ],
    fix: [
      "Measure reachability per persona before any Copilot licence is assigned.",
      "Close the org-wide grants — that single change removes 196,566 files from general reach.",
      "Re-measure after each wave and publish the number as the security metric."
    ],
    delta: [["Files one account can reach", "214,806", "18,240"], ["Regulated files in reach", "40,480", "1,120"], ["Accounts with full reach", "1,876", "0"]] },

  { id: "egress", n: "03", title: "Egress & Data Loss", who: "kirk", lead: "Third — whether anything stops it leaving once it has been found.",
    head: { v: "1,412", l: "mailboxes never evaluated on egress", tone: "#f87171", note: "finance and legal among them" },
    chartTitle: "Egress control coverage", chartKind: "bars",
    bars: [
      { l: "Exchange egress", v: "62%", pct: 62, c: "#f87171", flag: "2 sets unscoped" },
      { l: "SharePoint / OneDrive", v: "74%", pct: 74, c: "#fbbf24", flag: "partial" },
      { l: "Teams messages", v: "58%", pct: 58, c: "#f87171", flag: "chat uncovered" },
      { l: "Endpoint DLP", v: "0%", pct: 4, c: "#f87171", flag: "not deployed" },
      { l: "Copilot prompts", v: "0%", pct: 4, c: "#f87171", flag: "ungoverned" }
    ],
    wrong: [
      "Copilot prompts and responses are evaluated by nothing — the newest egress path is the only completely open one.",
      "Two policy sets were scoped to a pilot group in 2023 and never widened.",
      "Endpoint DLP is licensed and undeployed, so anything copied to a USB stick leaves silently."
    ],
    fix: [
      "Extend the existing policies to finance and legal rather than authoring new ones.",
      "Add Copilot as a DLP location before the pilot, not after it.",
      "Deploy endpoint DLP to the pilot cohort as a condition of entry."
    ],
    delta: [["Mailboxes uncovered", "1,412", "0"], ["Copilot prompt coverage", "0%", "100%"], ["Endpoint DLP", "0%", "100%"]] },

  { id: "chain", n: "04", title: "The Risk Chain", who: "kirk", lead: "Fourth — read in sequence rather than as a list, because that is how an incident actually happens.",
    head: { v: "4", l: "linked findings, one sequence", tone: "#f87171", note: "break any link and the chain stops" },
    chartTitle: "How the findings compound", chartKind: "bars",
    bars: [
      { l: "1 · No egress control on finance mail", v: "open", pct: 100, c: "#f87171", flag: "entry" },
      { l: "2 · Content reachable by everyone", v: "open", pct: 84, c: "#f87171", flag: "amplifier" },
      { l: "3 · No session boundary on Copilot", v: "open", pct: 68, c: "#f87171", flag: "accelerant" },
      { l: "4 · Disclosure becomes reportable", v: "open", pct: 52, c: "#f87171", flag: "consequence" }
    ],
    wrong: [
      "Each link on its own is a housekeeping item. In sequence they are a reportable event under MSA §7.4.",
      "The chain runs faster with Copilot because retrieval that took twenty minutes now takes nine seconds.",
      "Nobody currently owns the chain — each link has a different team and no single accountable name."
    ],
    fix: [
      "Break the chain at link one — DLP scope is the cheapest and most effective intervention.",
      "Give the chain a single owner who reports on it until every link is closed.",
      "Treat the chain as the deployment gate: no tenant-wide rollout while any link is open."
    ],
    delta: [["Open links", "4", "0"], ["Reportable exposure", "yes", "no"], ["Chain owner", "none", "named"]] },

  { id: "secgate", n: "05", title: "Security & the Copilot Gate", who: "kirk", gate: true, lead: "And this is the security position on go/no-go. I deal in what is reachable today, not in scores.",
    head: { v: "0", l: "conditional access policies govern the Copilot session", tone: "#f87171", note: "42 policies, none of them this one" },
    chartTitle: "The controls that decide it", chartKind: "heat",
    heat: [
      { l: "Identity perimeter", v: "strong", sub: "MFA 96%, legacy auth closed", c: "#34d399" },
      { l: "Standing admins", v: "18", sub: "target 5", c: "#f87171" },
      { l: "Copilot session policy", v: "none", sub: "CA01 disabled", c: "#f87171" },
      { l: "Egress over Copilot", v: "none", sub: "prompts ungoverned", c: "#f87171" },
      { l: "Reachable regulated files", v: "40,480", sub: "by any account", c: "#f87171" },
      { l: "Defender coverage", v: "98.4%", sub: "no open high alerts", c: "#34d399" }
    ],
    wrong: [
      "The exposure is in the content estate, not the identity estate — and content is exactly what Copilot reads.",
      "A clean identity perimeter does not compensate for content that everyone can already reach.",
      "Enabling Copilot tenant-wide today puts the exposure on your side of the MSA line."
    ],
    fix: [
      "Close egress scope and org-wide sharing before any tenant-wide enablement.",
      "Enforce CA01 once the device baseline is fixed, so it does not lock out one user in six.",
      "Keep the pilot inside Finance and Legal, under audit retention, until the chain is closed."
    ],
    delta: [["Open chain links", "4", "0"], ["Security pillar", "51", "89"], ["Copilot readiness", "34%", "48%"]] }
];

export const SEC_WALK_ANALYST = [
  { id: "surface", n: "A1", title: "Attack Surface", who: "kirk", lead: "Analyst view — the surface grouped by what an attacker or an over-eager prompt would actually use.",
    head: { v: "612", l: "external identities inside the boundary", tone: "#fbbf24", note: "48 domains, never pruned" },
    chartTitle: "Surface by entry point", chartKind: "bars",
    bars: [
      { l: "Guest identities", v: "612", pct: 100, c: "#fbbf24", flag: "no expiry" },
      { l: "Anonymous links", v: "23", pct: 46, c: "#f87171", flag: "no identity" },
      { l: "OAuth app grants", v: "94", pct: 62, c: "#fbbf24", flag: "quarterly review" },
      { l: "Unmanaged browser sessions", v: "allowed", pct: 78, c: "#f87171", flag: "no session control" }
    ],
    wrong: [
      "OAuth grants are reviewed quarterly, which means an over-permissioned app has ninety days of runway.",
      "Unmanaged browsers can reach everything a managed device can, with no session control in between.",
      "Anonymous links have no identity, so they are invisible in every access review you run."
    ],
    fix: [
      "Move OAuth grant review to continuous with an alert on any new high-privilege consent.",
      "Add session controls for unmanaged browsers — read-only, no download.",
      "Eliminate anonymous links entirely rather than managing them."
    ],
    delta: [["Guest identities", "612", "344"], ["Anonymous links", "23", "0"], ["OAuth review", "quarterly", "continuous"]] },

  { id: "detect", n: "A2", title: "Detection & Response", who: "kirk", lead: "Second: what you would actually see if this went wrong tonight.",
    head: { v: "98.4%", l: "Defender coverage, zero open high alerts", tone: "#34d399", note: "detection is not the weak point" },
    chartTitle: "Detection position", chartKind: "heat",
    heat: [
      { l: "Defender for Endpoint", v: "98.4%", sub: "healthy", c: "#34d399" },
      { l: "Open high alerts", v: "0", sub: "clean", c: "#34d399" },
      { l: "Audit retention", v: "180 days", sub: "below obligation", c: "#fbbf24" },
      { l: "AI-specific detections", v: "none", sub: "no rule covers Copilot", c: "#f87171" },
      { l: "Mean time to detect", v: "unmeasured", sub: "no baseline", c: "#fbbf24" },
      { l: "Incident drill", v: "never", sub: "untested", c: "#f87171" }
    ],
    wrong: [
      "There is no detection rule anywhere that mentions Copilot — an anomalous prompt pattern would look like normal traffic.",
      "Mean time to detect has never been measured, so there is no baseline to improve against.",
      "The incident process has never been rehearsed against an AI-disclosure scenario."
    ],
    fix: [
      "Write detections for anomalous Copilot retrieval volume and unusual grounding patterns.",
      "Extend audit retention so an investigation can look back far enough to matter.",
      "Rehearse the AI-disclosure scenario before the pilot widens."
    ],
    delta: [["AI detections", "0", "3"], ["Audit retention", "180 days", "7 years"], ["Incident drill", "never", "quarterly"]] }
];


// ── Copilot Readiness — every pillar folded into one decision ────────────────
export const CPL_WALK = [
  { id: "verdict", n: "01", title: "The Verdict", who: "shane", lead: "Every pillar you have just walked through resolves into one number and one decision. Here it is, unhedged.",
    head: { v: "34%", l: "Copilot readiness against a 75% gate", tone: "#f87171", note: "not ready for tenant-wide enablement" },
    chartTitle: "Readiness contribution by pillar", chartKind: "bars",
    bars: [
      { l: "Governance", v: "34 / 89", pct: 100, c: "#f87171", flag: "largest gap" },
      { l: "Security", v: "51 / 89", pct: 72, c: "#f87171", flag: "chain open" },
      { l: "Compliance", v: "38 / 84", pct: 84, c: "#f87171", flag: "unprovable" },
      { l: "Adoption", v: "54 / 86", pct: 58, c: "#fbbf24", flag: "no scaffolding" },
      { l: "Health", v: "58 / 88", pct: 52, c: "#fbbf24", flag: "device drift" },
      { l: "Licensing", v: "38 / 92", pct: 66, c: "#fbbf24", flag: "funds the rest" }
    ],
    wrong: [
      "Three pillars are blocking and three are gating — none of them is a licensing problem.",
      "Enabling at 34% would put ungoverned, unlabelled content in front of every licensed account on day one.",
      "The gap is entirely composed of controls you already own and have not yet applied."
    ],
    fix: [
      "Close governance first — it is worth more readiness than any other single pillar.",
      "Run licensing in parallel; it funds the work and blocks nothing.",
      "Hold tenant-wide enablement at 75% and pilot inside a labelled boundary before then."
    ],
    delta: [["Copilot readiness", "34%", "78%"], ["Blocking pillars", "3", "0"], ["Time to gate", "unbounded", "12 weeks"]] },

  { id: "blast", n: "02", title: "Blast Radius, Priced", who: "kirk", lead: "Second — what enabling today would actually expose, and what that exposure is worth.",
    head: { v: "$4.1M", l: "regulated records inside general reach", tone: "#f87171", note: "priced at your own breach-cost assumption" },
    chartTitle: "Exposure by class, priced", chartKind: "heat",
    heat: [
      { l: "PHI records", v: "$2.4M", sub: "9,860 files · reportable", c: "#f87171" },
      { l: "Financial records", v: "$1.1M", sub: "12,416 files", c: "#f87171" },
      { l: "PII records", v: "$0.6M", sub: "18,204 files", c: "#fbbf24" },
      { l: "Contracts", v: "unpriced", sub: "commercial harm", c: "#fbbf24" },
      { l: "Accounts with this reach", v: "1,876", sub: "every licensed user", c: "#f87171" },
      { l: "Time to first citation", v: "9 sec", sub: "was 20 minutes", c: "#f87171" }
    ],
    wrong: [
      "The exposure already exists — Copilot changes the retrieval time from twenty minutes to nine seconds.",
      "A PHI disclosure in a generated answer is reportable, which converts a technical issue into a legal one.",
      "The number above assumes nothing is remediated. Every switch you flipped in this session reduces it."
    ],
    fix: [
      "Close org-wide sharing and label the regulated backlog — together they remove 96% of the priced exposure.",
      "Scope the pilot to a labelled boundary so the blast radius during the pilot is near zero.",
      "Re-price after each wave and report it alongside the readiness number."
    ],
    delta: [["Priced exposure", "$4.1M", "$164K"], ["Reportable classes", "3", "0"], ["Accounts with reach", "1,876", "0"]] },

  { id: "prove", n: "03", title: "Prove It With Copilot", who: "shane", lead: "Third — rather than argue about it, run Copilot against your own tenant and see what comes back.",
    head: { v: "3 of 3", l: "test prompts returned regulated content", tone: "#f87171", note: "run this morning, unprivileged test identity" },
    chartTitle: "What the test prompts returned", chartKind: "heat",
    heat: [
      { l: "“Summarise this site”", v: "41,208 files", sub: "Flight Ops · unlabelled", c: "#f87171" },
      { l: "“Our termination terms?”", v: "verbatim MSA", sub: "Contracts · EEEU", c: "#f87171" },
      { l: "“Salary band structure?”", v: "draft comp data", sub: "HR · org-wide link", c: "#f87171" },
      { l: "Elevated rights needed", v: "none", sub: "ordinary account", c: "#f87171" },
      { l: "Citations attached", v: "yes", sub: "with your tenant's authority", c: "#f87171" },
      { l: "Classification warning", v: "none", sub: "content is unlabelled", c: "#f87171" }
    ],
    wrong: [
      "This is not a risk model. It is three prompts, run this morning, with the output kept.",
      "Every answer arrived with a citation, which is what makes it credible to the person reading it.",
      "None of the three required anything beyond a standard licensed account."
    ],
    fix: [
      "Re-run these exact prompts after each remediation wave as the acceptance test.",
      "Keep the output as evidence — it is the clearest before-and-after you will get.",
      "Add two prompts per regulated class so the test covers the whole boundary."
    ],
    delta: [["Prompts returning regulated content", "3 of 3", "0 of 3"], ["Citations to unlabelled sources", "9", "0"], ["Acceptance test", "none", "5 prompts"]] },

  { id: "value", n: "04", title: "The Value On The Other Side", who: "marcus", lead: "Fourth — because none of this is worth doing unless the upside is real. It is.",
    head: { v: "$4.1M", l: "annual value at full adoption", tone: "#34d399", note: "1,140 hours a week returned" },
    chartTitle: "Where the return comes from", chartKind: "bars",
    bars: [
      { l: "Routine documentation", v: "$2.2M", pct: 100, c: "#34d399", flag: "3.5 hrs/wk each" },
      { l: "Meeting recap and actions", v: "$1.0M", pct: 46, c: "#34d399", flag: "needs transcripts" },
      { l: "Ticket deflection", v: "$0.5M", pct: 24, c: "#6ee7b7", flag: "136 a week" },
      { l: "Finding prior work", v: "$0.4M", pct: 18, c: "#6ee7b7", flag: "needs governance" },
      { l: "Licence recovery", v: "$1.0M", pct: 44, c: "#34d399", flag: "year one only" }
    ],
    wrong: [
      "Every line above is gated by a pillar you have just seen — none of it lands on an ungoverned tenant.",
      "The recovery alone funds the pilot seven times over, so the business case does not depend on the productivity claim.",
      "Value realised without measurement is value nobody will believe. It has to be instrumented."
    ],
    fix: [
      "Instrument two workflows in the pilot and measure them properly rather than claiming all four.",
      "Report hours returned monthly alongside the readiness score.",
      "Fund the programme from the licence recovery so it needs no new budget."
    ],
    delta: [["Annual value", "$0", "$4.1M"], ["Hours returned weekly", "0", "1,140"], ["Return on the pilot", "—", "7×"]] },

  { id: "cplgate", n: "05", title: "Go / No-Go", who: "shane", gate: true, lead: "And that is the decision. Everything in this room comes down to this card.",
    head: { v: "NO-GO", l: "for tenant-wide enablement today", tone: "#f87171", note: "GO for a scoped pilot inside a labelled boundary" },
    chartTitle: "The gate, pillar by pillar", chartKind: "heat",
    heat: [
      { l: "Governance", v: "34", sub: "blocking · close first", c: "#f87171" },
      { l: "Security", v: "51", sub: "blocking · chain open", c: "#f87171" },
      { l: "Compliance", v: "38", sub: "blocking · unprovable", c: "#f87171" },
      { l: "Adoption", v: "54", sub: "gating · no champions", c: "#fbbf24" },
      { l: "Health", v: "58", sub: "gating · device drift", c: "#fbbf24" },
      { l: "Licensing", v: "38", sub: "funds it · not blocking", c: "#fbbf24" }
    ],
    wrong: [
      "No-go is not the same as no. It is a sequence and a date, and the date is twelve weeks out.",
      "A scoped pilot in Finance and Legal is defensible today and would prove the value while the work runs.",
      "Every blocking finding is a control you already own — this is configuration and sequencing, not procurement."
    ],
    fix: [
      "Approve the scoped pilot now and the remediation sequence alongside it.",
      "Re-run this readout at week six and week twelve against the same measurements.",
      "Set the tenant-wide date at the point the gate clears, not at a calendar quarter."
    ],
    delta: [["Verdict", "NO-GO", "GO"], ["Copilot readiness", "34%", "78%"], ["Pilot", "not started", "400 seats"]] }
];

export const CPL_WALK_ANALYST = [
  { id: "sequence", n: "A1", title: "Remediation Sequence", who: "shane", lead: "Analyst view — the whole programme in the order it has to happen.",
    head: { v: "12 weeks", l: "to clear the gate", tone: "#34d399", note: "with your own team, sequenced" },
    chartTitle: "The critical path", chartKind: "bars",
    bars: [
      { l: "Weeks 1–2 · Close org-wide sharing", v: "+30 readiness", pct: 100, c: "#34d399", flag: "biggest lever" },
      { l: "Weeks 1–3 · DLP scope and Copilot", v: "+12", pct: 44, c: "#34d399", flag: "parallel" },
      { l: "Weeks 2–6 · Label the backlog", v: "+14", pct: 52, c: "#6ee7b7", flag: "longest" },
      { l: "Weeks 3–5 · Device baseline", v: "+9", pct: 34, c: "#6ee7b7", flag: "before CA01" },
      { l: "Weeks 6–12 · Champions and tracks", v: "+8", pct: 30, c: "#60a5fa", flag: "adoption" }
    ],
    wrong: [
      "Doing the easy items first feels productive and moves readiness barely at all.",
      "CA01 cannot be enforced until the device baseline is fixed, or one user in six is locked out.",
      "Adoption work started too late is the most common reason a technically successful rollout fails."
    ],
    fix: [
      "Run sharing and DLP in the first fortnight — between them they are worth 42 points.",
      "Start labelling immediately because it is the longest pole, not because it is the biggest lever.",
      "Begin champion recruitment in week six so enablement is ready when the gate clears."
    ],
    delta: [["Readiness", "34%", "78%"], ["Elapsed", "—", "12 weeks"], ["New budget", "—", "$0"]] },

  { id: "whatif", n: "A2", title: "What If We Do Nothing", who: "beth", lead: "Second, and briefly: the cost of the option nobody writes down.",
    head: { v: "$70,000", l: "a month, before any incident", tone: "#f87171", note: "licence waste alone" },
    chartTitle: "Cost of delay", chartKind: "heat",
    heat: [
      { l: "Licence waste", v: "$70K/mo", sub: "continues", c: "#f87171" },
      { l: "Value not realised", v: "$342K/mo", sub: "hours not returned", c: "#f87171" },
      { l: "Exposure", v: "$4.1M", sub: "static, not reducing", c: "#f87171" },
      { l: "Reportable risk", v: "open", sub: "every day it stays open", c: "#f87171" },
      { l: "Competitive position", v: "slipping", sub: "peers are deploying", c: "#fbbf24" },
      { l: "Renewal leverage", v: "expiring", sub: "no evidence at the table", c: "#fbbf24" }
    ],
    wrong: [
      "Doing nothing is not a neutral option — it has a monthly price and it is the largest number on this card.",
      "The exposure does not decay on its own; unowned content accumulates rather than expires.",
      "The renewal date arrives whether or not the evidence has been gathered."
    ],
    fix: [
      "Decide on the pilot now and let the remediation run behind it.",
      "Take the recovery to the renewal with ninety days of evidence attached.",
      "Re-read this card at week six — the numbers should already be moving."
    ],
    delta: [["Monthly cost of delay", "$412K", "$0"], ["Exposure trend", "flat", "falling"], ["Evidence at renewal", "none", "90 days"]] }
];


// ── Statement of Work — the deliverable, walked and scoped ───────────────────
export const SOW_PHASES = [
  { id: "p1", n: "Phase 1", title: "Stop the bleeding", weeks: "Weeks 1–2", price: 0, fixed: true,
    detail: "Tenant sharing defaults, link expiry and the read-only inventories. Run by your own admins with our runbooks.",
    items: ["Default link type set to Specific people", "30-day link expiry enabled", "Org-wide and anonymous link inventory", "Licence position export"],
    readiness: 6, owner: "Your admins · we supply the runbooks" },
  { id: "p2", n: "Phase 2", title: "Close org-wide sharing", weeks: "Weeks 1–4", price: 48000,
    detail: "Replace 41 org-wide grants with scoped groups, site by site, with recipients notified before each cut.",
    items: ["41 sites remediated", "Security groups created and populated", "Owner assigned to every site", "Weekly reachability re-measure"],
    readiness: 30, owner: "Joint · our lead, your change window" },
  { id: "p3", n: "Phase 3", title: "DLP scope closure", weeks: "Weeks 2–4", price: 32000,
    detail: "Extend the two unscoped policy sets to finance and legal, add Copilot as a DLP location, promote the simulation rules.",
    items: ["1,412 mailboxes brought into scope", "Copilot prompts and responses evaluated", "3 simulation rules promoted", "False-positive tuning"],
    readiness: 12, owner: "Our security lead" },
  { id: "p4", n: "Phase 4", title: "Label the regulated backlog", weeks: "Weeks 2–8", price: 76000,
    detail: "Promote the three PHI classifiers, enable default labels at provisioning, auto-label 40,480 regulated files.",
    items: ["Classifier sampling and tuning", "Default labels at provisioning", "Auto-label clinical and billing first", "Containment evidence pack"],
    readiness: 14, owner: "Our compliance lead + Beth" },
  { id: "p5", n: "Phase 5", title: "Identity and device baseline", weeks: "Weeks 3–6", price: 38000,
    detail: "Re-publish the device baseline, cut standing admins to five, then enforce CA01 without locking anyone out.",
    items: ["312 endpoints returned to baseline", "18 standing admins to 5 with PIM", "CA01 report-only then enforced", "Sign-in risk policy enforced"],
    readiness: 9, owner: "Joint · your platform team" },
  { id: "p6", n: "Phase 6", title: "Adoption and enablement", weeks: "Weeks 6–12", price: 54000,
    detail: "38 champions, four role tracks, a prompt library and the measurement that proves the pilot worked.",
    items: ["38 champions recruited and briefed", "4 role-based tracks delivered", "Prompt library published", "Week-3 retention instrumented"],
    readiness: 8, owner: "Our adoption lead + Ellis" },
  { id: "p7", n: "Phase 7", title: "Managed monitoring", weeks: "Ongoing", price: 4800, recurring: true,
    detail: "Continuous drift detection across all seven pillars, with a monthly readout and the evidence pack maintained.",
    items: ["Hourly tenant scan", "Alert on new org-wide or anonymous link", "Monthly readiness readout", "Evidence pack kept current"],
    readiness: 4, owner: "Us · monthly" }
];

export const SOW_WALK = [
  { id: "scope", n: "01", title: "Scope & Objective", who: "shane", lead: "This is the statement of work the assessment produced. Everything in it traces back to a finding you have already seen.",
    head: { v: "24", l: "findings carried into scope", tone: "#7dd3fc", note: "none of them invented in this document" },
    chartTitle: "Findings by pillar, carried into scope", chartKind: "bars",
    bars: [
      { l: "Governance", v: "4 findings", pct: 100, c: "#3B82F6", flag: "Phase 2" },
      { l: "Security", v: "4 findings", pct: 84, c: "#8B5CF6", flag: "Phase 3, 5" },
      { l: "Compliance", v: "4 findings", pct: 76, c: "#F3F4F6", flag: "Phase 4" },
      { l: "Health", v: "4 findings", pct: 62, c: "#22C55E", flag: "Phase 5" },
      { l: "Adoption", v: "4 findings", pct: 58, c: "#F97316", flag: "Phase 6" },
      { l: "Licensing", v: "4 findings", pct: 44, c: "#14B8A6", flag: "self-funding" }
    ],
    wrong: [
      "The objective is one sentence: clear the Copilot deployment gate at 75% within twelve weeks.",
      "Nothing in this scope is discretionary tooling — every phase closes a finding that is currently open.",
      "Phase 1 is unpriced because you can run it yourselves this week."
    ],
    fix: [
      "Read the phase breakdown next and remove anything you would rather own internally.",
      "Approve the scoped pilot alongside the work so value starts before the gate clears.",
      "Hold the tenant-wide date to the gate, not to a calendar quarter."
    ],
    delta: [["Findings in scope", "24", "24"], ["Objective", "gate at 75%", "cleared"], ["Elapsed", "—", "12 weeks"]] },

  { id: "approach", n: "02", title: "Approach & Sequence", who: "shane", lead: "Second — the order, because sequence is what makes twelve weeks possible.",
    head: { v: "12 weeks", l: "critical path, phases running in parallel", tone: "#34d399", note: "four teams, one change calendar" },
    chartTitle: "Where each phase sits on the calendar", chartKind: "bars",
    bars: [
      { l: "Ph 1–2 · Sharing", v: "Weeks 1–4", pct: 100, c: "#3B82F6", flag: "biggest lever" },
      { l: "Ph 3 · DLP", v: "Weeks 2–4", pct: 62, c: "#8B5CF6", flag: "parallel" },
      { l: "Ph 4 · Labelling", v: "Weeks 2–8", pct: 88, c: "#F3F4F6", flag: "longest pole" },
      { l: "Ph 5 · Baseline", v: "Weeks 3–6", pct: 54, c: "#22C55E", flag: "before CA01" },
      { l: "Ph 6 · Adoption", v: "Weeks 6–12", pct: 70, c: "#F97316", flag: "lands last" }
    ],
    wrong: [
      "Labelling is the longest pole, so it starts in week two even though it is not the biggest lever.",
      "CA01 cannot be enforced until the device baseline is fixed, or one user in six is locked out on the morning.",
      "Adoption started too late is the most common reason a technically clean rollout still fails."
    ],
    fix: [
      "Book all change windows in one pass rather than phase by phase.",
      "Run the reachability re-measure weekly so progress is evidenced, not asserted.",
      "Start champion recruitment in week six so enablement is ready when the gate clears."
    ],
    delta: [["Critical path", "unbounded", "12 weeks"], ["Change windows", "ad hoc", "booked"], ["Progress evidence", "none", "weekly"]] },

  { id: "phases", n: "03", title: "Phase Breakdown & Scope", who: "shane", scoping: true, lead: "Third — the phases themselves. Take out anything you would rather run internally; the price and the readiness both move when you do.",
    head: { v: "$252,800", l: "professional services, phases 2 to 6", tone: "#7dd3fc", note: "Phase 1 is yours, Phase 7 is monthly" },
    chartTitle: "Investment by phase", chartKind: "bars",
    bars: [
      { l: "Phase 2 · Sharing", v: "$48,000", pct: 63, c: "#3B82F6", flag: "+30 readiness" },
      { l: "Phase 3 · DLP", v: "$32,000", pct: 42, c: "#8B5CF6", flag: "+12" },
      { l: "Phase 4 · Labelling", v: "$76,000", pct: 100, c: "#F3F4F6", flag: "+14" },
      { l: "Phase 5 · Baseline", v: "$38,000", pct: 50, c: "#22C55E", flag: "+9" },
      { l: "Phase 6 · Adoption", v: "$54,000", pct: 71, c: "#F97316", flag: "+8" }
    ],
    wrong: [
      "Removing a phase does not remove the finding — it moves the work to your team and the risk with it.",
      "Phase 2 carries the most readiness per dollar. Phase 4 costs the most because it is the longest.",
      "Phase 7 is the only recurring line and the only one that stops the estate drifting back."
    ],
    fix: [
      "Keep the phases where the risk of getting it wrong is highest — labelling and DLP.",
      "Take Phase 5 internally if your platform team has the change capacity.",
      "Decide Phase 7 separately; it is a different conversation from the remediation."
    ],
    delta: [["Professional services", "$252,800", "scoped"], ["Readiness delivered", "+73", "scoped"], ["Funded by recovery", "yes", "yes"]] },

  { id: "sowtel", n: "04", title: "Statement of Work Telemetry", who: "shane", lead: "Fourth — the document's own instrumentation, so nothing in it is asserted without a source.",
    head: { v: "24", l: "findings in scope, all traceable", tone: "#7dd3fc", note: "none invented for this document" },
    chartTitle: "Document telemetry", chartKind: "heat",
    heat: [
      { l: "Findings in scope", v: "24", sub: "traced to the assessment", c: "#7dd3fc" },
      { l: "Objective target", v: "75%", sub: "Copilot deployment gate", c: "#7dd3fc" },
      { l: "Elapsed time", v: "12 weeks", sub: "start to gate", c: "#34d399" },
      { l: "Critical path duration", v: "8 weeks", sub: "labelling is the pole", c: "#fbbf24" },
      { l: "Change window status", v: "not booked", sub: "10 working days each", c: "#f87171" },
      { l: "Re-measure cadence", v: "weekly", sub: "reachability re-run", c: "#34d399" }
    ],
    wrong: [
      "Change windows are not yet booked, and at ten working days each they are the only thing that can push the twelve weeks.",
      "The critical path is labelling at eight weeks, not the biggest lever — sequence and effort are different problems.",
      "Every finding in scope carries the identifier it was given in the pillar report."
    ],
    fix: [
      "Book all change windows in one pass at signature rather than phase by phase.",
      "Re-run the reachability measure weekly so progress is evidence, not status.",
      "Keep the finding identifiers in the change records so the audit trail is continuous."
    ],
    delta: [["Findings traceable", "24 of 24", "24 of 24"], ["Change windows booked", "0", "6"], ["Critical path", "8 weeks", "8 weeks"]] },

  { id: "commercial", n: "05", title: "Commercial Terms", who: "beth", lead: "Fourth — the commercial and contractual position, in plain terms.",
    head: { v: "$0", l: "of new budget required", tone: "#34d399", note: "funded from the licence recovery" },
    chartTitle: "How it is paid for", chartKind: "heat",
    heat: [
      { l: "Professional services", v: "$252,800", sub: "phases 2–6", c: "#7dd3fc" },
      { l: "Copilot pilot licences", v: "$144,000", sub: "400 seats, year one", c: "#7dd3fc" },
      { l: "Licence recovery", v: "$1,010,000", sub: "year one", c: "#34d399" },
      { l: "Net position", v: "+$613,200", sub: "returned in year one", c: "#34d399" },
      { l: "Payment", v: "on phase completion", sub: "not up front", c: "#34d399" },
      { l: "Termination", v: "30 days", sub: "for convenience", c: "#34d399" }
    ],
    wrong: [
      "This is a reallocation, not a budget request — the recovery covers the work and the licences with change left over.",
      "Payment is on phase completion against defined acceptance criteria, so unfinished work is unbilled.",
      "The MSA change record has to be signed before Phase 3 begins, not at the end."
    ],
    fix: [
      "Take the recovery to the renewal with the ninety-day evidence attached.",
      "Sign the change record alongside the SOW so Phase 3 is not held up.",
      "Agree the acceptance criteria per phase now, in writing."
    ],
    delta: [["New budget", "$396,800", "$0"], ["Net year one", "—", "+$613,200"], ["Payment risk", "up front", "on completion"]] },

  { id: "gatestatus", n: "06", title: "Governance Gate Status", who: "kirk", lead: "Sixth — the gate itself, and exactly which findings hold it shut.",
    head: { v: "BLOCKED", l: "Copilot gate at 34% against 75%", tone: "#f87171", note: "three blockers, all traced" },
    chartTitle: "Gate blockers traced to findings", chartKind: "bars",
    bars: [
      { l: "F-GOV-1 · Org-wide sharing", v: "blocking", pct: 100, c: "#3B82F6", flag: "Phase 2" },
      { l: "F-SEC-1 · DLP scope gap", v: "blocking", pct: 84, c: "#8B5CF6", flag: "Phase 3" },
      { l: "F-CMP-1 · Unlabelled regulated", v: "blocking", pct: 76, c: "#F3F4F6", flag: "Phase 4" },
      { l: "F-HLT-1 · Device drift", v: "gating", pct: 54, c: "#22C55E", flag: "Phase 5" },
      { l: "F-ADO-2 · No champions", v: "gating", pct: 44, c: "#F97316", flag: "Phase 6" }
    ],
    wrong: [
      "Three findings block the gate outright and two gate the pilot's success rather than its safety.",
      "Every blocker maps to exactly one phase, so removing a phase leaves its blocker open and named.",
      "Licensing appears nowhere in this list — it funds the work and blocks nothing."
    ],
    fix: [
      "Close the three blockers in phases 2, 3 and 4 to clear the gate.",
      "Treat the two gating findings as pilot-success conditions, not safety conditions.",
      "Re-evaluate the gate at week six against the same measurement."
    ],
    delta: [["Gate status", "BLOCKED", "PASSING"], ["Blocking findings", "3", "0"], ["Gate percentage", "34%", "78%"]] },

  { id: "sections", n: "07", title: "Section-by-Section Summary", who: "shane", lead: "Seventh — the deliverable summary, section by section, with the outcome each one produces.",
    head: { v: "6", l: "sections, each with a named outcome", tone: "#7dd3fc", note: "findings in, remediation out" },
    chartTitle: "Section outcomes", chartKind: "heat",
    heat: [
      { l: "1 · Scope & Objective", v: "24 findings", sub: "gate at 75% defined", c: "#7dd3fc" },
      { l: "2 · Approach & Sequence", v: "6 phases", sub: "12-week critical path", c: "#7dd3fc" },
      { l: "3 · Phase Breakdown", v: "scoped", sub: "price and readiness agreed", c: "#34d399" },
      { l: "4 · SOW Telemetry", v: "traceable", sub: "every figure sourced", c: "#34d399" },
      { l: "5 · Commercial Terms", v: "$0 new budget", sub: "funded from recovery", c: "#34d399" },
      { l: "6 · Gate Status", v: "3 blockers", sub: "each mapped to a phase", c: "#f87171" }
    ],
    wrong: [
      "Each section stands on its own — a reader can take section six to a change board without the rest.",
      "The headers are stable, so this document reads the same for every client engagement.",
      "Nothing in the summary restates marketing language; it restates findings and outcomes."
    ],
    fix: [
      "Circulate sections five and six to the approvers; the rest is for the delivery team.",
      "Keep the section numbering in the change records for traceability.",
      "Re-issue the summary at each phase close with the outcome column updated."
    ],
    delta: [["Sections complete", "6 of 6", "6 of 6"], ["Outcomes named", "6", "6"], ["Reissued at phase close", "no", "yes"]] },

  { id: "byPillar", n: "08", title: "Findings by Pillar", who: "shane", lead: "Eighth — the register itself, grouped by the pillar that raised each finding.",
    head: { v: "24", l: "findings carried into this contract", tone: "#7dd3fc", note: "four from each of six pillars" },
    chartTitle: "Findings by pillar, carried into scope", chartKind: "bars",
    bars: [
      { l: "Governance", v: "4 findings", pct: 100, c: "#3B82F6", flag: "Phase 2" },
      { l: "Security", v: "4 findings", pct: 92, c: "#8B5CF6", flag: "Phase 3, 5" },
      { l: "Compliance", v: "4 findings", pct: 84, c: "#F3F4F6", flag: "Phase 4" },
      { l: "Health", v: "4 findings", pct: 66, c: "#22C55E", flag: "Phase 5" },
      { l: "Adoption", v: "4 findings", pct: 58, c: "#F97316", flag: "Phase 6" },
      { l: "Licensing", v: "4 findings", pct: 44, c: "#14B8A6", flag: "self-funding" }
    ],
    wrong: [
      "Every finding retains the identifier it was given in its pillar report, so the audit trail is unbroken.",
      "A finding whose phase is removed from scope stays on the register as an accepted risk with a name against it.",
      "No finding appears in this register that was not measured in the tenant this morning."
    ],
    fix: [
      "Assign an internal owner to any finding whose phase you scope out.",
      "Keep the register open through delivery and close findings, not phases.",
      "Re-run the scan at close to confirm each finding is genuinely closed."
    ],
    delta: [["Findings on register", "24", "24"], ["Closed at completion", "0", "24"], ["Accepted risks", "0", "scoped out only"]] },

  { id: "sign", n: "09", title: "Acceptance & Signature", who: "shane", gate: true, lead: "And that is the whole document. Here is what you are agreeing to and what you get back.",
    head: { v: "78%", l: "Copilot readiness on completion", tone: "#34d399", note: "against a 75% gate" },
    chartTitle: "What completion looks like", chartKind: "heat",
    heat: [
      { l: "Copilot readiness", v: "78%", sub: "gate cleared", c: "#34d399" },
      { l: "Open findings", v: "0 of 24", sub: "all closed or owned", c: "#34d399" },
      { l: "Priced exposure", v: "$164K", sub: "from $4.1M", c: "#34d399" },
      { l: "Annual value", v: "$4.1M", sub: "instrumented", c: "#34d399" },
      { l: "Net year one", v: "+$613,200", sub: "after all costs", c: "#34d399" },
      { l: "Evidence pack", v: "maintained", sub: "regulator-ready", c: "#34d399" }
    ],
    wrong: [
      "Acceptance is per phase against written criteria, not a single sign-off at the end.",
      "Anything you scoped out stays on the findings register as an accepted risk with your name against it.",
      "The readiness number on completion is measured the same way it was measured this morning."
    ],
    fix: [
      "Sign the SOW and the MSA change record together.",
      "Approve the 400-seat pilot so value starts in week two rather than week thirteen.",
      "Book the week-six and week-twelve readouts now."
    ],
    delta: [["Copilot readiness", "34%", "78%"], ["Open findings", "24", "0"], ["Net year one", "—", "+$613,200"]] }
];


// ── Documents — every deliverable the assessment produced ────────────────────
export const DOC_LIBRARY = [
  { key: "governance", n: "01", title: "Governance Exposure & Oversharing", pillar: "Governance", color: "#3B82F6",
    pages: 34, tables: 4, playbooks: 5, findings: 4,
    summary: "Forty-one sites publish access that resolves to every internal account. The report names each one, what sits behind it, and the five playbooks that close it.",
    ai: "Copilot returned 41,208 citable files from a single unlabelled site during testing." },
  { key: "licensing", n: "02", title: "Copilot Licensing Alignment", pillar: "Licensing", color: "#14B8A6",
    pages: 28, tables: 5, playbooks: 4, findings: 4,
    summary: "The tenant pays for 1,308 seats nobody holds and withholds Copilot from the people who would return the most. Both are correctable inside one billing cycle.",
    ai: "Ninety days of workload telemetry, per user, against the SKU they hold." },
  { key: "adoption", n: "03", title: "Copilot Adoption & Workflow Readiness", pillar: "Adoption", color: "#F97316",
    pages: 26, tables: 4, playbooks: 4, findings: 4,
    summary: "The usage base is strong and the scaffolding is absent — zero champions, one generic deck, and 22% of meetings transcribed.",
    ai: "Workflow-level time study across 1,876 seats, measured rather than surveyed." },
  { key: "compliance", n: "04", title: "Compliance & Regulatory Position", pillar: "Compliance", color: "#F3F4F6",
    pages: 31, tables: 4, playbooks: 4, findings: 4,
    summary: "Containment is asserted rather than provable. 40,480 regulated files carry no label and Copilot prompts are evaluated by nothing.",
    ai: "Classifier match sampling with false-positive rates per regulated class." },
  { key: "health", n: "05", title: "Tenant Health & Operations", pillar: "Tenant Health", color: "#22C55E",
    pages: 22, tables: 4, playbooks: 4, findings: 4,
    summary: "312 endpoints outside baseline, no automated runbooks, and a restore that has never been tested.",
    ai: "Ticket-pattern analysis identifying the 40% answerable from existing content." },
  { key: "security", n: "06", title: "Security & Blast Radius", pillar: "Security", color: "#8B5CF6",
    pages: 37, tables: 5, playbooks: 5, findings: 4,
    summary: "Reachability rather than posture. One ordinary account retrieves 214,806 files, and the risk chain has four open links.",
    ai: "Per-persona blast radius computed from live permission resolution." },
  { key: "copilot", n: "07", title: "Copilot Readiness — Go / No-Go", pillar: "Copilot", color: "#67E8F9",
    pages: 19, tables: 3, playbooks: 3, findings: 0,
    summary: "Every pillar folded into one decision: no-go tenant-wide, go for a scoped pilot, gate cleared in twelve weeks.",
    ai: "Three live prompts run against the tenant, output retained as evidence." },
  { key: "sow", n: "08", title: "Statement of Work", pillar: "Deliverable", color: "#0078D4",
    pages: 16, tables: 4, playbooks: 0, findings: 24,
    summary: "Seven phases, twelve weeks, funded entirely from the licence recovery. Scope is yours to change.",
    ai: "Priced and sequenced from the finding register, not from a template." }
];

export const DOCS_WALK = [
  { id: "library", n: "01", title: "The Deliverable Set", who: "shane", lead: "Everything the assessment produced, in one place. Eight documents, none of them written before this morning.",
    head: { v: "213", l: "pages generated from your tenant", tone: "#7dd3fc", note: "33 tables, 29 playbooks, 24 findings" },
    chartTitle: "Documents by pillar", chartKind: "bars",
    bars: [
      { l: "Security & Blast Radius", v: "37 pp", pct: 100, c: "#8B5CF6", flag: "5 playbooks" },
      { l: "Governance Exposure", v: "34 pp", pct: 92, c: "#3B82F6", flag: "5 playbooks" },
      { l: "Compliance Position", v: "31 pp", pct: 84, c: "#F3F4F6", flag: "4 playbooks" },
      { l: "Licensing Alignment", v: "28 pp", pct: 76, c: "#14B8A6", flag: "4 playbooks" },
      { l: "Adoption Readiness", v: "26 pp", pct: 70, c: "#F97316", flag: "4 playbooks" },
      { l: "Tenant Health", v: "22 pp", pct: 60, c: "#22C55E", flag: "4 playbooks" }
    ],
    wrong: [
      "Every number in every document is reproducible with a read-only query your own team can run.",
      "The playbooks are written so you can run them without us — that is deliberate.",
      "Nothing here is a template. The tables contain your objects, named."
    ],
    fix: [
      "Read the executive summary of each and the playbooks of the two you will run yourselves.",
      "Hand the security and compliance documents to your counsel before the pilot.",
      "Keep the raw scan output — it is what makes the reports defensible."
    ],
    delta: [["Documents", "0", "8"], ["Playbooks", "0", "29"], ["Findings documented", "0", "24"]] },

  { id: "evidence", n: "02", title: "How They Were Produced", who: "kirk", lead: "Second — where the content came from, because that is what makes it defensible.",
    head: { v: "read-only", l: "every query, no agent installed", tone: "#34d399", note: "consent recorded, output retained" },
    chartTitle: "Sources behind the documents", chartKind: "heat",
    heat: [
      { l: "Microsoft Graph", v: "sites, identity", sub: "1,204 sites enumerated", c: "#7dd3fc" },
      { l: "SharePoint admin API", v: "sharing, ACLs", sub: "inheritance and links", c: "#7dd3fc" },
      { l: "Purview", v: "labels, DLP", sub: "184,000 files evaluated", c: "#7dd3fc" },
      { l: "Usage reports", v: "adoption", sub: "90-day window", c: "#fbbf24" },
      { l: "Intune", v: "device posture", sub: "1,876 endpoints", c: "#7dd3fc" },
      { l: "Copilot test prompts", v: "3 run", sub: "unprivileged identity", c: "#f87171" }
    ],
    wrong: [
      "Nothing was installed in your tenant. Every figure came from an API call with a recorded consent.",
      "Document contents were never read — the scan sees configuration and permission state.",
      "The only exception is the three Copilot test prompts, and their output is retained as evidence."
    ],
    fix: [
      "Keep the read-only consent so the position can be re-measured after each wave.",
      "Re-run the scan at each phase close and attach the delta to the evidence pack.",
      "Hand the raw JSON to your auditors rather than the slides."
    ],
    delta: [["Agents installed", "0", "0"], ["Re-derivable", "yes", "yes"], ["Evidence pack", "one-off", "maintained"]] }
];


// ── Full remediation guide — the gate clearance plan ─────────────────────────
export const REM_WALK = [
  { id: "overview", n: "01", title: "Remediation Overview", who: "shane", lead: "This is every action required to clear the Copilot deployment gate — organised by pillar, sequence and dependency. Nothing in it is optional; each step closes a blocker currently preventing activation.",
    head: { v: "24", l: "findings requiring remediation", tone: "#7dd3fc", note: "each one traces to your assessment" },
    chartTitle: "Gate blockers by pillar", chartKind: "bars",
    bars: [
      { l: "Governance", v: "1 blocker", pct: 100, c: "#3B82F6", flag: "+30 readiness" },
      { l: "Security", v: "1 blocker", pct: 84, c: "#8B5CF6", flag: "+14" },
      { l: "Compliance", v: "1 blocker", pct: 76, c: "#F3F4F6", flag: "+12" },
      { l: "Health", v: "gating", pct: 54, c: "#22C55E", flag: "+9" },
      { l: "Adoption", v: "gating", pct: 46, c: "#F97316", flag: "+8" },
      { l: "Licensing", v: "non-blocking", pct: 34, c: "#14B8A6", flag: "funds it" }
    ],
    wrong: [
      "Three findings block the gate outright; two gate the success of a pilot rather than its safety.",
      "Critical path duration is twelve weeks, with four phases parallelizable inside it.",
      "Every action uses a control you already license — nothing here is a procurement item."
    ],
    fix: [
      "Governance and security run first: between them they carry 44 of the 73 available points.",
      "Compliance labelling starts in week two because it is the longest pole, not the biggest lever.",
      "Adoption holds to weeks six through twelve so enablement lands on a governed tenant."
    ],
    delta: [["Findings open", "24", "0"], ["Expected readiness", "34%", "78%"], ["Critical path", "unbounded", "12 weeks"]] },

  { id: "gov", n: "02", title: "Governance Remediation", who: "jane", lead: "Governance first — this is where the blast radius actually lives.",
    head: { v: "6", l: "governance actions", tone: "#3B82F6", note: "closes the largest single blocker" },
    chartTitle: "Governance actions", chartKind: "bars",
    bars: [
      { l: "Remove org-wide and anonymous links", v: "41 sites · 23 links", pct: 100, c: "#3B82F6", flag: "+16" },
      { l: "Correct SharePoint and Teams oversharing", v: "17 teams", pct: 82, c: "#3B82F6", flag: "+6" },
      { l: "Apply labels to unlabelled content", v: "40,480 files", pct: 74, c: "#3B82F6", flag: "+4" },
      { l: "Restore permission inheritance", v: "128 libraries", pct: 58, c: "#3B82F6", flag: "+2" },
      { l: "Lifecycle policies for inactive sites and channels", v: "310 containers", pct: 44, c: "#3B82F6", flag: "+1" },
      { l: "Align naming conventions across workloads", v: "tenant-wide", pct: 30, c: "#3B82F6", flag: "+1" }
    ],
    wrong: [
      "Org-wide and EEEU links are standing tenant-wide read grants — Copilot honours them literally.",
      "Broken inheritance means nobody can answer who can see what without opening each library.",
      "Inactive sites and channels are never reviewed, so exposure created years ago is still live."
    ],
    fix: [
      "Set the default link type to Specific people, then replace each org-wide grant with a scoped group.",
      "Convert public Teams channels to private and remove anonymous links with no expiry.",
      "Enable default labels at provisioning and auto-label the regulated backlog."
    ],
    delta: [["Files reachable tenant-wide", "214,806", "18,240"], ["Governance pillar", "34", "89"], ["Unlabelled regulated files", "40,480", "1,120"]] },

  { id: "sec", n: "03", title: "Security Remediation", who: "kirk", lead: "Security next — identity is strong, but nothing governs the Copilot session itself.",
    head: { v: "6", l: "security actions", tone: "#8B5CF6", note: "closes the session boundary gap" },
    chartTitle: "Security actions", chartKind: "bars",
    bars: [
      { l: "Enforce MFA across all identities", v: "96% → 100%", pct: 62, c: "#8B5CF6", flag: "+2" },
      { l: "Correct admin roles, eliminate privilege creep", v: "18 → 5", pct: 78, c: "#8B5CF6", flag: "+3" },
      { l: "Re-align conditional access baseline", v: "CA01 · CA02 · CA03", pct: 100, c: "#8B5CF6", flag: "+5" },
      { l: "Disable legacy authentication protocols", v: "4 protocols", pct: 54, c: "#8B5CF6", flag: "+1" },
      { l: "Restore device compliance enforcement", v: "312 endpoints", pct: 72, c: "#8B5CF6", flag: "+2" },
      { l: "Re-enable and correct DLP policies", v: "2 unscoped sets", pct: 92, c: "#8B5CF6", flag: "+1" }
    ],
    wrong: [
      "No conditional access policy governs the Copilot app, so every grounded answer is unconditioned.",
      "Eighteen standing global admins against a target of five, with no PIM elevation.",
      "Two DLP policy sets never evaluate — 1,412 mailboxes and 8.4M messages are outside egress control."
    ],
    fix: [
      "Create CA01 scoped to the Copilot app requiring a compliant device — report-only for two weeks, then enforce.",
      "Move standing admin roles into PIM with approval and time limits.",
      "Scope the DLP baseline to finance and legal, and promote simulation rules to enforce."
    ],
    delta: [["Copilot session policy", "none", "CA01 enforced"], ["Standing global admins", "18", "5"], ["Security pillar", "51", "89"]] },

  { id: "cmp", n: "04", title: "Compliance Remediation", who: "beth", lead: "Compliance — this is the one that decides whether an incident is internal or reportable.",
    head: { v: "6", l: "compliance actions", tone: "#F3F4F6", note: "makes containment provable" },
    chartTitle: "Compliance actions", chartKind: "bars",
    bars: [
      { l: "Apply retention consistently across workloads", v: "6 workloads", pct: 76, c: "#F3F4F6", flag: "+3" },
      { l: "Correct labelling gaps for regulated content", v: "PII · PHI · financial", pct: 100, c: "#F3F4F6", flag: "+5" },
      { l: "Restore audit log completeness", v: "180d → 7yr", pct: 64, c: "#F3F4F6", flag: "+2" },
      { l: "Records management for regulated departments", v: "4 departments", pct: 52, c: "#F3F4F6", flag: "+1" },
      { l: "Resolve lifecycle violations in inactive containers", v: "310 containers", pct: 44, c: "#F3F4F6", flag: "+1" },
      { l: "Align DLP coverage with regulatory requirements", v: "42 CFR · HIPAA", pct: 88, c: "#F3F4F6", flag: "+2" }
    ],
    wrong: [
      "Three PHI classifiers sit in simulation mode — they report matches and block nothing.",
      "Copilot chat history is outside the retention scheme entirely.",
      "Retention is best-effort rather than provable, which is not a defence in an audit."
    ],
    fix: [
      "Promote the classifiers out of simulation after reviewing match rate on a 500-file sample.",
      "Bring Copilot prompts and responses into DLP scope and into the retention scheme.",
      "Segregate 42 CFR Part 2 records so they cannot be grounded on at all."
    ],
    delta: [["Provable containment", "no", "yes"], ["Audit retention", "180 days", "7 years"], ["Compliance pillar", "38", "84"]] },

  { id: "lic", n: "05", title: "Licensing Remediation", who: "shane", lead: "Licensing blocks nothing — but it funds everything else in this plan.",
    head: { v: "6", l: "licensing actions", tone: "#14B8A6", note: "$847,608 recoverable" },
    chartTitle: "Licensing actions", chartKind: "bars",
    bars: [
      { l: "Remove unused Copilot licences", v: "3 of 25", pct: 44, c: "#14B8A6", flag: "$1,140/mo" },
      { l: "Assign Copilot only to eligible personas", v: "400 seats", pct: 100, c: "#14B8A6", flag: "gated" },
      { l: "Correct SKU misalignment across departments", v: "760 users", pct: 86, c: "#14B8A6", flag: "$50,616/mo" },
      { l: "Normalize licensing inheritance groups", v: "38% direct", pct: 72, c: "#14B8A6", flag: "prevents drift" },
      { l: "Resolve seat drift from legacy templates", v: "1,308 seats", pct: 94, c: "#14B8A6", flag: "$847,608/yr" },
      { l: "Ensure personas meet Copilot prerequisites", v: "4 cohorts", pct: 58, c: "#14B8A6", flag: "gate" }
    ],
    wrong: [
      "1,308 paid seats are unassigned; 47 belong to people who have left.",
      "Twenty-five Copilot licences owned, two assigned — and one of those should be held back until governance closes.",
      "Thirty-eight percent of seats are assigned directly rather than by group, so every leaver is a manual step."
    ],
    fix: [
      "Reclaim unassigned and departed-staff seats, then reduce the purchased count at renewal.",
      "Right-size E5 against ninety days of real workload telemetry.",
      "Move all assignment to group-based licensing gated on labelled content and a compliant device."
    ],
    delta: [["Annual licence waste", "$847,608", "$0"], ["Copilot assigned", "2", "400"], ["New budget required", "$144,000", "$0"]] },

  { id: "ado", n: "06", title: "Adoption Remediation", who: "marcus", lead: "Adoption decides whether any of this returns hours or just invoices.",
    head: { v: "6", l: "adoption actions", tone: "#F97316", note: "weeks six to twelve" },
    chartTitle: "Adoption actions", chartKind: "bars",
    bars: [
      { l: "Increase Teams usage in low-adoption departments", v: "3 departments", pct: 62, c: "#F97316", flag: "+2" },
      { l: "Modernize workflows for Copilot alignment", v: "9 workflows", pct: 78, c: "#F97316", flag: "+3" },
      { l: "Train personas on Copilot fundamentals", v: "4 role tracks", pct: 100, c: "#F97316", flag: "+4" },
      { l: "Eliminate shadow collaboration", v: "64% files in chat", pct: 84, c: "#F97316", flag: "+2" },
      { l: "Align cross-department workflow patterns", v: "6 patterns", pct: 48, c: "#F97316", flag: "+1" },
      { l: "Implement monthly adoption reviews", v: "ongoing", pct: 36, c: "#F97316", flag: "+1" }
    ],
    wrong: [
      "Only 22% of meetings are transcribed, which gates the highest-frequency use case in the tenant.",
      "Zero named champions across 1,876 seats against a target of one per fifty.",
      "One generic enablement deck for every role — four role tracks are required."
    ],
    fix: [
      "Turn on transcription by default and name 38 champions before the pilot starts.",
      "Move work out of chat and into governed libraries so Copilot has something indexed to ground on.",
      "Build four role-based tracks at ninety minutes each, grounded in each role's real workflow."
    ],
    delta: [["Meetings transcribed", "22%", "85%"], ["Named champions", "0", "38"], ["Adoption pillar", "54", "86"]] },

  { id: "hlt", n: "07", title: "Health Remediation", who: "marcus", lead: "Health is what decides whether the security controls lock people out when you enforce them.",
    head: { v: "6", l: "health actions", tone: "#22C55E", note: "1 in 6 devices blocked today" },
    chartTitle: "Health actions", chartKind: "bars",
    bars: [
      { l: "Correct workload misconfigurations", v: "Exchange · SPO · Teams", pct: 74, c: "#22C55E", flag: "+3" },
      { l: "Restore baseline settings across services", v: "312 endpoints", pct: 100, c: "#22C55E", flag: "+4" },
      { l: "Resolve sync errors and client health issues", v: "184 clients", pct: 58, c: "#22C55E", flag: "+1" },
      { l: "Clean up orphaned resources and inactive containers", v: "310 containers", pct: 52, c: "#22C55E", flag: "+1" },
      { l: "Reduce service instability and degradation events", v: "9 events/qtr", pct: 44, c: "#22C55E", flag: "+1" },
      { l: "Implement operational hygiene standards", v: "5 runbooks", pct: 38, c: "#22C55E", flag: "+1" }
    ],
    wrong: [
      "312 endpoints sit outside the compliance baseline — one device in six.",
      "47 tenant settings drifted outside change control in the last ninety days.",
      "Zero automated remediation runbooks; every fix is manual and after-hours."
    ],
    fix: [
      "Re-publish the compliance baseline and re-assign the unassigned device groups.",
      "Automate the top five recurring alerts so drift is corrected without a ticket.",
      "Test restore and set a recovery time objective — it has never been exercised."
    ],
    delta: [["Endpoints off baseline", "312", "41"], ["Devices blocked at enforcement", "312", "41"], ["Health pillar", "58", "88"]] },

  { id: "cpl", n: "08", title: "Copilot-Specific Remediation", who: "shane", lead: "And these six exist only because Copilot is being introduced — they have no other purpose.",
    head: { v: "6", l: "Copilot-specific actions", tone: "#67E8F9", note: "none of these existed before Copilot" },
    chartTitle: "Copilot-specific actions", chartKind: "heat",
    heat: [
      { l: "Reduce blast radius", v: "214,806 → 18,240", sub: "correct oversharing before the index builds", c: "#67E8F9" },
      { l: "Label groundable content", v: "40,480 files", sub: "so answers inherit a classification", c: "#67E8F9" },
      { l: "Align workflows to value paths", v: "9 workflows", sub: "documentation, handover, deflection", c: "#67E8F9" },
      { l: "Enforce CA for Copilot workloads", v: "CA01", sub: "compliant device, 12-hour sign-in frequency", c: "#67E8F9" },
      { l: "Resolve licensing blockers", v: "400 seats", sub: "eligibility gated on boundary and device", c: "#67E8F9" },
      { l: "Restore workload stability for grounding", v: "312 endpoints", sub: "so enforcement does not lock users out", c: "#67E8F9" }
    ],
    wrong: [
      "Copilot does not widen access — it makes what is already open trivially findable, with a citation.",
      "Time to first citation drops from twenty minutes to nine seconds, which is what changes the risk profile.",
      "All three test prompts returned regulated content with no elevated rights and no classification warning."
    ],
    fix: [
      "Close sharing and label the backlog before the semantic index builds — not after.",
      "Gate licence eligibility on a labelled boundary and a compliant device, enforced by group.",
      "Re-run the three test prompts as an acceptance test after each remediation wave."
    ],
    delta: [["Files a prompt can cite", "214,806", "18,240"], ["Test prompts returning PHI", "3 of 3", "0 of 3"], ["Copilot readiness", "34%", "78%"]] },

  { id: "seq", n: "09", title: "Remediation Sequence", who: "shane", lead: "The order matters more than the effort. This is the critical path.",
    head: { v: "6", l: "phases on the critical path", tone: "#7dd3fc", note: "twelve weeks end to end" },
    chartTitle: "Phase sequence", chartKind: "heat",
    heat: [
      { l: "Phase 1", v: "Governance & Security", sub: "weeks 1–4 · carries 44 of 73 points", c: "#3B82F6" },
      { l: "Phase 2", v: "Compliance & Licensing", sub: "weeks 2–7 · labelling is the longest pole", c: "#F3F4F6" },
      { l: "Phase 3", v: "Adoption & Health", sub: "weeks 5–10 · enablement on a governed tenant", c: "#F97316" },
      { l: "Phase 4", v: "Copilot Enablement", sub: "weeks 9–11 · pilot into Finance and Legal", c: "#67E8F9" },
      { l: "Phase 5", v: "Gate Validation", sub: "week 11 · re-run the acceptance tests", c: "#8B5CF6" },
      { l: "Phase 6", v: "Readiness Certification", sub: "week 12 · sign-off and phased rollout", c: "#22C55E" }
    ],
    wrong: [
      "Running adoption before governance trains people on a tenant that is about to change underneath them.",
      "Enforcing conditional access before the device baseline blocks one user in six on day one.",
      "Labelling started late becomes the reason the gate slips, because it cannot be compressed."
    ],
    fix: [
      "Start phases 1 and 2 together in week two — they share no owners and no change windows.",
      "Hold phase 4 until phases 1 and 2 have passed their acceptance tests, not their end dates.",
      "Treat phase 5 as a gate, not a milestone: if a condition fails, the phase repeats."
    ],
    delta: [["Phases", "unsequenced", "6"], ["Parallelizable", "0", "4"], ["Critical path", "unbounded", "12 weeks"]] },

  { id: "gate", n: "10", title: "Gate Validation Checklist", who: "shane", gate: true, lead: "And this is the checklist the gate is actually measured against.",
    head: { v: "1 of 8", l: "conditions passing today", tone: "#f87171", note: "all eight required to clear" },
    chartTitle: "Gate conditions", chartKind: "heat",
    heat: [
      { l: "Governance blockers", v: "OPEN", sub: "41 sites publishing tenant-wide", c: "#f87171" },
      { l: "Security blockers", v: "OPEN", sub: "no Copilot session policy", c: "#f87171" },
      { l: "Compliance blockers", v: "OPEN", sub: "40,480 regulated files unlabelled", c: "#f87171" },
      { l: "Licensing blockers", v: "OPEN", sub: "2 of 400 pilot seats assigned", c: "#fbbf24" },
      { l: "Adoption blockers", v: "OPEN", sub: "22% transcription, zero champions", c: "#fbbf24" },
      { l: "Health blockers", v: "OPEN", sub: "312 endpoints off baseline", c: "#fbbf24" },
      { l: "Blast radius at safe threshold", v: "OPEN", sub: "214,806 files against a 20,000 ceiling", c: "#f87171" },
      { l: "Readiness at or above 75%", v: "PASS PENDING", sub: "34% today · 78% projected", c: "#34d399" }
    ],
    wrong: [
      "Seven of eight conditions are open. None of them is a procurement problem.",
      "The blast-radius condition is the one that cannot be argued down — it is a measured count.",
      "Readiness alone is not the gate; a 75% score with an open blocker still fails."
    ],
    fix: [
      "Re-run this checklist at the end of every phase, not at the end of the programme.",
      "Attach the evidence to each condition as it closes so certification is a formality.",
      "Any condition that reopens sends the gate back to blocked — that is deliberate."
    ],
    delta: [["Conditions passing", "1 of 8", "8 of 8"], ["Blast radius", "214,806", "18,240"], ["Readiness", "34%", "78%"]] },

  { id: "exec", n: "11", title: "Executive Summary", who: "shane", lead: "And the version for the people who will not read the other ten sections.",
    head: { v: "78%", l: "readiness at week twelve", tone: "#34d399", note: "from 34% today" },
    chartTitle: "What clearing the gate takes", chartKind: "heat",
    heat: [
      { l: "Coordinated across", v: "6 pillars", sub: "governance, security, compliance, licensing, adoption, health", c: "#67E8F9" },
      { l: "Discrete actions", v: "36", sub: "six per pillar, each traced to a finding", c: "#67E8F9" },
      { l: "Elapsed time", v: "12 weeks", sub: "four phases run in parallel", c: "#67E8F9" },
      { l: "New budget required", v: "$0", sub: "funded from $847,608 of licence recovery", c: "#34d399" },
      { l: "Risk reduction", v: "91%", sub: "blast radius 214,806 → 18,240 files", c: "#34d399" },
      { l: "Outcome", v: "GATE PASS", sub: "Copilot deployed safely and effectively", c: "#34d399" }
    ],
    wrong: [
      "Doing nothing costs $412,000 a month in unrealised value while the exposure stays flat.",
      "Deploying without this plan puts a PHI disclosure inside MSA §7.4 rather than an internal incident.",
      "There is no version of this where licences alone make the tenant ready."
    ],
    fix: [
      "Approve the twelve-week plan and start phases 1 and 2 in the same week.",
      "Fund it from the licence recovery already identified — no new budget line.",
      "Certify at week twelve, then begin the phased rollout to ready personas."
    ],
    delta: [["Readiness", "34%", "78%"], ["Open findings", "24", "0"], ["New budget", "—", "$0"]] }
];


// ── 12-week remediation timeline ─────────────────────────────────────────────
export const TIMELINE = [
  { w: "Week 1", title: "Baseline Correction", color: "#3B82F6",
    items: ["Remove org-wide and anonymous links", "Enforce MFA across all identities", "Disable legacy authentication protocols", "Apply sensitivity labels to high-risk unlabeled content", "Correct licensing prerequisites for Copilot personas", "Restore baseline Conditional Access policies (CA01, CA02)"] },
  { w: "Week 2", title: "Oversharing & Permission Hygiene", color: "#3B82F6",
    items: ["Correct oversharing in SharePoint and Teams", "Restore permission inheritance in broken libraries", "Remove external guest access where unnecessary", "Normalize permission sprawl groups", "Begin lifecycle cleanup of inactive sites and channels"] },
  { w: "Week 3", title: "Security Hardening", color: "#8B5CF6",
    items: ["Correct admin role assignments", "Eliminate privilege creep", "Enforce device compliance requirements", "Re-enable and correct DLP policies", "Align Conditional Access with identity and device posture"] },
  { w: "Week 4", title: "Compliance Alignment", color: "#F3F4F6",
    items: ["Apply retention policies consistently across workloads", "Correct labeling gaps for regulated content (PII, PHI, financial)", "Restore audit log completeness across services", "Implement records management for regulated departments", "Resolve lifecycle violations in inactive containers"] },
  { w: "Week 5", title: "Licensing Normalization", color: "#14B8A6",
    items: ["Remove unused Copilot licenses", "Assign Copilot only to eligible personas", "Correct SKU misalignment across departments", "Normalize licensing inheritance groups", "Resolve seat drift caused by legacy templates"] },
  { w: "Week 6", title: "Workflow Modernization", color: "#F97316",
    items: ["Increase Teams usage across low-adoption departments", "Modernize workflows for Copilot alignment", "Eliminate shadow collaboration (email-only workflows)", "Align cross-department workflow patterns", "Begin persona-based Copilot enablement training"] },
  { w: "Week 7", title: "Health & Operational Stability", color: "#22C55E",
    items: ["Correct workload misconfigurations (Exchange, SharePoint, Teams)", "Restore baseline settings across services", "Resolve sync errors and client health issues", "Clean up orphaned resources and inactive containers", "Reduce service instability and degradation events"] },
  { w: "Week 8", title: "Copilot Safety Corrections", color: "#67E8F9",
    items: ["Reduce Copilot blast radius by correcting oversharing", "Label all content Copilot can ground on", "Enforce Conditional Access for Copilot workloads", "Resolve licensing blockers preventing Copilot activation", "Restore workload stability required for Copilot grounding"] },
  { w: "Week 9", title: "Cross-Pillar Validation", color: "#0078D4",
    items: ["Governance validation", "Security validation", "Compliance validation", "Licensing validation", "Adoption validation", "Health validation"] },
  { w: "Week 10", title: "Copilot Readiness Review", color: "#67E8F9",
    items: ["Recalculate readiness score", "Validate blast radius reduction", "Validate persona readiness", "Validate workflow alignment", "Validate regulated content safety"] },
  { w: "Week 11", title: "Gate Pre-Check", color: "#0078D4",
    items: ["Ensure all blockers resolved", "Ensure readiness score ≥ 75%", "Ensure Conditional Access fully aligned", "Ensure regulated content protected", "Ensure workflows Copilot relies on are stable"] },
  { w: "Week 12", title: "Copilot Gate Clearance", color: "#34d399",
    items: ["Final readiness certification", "Copilot Gate status: PASS", "Copilot deployment approved", "Begin phased rollout to ready personas", "Schedule post-deployment monitoring"] }
];

export const TL_WALK = [
  { id: "path", n: "01", title: "The 12-Week Critical Path", who: "shane", timeline: true, lead: "This is the exact sequence required to clear the gate. Phases run in parallel where it is safe to do so, and every step traces to a finding.",
    head: { v: "12 weeks", l: "from baseline correction to certification", tone: "#34d399", note: "22 weeks if run sequentially" },
    chartTitle: "Where the effort sits", chartKind: "bars",
    bars: [
      { l: "Weeks 1–2 · Governance", v: "11 actions", pct: 100, c: "#3B82F6", flag: "+30 readiness" },
      { l: "Week 3 · Security", v: "5 actions", pct: 46, c: "#8B5CF6", flag: "+14" },
      { l: "Weeks 4–5 · Compliance & Licensing", v: "10 actions", pct: 88, c: "#F3F4F6", flag: "+19" },
      { l: "Weeks 6–7 · Adoption & Health", v: "10 actions", pct: 84, c: "#F97316", flag: "+17" },
      { l: "Weeks 8–12 · Copilot & validation", v: "26 actions", pct: 92, c: "#67E8F9", flag: "certification" }
    ],
    wrong: [
      "Run these in series and the twelve weeks becomes twenty-two — the parallelism is the plan.",
      "Weeks 9 to 11 are validation, not delivery. Nothing new is built; the position is re-measured.",
      "Week 12 issues certification only if all eight gate conditions pass."
    ],
    fix: [
      "Book all six change windows at signature so the sequence cannot slip on process.",
      "Re-measure weekly through weeks 1 to 8 so progress is evidence rather than status.",
      "Hold the rollout date to certification, not to a calendar quarter."
    ],
    delta: [["Elapsed", "22 weeks sequential", "12 weeks parallel"], ["Readiness", "34%", "78%"], ["Gate status", "BLOCKED", "PASS"]] },

  { id: "tlexec", n: "02", title: "Executive Summary", who: "shane", gate: true, lead: "And the summary your steering group will read.",
    head: { v: "PASS", l: "gate status at week twelve", tone: "#34d399", note: "if every condition is met" },
    chartTitle: "What week twelve looks like", chartKind: "heat",
    heat: [
      { l: "Readiness", v: "78%", sub: "against a 75% gate", c: "#34d399" },
      { l: "Blast radius", v: "18,240", sub: "from 214,806", c: "#34d399" },
      { l: "Open blockers", v: "0", sub: "all six pillars", c: "#34d399" },
      { l: "Regulated content", v: "labelled", sub: "99% coverage", c: "#34d399" },
      { l: "Pilot", v: "400 seats", sub: "phased rollout begins", c: "#34d399" },
      { l: "Monitoring", v: "continuous", sub: "post-deployment", c: "#34d399" }
    ],
    wrong: [
      "This timeline clears every blocker preventing Copilot activation — nothing is deferred past the gate.",
      "Governance, security, compliance, licensing, adoption and health must be corrected in sequence.",
      "Deployment approval is the outcome of the measurement, not a decision taken alongside it."
    ],
    fix: [
      "Approve the scoped pilot now so value starts in week two rather than week thirteen.",
      "Book the week-nine and week-eleven readouts at signature.",
      "Schedule post-deployment monitoring as part of the same approval."
    ],
    delta: [["Gate status", "BLOCKED", "PASS"], ["Deployment", "not approved", "approved"], ["Rollout", "none", "phased"]] }
];


// ── Pre-briefing: the wizard the customer completes before the scan ──────────

export const PERSONA_CATALOG = [
  { cluster: "Mission & Flight Operations", desc: "Flight command, mission control & satellite telemetry ops",
    personas: [
      { p: "Flight Controller", d: "Real-time telemetry, anomaly triage & shift handover", n: "212",
        outcomes: ["Faster anomaly detection and triage", "Reduced cognitive load during operations", "More reliable shift handover packages"],
        uses: ["Mission Log Drafting & Summaries", "Real-Time Telemetry Interpretation", "Shift Handover Package Generation", "Procedure Lookup & Cross-Reference"] },
      { p: "Mission Specialist", d: "Flight procedures, payload prep & mission logs", n: "148",
        outcomes: ["Mission safety through fewer checklist errors", "Consistent mission log quality"],
        uses: ["Mission Log Synthesis", "Timeline / Event Sequence Reconstruction"] },
      { p: "Flight Director", d: "Command centre oversight & contingency protocols", n: "12",
        outcomes: ["Improved decision confidence", "Better incident documentation"],
        uses: ["Contingency Protocol Drafting", "Incident Report Drafting"] },
      { p: "Flight Surgeon", d: "Crew physiological monitoring & bio-telemetry", n: "18",
        outcomes: ["Faster synthesis of crew health data"],
        uses: ["Bio-Telemetry Summarization"] }
    ] },
  { cluster: "Science & Research", desc: "Astrophysical study, orbital mechanics & propulsion research",
    personas: [
      { p: "Scientist", d: "Domain research, astrophysical calculation & paper synthesis", n: "340",
        outcomes: ["Research acceleration — months to days", "Engineering accuracy in calculation"],
        uses: ["Literature Synthesis", "Mission Feasibility Calculation"] },
      { p: "Research Analyst", d: "Literature reviews, grant proposals & data collection", n: "126",
        outcomes: ["Faster grant cycles", "Documentation quality"],
        uses: ["Grant Proposal Drafting", "Literature Synthesis"] },
      { p: "Data Scientist", d: "Telemetry analysis, modelling & sensor analytics", n: "88",
        outcomes: ["Faster anomaly surfacing across datasets"],
        uses: ["Telemetry Pattern Detection"] },
      { p: "Lab Specialist", d: "Cleanroom instrument testing & material analysis", n: "64",
        outcomes: ["Standardised sample reporting"],
        uses: ["Sample Analysis Reporting"] }
    ] },
  { cluster: "Engineering", desc: "Payload, hardware systems, CAD modelling & safety testing",
    personas: [
      { p: "Payload Engineer", d: "Instrument calibration, hardware integration & CAD specs", n: "204",
        outcomes: ["Documentation quality across global sites"],
        uses: ["Integration Spec Drafting"] },
      { p: "Systems Engineer", d: "Subsystem integration, thermal & power budget validation", n: "176",
        outcomes: ["Engineering accuracy in budget validation"],
        uses: ["Systems Budget Documentation"] },
      { p: "Safety Engineer", d: "Fault tree analysis, hazard identification & fail-safe testing", n: "58",
        outcomes: ["Mission safety through formal hazard analysis"],
        uses: ["Fault Tree Reporting"] },
      { p: "Requirements Engineer", d: "Specification verification & traceability matrices", n: "42",
        outcomes: ["Traceable requirement verification"],
        uses: ["Traceability Matrix Drafting"] }
    ] },
  { cluster: "Program & Administration", desc: "Agency compliance, liaison & program management",
    personas: [
      { p: "Program Manager", d: "Schedule alignment, agency compliance & contractor budgets", n: "96",
        outcomes: ["Faster inter-agency reporting"],
        uses: ["Agency Status Reporting"] },
      { p: "Communications Specialist", d: "Public mission briefings & internal newsletters", n: "34",
        outcomes: ["Clearer public-facing communication"],
        uses: ["Mission Briefing Drafting"] },
      { p: "Policy Analyst", d: "Space law, ITAR compliance & export control governance", n: "22",
        outcomes: ["Faster regulatory synthesis"],
        uses: ["Compliance Brief Drafting"] }
    ] }
];

// WIZ_PERSONAS and WIZ_QUESTIONS used to sit here: a six-role roster with
// invented seat counts ("Attending Clinician · 2,140") and twelve invented
// questions, all belonging to the Northline Health demo org this prototype was
// designed around. Every customer in the platform saw the same fictional
// hospital. Both are now built per customer from the real quiz catalog, scoped
// to their own industry — see warRoomQuizCatalog.ts (#306).

export const SCAN_PHASES = [
  { l: "Establishing read-only consent", d: "Graph · SharePoint admin · Purview · Intune", n: "4 scopes", grp: "Connect" },
  { l: "Connecting to Microsoft Graph", d: "read-only consent · no agent installed", n: "authenticating" },
  { l: "Enumerating sites and libraries", d: "SharePoint admin API", n: "1,204 sites" },
  { l: "Resolving sharing links and permissions", d: "EEEU · org-wide · anonymous · guest ACLs", n: "214,806 files" },
  { l: "Reading Purview labels and DLP scope", d: "classification and policy estate", n: "184,000 evaluated" },
  { l: "Pulling licence and usage telemetry", d: "subscribedSkus + 90-day activity", n: "6,180 seats" },
  { l: "Checking device and service health", d: "Intune + service dashboard", n: "1,876 endpoints" },
  { l: "Running Copilot test prompts", d: "unprivileged test identity", n: "3 prompts" },
  { l: "Scoring seven pillars", d: "weighting findings against the gate", n: "24 findings", grp: "Score" },
  { l: "Generating the governance report", d: "34 pages · 4 tables · 5 playbooks", n: "governance", grp: "Documents" },
  { l: "Generating the licensing report", d: "28 pages · 5 tables · 4 playbooks", n: "licensing", grp: "Documents" },
  { l: "Generating the adoption report", d: "26 pages · 4 tables · 4 playbooks", n: "adoption", grp: "Documents" },
  { l: "Generating the compliance report", d: "31 pages · 4 tables · 4 playbooks", n: "compliance", grp: "Documents" },
  { l: "Generating the health report", d: "22 pages · 4 tables · 4 playbooks", n: "health", grp: "Documents" },
  { l: "Generating the security report", d: "37 pages · 5 tables · 5 playbooks", n: "security", grp: "Documents" },
  { l: "Generating the readiness decision", d: "19 pages · go / no-go", n: "copilot", grp: "Documents" },
  { l: "Building the statement of work", d: "7 phases priced from the finding register", n: "sow", grp: "Documents" },
  { l: "Assembling the remediation plan", d: "36 actions · 12-week critical path", n: "plan", grp: "Documents" },
  { l: "Preparing the briefing room", d: "personas, board and radar", n: "ready", grp: "Briefing" }
];

export const GOV_BASE = { score: 34, sites: 41, docs: 11400, guests: 312, labelled: 78, inherit: 96 };

export const GOV_LEVERS = [
  { id: "orgwide", title: "Remove org-wide sharing links", detail: "Replace 'Everyone except external users' links with scoped groups on 41 sites.",
    owner: "Maya · SharePoint admin", effort: "2 weeks", risk: "Low — link recipients notified",
    d: { score: 7, sites: -41, docs: -4200, guests: 0, labelled: 0 } },
  { id: "inherit", title: "Re-inherit broken permissions", detail: "Reset unique permissions on 96 sites and libraries back to the parent scope.",
    owner: "Maya · SharePoint admin", effort: "3 weeks", risk: "Medium — access reviews required first",
    d: { score: 5, sites: 0, docs: -2100, guests: 0, labelled: 0 } },
  { id: "guests", title: "Expire and re-approve guest access", detail: "90-day expiry on 312 guest identities; owner attestation to renew.",
    owner: "Kirk · access governance", effort: "1 week", risk: "Low — staged by site",
    d: { score: 4, sites: 0, docs: -900, guests: -268, labelled: 0 } },
  { id: "labels", title: "Auto-label unlabelled content", detail: "Purview auto-classification across the 22% of content with no sensitivity label.",
    owner: "Beth · compliance", effort: "4 weeks", risk: "Medium — simulation mode first",
    d: { score: 6, sites: 0, docs: -3100, guests: 0, labelled: 21 } },
  { id: "creation", title: "Govern site & team creation", detail: "Template-only creation with mandatory owner, label and lifecycle policy.",
    owner: "Maya · platform", effort: "2 weeks", risk: "Low — no impact to existing sites",
    d: { score: 3, sites: 0, docs: 0, guests: 0, labelled: 1 } },
  { id: "rss", title: "Restricted SharePoint Search", detail: "Copilot grounded on an allow-list of governed sites while remediation runs.",
    owner: "Shane · Copilot rollout", effort: "2 days", risk: "Low — reversible per site",
    d: { score: 2, sites: 0, docs: -1100, guests: 0, labelled: 0 } }
];

export const SCRIPT = [
  { who: "shane", act: 0, text: "Introductions done. Before we look at a single control, tell me what you would actually use this for. Say it plainly and I'll put it on the board.", focus: "copilotready" },
  { who: "jane", act: 0, text: "Mine is the shift handover. Forty-one channels, and I rebuild the same note by hand every evening. If it could draft that from the threads and cite where each line came from, that is my day back.", focus: "teams", uc: "uc1" },
  { who: "jane", act: 0, text: "Second one — finding the current version of a policy. There are four copies of most of them. I need the one answer, not the four.", focus: "sharepoint", uc: "uc2" },
  { who: "priya", act: 0, text: "For me it's the weekly status and the referral letters. Both are assembled from documents that already exist. I want them drafted, with citations I can check.", focus: "semantic", uc: "uc3" },
  { who: "priya", act: 0, text: "And summarising prior work across sites before I start writing — that is the part that costs me hours.", focus: "semantic", uc: "uc4" },
  { who: "marcus", act: 0, text: "Support: deflect the forty repeat questions with a cited answer, so my team only sees the ones that need a human.", focus: "servicehealth", uc: "uc5" },
  { who: "marcus", act: 0, text: "And build the incident evidence pack automatically — timeline, comms, change records — instead of me assembling it after midnight.", focus: "servicehealth", uc: "uc6" },
  { who: "kirk", act: 0, text: "Mine isn't a productivity use case. Before a single licence is assigned I want to see the blast radius — exactly what a prompt could reach, per site.", focus: "ca", uc: "uc7" },
  { who: "beth", act: 0, text: "And I need provable containment of regulated content. Not assurance in a slide. Evidence I could hand a regulator.", focus: "dlp", uc: "uc8" },
  { who: "shane", act: 0, text: "Eight use cases, on the board. Everything from here is measured against them — and every one of them lands or fails on the same thing.", focus: "copilotready" },
  { who: "shane", act: 0, text: "Governance. Not policy documents. What your tenant is actually doing with access right now.", focus: "sharepoint" },
  { who: "jane", act: 0, text: "This is my world. 1,204 sites, and I can name maybe forty owners. The rest were spun up for a project that ended two years ago and nobody closed them.", focus: "sharepoint" },
  { who: "kirk", act: 0, text: "And governance is not a tidiness problem here. Whatever a site is sharing today is exactly what Copilot will ground on tomorrow. Sloppy sharing becomes a retrieval surface.", focus: "guests" },
  { who: "beth", act: 0, text: "Which is the part that reaches me. If an answer cites a document from a site nobody owns, I cannot tell a regulator who authorised access. That is the gap.", focus: "sharepoint" },
  { who: "shane", act: 0, text: "So let's stop describing it. Here is your live governance telemetry — and the levers. Toggle them and watch what changes.", focus: "sharepoint", dive: "governance" , covers: ["uc2"] },
  { who: "kirk", act: 0, text: "That board is the whole argument. Nothing on it is exotic — it's ownership, scope and labels. Governance is not a blocker to Copilot; it is what decides whether Copilot is safe to switch on.", focus: "sharepoint" },
  { who: "jane", act: 0, text: "And it answers my second one directly. Once there is a single owned source per policy, 'find the current version' stops being a search problem.", focus: "sharepoint", covers: ["uc2"] },
  { who: "beth", act: 0, text: "Labels do the same for me. If the content is classified, a grounded answer inherits that classification — that is the difference between an internal note and a reportable event.", focus: "purview" },
  { who: "marcus", act: 0, text: "Restricted search is the one I would take tomorrow. Ground Copilot on the sites we trust, let the rest catch up.", focus: "semantic" },
  { who: "shane", act: 0, text: "Governance clears the path for half the board. But it does not pay for anything. So let's talk about what you are already spending.", focus: "meter" },
  { who: "jane", act: 0, text: "We were told we were fully licensed for Copilot. I have never seen it.", focus: "copilotready" },
  { who: "shane", act: 0, text: "You have twenty-five Copilot seats. Two are assigned. Here is the full licence position — change any of it and watch the money move.", focus: "meter", dive: "licensing" },
  { who: "kirk", act: 0, text: "So the money to do the governance work is already in the tenant. It is sitting in unassigned seats.", focus: "meter" },
  { who: "shane", act: 0, text: "Which brings us to adoption. Licences you assign and nobody opens are the same waste with a different label.", focus: "teams" },
  { who: "jane", act: 0, text: "Nobody trained us. We were given Teams and told to get on with it. Half my floor still emails attachments to themselves.", focus: "teams" },
  { who: "marcus", act: 0, text: "And that is where my queue comes from. People using the wrong tool for the job, then asking me why it broke.", focus: "servicehealth" },
  { who: "shane", act: 0, text: "Here is what your usage telemetry actually shows — and what enablement would move.", focus: "teams", dive: "adoption" },
  { who: "priya", act: 0, text: "Role-based paths would land for me. I do not need a Copilot course, I need my three documents.", focus: "semantic", covers: ["uc3", "uc4"] },

  { who: "beth", act: 0, text: "Adoption is where my risk goes up though. More people using it, more regulated content in play. I need the compliance side answered before we scale.", focus: "purview" },
  { who: "shane", act: 0, text: "Fair. So let's look at compliance the same way — what a regulator would find if they walked in today.", focus: "dlp" },
  { who: "kirk", act: 0, text: "The gap is not policy. You have policies. They are scoped to the wrong things.", focus: "dlp" },
  { who: "shane", act: 0, text: "Your regulated-content position, live.", focus: "purview", dive: "compliance" },
  { who: "beth", act: 0, text: "Auto-labelling plus scoped DLP is my containment evidence. That is the answer I could hand a regulator.", focus: "dlp", covers: ["uc8"] },

  { who: "marcus", act: 0, text: "Can we talk about run cost? Every one of these changes lands in my queue eventually.", focus: "servicehealth" },
  { who: "shane", act: 0, text: "It should. Health is the pillar that decides whether any of this survives contact with a Tuesday.", focus: "servicehealth" },
  { who: "shane", act: 0, text: "Your service telemetry — and what deflection and automation would take out of Ellis's week.", focus: "servicehealth", dive: "health" },
  { who: "marcus", act: 0, text: "Deflection at that rate is 136 tickets a week I never see. That is my two use cases, both of them.", focus: "servicehealth", covers: ["uc5", "uc6"] },

  { who: "kirk", act: 0, text: "Last one before anyone gets excited. Security. Not posture scores — reachability.", focus: "ca" },
  { who: "kirk", act: 0, text: "Eighteen standing global admins and legacy auth still on. Copilot does not create that surface. It reads it.", focus: "entra" },
  { who: "shane", act: 0, text: "Your attack surface, and the four changes that close it.", focus: "ca", dive: "security" },
  { who: "kirk", act: 0, text: "PIM plus phishing-resistant MFA plus device compliance — that is my blast-radius answer. I would sign that.", focus: "ca", covers: ["uc7"] },
  { who: "jane", act: 0, text: "And the handover draft — with governed sites and labels, that is safe to run now.", focus: "teams", covers: ["uc1"] },

  { who: "shane", act: 0, text: "So. Six pillars, every number moved by a decision made in this room, not a slide. Here is what your tenant looks like now.", focus: "copilotready", dive: "copilot" },
  { who: "shane", act: 0, text: "That is the whole case. Same sequence I ran at agency scale — governance first, licences right-sized, adoption led, compliance provable, health protected, security closed, Copilot last.", focus: "copilotready" },
  { who: "shane", act: 0, text: "Your tenant scan finished this morning. Before I show you a single chart, meet three of your own people — built from the roles and workflows the scan actually found.", focus: null },
  { who: "jane", act: 0, text: "I'm on the floor most of the day. I sit in 41 Teams channels, twelve of them active before lunch. By the time I'm back at my desk there are 300 unread messages and I honestly can't tell which ones matter.", focus: "teams" },
  { who: "priya", act: 0, text: "I write the same three documents every week — shift summary, incident recap, weekly status. Every one of them is an hour spent retyping things that already exist somewhere in this tenant.", focus: "sharepoint" , covers: ["uc1"] },
  { who: "marcus", act: 0, text: "Support side, my team answers the same forty questions a day. Every answer is already written down. Nobody can find it.", focus: "semantic" },
  { who: "shane", act: 1, text: "Now put a number on that. From your own telemetry, not a benchmark: 6.4 hours per person per week lost to search, duplication and channel noise.", focus: "teams", quantified: true , covers: ["uc4"] },
  { who: "jane", act: 1, text: "For my shift that is most of a working day, every single week.", focus: "teams" },
  { who: "shane", act: 2, text: "So let's not theorise. Live prompt, your data, right now — this is the same thing you would run tomorrow morning.", focus: "semantic", demo: true },
  { who: "priya", act: 2, text: "That is my weekly status. Nine seconds, and it cited the right incident numbers — the ones I would have spent twenty minutes finding.", focus: "semantic" , covers: ["uc3"] },
  { who: "marcus", act: 3, text: "Run that across my queue and most of the forty questions answer themselves before they reach a human.", focus: "teams" , covers: ["uc5"] },
  { who: "shane", act: 3, text: "Across 1,876 active users, 6.4 hours a week returned is 512,000 dollars a year at your blended rate. That is the upside, measured from your tenant.", focus: "meter", payoff: true , covers: ["uc6"] },
  { who: "kirk", act: 4, text: "Before anyone signs anything. If Copilot can find that document in nine seconds, so can everyone who should not. Your scan shows no DLP scope on finance and legal mail.", focus: "dlp", set: { dlp: "alert" }, join: "kirk", mood: "security", board: "No DLP scope · finance + legal mail", hand: "dlp" },
  { who: "kirk", act: 4, text: "41 sites publish org-wide links. Eighteen accounts hold global admin. That is the real surface, and it exists today, with or without Copilot.", focus: "sharepoint", set: { sharepoint: "alert" }, board: "41 sites overshared · 18 global admins", hand: "sharepoint" , covers: ["uc7"] },
  { who: "beth", act: 4, text: "And we are retail. What happens the first time a support rep pastes a card number into a chat and Copilot cites it back a week later? That is a reportable event, not an incident.", focus: "purview", join: "beth", mood: "legal", board: "Card data in chat · reportable under MSA", chain: true },
  { who: "kirk", act: 4, text: "Chain it plainly: no egress control, reachable content, no session boundary. Three findings, one sequence.", focus: "dlp", board: "Chain: egress → exposure → liability", chain: true, hand: "riskchain" , covers: ["uc8"] },
  { who: "priya", act: 4, text: "Which is uncomfortable, because the demo you just watched is exactly what makes that surface findable.", focus: "semantic" },
  { who: "shane", act: 5, text: "So here is where you actually stand: real value on one side, real exposure on the other, both measured from your own tenant this morning.", focus: "copilotready", mood: "neutral" },
  { who: "shane", act: 5, text: "I have run this exact sequence at agency scale — NASA, largest Copilot deployment to date, zero reportable exposures. I would like to run it with you. Let's talk through it.", focus: "copilotready", closing: true }
];

export const TOPICS = {
  dlp: {
    title: "DLP Coverage & Gaps",
    cta: "DLP Details",
    good: ["18 active rules across mail, Teams and endpoint egress", "Credit-card and PII classifiers tuned, false positives under 2%", "Incident routing lands in the security queue within 4 minutes"],
    bad: ["Policy simulation mode still on for 3 of 18 rules", "Endpoint DLP covers 84% of managed devices, not all", "No rule set for Copilot-generated exports"],
    ugly: ["2 policy sets unscoped — finance and legal mailboxes are never evaluated on egress", "Sensitive data can leave the tenant unlogged, which starts the risk chain"],
    metrics: [["Active rules", "18", "#94a3b8"], ["Unscoped sets", "2", "#f87171"], ["Coverage required", "100%", "#60a5fa"], ["Change window", "2 days", "#94a3b8"]],
    copilot: "Copilot grounds on any mailbox and file a user can reach. Without egress evaluation on finance and legal content, a grounded answer can move regulated data outside the tenant with no DLP event to audit.",
    actions: [["Add to remediation roadmap", "dlp"], ["Export finding evidence", null]]
  },
  ca: {
    title: "Conditional Access Overview",
    cta: "Conditional Access Details",
    good: ["42 policies live, MFA enforced on all privileged roles", "Break-glass pair excluded and monitored separately", "Device-compliance grant applied to Exchange and SharePoint"],
    bad: ["Risk-based sign-in policy still report-only for 1,200 users", "Session controls not applied to unmanaged browsers", "No dedicated policy scoping Copilot app access"],
    ugly: ["Legacy authentication is blocked tenant-wide, but app-registration exclusions bypass the grant chain if left unreviewed"],
    metrics: [["Policies", "42", "#94a3b8"], ["Report-only", "6", "#fbbf24"], ["Legacy auth", "Blocked", "#34d399"], ["Excluded principals", "0", "#34d399"]],
    copilot: "Copilot inherits the session it is invoked from. Without a device-compliance grant and session control on the Copilot app, prompts and grounded responses can render on unmanaged endpoints.",
    actions: [["Add to remediation roadmap", "ca"], ["Export finding evidence", null]]
  },
  sharepoint: {
    title: "SharePoint Oversharing",
    cta: "SharePoint Details",
    good: ["1,204 sites inventoried with owners assigned", "Sensitivity labels published to 78% of site tiers", "External sharing defaults set to authenticated guests only"],
    bad: ["Site lifecycle reviews are 40 days overdue", "Label inheritance not enforced on newly provisioned sites", "Broken permission inheritance on 96 document libraries"],
    ugly: ["41 sites carry org-wide links — every licensed user can reach that content, and so can Copilot's semantic index"],
    metrics: [["Sites in scope", "1,204", "#94a3b8"], ["Org-wide links", "41", "#f87171"], ["Labelled sites", "78%", "#fbbf24"], ["Broken inheritance", "96", "#fbbf24"]],
    copilot: "The semantic index respects permissions, not intent. Anything reachable becomes a citable answer, so oversharing turns quietly tolerated access into actively surfaced content on day one.",
    actions: [["Add to remediation roadmap", "sharepoint"], ["Export site inventory", null]]
  },
  onedrive: {
    title: "OneDrive Sharing Posture",
    cta: "OneDrive Details",
    good: ["Known-folder move enabled for 96% of users", "Anonymous link creation disabled tenant-wide", "Retention applied to leaver accounts for 90 days"],
    bad: ["612 external guests hold standing access to shared folders", "Sensitivity auto-labelling still in simulation", "Link expiry set to 180 days instead of 30"],
    ugly: ["Personal OneDrive stores are the largest pool of unlabelled sensitive files in the tenant and are fully in scope for grounding"],
    metrics: [["External guests", "612", "#fbbf24"], ["Anonymous links", "0", "#34d399"], ["Unlabelled files", "High", "#f87171"], ["Link expiry", "180d", "#fbbf24"]],
    copilot: "OneDrive content is grounded per user. Unlabelled personal stores mean Copilot can summarise sensitive drafts and contracts with no classification signal attached to the response.",
    actions: [["Add to remediation roadmap", "guests"], ["Export sharing report", null]]
  },
  intune: {
    title: "Intune Compliance & Device Risk",
    cta: "Intune Compliance Details",
    good: ["94.2% of devices compliant against the corporate baseline", "Disk encryption and secure boot enforced everywhere", "Defender for Endpoint reporting on 98.4% of estate"],
    bad: ["Baseline last published 11 days ago, drift detection lagging", "Autopilot profile re-scope left 3 device groups unassigned", "Patch ring 3 is 2 cycles behind"],
    ugly: ["312 devices fell out of compliance overnight and are still able to run Copilot in Teams and Word"],
    metrics: [["Devices drifting", "312", "#fbbf24"], ["Compliant", "94.2%", "#34d399"], ["Baseline age", "11 days", "#94a3b8"], ["Readiness impact", "-9 pts", "#f87171"]],
    copilot: "Device compliance is the boundary that keeps prompts and grounded responses on managed hardware. Drifting endpoints move that content outside policy control and cap readiness in the sixties.",
    actions: [["Add to remediation roadmap", "intune"], ["Export device inventory", null]]
  },
  licensing: {
    title: "Licensing & Seat Metering",
    cta: "Licensing Details",
    good: ["2,140 seats provisioned with automated group-based assignment", "Metering reconciles nightly against Graph usage reports", "No overage on E5 security add-ons"],
    bad: ["264 seats idle for more than 60 days", "Seat drift running at -12% against forecast", "Copilot add-on licences unassigned pending readiness sign-off"],
    ugly: ["The tenant is paying for both idle seats and the risk they carry — unused accounts remain fully in scope for grounding"],
    metrics: [["Seats provisioned", "2,140", "#94a3b8"], ["Active seats", "1,876", "#34d399"], ["Idle 60d+", "264", "#fbbf24"], ["Seat drift", "-12%", "#fbbf24"]],
    copilot: "Copilot licences attach per user. Cleaning idle seats before enablement cuts both the bill and the grounding surface, and makes the 1,500-seat rollout forecast defensible.",
    actions: [["Model licence plan", "meter"], ["Export seat report", null]]
  },
  copilotready: {
    title: "Copilot Readiness Details",
    cta: "Copilot Readiness Details",
    good: ["Identity perimeter nominal — MFA, CA and Defender all in policy", "Service health green across all workloads", "Teams adoption at 87%, so grounding has real content to work with"],
    bad: ["Semantic index build queued behind the governance sweep", "Copilot add-on licences not yet assigned", "Pilot comms plan drafted but unapproved"],
    ugly: ["Score sits at 61% against a 75% enable threshold, blocked by DLP scope, SharePoint oversharing and Intune drift"],
    metrics: [["Current score", "61%", "#fbbf24"], ["Enable threshold", "75%", "#60a5fa"], ["Recovered by Phase 3", "+17 pts", "#34d399"], ["Seats in scope", "1,876", "#94a3b8"]],
    copilot: "Readiness is the single gate on rollout. Each remediated blocker returns points directly: DLP scope +6, oversharing +2, device drift +9 — enough to clear threshold inside Phase 3.",
    actions: [["Model projected readiness", "copilotready"], ["Export readiness report", null]]
  },
  sow: {
    title: "SOW Phase 3 — Remediation Plan",
    cta: "SOW Phase Details",
    good: ["6 of 10 findings already remediated and signed off", "Named owner on every open work item", "Change control window agreed with the business"],
    bad: ["Two work items depend on the same change window", "Evidence pack for findings 7 and 8 still being assembled"],
    ugly: ["Phase 3 closure is the gate on tenant-wide Copilot — any slip moves the rollout date with it"],
    metrics: [["Findings closed", "6/10", "#60a5fa"], ["Open items", "4", "#fbbf24"], ["Phase gate", "Thursday", "#94a3b8"], ["Readiness on close", "78%", "#34d399"]],
    copilot: "Phase 3 and Copilot enablement are the same plan: every open finding maps to a readiness blocker, so closing the phase clears the gate.",
    actions: [["Export remediation plan", null], ["Model projected readiness", "copilotready"]]
  },
  riskchain: {
    title: "Risk Chain: DLP Gap → Data Exposure → Financial Risk",
    cta: "Risk Chain Details",
    good: ["Chain is fully traced with named owners on every link", "Audit retention at 180 days covers the pilot window", "Break-at-source fix is inside SOW Phase 3 scope"],
    bad: ["Change record drafted but not signed", "Exposure surface still measured weekly, not continuously", "No automated rollback if the pilot surfaces regulated content"],
    ugly: ["All three links are open: unscoped DLP feeds 41 overshared sites, which turns any grounded answer into a reportable MSA event"],
    metrics: [["Chain links open", "3", "#f87171"], ["Reportable under", "MSA §7.4", "#94a3b8"], ["Exposure surface", "41 sites", "#f87171"], ["Owner", "Marcus Hale", "#818cf8"]],
    copilot: "Copilot cannot be deployed tenant-wide while the chain is intact — a single grounded answer citing regulated content converts a technical gap into a contractual liability.",
    actions: [["Sequence before deployment", "dlp"], ["Export risk summary", null]]
  },
  security: {
    title: "Security Boundary for Grounding",
    cta: "Conditional Access Details",
    good: ["Defender coverage 98.4% with zero high-severity alerts open", "Privileged roles under PIM with approval workflow", "Entra ID health at 99.98%"],
    bad: ["OAuth app grants reviewed quarterly, not continuously", "Sign-in risk policy partially in report-only"],
    ugly: ["The exposure sits in the content estate, not the identity estate — a clean perimeter can still ground on overshared data"],
    metrics: [["CA policies", "42", "#94a3b8"], ["Defender coverage", "98.4%", "#34d399"], ["High alerts", "0", "#34d399"], ["Entra health", "99.98%", "#34d399"]],
    copilot: "A strong perimeter is necessary but not sufficient: Copilot grounding is governed by content permissions, so identity posture alone does not clear the readiness gate.",
    actions: [["Model projected readiness", "defender"], ["Export posture evidence", null]]
  },
  compliance: {
    title: "Purview Audit & Retention",
    cta: "Risk Chain Details",
    good: ["180-day audit retention across all pilot tenants", "Every Copilot interaction is reconstructable for review", "Legal sign-off path defined with a named approver"],
    bad: ["Audit queries run manually rather than on schedule", "Retention labels not yet applied to Copilot chat history"],
    ugly: ["Without DLP closure, audit only proves the exposure happened — it does not prevent it"],
    metrics: [["Audit retention", "180d", "#94a3b8"], ["Pilot scope", "Finance, Legal", "#60a5fa"], ["Queries indexed", "queued", "#fbbf24"], ["Sign-off", "Beth Aldrin", "#fbbf24"]],
    copilot: "Audit evidence is what turns a Copilot pilot into a defensible one: it lets legal show exactly what was grounded, by whom, and under which policy state.",
    actions: [["Add to remediation roadmap", "purview"], ["Export audit evidence", null]]
  }
};

export const TOPIC_NODE = {
  dlp: "dlp", ca: "ca", sharepoint: "sharepoint", onedrive: "guests",
  intune: "intune", licensing: "meter", copilotready: "copilotready", riskchain: "dlp"
};

export const TOPIC_FOR = {
  copilotready: "copilotready", semantic: "copilotready", teams: "copilotready",
  sharepoint: "sharepoint", guests: "onedrive",
  dlp: "dlp", intune: "intune", servicehealth: "intune",
  purview: "compliance", defender: "security", entra: "security", ca: "ca",
  meter: "licensing", seatdrift: "licensing"
};

// war-room finding → node label on the tenant map
export const MAP_NODE = {
  entra: "MFA Coverage", ca: "Policy Compliance", defender: "Risky Sign-ins",
  sharepoint: "Sharing Governance", guests: "External Access Risk",
  meter: "License Utilization", seatdrift: "Idle Licenses", teams: "Active Usage",
  copilotready: "License Coverage", semantic: "Feature Mix",
  dlp: "DLP Enforcement", purview: "Audit Readiness",
  intune: "Endpoint Compliance", servicehealth: "SLA Compliance"
};
export const MAP_PILLAR = {
  security: "Security", governance: "Governance", licensing: "Licensing",
  adoption: "Adoption", copilot: "Copilot", compliance: "Compliance", health: "Health"
};

export const SITES = [
  { id: "s1", type: "SharePoint", name: "Flight Ops – Mission Docs", exposure: "EEEU", files: "41,208", ext: 0, sens: "Unlabelled", risk: "critical", note: "Everyone Except External Users granted Edit at site root — every internal user, and every grounded Copilot answer, can read it." },
  { id: "s2", type: "Teams", name: "Propulsion Program", exposure: "Anyone links", files: "12,940", ext: 37, sens: "Partial", risk: "critical", note: "17 anonymous links with no expiry; 37 guests still in the team 9 months after the contract closed." },
  { id: "s3", type: "SharePoint", name: "Contracts & Legal", exposure: "EEEU", files: "8,412", ext: 4, sens: "Confidential", risk: "critical", note: "EEEU on a library holding executed MSAs — labelled Confidential but readable tenant-wide." },
  { id: "s4", type: "Teams", name: "Vendor – Aerostruct", exposure: "Guests", files: "3,204", ext: 61, sens: "Unlabelled", risk: "high", note: "61 external guests, no sensitivity labels, no guest review cycle configured." },
  { id: "s5", type: "SharePoint", name: "HR – People Ops", exposure: "Org-wide link", files: "6,730", ext: 0, sens: "Confidential", risk: "high", note: "Org-wide sharing link on the payroll folder; DLP policy does not cover this site." },
  { id: "s6", type: "Teams", name: "Launch Readiness 2026", exposure: "EEEU", files: "22,116", ext: 12, sens: "Partial", risk: "high", note: "EEEU on the connected site — Copilot will ground launch planning answers for anyone who asks." },
  { id: "s7", type: "SharePoint", name: "Finance – FY26 Planning", exposure: "Anyone links", files: "2,884", ext: 8, sens: "Confidential", risk: "medium", note: "3 anonymous links shared externally in the last 30 days." },
  { id: "s8", type: "Teams", name: "Engineering All-Hands", exposure: "EEEU", files: "18,502", ext: 0, sens: "Unlabelled", risk: "medium", note: "EEEU inherited from template; low sensitivity but inflates the grounding surface." }
];

export const STATUS = {
  healthy: { color: "#34d399", label: "HEALTHY" },
  drift: { color: "#fbbf24", label: "DRIFT" },
  alert: { color: "#f87171", label: "ALERT" }
};

export const AMBIENCE = {
  neutral: "radial-gradient(ellipse 70% 55% at 50% 42%,rgba(0,120,212,.16),transparent 70%),radial-gradient(ellipse 50% 40% at 50% 100%,rgba(103,232,249,.10),transparent 70%)",
  security: "radial-gradient(ellipse 70% 55% at 50% 42%,rgba(248,113,113,.14),transparent 70%),radial-gradient(ellipse 60% 45% at 50% 100%,rgba(30,64,175,.16),transparent 70%)",
  legal: "radial-gradient(ellipse 70% 55% at 50% 42%,rgba(129,140,248,.16),transparent 70%),radial-gradient(ellipse 60% 45% at 50% 100%,rgba(2,132,199,.14),transparent 70%)"
};

