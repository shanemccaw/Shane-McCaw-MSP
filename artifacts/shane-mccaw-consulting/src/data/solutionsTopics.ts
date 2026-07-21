import {
  Brain, Lock, Shield, Share2, Zap, Users, GitMerge, Activity,
  RefreshCw, ClipboardList, Key, Layers, MessageSquare, Tag, Search,
  DollarSign, Link2, ShieldCheck, Phone, BarChart3, Mail, FolderOpen,
  Server, Building2, RotateCcw, Bot, TrendingUp, type LucideIcon,
} from "lucide-react";
import type { ShowcaseStageSpec } from "@/components/design-system/HowItWorksShowcase";

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
  /**
   * Flagship content-quality + visual layer — piloted on "governance" (Governance
   * Topic Page: Flagship Rebuild task), approved, and rolled out to all 8 topics
   * (Roll Out Governance Pattern to 7 Remaining Topic Pages task). When present,
   * SolutionTopicPage.tsx overrides the expanded-structure section headings (every
   * heading a specific claim/hook, never a bare category label), renders a
   * Portal-style dashboard preview inside "What You Get", pairs each section with
   * the visual matching that section's own claim, and lists the topic's real
   * document products. Each topic's block is authored from ITS OWN real
   * subhead/stats/coverage/risks/engine data — never copied across topics.
   */
  flagship?: SolutionTopicFlagship;
}

/**
 * One flagship section heading, optionally with a gradient-emphasized phrase
 * (rendered via GradientText — keep total gradient usage within the design
 * system's 2-3-per-page restraint rule when authoring these).
 */
export interface FlagshipHeading {
  pre?: string;
  gradient?: string;
  post?: string;
}

