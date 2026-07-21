import {
  Brain, Lock, Shield, Share2, Zap, Users, GitMerge, Activity, type LucideIcon,
} from "lucide-react";

// Solutions / Topic pages — mirrors the 8 existing quiz categories (website-rebuild-reference-v2.md §5).
// Each page is the personalization surface for its domain (§3): real score + remediation for a
// recognized visitor, generic domain marketing for a cold one. Stage 2 builds the cold-visitor
// structure only — the personalization layer slots in during Stage 4.
export interface SolutionTopic {
  slug: string;
  title: string;
  shortLabel: string;
  icon: LucideIcon;
  pillar: string;
  gradientPhrase: string;
  headlinePrefix: string;
  headlineSuffix: string;
  subhead: string;
  quizHref: string;
  stats: { label: string; value: string }[];
  coverage: string[];
  risks: string[];
  relatedEngine: { name: string; description: string };
  /**
   * Architecture Health Engine pillar key(s) this topic maps to (health-engine.ts
   * HEALTH_PILLARS + "security"), for Stage 4b real-score personalization
   * (website-rebuild-reference-v2.md §3). Most topics own exactly one pillar;
   * "architecture" and "governance" are each shared by more than one topic (a real
   * many-to-one relationship in the underlying scoring model, not an omission) —
   * m365-health is the only topic scored as the full 7-pillar composite.
   */
  healthPillarKeys: string[];
  /**
   * Optional standard-SaaS-structure content (currently populated for the "copilot"
   * topic only — see PLATFORM_BUILD.md's "Copilot & AI Topic Page" entry). When present,
   * SolutionTopicPage.tsx renders the expanded 8-section layout instead of the default
   * cold-visitor template. Left undefined for every other topic so they render unchanged.
   */
  productOverview?: string;
  credibilityBody?: string;
  whyItMattersIntro?: string;
  howItWorks?: { title: string; description: string }[];
  whatYouGet?: string[];
  modulesIntro?: string;
  finalCtaBody?: string;
}

