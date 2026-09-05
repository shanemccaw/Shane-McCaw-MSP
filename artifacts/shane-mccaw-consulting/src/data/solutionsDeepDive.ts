import { Sparkles, Shield, Share2, Layers, Zap, Users, ArrowLeftRight, Activity, type LucideIcon } from "lucide-react";

/**
 * Solutions index + 8 topic deep-dive pages (Design/fractional_architecture/README.md
 * §7–§8, Git #2961). Copy extracted verbatim from `Solutions.dc.html` and
 * `Solution - *.dc.html` (all 8 topic exports share one identical TOPICS array — the
 * design source itself is already "one shared template, one data array"). SEO copy
 * only: no live scan, no real per-tenant numbers — every metric here is the design's
 * own "Illustrative, not your tenant" panel content, never presented as real.
 */

export interface FindingRow {
  label: string;
  value: string;
  pct: number;
  sub: string;
}

export interface TimelineStep {
  title: string;
  body: string;
}

export interface ProjectCard {
  name: string;
  body: string;
  when: string;
}

export interface SolutionTopic {
  slug: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** Exact topic accent hex (Git #2961 dispatch). */
  accent: string;
  /** Copilot is the one topic with the blue→violet "flagship" gradient treatment. */
  isFlagship?: boolean;
  /** Exact index-card link word, e.g. "Copilot deep dive →" (Solutions.dc.html — shorter than `label`). */
  indexLinkWord: string;
  indexHeadline: string;
  indexExcerpt: string;
  h1: string;
  h1Accent: string;
  lead: string;
  sub: string;
  rows: [FindingRow, FindingRow, FindingRow];
  panelNote: string;
  pathsEyebrow: string;
  pathsH2: string;
  pathsLead: string;
  badPath: TimelineStep[];
  goodPath: TimelineStep[];
  workH2: string;
  projects: ProjectCard[];
}

export const SOLUTION_TOPICS: SolutionTopic[] = [
  {
    slug: "copilot",
    label: "Copilot & AI",
    short: "Copilot",
    icon: Sparkles,
    accent: "#38bdf8",
    isFlagship: true,
    indexLinkWord: "Copilot",
    indexHeadline: "Copilot doesn't leak your data. It reads it out loud.",
    indexExcerpt:
      "Copilot answers from whatever your permission model already exposes. The rollout doesn't create the exposure. It narrates it.",
    h1: "Copilot doesn't leak your data.",
    h1Accent: "It reads it out loud.",
    lead:
      "Copilot answers from whatever your permission model already exposes. Every overshared site, every “Anyone with the link”, every unlabelled salary file: reachable today, quotable the day the seats go live. The rollout doesn't create the exposure. It narrates it.",
    sub: "The panel alongside is what Shane's read-only review returns for a typical mid-market tenant: the exact surface Copilot's index will see.",
    rows: [
      { label: "Files and messages Copilot will index", value: "2.1M", pct: 100, sub: "Everything the permission model exposes to licensed users." },
      { label: "Reachable beyond the intended audience", value: "214,000", pct: 34, sub: "Open links, broken inheritance, org-wide groups used as ACLs." },
      { label: "Sensitive and unlabelled among those", value: "3,400", pct: 9, sub: "Salary, legal and board material with no label on it." },
    ],
    panelNote: "Six findings would block this rollout. Every one is fixable before a single seat is assigned.",
    pathsEyebrow: "Deployment order",
    pathsH2: "The order of operations decides whether Copilot is an advantage or a headline.",
    pathsLead:
      "Most failed rollouts run the same script: buy seats, enable, apologise. The work is identical either way: permissions, labels, licensing. The only variable is whether it happens before or after someone asks Copilot the wrong question.",
    badPath: [
      { title: "Buy 300 seats", body: "The licence spend is committed before anyone has read the tenant." },
      { title: "Enable for everyone", body: "The index inherits every oversharing decision of the last decade." },
      { title: "Week two", body: "“Summarise what we pay the leadership team” returns an answer." },
      { title: "Rollout paused", body: "Legal owns the incident, adoption never recovers, seats keep billing." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "What is licensed, what is budgeted, what the board was promised." },
      { title: "Shane's read-only review", body: "The exact reachable surface, measured before any spend." },
      { title: "Exposure closed", body: "Open links closed, labels applied, permissions rebuilt, in the right order." },
      { title: "Pilot, then seats", body: "A pilot group with usage policy in place, then licences that match reality." },
      { title: "Standing review", body: "Retainer hours keep the reachable surface from quietly reopening." },
    ],
    workH2: "Top four Copilot projects that surface after the review.",
    projects: [
      { name: "Copilot for Microsoft 365 Deployment Project", body: "The permission model, labelling and licensing plan behind a defensible rollout.", when: "Before the first seat" },
      { name: "Copilot Data Exposure Remediation", body: "Closes the oversharing, unlabelled content and orphaned permissions the review found.", when: "When the review says no" },
      { name: "Copilot Adoption & Governance Program", body: "Acceptable-use policy, prompt handling, and the adoption work that makes renewal justifiable.", when: "After go-live" },
      { name: "Data Classification & Sensitivity Label Rollout", body: "Labels that are applied, not just defined, on the content Copilot will read first.", when: "Before or alongside rollout" },
    ],
  },
  {
    slug: "security",
    label: "Security & Compliance",
    short: "security",
    icon: Shield,
    accent: "#a78bfa",
    indexLinkWord: "Security",
    indexHeadline: "The gap is almost never the policy. It's the exclusion.",
    indexExcerpt:
      "Break-glass accounts, a service principal added during a migration, one group excluded for a project that ended two years ago. Together they are the route in.",
    h1: "The gap is almost never the policy.",
    h1Accent: "It's the exclusion.",
    lead:
      "Break-glass accounts, a service principal added during a migration, one group excluded for a project that ended two years ago. Each was reasonable on the day. Together they are the route in, and no quarterly review is scoped to find them.",
    sub: "The panel alongside is what Shane's review returns for a typical tenant that believes Conditional Access is finished.",
    rows: [
      { label: "Users covered by a Conditional Access policy", value: "71%", pct: 71, sub: "The rest sign in on the older path, every day." },
      { label: "Exclusions nobody can still explain", value: "19", pct: 40, sub: "Service principals, ended projects, copies of break-glass." },
      { label: "Admin roles held permanently", value: "14", pct: 60, sub: "Standing Global Admins where time-bound activation belongs." },
    ],
    panelNote: "A valid credential is a valid session from anywhere until the exclusions are pruned. That is the first week of work.",
    pathsEyebrow: "Hardening order",
    pathsH2: "Security defaults authenticate the user. They never ask where from.",
    pathsLead:
      "Every hardening effort touches the same controls: MFA, Conditional Access, privileged roles, mail flow, data loss prevention. The difference is whether they are sequenced by an architect or by the last incident.",
    badPath: [
      { title: "Security defaults on", body: "MFA enforced, legacy auth blocked, and everyone assumes the job is finished." },
      { title: "An exclusion for the migration", body: "Reasonable, temporary, never removed." },
      { title: "Audit season", body: "The compliance questionnaire asks for evidence nobody has." },
      { title: "The incident", body: "A valid credential from the wrong country, on a path no policy covered." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "Which frameworks apply, what the auditors asked for last time, what broke." },
      { title: "Shane's read-only review", body: "Every policy, every exclusion, every standing admin role, listed with a reason or without one." },
      { title: "Coverage rebuilt", body: "Baseline Conditional Access for every user, then device and risk conditions." },
      { title: "Privilege made temporary", body: "Standing admin roles moved to time-bound activation with approval." },
      { title: "Standing review", body: "Retainer hours re-read the exclusion list every month, before an auditor does." },
    ],
    workH2: "Top four security and compliance projects that surface after the review.",
    projects: [
      { name: "Identity Modernization & Conditional Access Build-Out", body: "Baseline policies for every user, exclusions with an owner and an end date.", when: "First" },
      { name: "Security & Compliance Hardening for Microsoft 365", body: "Mail flow, sharing, privileged access and audit settings brought to a defensible baseline.", when: "After identity" },
      { name: "DLP Policy Implementation", body: "Policies that stop sensitive data leaving, tuned so people stop working around them.", when: "Once labels exist" },
      { name: "Compliance Framework Implementation", body: "SOC 2, NIST CSF, ISO 27001 or CMMC controls mapped to tenant settings, with evidence.", when: "When an audit is on the calendar" },
    ],
  },
  {
    slug: "governance",
    label: "Governance",
    short: "governance",
    icon: Share2,
    accent: "#60a5fa",
    indexLinkWord: "Governance",
    indexHeadline: "Nobody owns the tenant. So the tenant owns itself.",
    indexExcerpt:
      "With no named owner, sharing settings, guest access and site permissions widen one request at a time and nothing pulls them back.",
    h1: "Nobody owns the tenant.",
    h1Accent: "So the tenant owns itself.",
    lead:
      "With no named owner, sharing settings, guest access and site permissions widen one request at a time and nothing pulls them back. Governance is not a policy document. It is someone whose job it is to say no, and the settings that make no stick.",
    sub: "The panel alongside is what Shane's review returns for a tenant where governance has been picked up between outages.",
    rows: [
      { label: "Sites with no active owner", value: "38%", pct: 38, sub: "The owner left. The site kept sharing." },
      { label: "Sharing links created in the last twelve months", value: "61,000", pct: 100, sub: "Almost none reviewed after the day they were made." },
      { label: "Guest accounts inactive for 90+ days", value: "412", pct: 45, sub: "Still attached to the sites they were invited into." },
    ],
    panelNote: "None of this fails. It sits there, correct on paper and wrong in practice, until something reads it.",
    pathsEyebrow: "Ownership order",
    pathsH2: "Reactive ownership only ever catches the things that break.",
    pathsLead:
      "A permission opening too wide never fails. It waits. Recorded ownership with a review cadence is the only mechanism that reliably stops permissions accumulating quietly, and it is rare at any size.",
    badPath: [
      { title: "IT, part-time", body: "Governance happens when something breaks, so review happens after failure." },
      { title: "One request at a time", body: "Each sharing exception is reasonable. Nobody sees the sum." },
      { title: "The audit", body: "Somebody asks who can reach the finance site. Nobody can answer quickly." },
      { title: "Cleanup by hand", body: "Months of work to reconstruct decisions nobody recorded." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "Who decides today, who should, and what the board needs to see." },
      { title: "Shane's read-only review", body: "Ownership, sharing settings, guest access and lifecycle across every site and team." },
      { title: "Owners named", body: "Every site and team gets an accountable owner and an expiry." },
      { title: "Settings that hold", body: "Sharing defaults, guest policy and labels set so drift becomes an exception." },
      { title: "Standing review", body: "Retainer hours run the review cadence so it happens without a crisis." },
    ],
    workH2: "Top four governance projects that surface after the review.",
    projects: [
      { name: "Governance Remediation & Architecture Hardening", body: "Ownership, lifecycle and sharing defaults rebuilt from the review's findings.", when: "First" },
      { name: "External Sharing & Guest Access Governance", body: "Guest lifecycle, sharing policy per site class, access reviews that actually run.", when: "When guests outnumber owners" },
      { name: "Data Classification & Sensitivity Label Rollout", body: "A taxonomy applied to content, with auto-labelling where nobody visits.", when: "Before Copilot" },
      { name: "Retention & Records Management Implementation", body: "Retention that survives a departing employee and a legal hold that holds.", when: "When legal asks" },
    ],
  },
  {
    slug: "sharepoint",
    label: "SharePoint",
    short: "SharePoint",
    icon: Layers,
    accent: "#22d3ee",
    indexLinkWord: "SharePoint",
    indexHeadline: "Every link ever created is still live.",
    indexExcerpt:
      "Sharing links made for projects that closed years ago still resolve. SharePoint does exactly what it was told in 2019, and nobody has told it anything since.",
    h1: "Every link ever created is",
    h1Accent: "still live.",
    lead:
      "Sharing links made for projects that closed years ago still resolve. Sites whose owners left still share. SharePoint does exactly what it was told in 2019, and nobody has told it anything since.",
    sub: "The panel alongside is what Shane's review returns for a typical SharePoint estate that grew without an information architecture.",
    rows: [
      { label: "Sites", value: "1,860", pct: 100, sub: "Roughly one for every four people, most created by a Team." },
      { label: "Sites with broken permission inheritance", value: "27%", pct: 27, sub: "Unique permissions nobody remembers granting." },
      { label: "“Anyone with the link” files", value: "48,000", pct: 52, sub: "Reachable by anyone the link was ever forwarded to." },
    ],
    panelNote: "The intranet nobody uses and the site everybody overshares are the same architecture problem.",
    pathsEyebrow: "Rebuild order",
    pathsH2: "Sharing and labelling staying in step is the whole point.",
    pathsLead:
      "An information architecture is a decision about who owns what and how long it lives. Without one, hub sites, sharing settings and labels are three separate arguments that never resolve.",
    badPath: [
      { title: "Every Team makes a site", body: "Two thousand sites, no hierarchy, no owner of the whole." },
      { title: "Sharing set to Anyone", body: "Because the alternative generated tickets." },
      { title: "The intranet project", body: "A new front door on the same unstructured house." },
      { title: "The oversharing finding", body: "Found by Copilot, or by an auditor, or by the person who should not have seen it." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "What the business actually uses SharePoint for, and what it thinks it does." },
      { title: "Shane's read-only review", body: "Every site, its owner, its sharing state and its last activity." },
      { title: "Architecture decided", body: "Hub structure, site classes, sharing policy per class." },
      { title: "Estate reshaped", body: "Orphans reassigned, dormant sites archived, inheritance restored where it matters." },
      { title: "Standing review", body: "Retainer hours keep new sites landing in the structure, not beside it." },
    ],
    workH2: "Top four SharePoint projects that surface after the review.",
    projects: [
      { name: "SharePoint & Teams Information Architecture Rebuild", body: "Hubs, site classes and ownership designed once, then enforced by settings.", when: "First" },
      { name: "External Sharing & Guest Access Governance", body: "Sharing policy per site class and guest lifecycle that closes what the review found.", when: "When links outnumber owners" },
      { name: "Intranet / Hub Site Build-Out", body: "A front door built on the architecture, not in place of it.", when: "After the rebuild" },
      { name: "SharePoint Migration", body: "File shares and legacy sites moved into the structure, with what is not worth moving left behind.", when: "When there is something to bring" },
    ],
  },
  {
    slug: "power-platform",
    label: "Power Platform",
    short: "Power Platform",
    icon: Zap,
    accent: "#f59e0b",
    indexLinkWord: "Power Platform",
    indexHeadline: "Your citizen developers shipped to production. Nobody told production.",
    indexExcerpt:
      "Flows running on a departed employee's credentials. The Power Platform is the fastest way to build in Microsoft 365, and the least governed.",
    h1: "Your citizen developers shipped to production.",
    h1Accent: "Nobody told production.",
    lead:
      "Flows running on a departed employee's credentials. Apps in the default environment with connectors that move customer data into personal storage. The Power Platform is the fastest way to build in Microsoft 365, and the least governed.",
    sub: "The panel alongside is what Shane's review returns for a tenant that never set an environment strategy.",
    rows: [
      { label: "Flows and apps in the default environment", value: "640", pct: 100, sub: "Built by makers, running on personal connections." },
      { label: "Connectors crossing business and non-business data", value: "22", pct: 35, sub: "No data loss prevention policy separates them." },
      { label: "Apps whose owner has left", value: "31", pct: 20, sub: "Still running, still authorised, nobody to ask." },
    ],
    panelNote: "The goal is not to stop the makers. It is to give them an environment where what they build can be trusted.",
    pathsEyebrow: "Guardrail order",
    pathsH2: "Governance that arrives after the apps exist has to negotiate.",
    pathsLead:
      "Environment strategy, connector policy and ownership are cheap on day one and expensive after six hundred flows depend on the wrong defaults.",
    badPath: [
      { title: "Default environment for everything", body: "Every maker, every connector, one shared space." },
      { title: "A flow becomes a process", body: "Payroll approvals run on one person's connection." },
      { title: "That person leaves", body: "The flow fails on the first Monday, or worse, keeps running." },
      { title: "The lockdown", body: "IT disables makers wholesale and the business routes around it." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "What has been built, who depends on it, what must never leave the tenant." },
      { title: "Shane's read-only review", body: "Every app, flow, connector and owner across all environments." },
      { title: "Environments designed", body: "Personal, team and production tiers with promotion paths." },
      { title: "Connector policy set", body: "Business and non-business connectors separated by policy, not by hope." },
      { title: "Standing review", body: "Retainer hours review new apps and orphaned owners each month." },
    ],
    workH2: "Top three Power Platform projects that surface after the review.",
    projects: [
      { name: "Environment strategy", body: "Default, team and production environments with a promotion path makers will actually follow.", when: "First" },
      { name: "Connector DLP policy", body: "Business and non-business connector groups, tested against the flows that exist today.", when: "Before the next incident" },
      { name: "Ownership and lifecycle", body: "Co-owners on every production flow, orphaned apps reassigned or retired.", when: "Ongoing" },
    ],
  },
  {
    slug: "teams",
    label: "Teams",
    short: "Teams",
    icon: Users,
    accent: "#818cf8",
    indexLinkWord: "Teams",
    indexHeadline: "A Team for every project. And a Team for every project that never ended.",
    indexExcerpt:
      "Teams created in the 2020 rush are still there, still sharing, still holding guests. Sprawl is a permissions problem with a chat window attached.",
    h1: "A Team for every project.",
    h1Accent: "And a Team for every project that never ended.",
    lead:
      "Teams created in the 2020 rush are still there, still sharing, still holding guests. Sprawl is not a storage problem. It is a permissions problem with a chat window attached.",
    sub: "The panel alongside is what Shane's review returns for a tenant that turned on self-service Team creation and never turned on expiry.",
    rows: [
      { label: "Teams", value: "940", pct: 100, sub: "One for every two people. Most created in 2020." },
      { label: "Inactive for 180+ days", value: "46%", pct: 46, sub: "No expiration policy applied, so nothing ends." },
      { label: "Teams with external guests and no owner", value: "63", pct: 18, sub: "Nobody accountable for who is inside." },
    ],
    panelNote: "Every dormant Team is a SharePoint site with a sharing history. Lifecycle is the cheapest security control you are not running.",
    pathsEyebrow: "Lifecycle order",
    pathsH2: "Sprawl is what happens when creation is free and ending is nobody's job.",
    pathsLead:
      "Naming, expiry, guest policy and ownership decide whether Teams is a collaboration platform or an archive that still accepts guests.",
    badPath: [
      { title: "Self-service creation on", body: "Anyone can make a Team. Everyone does." },
      { title: "The project ends", body: "The Team does not. Neither does its guest access." },
      { title: "The owner leaves", body: "Four hundred ownerless Teams, each still a site." },
      { title: "The cleanup", body: "Someone deletes in bulk and takes a live process with it." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "How Teams is actually used: chat, files, phone, meetings, external work." },
      { title: "Shane's read-only review", body: "Every Team, owner, guest and last activity, plus the policies that govern them." },
      { title: "Lifecycle switched on", body: "Expiry, naming and ownership rules that end what has ended." },
      { title: "Guests governed", body: "Access reviews and guest policy per Team class." },
      { title: "Standing review", body: "Retainer hours handle the exceptions each month instead of another cleanup." },
    ],
    workH2: "Top four Teams projects that surface after the review.",
    projects: [
      { name: "Teams Sprawl & Lifecycle Automation", body: "Expiry, naming and ownership policy applied to the estate the review found.", when: "First" },
      { name: "SharePoint & Teams Information Architecture Rebuild", body: "Team classes and the sites behind them designed together.", when: "When sprawl is structural" },
      { name: "Teams Phone License & Calling Policy Configuration", body: "Calling plans, policies and licences configured for the people who use them.", when: "When phones move to Teams" },
      { name: "Teams Rooms License & Policy Configuration", body: "Room accounts, licences and policies set for meeting spaces.", when: "When rooms come online" },
    ],
  },
  {
    slug: "migration",
    label: "Migration",
    short: "migration",
    icon: ArrowLeftRight,
    accent: "#fb7185",
    indexLinkWord: "Migration",
    indexHeadline: "Migrations fail on the things nobody listed.",
    indexExcerpt:
      "Shared mailboxes with no owner, distribution lists that ran a business process, identities that do not match on the other side. Cutover is the easy part.",
    h1: "Migrations fail on",
    h1Accent: "the things nobody listed.",
    lead:
      "The shared mailboxes with no owner, the distribution lists that ran a business process, the identities that do not match on the other side. Cutover is the easy part. The inventory is where it goes wrong.",
    sub:
      "The panel alongside is what Shane's review returns before a typical Exchange or tenant-to-tenant move. Shane ran NASA's migration from on-prem Exchange to Microsoft 365 and from Skype for Business to Teams.",
    rows: [
      { label: "Mailboxes to move", value: "2,400", pct: 100, sub: "Plus the shared mailboxes nobody put on the list." },
      { label: "Identity mismatches between source and target", value: "8%", pct: 30, sub: "UPNs, proxy addresses, duplicate SMTP." },
      { label: "Content not worth bringing across", value: "41%", pct: 41, sub: "Stale sites, orphaned OneDrives, archives nobody opens." },
    ],
    panelNote: "What you leave behind is a decision. What you forget is an outage.",
    pathsEyebrow: "Cutover order",
    pathsH2: "Sequence is the whole difference between a migration and an incident.",
    pathsLead:
      "Identity first, then mail, then files, then the things that depend on all three. Every migration that skipped a step found it again on cutover weekend.",
    badPath: [
      { title: "Pick a tool, set a date", body: "The project plan starts at cutover and works backwards." },
      { title: "Discovery by surprise", body: "Shared mailboxes, mail-enabled lists and app relays appear the week before." },
      { title: "Cutover weekend", body: "Identity mismatches block sign-in on Monday morning." },
      { title: "The long tail", body: "Six months of “it used to work” tickets nobody budgeted for." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "What is moving, what is not, and what the business cannot lose for an hour." },
      { title: "Shane's read-only review", body: "Mailboxes, identities, sites, dependencies and the mismatches between source and target." },
      { title: "Identity reconciled", body: "UPNs, addresses and licences aligned before anything moves." },
      { title: "Waves, not a weekend", body: "Pilot, then waves sized to the help desk, with what not to bring decided up front." },
      { title: "Standing review", body: "Retainer hours own the tail: coexistence, decommissioning, the last stragglers." },
    ],
    workH2: "Top four migration projects that surface after the review.",
    projects: [
      { name: "Microsoft 365 Migration Execution", body: "On-prem Exchange, file shares and identity moved in waves, with the inventory done first.", when: "From on-prem" },
      { name: "Tenant-to-Tenant Migration", body: "Mergers, divestitures and consolidations: identity mapping, coexistence, cutover.", when: "Tenant to tenant" },
      { name: "SharePoint Migration", body: "Sites and file shares into a designed structure, stale content left behind on purpose.", when: "Files and sites" },
      { name: "Exchange Online Hygiene & Modernization", body: "Mail flow, legacy protocols and stale objects cleaned up before or after the move.", when: "Before cutover, or after" },
    ],
  },
  {
    slug: "health",
    label: "M365 Health",
    short: "tenant health",
    icon: Activity,
    accent: "#4ADE80",
    indexLinkWord: "M365 Health",
    indexHeadline: "A tenant does not stay where you left it.",
    indexExcerpt:
      "Admins change settings, vendors consent to OAuth apps, defaults shift when Microsoft ships. An assessment tells you what is wrong today. Health is every day after that.",
    h1: "A tenant does not stay",
    h1Accent: "where you left it.",
    lead:
      "Admins change settings, vendors consent to OAuth apps, defaults shift when Microsoft ships. An assessment tells you what is wrong today. Health is what happens on every day after that.",
    sub: "The panel alongside is what Shane's review returns for a tenant that was configured well once and reviewed never.",
    rows: [
      { label: "Message Center changes this quarter", value: "210", pct: 100, sub: "Each one a default that may have moved under you." },
      { label: "Licences assigned but unused for 90+ days", value: "18%", pct: 18, sub: "Paid, renewed, idle." },
      { label: "Settings changed since the last review", value: "57", pct: 45, sub: "Nobody can say who changed them, or why." },
    ],
    panelNote: "Undetected is not the same as absent. Every remediation starts decaying the day after it lands.",
    pathsEyebrow: "Review order",
    pathsH2: "You find out because something broke, not because something changed.",
    pathsLead:
      "Changes that break things get attention within the day. Changes that quietly open exposure never break anything, so they wait. A health practice is the review that catches the second kind.",
    badPath: [
      { title: "Configured once", body: "A good baseline, a proud handover document." },
      { title: "Eighteen months pass", body: "Three admins, two vendors, forty Microsoft changes." },
      { title: "The renewal", body: "Licences renew on the original count. Nobody checked usage." },
      { title: "The archaeology", body: "Someone tries to work out when a setting moved. Nobody can." },
    ],
    goodPath: [
      { title: "Kickoff with Shane", body: "What was decided at the last baseline, and who has touched the tenant since." },
      { title: "Shane's read-only review", body: "Configuration against baseline, licence utilisation, service health, Message Center exposure." },
      { title: "Baseline restored", body: "Drifted settings moved back, or the baseline updated deliberately." },
      { title: "Licences right-sized", body: "Idle seats reclaimed before the renewal, not after." },
      { title: "Standing review", body: "Retainer hours run the review each month so change becomes a decision, not a discovery." },
    ],
    workH2: "Top four tenant health projects that surface after the review.",
    projects: [
      { name: "License Waste Optimization & Cost Recovery", body: "Idle seats and mismatched SKUs found and reclaimed before renewal.", when: "Before renewal" },
      { name: "Intune Deployment & Device Compliance Build-Out", body: "Baselines, compliance policies and enrolment paths for the devices that reach the tenant.", when: "When devices are the gap" },
      { name: "Business Continuity / Disaster Recovery Implementation", body: "Backup, recovery and continuity for the data Microsoft does not restore for you.", when: "Before you need it" },
      { name: "Exchange Online Hygiene & Modernization", body: "Legacy protocols, stale objects and mail flow brought to a defensible state.", when: "When mail is the gap" },
    ],
  },
];

export function getSolutionTopic(slug: string | undefined): SolutionTopic | undefined {
  return SOLUTION_TOPICS.find((t) => t.slug === slug);
}

/** Shared "How working with Shane goes" four-step section (Solutions index + every topic page, verbatim). */
export const HOW_WORKING_WITH_SHANE_GOES_STEPS: TimelineStep[] = [
  { title: "Start, or ask first", body: "Start a retainer from $900 a month, or send Shane the question that is stuck. Either way the next step is the same." },
  { title: "Kickoff with Shane", body: "A call to cover what is planned, what is broken, and where the review should focus. You bring the decisions; he brings the questions." },
  { title: "Shane reviews your tenant", body: "A read-only pass he runs himself after kickoff. Nothing installed, nothing changed, access you can revoke the same day." },
  { title: "Findings, then the work", body: "Written findings with an order to fix things in. Retainer hours work the list; delivery becomes a fixed-price SOW you approve first." },
];

/** Converts a topic's hex accent into an rgba() string at the given alpha, for tinted panels/glows. */
export function accentRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