export interface SolutionTopicFlagship {
  headings: {
    whatItDoes: FlagshipHeading;
    credibility: FlagshipHeading;
    whyItMatters: FlagshipHeading;
    howItWorks: FlagshipHeading;
    whatYouGet: FlagshipHeading;
    modules: FlagshipHeading;
    docProducts: FlagshipHeading;
    finalCta: FlagshipHeading;
  };
  /**
   * Illustrative Portal-preview panel (reuses Home.tsx's Mission Control preview
   * visual language: conic-gradient ring, metric bars, flat-amber-means-attention).
   * Metric labels MUST be real, code-verified metric names from the platform's
   * dashboard registry (lib/dashboard-registry/src/metrics.ts) — values are
   * illustrative and the panel carries the same "Illustrative Example" badge as
   * Home's preview. These are target-0 count metrics in the real product: count 0
   * renders as healthy (empty track), count > 0 renders a flat amber bar.
   */
  dashboard: {
    panelLabel: string;
    ringLabel: string;
    ringValue: number;
    /**
     * Optional "after remediation" companion to ringValue for the How It Works
     * animated sequence's Remediate stage (HowItWorksShowcase.tsx) — a
     * conceptual before/after of the mechanism, both values illustrative under
     * the same badge + caption. Author it at/above 85 so the after-state lands
     * in the healthy tier (PillarScoreRing scoreTone: ≥85 green).
     */
    remediatedRingValue?: number;
    metrics: { label: string; count: number }[];
    trendNote: string;
    caption: string;
    /**
     * Small category rings beside the primary ring — the Portal's real Mission
     * Control layout (one large ring + a grid of 48px pillar rings). Labels MUST
     * be the 7 real Architecture Health Engine pillar names (HEALTH_PILLAR_LABELS
     * below / MissionControl.tsx PILLAR_LABELS); values are illustrative and live
     * inside the panel's "Illustrative Example" badge + caption.
     */
    pillarBreakdown?: { label: string; value: number }[];
    /**
     * Small trend line depicting a real engine's scheduled-evaluation output
     * shape (score + trendDirection per evaluation, drift-engine.ts — or the
     * Security Engine's recurring scan cadence) — x labels are relative
     * scheduled evaluations/scans, never fabricated calendar dates, and the
     * counts are illustrative under the same badge. seriesLabel names what the
     * line counts in the hover tooltip. panelHeading defaults to the Governance
     * pilot's "Drift Engine — scheduled evaluations"; a topic re-checked by a
     * different real engine MUST pass its own honest heading.
     */
    driftTrend?: { seriesLabel: string; panelHeading?: string; points: { label: string; value: number }[] };
    /**
     * License-utilization scatter for a topic whose "What It Does" prose makes
     * a two-measure relationship claim (M365 Health: license utilization and
     * waste tracked separately from the health score — licensing.skuBreakdown /
     * licensing.wasteEstimateBreakdown are the real registry concepts depicted).
     * Point labels are real M365 license SKU names; seat values are illustrative
     * under the panel's badge. Mutually exclusive with driftTrend in practice —
     * the page renders driftTrend first if both are authored.
     */
    licenseScatter?: {
      panelHeading: string;
      xLabel: string;
      yLabel: string;
      points: { label: string; x: number; y: number }[];
      caption: string;
    };
  };
  /**
   * Per-stage visual specs for the How It Works showcase (HowItWorksShowcase
   * ShowcaseStageSpec) — lets each topic put its OWN real copy inside the five
   * animated stages (connect endpoints/checklist, scan verb, findings note,
   * remediate engine attribution) instead of inheriting the Governance pilot's
   * hardcoded claims. Omitted by governance itself, which keeps the original
   * defaults; REQUIRED in spirit for every other topic, because the defaults
   * name the Drift Engine and Governance's cadence claims.
   */
  showcaseStages?: ShowcaseStageSpec[];
  /**
   * Icon-led strip for the "What It Does" section naming the real surfaces the
   * scan reads — icons + real M365 terminology only, no data values, so no
   * illustrative badge is needed. Labels must stay grounded in the topic's real
   * coverage claims (the `coverage` array), not invent new capabilities.
   */
  scanSurfaces?: { icon: LucideIcon; label: string; sublabel: string }[];
  /**
   * Per-risk M365 concept icon + tag for RiskList, index-aligned with `risks`
   * (same order, same length) — grounds each risk card in the real surface it
   * describes (SharePoint sites, Teams naming, …) instead of a uniform warning
   * triangle. Purely iconographic: no severity scores, no fabricated data.
   */
  riskDetails?: { icon: LucideIcon; tag: string }[];
  /**
   * Radar (spider) chart for the modules section's multi-dimensional claim —
   * the topic's real coverage surfaces scored in relation to each other on one
   * web. Axis labels must map 1:1 to the real `coverage` surfaces; values are
   * illustrative (no per-surface scoring exists in code — see the dashboard
   * comment below) and the block carries the same "Illustrative Example" badge
   * + caption convention as the Portal preview.
   */
  surfaceRadar?: { axes: { label: string; value: number }[]; caption: string };
  /**
   * Real document_product catalog slugs to list for this topic. Resolved live via
   * useServices({ type: "document_product" }) — name/price/description all come from
   * the API response, never hardcoded (no-hardcoding rule). Slugs that don't resolve
   * to a live catalog row are silently skipped; if none resolve, the block hides
   * entirely rather than showing an empty state.
   */
  docProductSlugs: string[];
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "Copilot doesn't create your oversharing problem. It puts a search box on it.",
        },
        credibility: {
          pre: "By the architect who wrote ",
          gradient: "NASA's M365 Copilot governance framework",
          post: " — before writing this scan.",
        },
        whyItMatters: {
          pre: "The first bad Copilot answer lands in front of exactly the wrong employee.",
        },
        howItWorks: {
          pre: "Five steps from read-only connection to a rollout you can defend.",
        },
        whatYouGet: {
          pre: "Your Copilot readiness scanned from the tenant its index will actually read.",
        },
        modules: {
          pre: "Four surfaces Copilot inherits. Scanned before it answers from them.",
        },
        docProducts: {
          pre: "Priced in the open: the Copilot readiness documents this platform actually generates.",
        },
        finalCta: {
          pre: "Copilot will answer from the tenant you actually have. ",
          gradient: "See it first — free.",
        },
      },
      // Every metric label is a real registry metric (lib/dashboard-registry/src/
      // metrics.ts: copilot.overshareExposureCount [Collaboration & Sharing tab],
      // compliance.oversharedSiteCount + compliance.missingLabelCount [Compliance &
      // Governance tab], licensing.inactiveLicenseCount [Licensing & Cost tab]) —
      // a themed cross-tab set, so the panel is labeled by theme, not one tab.
      // Counts illustrative under the panel's badge; Inactive Licenses 0 = the
      // healthy empty track (coherent with a pre-rollout scenario: no Copilot
      // seats bought, none wasted yet).
      dashboard: {
        panelLabel: "Portal preview — Copilot readiness",
        ringLabel: "Copilot Readiness pillar",
        // 41 = red tier (scoreTone <60) — a genuine "before" state for a tenant
        // that hasn't governed its sharing surface yet; matches this page's own
        // pillarBreakdown entry below (pillar-consistency rule).
        ringValue: 41,
        // 86 = healthy tier (≥85 green) for the Remediate stage's before/after.
        remediatedRingValue: 86,
        metrics: [
          { label: "Copilot Oversharing Exposure", count: 17 },
          { label: "Overshared Sites", count: 9 },
          { label: "Missing Sensitivity Labels", count: 34 },
          { label: "Inactive Licenses", count: 0 },
        ],
        trendNote: "Security Engine: the same surface re-checked on a recurring scan cadence",
        caption: "Example data — not your real score",
        // One coherent illustrative scenario: weak Security (58) is WHY Copilot
        // Readiness is low — Copilot inherits the security surface, per this
        // page's own subhead. Copilot Readiness = the primary ring's 41.
        pillarBreakdown: [
          { label: "Governance", value: 72 },
          { label: "Compliance", value: 66 },
          { label: "Adoption", value: 84 },
          { label: "Copilot Readiness", value: 41 },
          { label: "Architecture", value: 77 },
          { label: "Licensing", value: 69 },
          { label: "Security", value: 58 },
        ],
        // No driftTrend: this page's What-It-Does prose claims a permission-surface
        // read, not a drift/cadence mechanism — the strip below the prose carries
        // the enumeration instead (proportional treatment, not forced parity).
      },
      // The same four real coverage surfaces as `coverage` above — Share2 =
      // SharePoint sharing, Tag = sensitivity labels, DollarSign = licensing,
      // Search = the semantic index (all icons already in the site vocabulary).
      scanSurfaces: [
        {
          icon: Share2,
          label: "SharePoint & OneDrive sharing",
          sublabel: "Oversharing and permission-inheritance exposure across every site and drive",
        },
        {
          icon: Tag,
          label: "Sensitivity labels",
          sublabel: "Label coverage and data classification maturity across your content",
        },
        {
          icon: DollarSign,
          label: "Copilot licensing",
          sublabel: "Who actually needs a Copilot seat — per-seat fit, not bulk guesswork",
        },
        {
          icon: Search,
          label: "Semantic index hygiene",
          sublabel: "Stale sites, orphaned permissions, and dead groups Copilot's index can still reach",
        },
      ],
      // Index-aligned with `risks` above.
      riskDetails: [
        { icon: Share2, tag: "SharePoint & OneDrive" },
        { icon: Brain, tag: "Copilot rollout" },
      ],
      // Axes map 1:1 to the four coverage surfaces; sub-scores illustrative
      // (avg ≈ 43, coherent with the 41 ring: licensing fit least broken,
      // oversharing exposure worst — the page's own emphasis).
      surfaceRadar: {
        axes: [
          { label: "Oversharing exposure", value: 34 },
          { label: "Label coverage", value: 40 },
          { label: "Licensing fit", value: 55 },
          { label: "Index hygiene", value: 42 },
        ],
        caption: "The four surfaces Copilot inherits, scored in relation to each other — example data, not your tenant",
      },
      // Stage copy sourced from THIS topic's real howItWorks steps: Connect
      // matches Governance's wording (same real claims), Findings drops the
      // "scheduled evaluation" phrase this page never makes, Remediate names
      // the Security Engine per this page's own Remediate step.
      showcaseStages: [
        { kind: "connect" },
        { kind: "scan" },
        { kind: "findings", note: "findings logged from the live Graph scan — each one inspectable" },
        { kind: "score" },
        {
          kind: "remediate",
          note: "Security Engine re-checks the same surface after you fix it",
        },
      ],
      // Best-guess catalog slugs (document_product rows are admin-managed DB
      // data with no in-repo seed) — unresolved slugs hide silently by design;
      // Shane confirms/corrects against the live Product Catalog.
      docProductSlugs: ["copilot-readiness-report", "copilot-governance-framework-plan"],
    },
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
        title: "Findings",
        description: "Every open anonymous link, stale guest account, risky OAuth grant, and MFA gap is logged as a real, inspectable finding — traceable to an actual Graph API response.",
      },
      {
        title: "Score",
        description: "Findings roll into your tenant's real Security pillar score inside the Architecture Health Engine — not a generic industry checklist score.",
      },
      {
        title: "Remediate",
        description: "New or worsening findings appear in your Portal with the specific fix ranked by what closes the biggest exposure first — and scans repeat on a scheduled cadence, so a fixed finding that regresses gets caught instead of surfacing at the next annual audit.",
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "The four gaps behind most real breaches — checked against your tenant, on a schedule.",
        },
        credibility: {
          pre: "The same class of control managed daily by the ",
          gradient: "Microsoft 365 Architect at NASA",
          post: ".",
        },
        whyItMatters: {
          pre: "Every breach post-mortem lists the same four gaps. None of them announce themselves.",
        },
        howItWorks: {
          pre: "From read-only connection to a caught regression — five steps on a real cadence.",
        },
        whatYouGet: {
          pre: "Your security posture as a live score — every finding traceable to a real Graph check.",
        },
        modules: {
          pre: "Four real surfaces. One recurring scan cadence.",
        },
        docProducts: {
          pre: "Priced in the open: the security documents this platform actually generates.",
        },
        finalCta: {
          pre: "Your gaps get found on a schedule, or found in an incident report. ",
          gradient: "Choose the schedule — free.",
        },
      },
      // Real registry metrics themed to this page's own coverage claims
      // (metrics.ts: compliance.oversharedSiteCount [sharing-link exposure],
      // identity.staleAccountCount [stale guest/user accounts],
      // identity.legacyAuthCount [the MFA-bypass surface],
      // security.highSeverityAlertCount [Security Posture tab]). Counts
      // illustrative under the badge. Deliberately NOT depicted, because no such
      // registry metric exists: an "OAuth grants without review" count.
      dashboard: {
        panelLabel: "Portal preview — Security posture",
        ringLabel: "Security pillar",
        // 52 = red tier — a before-state worth improving; equals this page's own
        // pillarBreakdown Security entry (pillar-consistency rule). Compliance
        // (47) sits low with it — the page's healthPillarKeys own both pillars.
        ringValue: 52,
        remediatedRingValue: 88,
        metrics: [
          { label: "Overshared Sites", count: 8 },
          { label: "Stale Accounts", count: 27 },
          { label: "Legacy Auth Usage", count: 11 },
          { label: "High-Severity Alerts", count: 2 },
        ],
        trendNote: "Security Engine: open findings falling scan over scan — a regression gets caught, not missed",
        caption: "Example data — not your real score",
        pillarBreakdown: [
          { label: "Governance", value: 74 },
          { label: "Compliance", value: 47 },
          { label: "Adoption", value: 86 },
          { label: "Copilot Readiness", value: 58 },
          { label: "Architecture", value: 81 },
          { label: "Licensing", value: 88 },
          { label: "Security", value: 52 },
        ],
        // The Security Engine's REAL recurring-scan cadence (this page's own
        // productOverview claim: "re-checked on a scheduled cadence — not a
        // checklist filled out once a year"), so the panel heading names that
        // engine, not the Drift Engine. Mostly-falling series with one uptick —
        // the whatYouGet claim that a regressed finding gets caught again.
        driftTrend: {
          panelHeading: "Security Engine — scheduled scans",
          seriesLabel: "Open security findings",
          points: [
            { label: "5 scans ago", value: 19 },
            { label: "4 scans ago", value: 16 },
            { label: "3 scans ago", value: 12 },
            { label: "2 scans ago", value: 13 },
            { label: "1 scan ago", value: 9 },
            { label: "Latest", value: 7 },
          ],
        },
      },
      // The same four real coverage surfaces as `coverage` above (Link2 =
      // sharing links, Users = guest accounts, Key = OAuth/consent, ShieldCheck
      // = MFA — established site vocabulary).
      scanSurfaces: [
        {
          icon: Link2,
          label: "Sharing link exposure",
          sublabel: "Anonymous and organization-wide links open across SharePoint and OneDrive",
        },
        {
          icon: Users,
          label: "Guest accounts",
          sublabel: "Stale external guests still holding the permissions they left with",
        },
        {
          icon: Key,
          label: "OAuth consent grants",
          sublabel: "Applications holding broad access a user approved once and nobody reviewed since",
        },
        {
          icon: ShieldCheck,
          label: "MFA coverage",
          sublabel: "Registration status on privileged identities — the accounts attackers target first",
        },
      ],
      // Index-aligned with `risks` above (4 risks on this page).
      riskDetails: [
        { icon: Link2, tag: "Sharing links" },
        { icon: Users, tag: "Guest accounts" },
        { icon: Key, tag: "OAuth grants" },
        { icon: Lock, tag: "Privileged identities" },
      ],
      // Axes 1:1 with coverage; illustrative sub-scores average 52 = the ring
      // (sharing links weakest, OAuth strongest — matching the metric spread).
      surfaceRadar: {
        axes: [
          { label: "Sharing links", value: 45 },
          { label: "Guest hygiene", value: 49 },
          { label: "OAuth grants", value: 58 },
          { label: "MFA coverage", value: 56 },
        ],
        caption: "The four surfaces, scored in relation to each other — example data, not your tenant",
      },
      // Connect checklist = THIS page's own Connect claims (scoped, read-only,
      // no standing credential, revocable at any time — its copy never says
      // "no agent installed", so that default line is dropped); Remediate names
      // the scheduled-cadence recheck, not the Drift Engine.
      showcaseStages: [
        {
          kind: "connect",
          checklist: ["Scoped connection", "Read-only", "No standing credential", "Revocable at any time"],
        },
        { kind: "scan" },
        { kind: "findings", note: "findings logged this scan — each one traceable to a real Graph API response" },
        { kind: "score" },
        {
          kind: "remediate",
          note: "Scans repeat on a scheduled cadence — a fixed finding that regresses gets caught again",
        },
      ],
      // Best-guess slugs (no in-repo doc-product seed) — unresolved slugs hide
      // silently; Shane confirms against the live catalog.
      docProductSlugs: ["m365-security-assessment-report", "security-remediation-plan"],
    },
  },
  {
    slug: "governance",
    title: "Governance",
    shortLabel: "Governance",
    icon: Shield,
    pillar: "Governance",
    gradientPhrase: "The cleanup invoice does.",
    headlinePrefix: "Sprawl doesn't announce itself. ",
    headlineSuffix: "The cleanup invoice does.",
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
      "SharePoint sprawl that ends as a paid cleanup project — hundreds of orphaned sites nobody can safely delete, scoped in consultant-weeks, because the ownership answers left with the people who had them",
      "Four Teams all named some variant of \"Marketing\" and no way to tell which one is real — misfiled documents, misrouted requests, and a manual rationalization effort that costs more every quarter it's deferred",
      "Microsoft 365 Groups sprawl quietly filling the Global Address List — every dead and duplicate group another chance for a confidential message to reach the wrong audience, until someone budgets a project just to make the address book usable again",
      "An audit stalled for days at \"who has Global Admin, and why\" — billable hours burned reconstructing role assignments that were granted ad hoc across three reorgs and documented nowhere",
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
      "Governance debt doesn't fail all at once — it fails the day someone asks who owns a Team, why a Global Admin role was granted three reorgs ago, or why a configuration change nobody approved has been sitting in production since last quarter. Each of those questions eventually stops being awkward and starts being expensive. These are the bills an ungoverned tenant eventually pays:",
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "A live read of the tenant you actually have — not the one your policy document describes.",
        },
        credibility: {
          pre: "Built by the ",
          gradient: "Microsoft 365 Architect at NASA",
          post: " — practiced daily, not read about.",
        },
        whyItMatters: {
          pre: "Governance debt always gets paid. The only question is on whose schedule.",
        },
        howItWorks: {
          pre: "From read-only connection to accountable baseline — five steps, on a schedule you can see.",
        },
        whatYouGet: {
          pre: "Your governance posture as a live score — not a policy binder nobody reopens.",
        },
        modules: {
          pre: "Four real surfaces. One accountable baseline.",
        },
        docProducts: {
          pre: "Priced in the open: the governance documents this platform actually generates.",
        },
        finalCta: {
          pre: "Your governance baseline is either enforced, or assumed. ",
          gradient: "Find out which — free.",
        },
      },
      // Every metric label below is a real, code-verified metric (lib/dashboard-registry/
      // src/metrics.ts: compliance.orphanedTeamCount, compliance.orphanedSiteCount,
      // governance.overdueAccessReviewCount, governance.orphanedAccessPackageCount) and
      // all four sit on the seeded "Compliance & Governance" customer dashboard tab
      // layout (2026-07-19-customer-dashboard-category-tabs.sql). The trend note
      // reflects the real Drift Engine output shape (score + trendDirection,
      // drift-engine.ts). The counts themselves are illustrative — the panel carries
      // the same "Illustrative Example" badge and caption as Home's Mission Control
      // preview. Deliberately NOT depicted, because no such checks exist in code:
      // guest-expiry metrics, a Global Admin roster widget, per-Team lifecycle
      // compliance percentages.
      dashboard: {
        panelLabel: "Portal preview — Compliance & Governance",
        ringLabel: "Governance pillar",
        // 49 = a compelling "before" state (red tier per PillarScoreRing's
        // scoreTone: 60-84 amber, <60 red) — a real starting point worth
        // improving from, not an already-healthy score. Shared with the main
        // "What You Get" score ring elsewhere on this page (one coherent
        // illustrative scenario).
        ringValue: 49,
        // How It Works Remediate stage's after-remediation value: 85 = the
        // healthy-tier floor (scoreTone ≥85 green), so the before/after reads
        // red 49 → green 85 while staying inside the page's one coherent
        // illustrative scenario. Conceptual mechanism demo under the same
        // badge — not any real customer's improvement.
        remediatedRingValue: 85,
        metrics: [
          { label: "Orphaned Teams", count: 14 },
          { label: "Orphaned SharePoint Sites", count: 23 },
          { label: "Overdue Access Reviews", count: 6 },
          { label: "Orphaned Access Packages", count: 0 },
        ],
        trendNote: "Drift Engine: trend rising since last scheduled evaluation",
        caption: "Example data — not your real score",
        // The 7 real Architecture Health Engine pillar names (health-engine.ts
        // HEALTH_PILLARS + the Security Engine's security pillar; labels match
        // HEALTH_PILLAR_LABELS / MissionControl.tsx PILLAR_LABELS). Values are
        // illustrative, inside the panel's badge; governance deliberately equals
        // the primary ring's value so the breakdown reads as one coherent scenario.
        pillarBreakdown: [
          { label: "Governance", value: 49 },
          { label: "Compliance", value: 32 },
          { label: "Adoption", value: 88 },
          { label: "Copilot Readiness", value: 38 },
          { label: "Architecture", value: 79 },
          { label: "Licensing", value: 91 },
          { label: "Security", value: 58 },
        ],
        // Real Drift Engine output shape (score + trendDirection per scheduled
        // evaluation, drift-engine.ts) — a rising series matching the trendNote
        // language above. Relative-evaluation x labels, no fabricated dates;
        // counts illustrative under the same badge.
        driftTrend: {
          seriesLabel: "Open baseline deviations",
          points: [
            { label: "5 evals ago", value: 3 },
            { label: "4 evals ago", value: 4 },
            { label: "3 evals ago", value: 4 },
            { label: "2 evals ago", value: 6 },
            { label: "1 eval ago", value: 7 },
            { label: "Latest", value: 9 },
          ],
        },
      },
      // The same four real coverage surfaces as `coverage` above, in the site's
      // established icon vocabulary (ClipboardList = policy/ownership and Layers =
      // baseline drift per the quiz pages; Key = privileged access per the legacy
      // governance service page). No values — iconography + real terminology only.
      scanSurfaces: [
        {
          icon: RefreshCw,
          label: "Teams & Group lifecycle",
          sublabel: "Every Team and Microsoft 365 Group, creation to expiry, against your real policy",
        },
        {
          icon: ClipboardList,
          label: "Naming & ownership",
          sublabel: "Naming convention exceptions and groups without a current accountable owner",
        },
        {
          icon: Key,
          label: "Admin role assignments",
          sublabel: "Who actually holds Global Admin and every other privileged role",
        },
        {
          icon: Layers,
          label: "Configuration baseline",
          sublabel: "Your live tenant configuration compared against the last approved state",
        },
      ],
      // Index-aligned with `risks` above — each tag names the real M365 surface
      // that risk describes, icons per the site's vocabulary (Share2 = SharePoint,
      // MessageSquare = Teams, Users = people/groups, Key = privileged access).
      riskDetails: [
        { icon: Share2, tag: "SharePoint sites" },
        { icon: MessageSquare, tag: "Teams naming" },
        { icon: Users, tag: "Microsoft 365 Groups" },
        { icon: Key, tag: "Admin roles" },
      ],
      // The four coverage surfaces on one web — sub-scores are illustrative (no
      // per-surface scoring exists in code; the caption + badge say so) and
      // average to 61, consistent with the dashboard's Governance pillar ring
      // (same relative spread as before the ring was lowered from 74: baseline
      // integrity weakest, admin role hygiene strongest).
      surfaceRadar: {
        axes: [
          { label: "Lifecycle policy", value: 55 },
          { label: "Naming compliance", value: 63 },
          { label: "Baseline integrity", value: 49 },
          { label: "Admin role hygiene", value: 77 },
        ],
        caption: "The four surfaces, scored in relation to each other — example data, not your tenant",
      },
      docProductSlugs: ["governance-maturity-report", "governance-framework-plan"],
    },
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "A live read of the intranet you actually built — sites, permissions, and every break nobody remembers making.",
        },
        credibility: {
          pre: "Site architecture governed daily by the ",
          gradient: "Microsoft 365 Architect at NASA",
          post: " — where sprawl isn't hypothetical.",
        },
        whyItMatters: {
          pre: "Nobody decides to abandon an intranet. It happens one broken permission at a time.",
        },
        howItWorks: {
          pre: "From read-only connection to a mapped architecture — five steps, traced site by site.",
        },
        whatYouGet: {
          pre: "Your architecture as a live score — not a site map from three reorgs ago.",
        },
        modules: {
          pre: "Four real surfaces. One architecture you can actually defend.",
        },
        docProducts: {
          pre: "Priced in the open: the SharePoint documents this platform actually generates.",
        },
        finalCta: {
          pre: "Your intranet is either governed, or quietly abandoned. ",
          gradient: "Find out which — free.",
        },
      },
      // Real registry metrics (metrics.ts: compliance.orphanedSiteCount +
      // compliance.oversharedSiteCount [Compliance & Governance tab],
      // drift.sharePointAdminDriftCount [Configuration Drift tab],
      // compliance.labelErrorCount [metadata governance]) — counts illustrative
      // under the badge; Sensitivity Label Errors 0 = the healthy empty track.
      dashboard: {
        panelLabel: "Portal preview — SharePoint architecture",
        ringLabel: "Architecture pillar",
        // 63 = amber tier — an intranet drifting, not yet abandoned; equals this
        // page's own pillarBreakdown Architecture entry (pillar-consistency rule).
        ringValue: 63,
        remediatedRingValue: 90,
        metrics: [
          { label: "Orphaned SharePoint Sites", count: 31 },
          { label: "Overshared Sites", count: 12 },
          { label: "SharePoint Admin Drift", count: 4 },
          { label: "Sensitivity Label Errors", count: 0 },
        ],
        trendNote: "Drift Engine: configuration deltas accumulating across site collections since the approved architecture",
        caption: "Example data — not your real score",
        // Coherent scenario: Adoption 52 is the page's own headline risk (the
        // intranet nobody opens), dragging with the 63 Architecture ring.
        pillarBreakdown: [
          { label: "Governance", value: 58 },
          { label: "Compliance", value: 71 },
          { label: "Adoption", value: 52 },
          { label: "Copilot Readiness", value: 66 },
          { label: "Architecture", value: 63 },
          { label: "Licensing", value: 90 },
          { label: "Security", value: 74 },
        ],
        // This page's relatedEngine IS the Drift Engine ("tracks configuration
        // baseline deltas across SharePoint site collections"), so the default
        // "Drift Engine — scheduled evaluations" panel heading is the honest one
        // here — no panelHeading override. Rising series matches the trendNote.
        driftTrend: {
          seriesLabel: "Open configuration deltas",
          points: [
            { label: "5 evals ago", value: 2 },
            { label: "4 evals ago", value: 3 },
            { label: "3 evals ago", value: 5 },
            { label: "2 evals ago", value: 5 },
            { label: "1 eval ago", value: 7 },
            { label: "Latest", value: 8 },
          ],
        },
      },
      // The same four real coverage surfaces as `coverage` above (Layers = site/
      // hub structure, Key = permission inheritance, Tag = content types &
      // metadata, Search = findability — established site vocabulary).
      scanSurfaces: [
        {
          icon: Layers,
          label: "Site & hub architecture",
          sublabel: "Every site and hub, checked against how people actually use them",
        },
        {
          icon: Key,
          label: "Permission inheritance",
          sublabel: "Every inheritance break and unique-permission site, traced to its origin",
        },
        {
          icon: Tag,
          label: "Content types & metadata",
          sublabel: "Classification and metadata governance, checked for consistency",
        },
        {
          icon: Search,
          label: "Search & findability",
          sublabel: "The configuration that decides whether anyone finds anything",
        },
      ],
      // Index-aligned with `risks` above (2 risks on this page).
      riskDetails: [
        { icon: BarChart3, tag: "Intranet adoption" },
        { icon: Key, tag: "Permission inheritance" },
      ],
      // Axes 1:1 with coverage; illustrative sub-scores average 63 = the ring
      // (permission model weakest, findability strongest).
      surfaceRadar: {
        axes: [
          { label: "Site architecture", value: 60 },
          { label: "Permission model", value: 55 },
          { label: "Metadata governance", value: 66 },
          { label: "Findability", value: 71 },
        ],
        caption: "The four surfaces, scored in relation to each other — example data, not your tenant",
      },
      // Connect matches this page's own Connect step (same claims as the
      // defaults); Findings drops the scheduled-evaluation phrase its copy never
      // makes; Remediate names the Drift Engine per its own Remediate step.
      showcaseStages: [
        { kind: "connect" },
        { kind: "scan" },
        { kind: "findings", note: "findings logged from the live Graph scan — each one inspectable" },
        { kind: "score" },
        {
          kind: "remediate",
          note: "Drift Engine keeps tracking the same architecture as it moves",
        },
      ],
      // Best-guess slugs (no in-repo doc-product seed) — unresolved slugs hide
      // silently; Shane confirms against the live catalog.
      docProductSlugs: ["sharepoint-architecture-report", "sharepoint-governance-plan"],
    },
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "Every maker in your tenant can already touch production data. This maps what they've built.",
        },
        credibility: {
          pre: "Environment strategy and DLP governed daily inside ",
          gradient: "NASA's own tenant",
          post: " — real makers, real apps.",
        },
        whyItMatters: {
          pre: "The audit question isn't whether citizen developers built something. It's whether anyone can say what.",
        },
        howItWorks: {
          pre: "From read-only connection to a governed platform — five steps, environment by environment.",
        },
        whatYouGet: {
          pre: "Your Power Platform estate as a live score — every app, flow, and connector accounted for.",
        },
        modules: {
          pre: "Four real surfaces. One inventory nobody has to reconstruct for an audit.",
        },
        docProducts: {
          pre: "Priced in the open: the Power Platform documents this platform actually generates.",
        },
        finalCta: {
          pre: "Power Platform is scaling in your tenant either way. ",
          gradient: "Govern it first — free.",
        },
      },
      // Real registry metrics themed to this page's own claims (metrics.ts:
      // compliance.weakDlpPolicyCount + compliance.dlpIncidentCount [Compliance
      // & Governance tab — the DLP-coverage claim], licensing.inactiveLicenseCount
      // [Licensing & Cost tab — the licensing-exposure claim]). Three rows, not
      // four — the registry has no orphaned-app/flow-ownership count, and the
      // rule is a proportionally simpler panel over an invented metric.
      dashboard: {
        panelLabel: "Portal preview — Power Platform governance",
        ringLabel: "Architecture pillar",
        // 57 = red tier — ungoverned-sprawl before-state; equals this page's own
        // pillarBreakdown Architecture entry (pillar-consistency rule).
        ringValue: 57,
        remediatedRingValue: 85,
        metrics: [
          { label: "Weak DLP Policies", count: 4 },
          { label: "DLP Incidents", count: 9 },
          { label: "Inactive Licenses", count: 6 },
        ],
        trendNote: "Health Engine: tenant risk re-scored on each scheduled evaluation",
        caption: "Example data — not your real score",
        // Coherent scenario: Adoption 91 — makers move fast — against a 57
        // Architecture and 55 Compliance; high adoption with weak governance IS
        // this page's story.
        pillarBreakdown: [
          { label: "Governance", value: 61 },
          { label: "Compliance", value: 55 },
          { label: "Adoption", value: 91 },
          { label: "Copilot Readiness", value: 72 },
          { label: "Architecture", value: 57 },
          { label: "Licensing", value: 64 },
          { label: "Security", value: 68 },
        ],
        // No driftTrend: this page's engine is the Health Engine (risk scored on
        // evaluation), and its What-It-Does prose claims an inventory read, not a
        // drift/cadence mechanism — the strip carries the enumeration instead.
      },
      // The same four real coverage surfaces as `coverage` above (Layers =
      // environments, ShieldCheck = DLP, Users = ownership, Zap = connectors —
      // established site vocabulary).
      scanSurfaces: [
        {
          icon: Layers,
          label: "Environments",
          sublabel: "Default-environment sprawl versus a real ALM model",
        },
        {
          icon: ShieldCheck,
          label: "DLP policies",
          sublabel: "Which connectors each policy actually covers — and which it doesn't",
        },
        {
          icon: Users,
          label: "App & flow ownership",
          sublabel: "What's running, who owns it, and what happens when the maker leaves",
        },
        {
          icon: Zap,
          label: "Premium connectors",
          sublabel: "What's already in use, and what it's costing you",
        },
      ],
      // Index-aligned with `risks` above (2 risks on this page).
      riskDetails: [
        { icon: ShieldCheck, tag: "Connectors & DLP" },
        { icon: Layers, tag: "Default environment" },
      ],
      // Axes 1:1 with coverage; illustrative sub-scores average 57 = the ring
      // (DLP coverage weakest — the incident risk above; licensing least broken).
      surfaceRadar: {
        axes: [
          { label: "Environment strategy", value: 51 },
          { label: "DLP coverage", value: 49 },
          { label: "Ownership", value: 60 },
          { label: "Licensing exposure", value: 68 },
        ],
        caption: "The four surfaces, scored in relation to each other — example data, not your tenant",
      },
      // Connect names this page's REAL connection surface (Power Platform admin
      // + Microsoft Graph, per its own Connect step); Remediate cites its own
      // next-scheduled-evaluation recheck, not the Drift Engine.
      showcaseStages: [
        { kind: "connect", viaLabel: "Power Platform admin + Graph" },
        { kind: "scan" },
        { kind: "findings", note: "findings logged from the live scan — each one inspectable" },
        { kind: "score" },
        {
          kind: "remediate",
          note: "The same scan runs again on your next scheduled evaluation to confirm it stayed fixed",
        },
      ],
      // Best-guess slugs (no in-repo doc-product seed) — unresolved slugs hide
      // silently; Shane confirms against the live catalog.
      docProductSlugs: ["power-platform-governance-report", "power-platform-governance-plan"],
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "Usage dashboards count messages. This reads the structure underneath them.",
        },
        credibility: {
          pre: "Lifecycle and guest-access discipline practiced daily on ",
          gradient: "NASA's own Teams environment",
          post: ".",
        },
        whyItMatters: {
          pre: "The two failure modes that matter never show up in an adoption dashboard.",
        },
        howItWorks: {
          pre: "From read-only connection to a governed rollout — five steps, team by team.",
        },
        whatYouGet: {
          pre: "Your Teams governance as a live score — abandoned teams, standing guests, and sprawl included.",
        },
        modules: {
          pre: "Four real surfaces. One structure that survives its own adoption.",
        },
        docProducts: {
          pre: "Priced in the open: the Teams documents this platform actually generates.",
        },
        finalCta: {
          pre: "High adoption isn't governance. ",
          gradient: "See the difference — free.",
        },
      },
      // Real registry metrics themed to this page's own coverage (metrics.ts:
      // compliance.orphanedTeamCount + compliance.publicChannelCount [Compliance
      // & Governance tab], drift.teamsPolicyDriftCount [Configuration Drift tab],
      // governance.workflowFailureCount [lifecycle workflows]). Counts
      // illustrative under the badge; Lifecycle Workflow Failures 0 = the
      // healthy empty track.
      dashboard: {
        panelLabel: "Portal preview — Teams governance",
        ringLabel: "Governance pillar",
        // 66 = amber tier — structure drifting behind healthy usage; equals this
        // page's own pillarBreakdown Governance entry (pillar-consistency rule).
        ringValue: 66,
        remediatedRingValue: 89,
        metrics: [
          { label: "Orphaned Teams", count: 11 },
          { label: "Public Channels", count: 6 },
          { label: "Teams Policy Drift", count: 3 },
          { label: "Lifecycle Workflow Failures", count: 0 },
        ],
        trendNote: "Health Engine: adoption and structural signals correlated on each evaluation",
        caption: "Example data — not your real score",
        // THE Teams scenario, in one breakdown: Adoption 92 (usage numbers look
        // great) against Governance 66 and Security 63 (standing guest access) —
        // exactly the page's "healthy metrics, chaotic structure" risk.
        pillarBreakdown: [
          { label: "Governance", value: 66 },
          { label: "Compliance", value: 70 },
          { label: "Adoption", value: 92 },
          { label: "Copilot Readiness", value: 75 },
          { label: "Architecture", value: 78 },
          { label: "Licensing", value: 85 },
          { label: "Security", value: 63 },
        ],
        // No driftTrend: this page's engine is the Health Engine (composite
        // correlation), and its What-It-Does prose claims a structural read a
        // usage dashboard can't make — not a drift/cadence mechanism.
      },
      // The same four real coverage surfaces as `coverage` above (RefreshCw =
      // lifecycle, Users = external guests, MessageSquare = channels, Phone =
      // meeting/calling policy — established site vocabulary).
      scanSurfaces: [
        {
          icon: RefreshCw,
          label: "Team lifecycle",
          sublabel: "Creation, naming, approval, and archival — every team against your real policy",
        },
        {
          icon: Users,
          label: "External guest access",
          sublabel: "Guest membership across active and dormant teams, reviewed instead of assumed",
        },
        {
          icon: MessageSquare,
          label: "Channel & app sprawl",
          sublabel: "Where channels and apps have outgrown actual adoption",
        },
        {
          icon: Phone,
          label: "Meeting & calling policy",
          sublabel: "Policy assignment checked against how your organization actually works",
        },
      ],
      // Index-aligned with `risks` above (2 risks on this page).
      riskDetails: [
        { icon: Users, tag: "External guests" },
        { icon: BarChart3, tag: "Adoption metrics" },
      ],
      // Axes 1:1 with coverage; illustrative sub-scores average 66 = the ring
      // (guest access weakest — the standing-access risk; policy alignment
      // strongest).
      surfaceRadar: {
        axes: [
          { label: "Lifecycle", value: 60 },
          { label: "Guest access", value: 58 },
          { label: "Channel & app sprawl", value: 71 },
          { label: "Policy alignment", value: 75 },
        ],
        caption: "The four surfaces, scored in relation to each other — example data, not your tenant",
      },
      // Connect matches this page's own Connect step; Findings drops the
      // scheduled-evaluation phrase its copy never makes; Remediate names the
      // Health Engine per its own Remediate step.
      showcaseStages: [
        { kind: "connect" },
        { kind: "scan" },
        { kind: "findings", note: "findings logged from the live Graph scan — each one inspectable" },
        { kind: "score" },
        {
          kind: "remediate",
          note: "Health Engine keeps re-checking the same surface after you fix it",
        },
      ],
      // Best-guess slugs (no in-repo doc-product seed) — unresolved slugs hide
      // silently; Shane confirms against the live catalog.
      docProductSlugs: ["teams-governance-report", "teams-governance-plan"],
    },
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
      "I design and execute Microsoft 365 tenant migrations as the M365 Architect at NASA — the same discovery-first, rollback-planned discipline required when a migration touches a mission-critical tenant is what's engineered into this platform. This platform doesn't extend any federal compliance posture to your migration — that's not what it's built to do — but the same rigor that prevents a bad cutover at NASA is what prevents one in yours.",
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "Discovery first, architecture locked, rollback planned — before a single object moves.",
        },
        credibility: {
          pre: "Cutover discipline from tenant migrations at ",
          gradient: "NASA",
          post: " — where a bad one isn't an option.",
        },
        whyItMatters: {
          pre: "Migrations don't fail on day one. They fail three weeks in, when the real scope surfaces.",
        },
        howItWorks: {
          pre: "From source discovery to validated cutover — five gates, each one earning the next.",
        },
        whatYouGet: {
          pre: "Deliverables you can hold the migration to — scope, architecture, rollback, validation.",
        },
        modules: {
          pre: "Four real components. Each one gates the next.",
        },
        docProducts: {
          pre: "Priced in the open: the migration documents this platform actually generates.",
        },
        finalCta: {
          pre: "Every migration has a real scope. ",
          gradient: "Find yours before cutover — free.",
        },
      },
      // Real registry metrics reframed as what discovery actually surfaces
      // pre-cutover (metrics.ts: identity.staleAccountCount [Identity & Access
      // tab — the legacy directory objects a move must exclude or carry],
      // collaboration.forwardingMailboxCount + collaboration.
      // sharedMailboxSigninEnabledCount [Collaboration & Sharing tab — classic
      // cutover blockers]). Three rows — the registry has no migration-specific
      // counts, and the rule is a proportionally simpler panel over invented
      // "wave/readiness" numbers. Counts illustrative under the badge.
      dashboard: {
        panelLabel: "Portal preview — Architecture health",
        ringLabel: "Architecture pillar",
        // 58 = red tier — the source environment before consolidation; equals
        // this page's own pillarBreakdown Architecture entry (pillar-consistency
        // rule). The Validate gate's after-value (87) depicts the mechanism —
        // a locked, validated target architecture — under the same badge.
        ringValue: 58,
        remediatedRingValue: 87,
        metrics: [
          { label: "Stale Accounts", count: 41 },
          { label: "External Auto-Forwarding Mailboxes", count: 5 },
          { label: "Shared Mailboxes with Sign-in Enabled", count: 8 },
        ],
        trendNote: "Scope Creep Engine: live work checked against the signed SOW at each scheduled review",
        caption: "Example data — not your real environment",
        // A plausible pre-consolidation source tenant: nothing catastrophic,
        // everything mediocre — the "moving target" a locked design fixes.
        pillarBreakdown: [
          { label: "Governance", value: 62 },
          { label: "Compliance", value: 66 },
          { label: "Adoption", value: 71 },
          { label: "Copilot Readiness", value: 54 },
          { label: "Architecture", value: 58 },
          { label: "Licensing", value: 60 },
          { label: "Security", value: 65 },
        ],
        // No driftTrend/licenseScatter: Migration is a gated engagement, not a
        // recurring-scan product — its What-It-Does prose claims discovery and
        // locked design, so the strip below it carries the enumeration alone.
      },
      // What discovery actually reads in the source environment (coverage[0]'s
      // real enumeration: mailboxes, file shares, legacy directory objects,
      // plus the live tenant configuration the target is designed from). Mail/
      // FolderOpen/Server/Building2 are established site vocabulary.
      scanSurfaces: [
        {
          icon: Mail,
          label: "Mailboxes",
          sublabel: "Every mailbox in the source environment, captured before planning starts",
        },
        {
          icon: FolderOpen,
          label: "File shares",
          sublabel: "Legacy file shares mapped for what actually has to move",
        },
        {
          icon: Server,
          label: "Legacy directory objects",
          sublabel: "The accounts, groups, and artifacts a from-memory spreadsheet always misses",
        },
        {
          icon: Building2,
          label: "Tenant configuration",
          sublabel: "The source tenant's real current state — the baseline the target is designed from",
        },
      ],
      // Index-aligned with `risks` above (2 risks on this page).
      riskDetails: [
        { icon: ClipboardList, tag: "Migration scope" },
        { icon: RotateCcw, tag: "Cutover & rollback" },
      ],
      // No surfaceRadar: this page's modules are SEQUENTIAL gates ("each one
      // gating the next"), not parallel dimensions scored in relation — a radar
      // would misrepresent the claim, so the checklist stands alone.
      // Migration's five REAL gates (Discover/Design/Plan the cutover/Execute/
      // Validate) are an engagement sequence, not the scan-product loop — each
      // stage visual is remapped to depict ITS OWN gate honestly:
      //  1 Discover  → the scan grammar reading the four discovery surfaces
      //  2 Design    → the A→B grammar: source inventory → locked architecture
      //  3 Plan      → the findings bars as discovery-surfaced cutover blockers
      //  4 Execute   → the A→B grammar again: source tenant → target tenant
      //  5 Validate  → the before/after rings, attributed to scope validation
      showcaseStages: [
        {
          kind: "scan",
          verb: "Discovering",
          completeText: "Source environment inventoried — before any plan is drafted",
        },
        {
          kind: "connect",
          fromLabel: "Source inventory",
          viaLabel: "Target design",
          toLabel: "Locked architecture",
          checklist: ["Tenant structure", "Identity model", "Licensing model", "Locked before a single object moves"],
        },
        {
          kind: "findings",
          panelLabel: "Discovery findings — cutover blockers",
          note: "pre-cutover blockers identified — each one sequenced into the plan with a rollback path",
        },
        {
          kind: "connect",
          fromLabel: "Source tenant",
          viaLabel: "Locked migration plan",
          toLabel: "Target tenant",
          checklist: ["Tenant-to-tenant transfer", "Domain consolidation", "Identity alignment", "Executed against the locked plan"],
        },
        {
          kind: "remediate",
          headline: "Validated against the original scope",
          note: "Scope Creep Engine checks the result against the signed SOW — drift is a flagged violation, not a surprise invoice",
          afterLabel: "After cutover",
        },
      ],
      // Best-guess slugs (no in-repo doc-product seed) — unresolved slugs hide
      // silently; Shane confirms against the live catalog.
      docProductSlugs: ["migration-readiness-report", "migration-cutover-plan"],
    },
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
        title: "Findings",
        description: "Each pillar's findings are logged as real, inspectable findings and checked against each other across pillars — so a licensing anomaly and a service health flag that share the same root cause don't show up as two unrelated alerts.",
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
    flagship: {
      headings: {
        whatItDoes: {
          pre: "Seven pillar scans. One number. Nothing left for a user complaint to find first.",
        },
        credibility: {
          pre: "The same seven pillars answered for daily at ",
          gradient: "NASA",
          post: " — at tenant scale.",
        },
        whyItMatters: {
          pre: "Tenants don't degrade everywhere at once. They degrade wherever nobody's watching.",
        },
        howItWorks: {
          pre: "From read-only connection to one trustworthy number — five steps across seven pillars.",
        },
        whatYouGet: {
          pre: "Your whole tenant as one live score — with waste tracked where it can't hide.",
        },
        modules: {
          pre: "Four real signals. One composite score.",
        },
        docProducts: {
          pre: "Priced in the open: the tenant health documents this platform actually generates.",
        },
        finalCta: {
          pre: "Your tenant already has a health score. ",
          gradient: "See it before a user does — free.",
        },
      },
      // Cross-pillar registry metrics — the composite page's whole point
      // (metrics.ts: licensing.inactiveLicenseCount + licensing.
      // duplicateLicenseCount [Licensing & Cost tab — the waste claim],
      // security.highSeverityAlertCount [Security Posture tab],
      // governance.overdueAccessReviewCount [Compliance & Governance tab]).
      // Counts illustrative under the badge. "Executive" is the REAL seeded
      // customer dashboard tab for overall posture + pillar scores
      // (2026-07-19-customer-dashboard-category-tabs.sql).
      dashboard: {
        panelLabel: "Portal preview — Executive",
        ringLabel: "Composite health score",
        // 61 = amber tier, and exactly the mean of the seven pillarBreakdown
        // values below — the composite IS its pillars, so the panel's internal
        // math holds together (pillar-consistency rule, composite form).
        ringValue: 61,
        remediatedRingValue: 86,
        metrics: [
          { label: "Inactive Licenses", count: 46 },
          { label: "Duplicate Licenses", count: 12 },
          { label: "High-Severity Alerts", count: 2 },
          { label: "Overdue Access Reviews", count: 5 },
        ],
        trendNote: "Health Engine: all seven pillars refreshed on your configured check cadence",
        caption: "Example data — not your real score",
        // Seven values averaging exactly 61: the composite's story is the
        // SPREAD — Compliance 48 and Copilot Readiness 44 dragging an otherwise
        // decent tenant, which is precisely what one number surfaces.
        pillarBreakdown: [
          { label: "Governance", value: 55 },
          { label: "Compliance", value: 48 },
          { label: "Adoption", value: 79 },
          { label: "Copilot Readiness", value: 44 },
          { label: "Architecture", value: 68 },
          { label: "Licensing", value: 58 },
          { label: "Security", value: 75 },
        ],
        // The What-It-Does prose's own two-measure claim ("tracks license
        // utilization and waste separately from the health score") as a scatter:
        // real M365 SKU names (licensing.skuBreakdown / wasteEstimateBreakdown /
        // copilotLicenseBreakdown are the real registry concepts), illustrative
        // seat values under the badge, waste = the gap below the x=y diagonal.
        // "Licensing & Cost" is the real seeded tab for these widgets.
        licenseScatter: {
          panelHeading: "Licensing & Cost — assigned vs. actively used",
          xLabel: "Seats assigned",
          yLabel: "Seats active",
          points: [
            { label: "Microsoft 365 E5", x: 120, y: 68 },
            { label: "Microsoft 365 E3", x: 260, y: 214 },
            { label: "Business Premium", x: 40, y: 37 },
            { label: "Microsoft 365 Copilot", x: 60, y: 22 },
            { label: "Power BI Pro", x: 85, y: 41 },
          ],
          caption: "Waste is the gap below the line — tracked separately, so it can't hide inside a good score. Example data",
        },
      },
      // The four real signals from `coverage` above (Activity = the composite
      // scan, DollarSign = licensing, Server = service health, Bot = runbooks —
      // established site vocabulary). The runbook sublabel carries this page's
      // real write-back caveat verbatim in spirit — never dropped.
      scanSurfaces: [
        {
          icon: Activity,
          label: "All seven pillar scans",
          sublabel: "Governance, compliance, adoption, Copilot readiness, architecture, licensing, security — one pass",
        },
        {
          icon: DollarSign,
          label: "License utilization",
          sublabel: "Waste tracked separately from the health score, so it can't hide inside a good number",
        },
        {
          icon: Server,
          label: "Service health anomalies",
          sublabel: "Correlated across pillars instead of surfacing as isolated alerts",
        },
        {
          icon: Bot,
          label: "Remediation runbooks",
          sublabel: "Write-back against qualifying findings — where configured and enabled for your tenant",
        },
      ],
      // Index-aligned with `risks` above (2 risks on this page).
      riskDetails: [
        { icon: Activity, tag: "Tenant health" },
        { icon: DollarSign, tag: "License spend" },
      ],
      // No surfaceRadar: the score card beside "What You Get" already carries
      // the real 7-pillar ring grid — a second 7-axis radar would duplicate it,
      // so the modules checklist stands alone at prose width.
      // Connect matches this page's own Connect step; the Scan stage's rotating
      // rows are the SEVEN REAL PILLARS (its Scan step's literal claim: "runs
      // each pillar's real scan"), not the strip's four signals — runbooks
      // aren't scanned; Findings carries its cross-pillar-correlation claim;
      // Remediate keeps the write-back caveat exactly as scoped in its own step.
      showcaseStages: [
        { kind: "connect" },
        {
          kind: "scan",
          surfaces: [
            { icon: Shield, label: "Governance" },
            { icon: ClipboardList, label: "Compliance" },
            { icon: TrendingUp, label: "Adoption" },
            { icon: Brain, label: "Copilot readiness" },
            { icon: Layers, label: "Architecture" },
            { icon: DollarSign, label: "Licensing" },
            { icon: Lock, label: "Security" },
          ],
          completeText: "All seven pillar scans complete — findings logged",
        },
        {
          kind: "findings",
          note: "findings logged and correlated across pillars — shared root causes surface once, not twice",
        },
        { kind: "score" },
        {
          kind: "remediate",
          headline: "Ranked fixes — runbooks where enabled",
          note: "Write-back remediation runs only where configured and enabled for your tenant; everything else comes back as a ranked, specific fix",
        },
      ],
      // Best-guess slugs (no in-repo doc-product seed) — unresolved slugs hide
      // silently; Shane confirms against the live catalog.
      docProductSlugs: ["m365-health-report", "m365-tenant-roadmap-plan"],
    },
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