export const SOLUTIONS_TOPICS: SolutionTopic[] = [
  {
    slug: "copilot",
    title: "Copilot & AI",
    shortLabel: "Copilot",
    icon: Brain,
    pillar: "Copilot readiness",
    gradientPhrase: "Copilot readiness",
    headlinePrefix: "Most Copilot deployments fail. ",
    headlineSuffix: "Yours doesn't have to.",
    subhead:
      "Copilot answers with whatever your permission model already exposes — this scans that exact surface before a rollout finds out the hard way.",
    quizHref: "/copilot-quiz",
    stats: [
      { label: "Copilot readiness", value: "Scored" },
      { label: "Oversharing check", value: "Graph-based" },
      { label: "Licensing fit", value: "Per-seat" },
    ],
    coverage: [
      "Oversharing and permission-inheritance exposure across SharePoint and OneDrive",
      "Sensitivity label coverage and data classification maturity",
      "Licensing alignment — who actually needs a Copilot seat",
      "Semantic index hygiene (stale sites, orphaned permissions, dead groups)",
    ],
    risks: [
      "Copilot answering questions using content an employee should never have had access to",
      "Rolling out AI before governance — the failure mode that makes headlines",
    ],
    relatedEngine: {
      name: "Security Engine",
      description:
        "Hunts anonymous share links, stale guest access, and over-privileged access — the exact surface area Copilot inherits.",
    },
    healthPillarKeys: ["copilot"],
    productOverview:
      "Copilot & AI Readiness runs a live, read-only Microsoft Graph API scan against your tenant's actual permission model — SharePoint and OneDrive sharing links, sensitivity label coverage, group membership, and Copilot license assignment. It's the same surface area Copilot's semantic index reads from, so the scan shows you exactly what Copilot could already surface in an answer, before you turn it on for anyone.",
    credibilityBody:
      "I wrote the M365 Copilot governance framework NASA distributed agency-wide, and the oversharing, permission-inheritance, and sensitivity-label problems this page scans for are ones I govern inside NASA's own tenant every day — not case studies I read about. This platform doesn't score your tenant against NASA's specific frameworks — that's not what it's built to do — but the same discipline that governs Copilot at NASA is what's engineered into this scan.",
    whyItMattersIntro:
      "An ungoverned Copilot rollout doesn't fail quietly — it fails in front of the exact employee who shouldn't have seen the answer it just gave them.",
    howItWorks: [
      {
        title: "Connect",
        description: "You grant a scoped, read-only Graph API connection. No agent installed, no standing credential left behind.",
      },
      {
        title: "Scan",
        description: "The engine reads SharePoint and OneDrive sharing, sensitivity labels, group membership, and Copilot license assignment across your tenant.",
      },
      {
        title: "Findings",
        description: "Every oversharing exposure, stale permission, and licensing mismatch is logged as a real, inspectable finding — not a scored questionnaire answer.",
      },
      {
        title: "Score",
        description: "Findings roll up into your real Copilot Readiness pillar score inside the Architecture Health Engine.",
      },
      {
        title: "Remediate",
        description: "You get the specific fixes, ranked by which one closes the biggest exposure first — and the Security Engine keeps re-checking the same surface after you fix it.",
      },
    ],
    whatYouGet: [
      "Your real Copilot Readiness pillar score, not a self-reported estimate",
      "A full oversharing exposure report — every anonymous link, stale permission, and orphaned group Copilot's index can already reach",
      "A licensing fit read — who actually needs a Copilot seat, and who doesn't",
      "Zero questionnaires. Every finding comes from a live Graph API scan of your actual tenant.",
    ],
    modulesIntro: "Copilot & AI Readiness checks four real surfaces before you flip the switch:",
    finalCtaBody:
      "Start a free Assessment and get your real Copilot Readiness score — scanned, not guessed — or take the quiz for a faster, self-reported read first.",
  },
  {
    slug: "security-compliance",
    title: "Security & Compliance",
    shortLabel: "Security",
    icon: Lock,
    pillar: "Security",
    gradientPhrase: "before it's an incident report",
    headlinePrefix: "Close the gap ",
    headlineSuffix: "before it becomes an incident report.",
    subhead:
      "Anonymous links, stale guest accounts, missing MFA, and over-privileged OAuth grants — the same handful of misconfigurations behind most real-world breaches, checked on a recurring schedule against your actual tenant, not once a year.",
    quizHref: "/security-quiz",
    stats: [
      { label: "Security pillar", value: "Scored" },
      { label: "MFA coverage", value: "Checked" },
      { label: "Guest access", value: "Audited" },
    ],
    coverage: [
      "Anonymous and organization-wide sharing link exposure",
      "Stale external guest accounts with residual permissions",
      "Over-privileged OAuth application consent grants",
      "MFA registration coverage on privileged identities",
    ],
    risks: [
      "An anonymous sharing link left open for months, discovered only after something has already leaked through it",
      "A departed employee's or contractor's guest account that was never removed, still holding its original permissions",
      "An OAuth app a user approved once, now sitting with broad access nobody has reviewed since",
      "A privileged admin account with no MFA registered — the exact account an attacker targets first",
    ],
    relatedEngine: {
      name: "Security Engine",
      description:
        "Hunts anonymous share links, stale guest access, over-privileged OAuth apps, and MFA gaps on a recurring scan cadence.",
    },
    healthPillarKeys: ["security", "compliance"],
    productOverview:
      "The Security Engine connects to Microsoft Graph with scoped, read-only access and evaluates your tenant's real configuration: sharing link exposure, guest account activity, OAuth application consent grants, and MFA registration status per identity. Every finding traces back to an actual Graph API response, re-checked on a scheduled cadence — not a checklist filled out once a year.",
    credibilityBody:
      "I'm the Microsoft 365 Architect at NASA today, and the checks this page runs — anonymous sharing links, stale guest accounts, OAuth consent grants, MFA coverage — are the same class of control I manage in a live enterprise tenant, not theoretical best practices. One clarification, since the word \"Compliance\" is in this page's title: this covers your organization's own commercial security and governance posture — not federal regulatory compliance, government contracting requirements, or any government-specific framework. This platform doesn't provide, claim, or imply coverage of any federal compliance program, and isn't built for regulated federal environments.",
    whyItMattersIntro:
      "Anonymous sharing links left open, stale guest accounts still holding permissions, over-privileged OAuth consent grants, and privileged accounts missing MFA — these four gaps show up in nearly every real-world breach post-mortem, and they're exactly what this engine checks for on a recurring basis, not once at audit time.",
    howItWorks: [
      {
        title: "Connect",
        description: "A scoped, read-only Microsoft Graph connection is granted during onboarding — no standing credential, revocable at any time.",
      },
      {
        title: "Scan",
        description: "The Security Engine evaluates sharing links, guest accounts, OAuth consent grants, and MFA registration against your tenant's real current state.",
      },
      {
        title: "Score",
        description: "Findings roll into your tenant's real Security pillar score inside the Architecture Health Engine — not a generic industry checklist score.",
      },
      {
        title: "Recheck",
        description: "Scans repeat on a scheduled cadence, so drift since the last check gets caught instead of only surfacing at the next annual audit.",
      },
      {
        title: "Surface",
        description: "New or worsening findings appear in your Portal, with the specific fix ranked by what closes the biggest exposure first.",
      },
    ],
    whatYouGet: [
      "Your real Security pillar score, not a self-attested rating",
      "A live list of open anonymous links, stale guest accounts, risky OAuth grants, and MFA gaps — every finding traceable to a real Graph API check",
      "Scheduled re-checks, so a fixed finding that regresses gets caught again",
      "Zero questionnaires — every number on this page comes from your actual tenant",
    ],
    modulesIntro: "Every module below runs on the same real Graph telemetry — no self-attestation, no once-a-year audit.",
    finalCtaBody:
      "Start a free Assessment and get your real Security score — scanned against your actual tenant, not guessed from a questionnaire.",
  },
  {
    slug: "governance",
    title: "Governance",
    shortLabel: "Governance",
    icon: Shield,
    pillar: "Governance",
    gradientPhrase: "Accountable to a Baseline",
    headlinePrefix: "Every Team, Group, and Admin Role — ",
    headlineSuffix: "Accountable to a Baseline.",
    subhead:
      "Lifecycle policy, naming discipline, and admin role assignments enforced against a real approved baseline — checked on a real schedule, not assumed compliant because nobody complained.",
    quizHref: "/governance-quiz",
    stats: [
      { label: "Governance pillar", value: "Scored" },
      { label: "Lifecycle policy", value: "Verified" },
      { label: "Baseline drift", value: "Tracked" },
    ],
    coverage: [
      "Microsoft 365 Group and Teams lifecycle policy enforcement",
      "Naming convention and ownership requirement compliance",
      "Configuration baseline drift since the last approved state",
      "Admin role assignment sprawl (who actually has Global Admin, and why)",
    ],
    risks: [
      "Nobody being able to answer \"who owns this Team\" six months after it was created",
      "Every admin change happening ad hoc, with no baseline to compare against",
    ],
    relatedEngine: {
      name: "Drift Engine",
      description:
        "Fingerprints every admin change against your approved baseline on your next scheduled evaluation.",
    },
    healthPillarKeys: ["governance"],
    productOverview:
      "Governance runs a live, read-only Microsoft Graph API scan against your tenant's actual Teams and Microsoft 365 Group lifecycle state — every naming convention exception, every group without a current accountable owner, every admin role assignment, and your live configuration compared against your approved governance baseline. Baseline drift isn't watched in real time and it doesn't guarantee an alert the instant something changes — deviations are flagged on your next scheduled evaluation, a real cadence you can see, not an assumed constant watch.",
    credibilityBody:
      "I'm the Microsoft 365 Architect at NASA, where I wrote the agency's M365 Copilot governance framework. The same lifecycle, naming, and admin-role discipline this page scans for is one I enforce inside NASA's own tenant every day — not a case study I read about. This platform doesn't score your tenant against NASA's specific frameworks — that's not what it's built to do — but the same governance discipline that keeps a tenant defensible at NASA's scale is what's engineered into this scan.",
    whyItMattersIntro:
      "Governance debt doesn't fail all at once — it fails the day someone asks who owns a Team, why a Global Admin role was granted three reorgs ago, or why a configuration change nobody approved has been sitting in production since last quarter, and the honest answer is nobody's actually sure.",
    howItWorks: [
      {
        title: "Connect",
        description: "You grant a scoped, read-only Graph API connection. No agent installed, no standing credential left behind.",
      },
      {
        title: "Scan",
        description: "The engine reads your real Teams and Group lifecycle state, naming convention compliance, admin role assignments, and current tenant configuration against your approved baseline.",
      },
      {
        title: "Findings",
        description: "Every lifecycle policy exception, naming violation, ownerless Group, and baseline deviation is logged as a real, inspectable finding on your next scheduled evaluation — not guaranteed the instant a change happens.",
      },
      {
        title: "Score",
        description: "Findings roll up into your real Governance pillar score inside the Architecture Health Engine.",
      },
      {
        title: "Remediate",
        description: "You get the specific fixes, ranked by which one closes the biggest exposure first — and the Drift Engine checks the same baseline again on your next scheduled evaluation.",
      },
    ],
    whatYouGet: [
      "Your real Governance pillar score, not a self-reported estimate",
      "A full lifecycle and naming compliance report — every Team and Group checked against your real policy, not a spreadsheet",
      "A current admin role roster — who actually holds Global Admin and every other privileged role, and why",
      "Baseline drift findings from your real scheduled evaluations, not a one-time audit",
      "Zero questionnaires. Every finding comes from a live Graph API scan of your actual tenant.",
    ],
    modulesIntro: "Governance checks four real surfaces before sprawl and ad hoc admin changes become the norm:",
    finalCtaBody:
      "Start a free Assessment and get your real Governance pillar score — scanned, not guessed — or take the quiz for a faster, self-reported read first.",
  },
  {
    slug: "sharepoint",
    title: "SharePoint",
    shortLabel: "SharePoint",
    icon: Share2,
    pillar: "Architecture",
    gradientPhrase: "an intranet people actually use",
    headlinePrefix: "Most SharePoint intranets fail quietly. ",
    headlineSuffix: "Yours doesn't have to.",
    subhead:
      "SharePoint surfaces exactly the site architecture and permission model you've built — this scans that real surface before sprawl and broken inheritance turn the intranet into the tool nobody opens.",
    quizHref: "/sharepoint-quiz",
    stats: [
      { label: "Architecture pillar", value: "Scored" },
      { label: "Site sprawl", value: "Mapped" },
      { label: "Permission model", value: "Audited" },
    ],
    coverage: [
      "Site and hub architecture against actual usage patterns",
      "Permission inheritance breaks and orphaned unique-permission sites",
      "Content type and metadata governance consistency",
      "Search and findability configuration",
    ],
    risks: [
      "An intranet that costs a license fee and gets used by nobody",
      "Permission inheritance breaks nobody remembers making, three reorgs ago",
    ],
    relatedEngine: {
      name: "Drift Engine",
      description:
        "Tracks configuration baseline deltas across SharePoint site collections as they drift from the approved architecture.",
    },
    healthPillarKeys: ["architecture"],
    productOverview:
      "SharePoint Governance runs a live, read-only Microsoft Graph API scan across your tenant's real site and hub architecture — checked against actual usage patterns, permission inheritance traced from every site collection down to individual unique-permission breaks, content type and metadata governance checked for consistency, and search and findability configuration audited. It's the same surface a user hits when they can't find something in your intranet, or find too much of it — scanned directly, not guessed at from a checklist.",
    credibilityBody:
      "I'm the current Microsoft 365 Architect at NASA, where I govern the same site architecture, permission inheritance, and metadata problems this page scans for — not case studies I read about, but a tenant I administer every day. This platform doesn't score your tenant against NASA's specific frameworks — that's not what it's built to do — but the same architectural discipline that keeps a SharePoint environment usable at NASA's scale is what's engineered into this scan.",
    whyItMattersIntro:
      "An ungoverned SharePoint doesn't fail all at once — it fails one abandoned site, one broken permission inheritance, and one orphaned share at a time, until the intranet you're paying a license fee for is the tool nobody opens voluntarily.",
    howItWorks: [
      {
        title: "Connect",
        description: "You grant a scoped, read-only Graph API connection. No agent installed, no standing credential left behind.",
      },
      {
        title: "Scan",
        description: "The engine reads your real site and hub architecture, permission inheritance chains, content type and metadata configuration, and search and findability settings across every site collection.",
      },
      {
        title: "Findings",
        description: "Every orphaned unique-permission site, broken inheritance chain, and metadata inconsistency is logged as a real, inspectable finding — not a scored questionnaire answer.",
      },
      {
        title: "Score",
        description: "Findings roll up into your real Architecture pillar score inside the Architecture Health Engine.",
      },
      {
        title: "Remediate",
        description: "You get the specific fixes, ranked by which one closes the biggest exposure first — and the Drift Engine keeps tracking that same architecture as it moves.",
      },
    ],
    whatYouGet: [
      "Your real Architecture pillar score, not a self-reported estimate",
      "A full site and hub architecture map, checked against actual usage — not guessed at",
      "Every permission inheritance break and orphaned unique-permission site, traced and logged",
      "Content type and metadata governance findings, plus your search and findability configuration read",
      "Ongoing tracking from the Drift Engine, which tracks configuration baseline deltas across your site collections as they drift from the approved architecture",
      "Zero questionnaires. Every finding comes from a live Graph API scan of your actual tenant.",
    ],
    modulesIntro: "SharePoint Governance checks four real surfaces before sprawl and broken permissions become the norm:",
    finalCtaBody:
      "Start a free Assessment and get your real Architecture pillar score — scanned, not guessed — or take the quiz for a faster, self-reported read first.",
  },
  {
    slug: "power-platform",
    title: "Power Platform",
    shortLabel: "Power Platform",
    icon: Zap,
    pillar: "Architecture",
    gradientPhrase: "Govern it before it scales past you",
    headlinePrefix: "Power Platform scales fast. ",
    headlineSuffix: "Govern it before it scales past you.",
    subhead:
      "Every Power Apps and Power Automate maker in your tenant can already touch production data. This maps your real environment strategy, DLP policy coverage, and connector exposure — before an ungoverned app becomes the one nobody can explain in an audit.",
    quizHref: "/power-platform-quiz",
    stats: [
      { label: "Architecture pillar", value: "Scored" },
      { label: "App inventory", value: "Discovered" },
      { label: "DLP policy", value: "Checked" },
    ],
    coverage: [
      "Environment strategy — default environment sprawl vs. a real ALM model",
      "Data Loss Prevention policy coverage across connectors",
      "App and flow ownership — what happens when the maker leaves",
      "Premium connector and licensing exposure",
    ],
    risks: [
      "A citizen-developer app quietly moving regulated data through an unapproved connector",
      "Nobody being able to inventory what's actually running in the default environment",
    ],
    relatedEngine: {
      name: "Health Engine",
      description:
        "Scores tenant risk on evaluation across licensing utilization and operational exposure, including citizen-developer sprawl.",
    },
    healthPillarKeys: ["architecture"],
    productOverview:
      "Power Platform Governance runs a live, read-only scan against your tenant's actual Power Platform admin surface — every environment beyond the unmanaged default, every Data Loss Prevention policy and the connectors it does or doesn't cover, every app and flow with (or without) a real owner, and every premium connector already in use. It's the same surface a citizen developer touches when they build something in an afternoon, so the scan shows you exactly what's already running, and what's ungoverned, before it becomes the app nobody can explain in an audit.",
    credibilityBody:
      "I govern Power Platform inside NASA's own tenant every day — environment strategy, DLP policy design, and citizen-developer oversight for real makers building real apps, not case studies I read about. This platform doesn't score your tenant against NASA's specific frameworks — that's not what it's built to do — but the same governance discipline I apply at NASA is what's engineered into this scan.",
    whyItMattersIntro:
      "Power Platform sprawl doesn't fail quietly — it fails the day an auditor, regulator, or breach investigation asks which app touched which data, and the honest answer is nobody's actually sure.",
    howItWorks: [
      {
        title: "Connect",
        description: "You grant a scoped, read-only connection to your Power Platform admin surface and Microsoft Graph. No agent installed, no standing credential left behind.",
      },
      {
        title: "Scan",
        description: "The engine reads every environment, each DLP policy and the connectors it covers, app and flow ownership, and premium connector usage across your tenant.",
      },
      {
        title: "Findings",
        description: "Every ungoverned environment, DLP coverage gap, orphaned app or flow, and premium connector exposure is logged as a real, inspectable finding — not a scored questionnaire answer.",
      },
      {
        title: "Score",
        description: "Findings roll up into your real Architecture pillar score inside the Architecture Health Engine.",
      },
      {
        title: "Remediate",
        description: "You get the specific fixes, ranked by which one closes the biggest exposure first — and the same scan runs again on your next scheduled evaluation to confirm it stayed fixed.",
      },
    ],
    whatYouGet: [
      "Your real Architecture pillar score for Power Platform, not a self-reported estimate",
      "A full environment and DLP policy coverage report — every environment beyond the default, and exactly which connectors each DLP policy does and doesn't reach",
      "An app and flow ownership map — what's actually running, who owns it, and what happens when that maker leaves",
      "A premium connector and licensing exposure read — what's already in use, and what it's costing you",
      "Zero questionnaires. Every finding comes from a live scan of your actual tenant, and every score updates the next time the Health Engine evaluates it.",
    ],
    modulesIntro: "Power Platform Governance checks four real surfaces before a citizen-developer app becomes a citizen-developer incident:",
    finalCtaBody:
      "Start a free Assessment and get your real Architecture pillar score for Power Platform — scanned, not guessed — or take the quiz for a faster, self-reported read first.",
  },
  {
    slug: "teams",
    title: "Teams",
    shortLabel: "Teams",
    icon: Users,
    pillar: "Governance",
    gradientPhrase: "structure, not just adoption",
    headlinePrefix: "Teams rollout needs ",
    headlineSuffix: "structure, not just adoption.",
    subhead:
      "High Teams usage numbers look good in a dashboard. They don't tell you how many abandoned teams are sitting there with external guests still attached, or whether anyone can find the right channel without asking in three others first.",
    quizHref: "/teams-quiz",
    stats: [
      { label: "Governance pillar", value: "Scored" },
      { label: "Abandoned teams", value: "Flagged" },
      { label: "Guest access", value: "Reviewed" },
    ],
    coverage: [
      "Team creation and lifecycle governance (naming, approval, archival)",
      "External guest access review across active and dormant teams",
      "Channel and app sprawl versus actual adoption",
      "Meeting and calling policy alignment with organizational needs",
    ],
    risks: [
      "External guests with standing access to a team nobody's used in a year",
      "Adoption metrics that look healthy while the underlying structure is chaos",
    ],
    relatedEngine: {
      name: "Health Engine",
      description:
        "Correlates service health and adoption signals into a composite score, surfacing structural issues dashboards alone miss.",
    },
    healthPillarKeys: ["governance"],
    productOverview:
      "Teams Governance runs a live, read-only Microsoft Graph API scan across every team and Microsoft 365 Group in your tenant — creation and naming patterns, archival and lifecycle status, guest membership, channel and app counts, and meeting/calling policy assignment. It's built to catch what a usage dashboard can't: a team that looks active by usage stats but has no clear owner, an external guest with standing access nobody's reviewed since onboarding, or channel sprawl that's quietly outgrown the policies meant to contain it.",
    credibilityBody:
      "I govern Microsoft Teams lifecycle policy, naming discipline, and external guest access for NASA's own tenant — the structural problems this page scans for are ones I manage directly, not case studies I read about. This platform doesn't score your tenant against NASA's specific frameworks — that's not what it's built to do — but the same lifecycle discipline that keeps NASA's Teams environment governed is what's engineered into this scan.",
    whyItMattersIntro:
      "A Teams rollout with strong adoption numbers can still be structurally ungoverned — and the two failure modes that matter most don't show up in a usage dashboard at all.",
    howItWorks: [
      {
        title: "Connect",
        description: "You grant a scoped, read-only Graph API connection. No agent installed, no standing credential left behind.",
      },
      {
        title: "Scan",
        description: "The engine reads team and Microsoft 365 Group creation history, naming patterns, archival status, guest membership, channel and app counts, and meeting/calling policy assignment across your tenant.",
      },
      {
        title: "Findings",
        description: "Every abandoned team with standing guest access, naming-convention violation, and channel sprawl pattern is logged as a real, inspectable finding — not a scored questionnaire answer.",
      },
      {
        title: "Score",
        description: "Findings roll up into your real Governance pillar score inside the Architecture Health Engine.",
      },
      {
        title: "Remediate",
        description: "You get the specific fixes, ranked by which one closes the biggest exposure first — and the Health Engine keeps re-checking the same surface after you fix it.",
      },
    ],
    whatYouGet: [
      "Your real Governance pillar score, not a self-reported estimate",
      "A full lifecycle and guest-access report — every abandoned team, naming-convention violation, and external guest with standing access flagged",
      "A channel and app sprawl read — where usage has outgrown the policies meant to contain it",
      "Zero questionnaires. Every finding comes from a live Graph API scan of your actual tenant.",
    ],
    modulesIntro: "Teams Governance checks four real surfaces before sprawl becomes a cleanup project:",
    finalCtaBody:
      "Start a free Assessment and get your real Governance pillar score — scanned, not guessed — or take the quiz for a faster, self-reported read first.",
  },
  {
    slug: "migration",
    title: "Migration",
    shortLabel: "Migration",
    icon: GitMerge,
    pillar: "Architecture",
    gradientPhrase: "without the scope drift that turns a migration into a fire drill",
    headlinePrefix: "Move to Microsoft 365 ",
    headlineSuffix: "without the scope drift that turns a migration into a fire drill.",
    subhead:
      "Tenant-to-tenant moves, domain consolidation, identity alignment — planned against your actual source environment, executed against a locked target architecture, and cut over with a validated rollback path, not just crossed fingers.",
    quizHref: "/migration-quiz",
    stats: [
      { label: "Architecture pillar", value: "Scored" },
      { label: "Scope tracking", value: "Tracked" },
      { label: "Cutover risk", value: "Assessed" },
    ],
    coverage: [
      "Source environment discovery — mailboxes, file shares, legacy directory objects",
      "Target architecture design (tenant, identity, licensing model)",
      "Cutover planning and rollback strategy",
      "Post-migration validation against the original scope",
    ],
    risks: [
      "Discovering the \"real\" scope only after the migration is already underway",
      "A cutover with no rollback plan if something doesn't validate cleanly",
    ],
    relatedEngine: {
      name: "Scope Creep Engine",
      description:
        "Checks live engineering work against the signed SOW on every scheduled review, catching scope drift before it becomes a budget conversation.",
    },
    healthPillarKeys: ["architecture"],
    productOverview:
      "Migration starts with real discovery against your actual source environment — mailboxes, file shares, and legacy directory objects, not a spreadsheet someone filled out from memory. The target architecture (tenant structure, identity model, licensing) is designed and locked before a single object moves, so tenant-to-tenant transfer, domain consolidation, and identity alignment all execute against a fixed plan instead of a moving target. Cutover runs against a defined rollback strategy, and once workloads land, validation checks the result against the original scope — not against whatever scope quietly grew along the way.",
    credibilityBody:
      "I design and execute Microsoft 365 tenant migrations as the M365 Architect at NASA — the same discovery-first, rollback-planned discipline required when a migration touches a mission-critical tenant is what's engineered into this product. This platform doesn't extend any federal compliance posture to your migration — that's not what it's built to do — but the same rigor that prevents a bad cutover at NASA is what prevents one in yours.",
    whyItMattersIntro:
      "An ungoverned migration doesn't fail on day one — it fails three weeks in, when identity collisions surface, sharing links break, Teams and SharePoint structure drifts from what was promised, and downtime nobody planned for shows up mid-cutover. Scope discovered only after the migration is underway, and a cutover with no way back, are the two failure modes behind nearly all of it.",
    howItWorks: [
      {
        title: "Discover",
        description: "Source environment discovery captures mailboxes, file shares, and legacy directory objects before any plan is drafted.",
      },
      {
        title: "Design",
        description: "Target architecture — tenant structure, identity model, licensing — is designed and locked before a single object moves.",
      },
      {
        title: "Plan the cutover",
        description: "Cutover sequence and rollback strategy are defined and reviewed before execution starts, not improvised mid-migration.",
      },
      {
        title: "Execute",
        description: "Tenant-to-tenant transfer, domain consolidation, and identity alignment run against the locked plan.",
      },
      {
        title: "Validate",
        description: "Post-migration validation checks the result against the original scope, with the Scope Creep Engine confirming nothing drifted from what was signed.",
      },
    ],
    whatYouGet: [
      "A full source-environment inventory — mailboxes, file shares, and legacy directory objects mapped before migration starts",
      "A locked target architecture: tenant structure, identity model, and licensing plan, reviewed before cutover",
      "A defined cutover sequence with a real rollback strategy, not a one-way door",
      "Post-migration validation against the original scope, plus a Scope Creep Engine check against the signed SOW at each scheduled review, so drift shows up as a flagged violation, not a surprise invoice",
      "Zero questionnaires. Every deliverable comes from real discovery and validation against your actual environment.",
    ],
    modulesIntro: "Migration runs on four real components, each one gating the next:",
    finalCtaBody:
      "Start a free Assessment to get real visibility into what a migration would actually touch — or take the migration quiz for a faster, self-reported read first.",
  },
  {
    slug: "m365-health",
    title: "M365 Health",
    shortLabel: "M365 Health",
    icon: Activity,
    pillar: "Overall tenant health",
    gradientPhrase: "into one number you can trust",
    headlinePrefix: "Seven pillars of tenant health, rolled ",
    headlineSuffix: "into one number you can trust.",
    subhead:
      "Governance, compliance, adoption, Copilot readiness, architecture, licensing, and security don't fail one at a time — they drift together, and the only way to see it is a single composite score built from real Graph API scans, not a checklist.",
    quizHref: "/m365-health-quiz",
    stats: [
      { label: "Composite health", value: "Scored" },
      { label: "Pillars tracked", value: "7" },
      { label: "Check cadence", value: "Configurable" },
    ],
    coverage: [
      "Composite tenant health score across all seven Architecture Health Engine pillars",
      "License utilization efficiency and waste identification",
      "Service health anomaly correlation",
      "Automated remediation runbook coverage",
    ],
    risks: [
      "Finding out about a health regression from a user complaint instead of a dashboard",
      "Licensing spend that nobody's actually reconciled against usage",
    ],
    relatedEngine: {
      name: "Health Engine",
      description:
        "Calculates your composite tenant health score across all seven Architecture Health Engine pillars on your configured check cadence, and can trigger automated remediation runbooks against qualifying findings where write-back is configured and enabled for your tenant — not switched on by default for every customer today.",
    },
    healthPillarKeys: ["governance", "compliance", "adoption", "copilot", "architecture", "licensing", "security"],
    productOverview:
      "M365 Health is the composite version of every other Solutions page here — the same read-only Microsoft Graph API scan, but rolled across all seven Architecture Health Engine pillars (governance, compliance, adoption, Copilot readiness, architecture, licensing, security) into one score instead of a single-domain read. It correlates service health anomalies across pillars rather than surfacing them as isolated alerts, tracks license utilization and waste separately from the health score so waste doesn't hide inside a good number, and can trigger automated remediation runbooks against qualifying findings where write-back is configured and enabled for your tenant.",
    credibilityBody:
      "I'm the current Microsoft 365 Architect at NASA, where the same seven pillars — governance, compliance, adoption, Copilot readiness, architecture, licensing, security — are what I'm personally accountable for keeping healthy across a tenant that size, every day. This platform doesn't score your tenant against NASA's specific frameworks — that's not what it's built to do — but the same discipline that keeps those seven pillars moving together at NASA's scale is what's engineered into this composite score.",
    whyItMattersIntro:
      "A tenant doesn't degrade in one place — it degrades in whichever pillar nobody's watching that week, and the first sign is usually a user complaint, not a dashboard. M365 Health exists so regressions, licensing waste, service anomalies, and drift across governance, security, and every other pillar surface as a real number before they turn into a support ticket or a budget conversation.",
    howItWorks: [
      {
        title: "Connect",
        description: "You grant a scoped, read-only Graph API connection. No agent installed, no standing credential left behind.",
      },
      {
        title: "Scan",
        description: "The engine runs each pillar's real scan — governance, compliance, adoption, Copilot readiness, architecture, licensing, and security — against your tenant's actual current state.",
      },
      {
        title: "Correlate",
        description: "Findings are checked against each other across pillars, so a licensing anomaly and a service health flag that share the same root cause don't show up as two unrelated alerts.",
      },
      {
        title: "Score",
        description: "Every pillar rolls up into your real composite Architecture Health Engine score, refreshed on your configured check cadence — not a continuous real-time feed.",
      },
      {
        title: "Remediate",
        description: "Where write-back remediation is configured and enabled for your tenant, qualifying findings can be corrected automatically; everything else comes back as a ranked, specific fix.",
      },
    ],
    whatYouGet: [
      "Your real composite tenant health score across all seven Architecture Health Engine pillars, not a self-reported estimate",
      "Service health anomalies correlated across pillars instead of surfaced as isolated alerts",
      "License utilization and waste tracked separately from the health score, so it can't hide inside a good number",
      "Automated remediation runbooks against qualifying findings where write-back is configured and enabled for your tenant — not a guarantee for every finding or every customer today",
      "Findings refreshed on your configured check cadence, not a fixed annual audit",
      "Zero questionnaires. Every finding comes from a live Graph API scan of your actual tenant.",
    ],
    modulesIntro:
      "M365 Health rolls up four real signals into your composite score before a regression in any one pillar becomes the thing a user notices first:",
    finalCtaBody:
      "Start a free Assessment and get your real composite health score — scanned across all seven pillars, not guessed — or take the quiz for a faster, self-reported read first.",
  },
];

