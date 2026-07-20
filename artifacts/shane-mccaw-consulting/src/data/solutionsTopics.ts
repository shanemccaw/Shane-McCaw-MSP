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
}

export const SOLUTIONS_TOPICS: SolutionTopic[] = [
  {
    slug: "copilot",
    title: "Copilot & AI",
    shortLabel: "Copilot",
    icon: Brain,
    pillar: "Copilot readiness",
    gradientPhrase: "Copilot readiness",
    headlinePrefix: "Most Copilot deployments fail before the first prompt. ",
    headlineSuffix: "Yours doesn't have to.",
    subhead:
      "Copilot surfaces whatever your permission model already exposes. Oversharing, stale group membership, and ungoverned OneDrive links become Copilot's search index — not a hypothetical risk, but the first thing a real rollout uncovers.",
    quizHref: "/copilot-quiz",
    stats: [
      { label: "Copilot readiness pillar", value: "Scored" },
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
  },
  {
    slug: "security-compliance",
    title: "Security & Compliance",
    shortLabel: "Security",
    icon: Lock,
    pillar: "Security",
    gradientPhrase: "before it's an incident report",
    headlinePrefix: "Find the gap ",
    headlineSuffix: "before it's an incident report.",
    subhead:
      "Anonymous links, stale guest accounts, missing MFA, over-privileged OAuth apps — the same handful of misconfigurations show up in nearly every breach post-mortem. They're also the easiest things to check for continuously, not once a year.",
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
      "A single forgotten anonymous link turning into a data exposure headline",
      "Compliance frameworks (SOC 2, HIPAA) assuming controls that were never actually verified",
    ],
    relatedEngine: {
      name: "Security Engine",
      description:
        "Continuously hunts anonymous share links, stale guest access, over-privileged OAuth apps, and MFA gaps.",
    },
  },
  {
    slug: "governance",
    title: "Governance",
    shortLabel: "Governance",
    icon: Shield,
    pillar: "Governance",
    gradientPhrase: "intention, not accumulation",
    headlinePrefix: "Your tenant should evolve with ",
    headlineSuffix: "intention, not accumulation.",
    subhead:
      "Teams sprawl, ungoverned Microsoft 365 Groups, and lifecycle policies that exist on paper but not in the tenant — governance debt compounds quietly until an audit or a departing employee forces the question.",
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
        "Fingerprints every admin change against your approved baseline the moment it happens.",
    },
  },
  {
    slug: "sharepoint",
    title: "SharePoint",
    shortLabel: "SharePoint",
    icon: Share2,
    pillar: "Architecture",
    gradientPhrase: "an intranet people actually use",
    headlinePrefix: "From site sprawl to ",
    headlineSuffix: "an intranet people actually use.",
    subhead:
      "Most SharePoint environments grow site-by-site with no information architecture behind them. The result: duplicate content, broken permission inheritance, and an intranet nobody opens voluntarily.",
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
  },
  {
    slug: "power-platform",
    title: "Power Platform",
    shortLabel: "Power Platform",
    icon: Zap,
    pillar: "Architecture",
    gradientPhrase: "before it's shadow IT",
    headlinePrefix: "Get ahead of Power Platform sprawl ",
    headlineSuffix: "before it's shadow IT.",
    subhead:
      "Every business user with a Power Apps license can build something that touches production data. Without environment strategy and DLP policy, that's not empowerment — it's an ungoverned attack surface with nobody's name on it.",
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
        "Scores tenant risk in real time across licensing utilization and operational exposure, including citizen-developer sprawl.",
    },
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
  },
  {
    slug: "migration",
    title: "Migration",
    shortLabel: "Migration",
    icon: GitMerge,
    pillar: "Architecture",
    gradientPhrase: "without the six-month fire drill",
    headlinePrefix: "Move to Microsoft 365 ",
    headlineSuffix: "without the six-month fire drill.",
    subhead:
      "On-premises Exchange, file shares, legacy identity — every migration carries the same risk: scope that grows the moment real users start finding what the discovery phase missed. Scope Creep tracking exists for exactly this reason.",
    quizHref: "/migration-quiz",
    stats: [
      { label: "Architecture pillar", value: "Scored" },
      { label: "Scope tracking", value: "Live" },
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
        "Checks live engineering work against the signed SOW continuously, catching scope drift before it becomes a budget conversation.",
    },
  },
  {
    slug: "m365-health",
    title: "M365 Health",
    shortLabel: "M365 Health",
    icon: Activity,
    pillar: "Overall tenant health",
    gradientPhrase: "one composite number",
    headlinePrefix: "Every pillar, rolled into ",
    headlineSuffix: "one composite number.",
    subhead:
      "Governance, compliance, adoption, Copilot readiness, architecture, licensing, and security — each matters on its own, but the real signal is how they move together. That's the number this page is built to show a recognized visitor.",
    quizHref: "/m365-health-quiz",
    stats: [
      { label: "Composite health", value: "Live" },
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
        "Calculates a composite real-time tenant health score and fires automated remediation runbooks when it degrades below threshold.",
    },
  },
];

export function getSolutionTopic(slug: string): SolutionTopic | undefined {
  return SOLUTIONS_TOPICS.find((t) => t.slug === slug);
}