/**
 * `engagement_projects.triggeredBy` real signal-key domain prefix → topic slug
 * (Real Projects + Assessments CTAs on Topic Pages task). Signal keys use the
 * `signal.<domain>.<name>` convention (verified against `signal_derivation_rules`);
 * the domain segment is what a Solutions/Topic page owns. Quiz-derived
 * migration-readiness triggers use a separate `trigger.quiz.*` /
 * `trigger.purchase-timing.*` convention (no domain segment) and map directly to
 * Migration. Deliberately no entry for "power-platform" or a plain "migration"
 * domain — real, by design: those topics show zero follow-on projects until a
 * project is tagged with a matching signal domain, per this task's explicit rule
 * that an unmatched topic hides its Projects section entirely rather than showing
 * an empty state.
 */
export const SIGNAL_DOMAIN_TO_TOPIC_SLUG: Record<string, string> = {
  copilot: "copilot",
  sharepoint: "sharepoint",
  teams: "teams",
  governance: "governance",
  security: "security-compliance",
  compliance: "security-compliance",
};

/** Topic slugs a follow-on project's real `triggeredBy` signal keys resolve to. */
export function topicSlugsForProjectTriggers(triggeredBy: string[]): Set<string> {
  const slugs = new Set<string>();
  for (const key of triggeredBy) {
    if (key.startsWith("trigger.quiz.") || key.startsWith("trigger.purchase-timing.")) {
      slugs.add("migration");
      continue;
    }
    if (key.startsWith("signal.")) {
      const domain = key.split(".")[1];
      const slug = domain ? SIGNAL_DOMAIN_TO_TOPIC_SLUG[domain] : undefined;
      if (slug) slugs.add(slug);
    }
  }
  return slugs;
}

export function projectMatchesTopic(triggeredBy: string[], topicSlug: string): boolean {
  return topicSlugsForProjectTriggers(triggeredBy).has(topicSlug);
}

export function findTopicByText(text: string): SolutionTopic | undefined {
  return SOLUTIONS_TOPICS.find((t) => topicMatchesKeywordText(t.slug, text));
}