export function getSolutionTopic(slug: string): SolutionTopic | undefined {
  return SOLUTIONS_TOPICS.find((t) => t.slug === slug);
}

/** Display labels for the 7 real Architecture Health Engine pillar keys. */
export const HEALTH_PILLAR_LABELS: Record<string, string> = {
  governance: "Governance",
  compliance: "Compliance",
  adoption: "Adoption",
  copilot: "Copilot Readiness",
  architecture: "Architecture",
  licensing: "Licensing",
  security: "Security",
};

/**
 * Which Solutions/Topic page a Home-page visitor's weakest pillar should route to
 * (website-rebuild-reference-v2.md §3: "directing the visitor to whichever topic
 * page needs attention most"). "architecture" and "governance" are each real-owned
 * by more than one topic (see SolutionTopic.healthPillarKeys above) — this is Stage
 * 4b's explicit, documented single-destination choice for those pillars, not a data
 * lookup. "adoption" and "licensing" have no single-owner topic at all, so both route
 * to the composite m365-health page, which explicitly covers all 7 pillars.
 */
export const PILLAR_TO_TOPIC_SLUG: Record<string, string> = {
  governance: "governance",
  compliance: "security-compliance",
  adoption: "m365-health",
  copilot: "copilot",
  architecture: "sharepoint",
  licensing: "m365-health",
  security: "security-compliance",
};

/**
 * Best-effort keyword match from free text to a topic, used two ways in Stage 4b:
 * (1) matching an article's category/title to a domain for a personalized nudge, and
 * (2) matching a quiz-tier visitor's Lead Offer Engine inferredSignals[].signalKey to
 * the topic page they're currently viewing. inferredSignalKey is admin-configured
 * (leadOfferInferenceRulesTable, confirmed empty/unseeded as of this task — see Stage
 * 4b completion notes) with no fixed vocabulary, so this is deliberately a heuristic,
 * not a lookup against a real enum — it degrades to "no match" safely, which is the
 * correct behavior per website-rebuild-reference-v2.md §3 (no relevant signal → cold
 * fallback, never a forced/irrelevant nudge).
 */
export const TOPIC_KEYWORDS: Record<string, string[]> = {
  copilot: ["copilot"],
  "security-compliance": ["security", "compliance", "mfa", "guest access", "breach"],
  governance: ["governance", "lifecycle", "baseline drift", "admin role"],
  sharepoint: ["sharepoint", "intranet", "site sprawl"],
  "power-platform": ["power platform", "power apps", "power automate", "shadow it", "dlp", "citizen"],
  teams: ["teams", "channel sprawl"],
  migration: ["migration", "cutover", "cloud migration", "tenant-to-tenant"],
  "m365-health": ["m365 health", "tenant health", "composite"],
};

export function topicMatchesKeywordText(slug: string, text: string): boolean {
  const hay = text.toLowerCase();
  return (TOPIC_KEYWORDS[slug] ?? []).some((kw) => hay.includes(kw));
}

export function findTopicByText(text: string): SolutionTopic | undefined {
  return SOLUTIONS_TOPICS.find((t) => topicMatchesKeywordText(t.slug, text));
}
