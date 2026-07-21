import { useState } from "react";
import { Layout } from "@/components/Layout";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import {
  CheckCircle, FolderOpen, Building2, ShieldCheck, FileText,
  Users, BarChart3, AlertTriangle, Globe, Lock, Database,
  Target, Award, ArrowRight, RefreshCw, Layers, Download,
  TrendingUp, Star,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const config: QuizConfig = {
  quizType: "sharepoint",
  title: "SharePoint Architecture Assessment",
  introTitle: "How Well-Architected Is Your SharePoint Environment?",
  introDescription:
    "Answer 10 AI-powered questions across 5 architecture dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.",
  categories: [
    { key: "infoArchitecture", label: "Information Architecture" },
    { key: "searchMetadata", label: "Search & Metadata" },
    { key: "contentLifecycle", label: "Content Lifecycle" },
    { key: "governanceGaps", label: "Governance Gaps" },
    { key: "migrationReadiness", label: "Migration Readiness" },
  ],
  fallbackQuestions: [
    "How is your SharePoint environment currently structured — for example, do you use a hub site model with associated team/communication sites, or has it grown organically without a deliberate hierarchy?",
    "How many SharePoint site collections or team sites do you have, and do you have a documented naming convention and provisioning process for creating new sites?",
    "How are permissions managed across your SharePoint environment? Are they primarily inherited from parent sites, or are there many unique item-level and folder-level permissions that have accumulated over time?",
    "Do you have lifecycle policies in place for SharePoint sites — for example, automatic expiry, ownership reviews, or archiving processes for inactive sites and teams?",
    "How would users in your organisation rate the findability of content in SharePoint? Can staff reliably find documents they need using search, or do they rely on direct links and shared drives?",
    "Are your SharePoint search results relevant and well-structured? Have you configured managed properties, result sources, or promoted results to surface key content?",
    "What happens to content in SharePoint when an employee leaves the organisation or a project ends? Is there a documented process for content retention, archival, or deletion?",
    "Do you use SharePoint metadata (columns, content types) consistently across your sites to classify and filter documents, or is organisation primarily managed through folder structures?",
    "Which teams or departments in your organisation are actively using SharePoint as their primary document management and collaboration platform, and which ones have avoided adoption?",
    "Have you deployed any SharePoint training or adoption campaigns for staff — for example, intranet guides, champions programmes, or department-specific enablement sessions?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here",
      name: "M365 Tenant Health Audit",
      description:
        "Before SharePoint architecture can be improved, your tenant foundation needs to be solid. A comprehensive audit identifies the licensing, governance, and configuration issues that will undermine any SharePoint redesign.",
      slug: "m365-tenant-health-audit",
      ctaText: "Fix the Foundation First",
    },
    Developing: {
      badge: "Recommended",
      name: "Governance Foundations Package",
      description:
        "Your SharePoint environment needs a structured governance framework before it can scale. This engagement designs and implements naming conventions, lifecycle policies, and permission models that bring order to your environment.",
      slug: "governance-foundations-package",
      ctaText: "Build Your Governance Framework",
    },
    Emerging: {
      badge: "Next Step",
      name: "Governance Foundations Package",
      description:
        "You have the basics, but gaps in governance and lifecycle management are creating technical debt. Formalise your SharePoint governance before the complexity compounds further.",
      slug: "governance-foundations-package",
      ctaText: "Formalise Your Governance",
    },
    Advanced: {
      badge: "High Impact",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your SharePoint environment is well-structured. With clean information architecture and good governance in place, you're in a strong position to evaluate Copilot — which relies heavily on well-organised SharePoint content.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Assess Copilot Readiness",
    },
    Ready: {
      badge: "Enterprise Grade",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your SharePoint architecture is excellent. Copilot will be most effective when it has clean, well-governed content to work with — which you have. Validate your full M365 readiness and deploy Copilot confidently.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Deploy Copilot on Strong Foundations",
    },
  },
  reportTitle: "SharePoint Architecture Assessment Report",
  pdfFilename: "sharepoint-assessment-report.pdf",
  introFeatureLabels: ["5 architecture dimensions", "Maturity tier rating", "PDF report emailed"],
};

const DIMENSIONS = [
  {
    colour: "bg-blue-500",
    label: "Dimension 1",
    title: "Information Architecture",
    bullets: [
      "Hub site model adoption and associated site hierarchy design quality.",
      "Naming conventions for sites, libraries, and folders — enforced or ad hoc.",
      "Intentional IA design versus organic ungoverned growth over time.",
      "Navigation structure consistency across departments and divisions.",
      "Site provisioning process maturity and governance controls at creation.",
    ],
  },
  {
    colour: "bg-teal-500",
    label: "Dimension 2",
    title: "Search & Metadata",
    bullets: [
      "Content findability — can staff reliably locate documents using search?",
      "Managed properties, result sources, and promoted results configuration.",
      "Metadata and content type adoption across libraries and sites.",
      "Folder-based versus metadata-based document organisation maturity.",
      "Search relevance tuning and query rules for high-priority content types.",
    ],
  },
  {
    colour: "bg-violet-500",
    label: "Dimension 3",
    title: "Content Lifecycle",
    bullets: [
      "Site expiry policies and ownership accountability documentation.",
      "Lifecycle processes for active and inactive sites — reviews, archiving, deletion.",
      "Employee offboarding content handling and ownership transfer procedures.",
      "Retention and archiving processes aligned to regulatory obligations.",
      "Provisioning guardrails that enforce lifecycle expectations at site creation.",
    ],
  },
  {
    colour: "bg-orange-500",
    label: "Dimension 4",
    title: "Governance & Permissions",
    bullets: [
      "Inherited versus unique item- and folder-level permission sprawl.",
      "RBAC model maturity and group-based access design consistency.",
      "External sharing posture and guest access controls and review cadence.",
      "Oversharing risk and sensitive content exposure to unintended audiences.",
      "Sensitivity label adoption and enforcement across SharePoint workloads.",
    ],
  },
  {
    colour: "bg-green-500",
    label: "Dimension 5",
    title: "Copilot & Migration Readiness",
    bullets: [
      "SharePoint as a Copilot knowledge source — content quality and governance.",
      "Teams and SharePoint integration alignment and architectural consistency.",
      "Compliance and data residency posture for AI and regulated workloads.",
      "Power Platform and third-party connector dependencies and documentation.",
      "Architecture gaps that would block safe Copilot deployment or migration.",
    ],
  },
];

export default function SharePointQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <SEOMeta
        title="SharePoint Architecture & IA Assessment | Free Quiz | Shane McCaw Consulting"
        description="How well-architected is your SharePoint environment? Answer 10 expert questions across 5 dimensions and receive a personalised maturity report from the Lead M365 Architect at NASA."
        ogImage="/og-image-sharepoint-quiz.png"
        ogUrl="https://shanemccaw.com/sharepoint-readiness-quiz"
      />

      {/* ── 1. Hero ── */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <FolderOpen className="w-4 h-4" />
            SharePoint Architecture Assessment
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Your SharePoint Is <GradientText>Growing.</GradientText>
            <br className="hidden md:block" /> Is It Architected?
          </h1>

          <p className="text-text-secondary text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            SharePoint environments almost always start with good intentions and end with thousands of ungoverned sites, redundant libraries, broken permissions, and content nobody can find. Sprawl accumulates silently until it becomes a compliance crisis or a migration blocker.
          </p>
          <p className="text-text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question assessment — built on the same diagnostic framework Shane applies as Lead M365 Architect at NASA — identifies exactly where your SharePoint environment stands across five architecture dimensions before Copilot, migration, or governance work begins.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "architecture dimensions" },
              { value: "Free", label: "personalised PDF report" },
            ].map((stat) => (
              <StatPanel key={stat.label} label={stat.label} value={stat.value} className="min-w-[170px] text-left" />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
            <button
              onClick={() => setModalOpen(true)}
              data-track="cta"
              className="group inline-flex items-center gap-3 text-white font-semibold text-lg px-8 py-4 rounded-xl transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
            >
              Take the Free Assessment
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <a
              href="/book"
              data-track="cta"
              className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary font-semibold text-sm border border-glass-border px-6 py-4 rounded-xl hover:border-white/40 transition-colors"
            >
              Book a Discovery Call
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-6">
            {["5 minutes", "Free PDF report", "No account required", "No sales call"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-text-tertiary text-sm">
                <CheckCircle className="w-4 h-4 text-accent-blue" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. Why This Assessment Exists ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">Why This Assessment Exists</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            Most SharePoint environments are architecturally broken — and admins can't see it.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            SharePoint admin tools show you what exists — not whether it's well-architected. Permission sprawl, broken lifecycle policies, and information architecture antipatterns are invisible in the admin centre. They surface only when a Copilot deployment surfaces the wrong data or a migration reveals what was hiding in the file shares.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: AlertTriangle,
                title: "Organic sprawl is the default outcome without intentional architecture",
                body: "SharePoint environments almost always start with good intentions and end with thousands of ungoverned sites, redundant libraries, and abandoned team sites no one owns. Sprawl accumulates silently over years — until it becomes a compliance or migration crisis.",
              },
              {
                icon: Database,
                title: "ROT content destroys findability and trust in the platform",
                body: "Redundant, Outdated, and Trivial content is the silent productivity killer. When staff cannot trust search results, they stop using SharePoint — defaulting to email attachments, shared drives, and tribal knowledge that never gets captured.",
              },
              {
                icon: Target,
                title: "Poor information architecture blocks Copilot, Teams, and compliance",
                body: "Copilot for M365 surfaces content from SharePoint based on existing permissions and structure. If your information architecture is chaotic, Copilot surfaces the wrong documents to the wrong people — creating security and compliance risks rather than productivity gains.",
              },
              {
                icon: Lock,
                title: "Permission sprawl is invisible until it becomes a breach or audit finding",
                body: "Unique permissions at the folder and item level accumulate silently across a mature SharePoint environment. External sharing that was enabled once and never reviewed. Guest accounts that still have access to sensitive libraries. These gaps exist invisibly until an auditor or attacker surfaces them.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 3. Who This Is For ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">Who This Assessment Is For</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            Built for organisations where SharePoint is a core platform — not an afterthought.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            If your organisation is in any of these categories, you need this assessment before your next SharePoint initiative begins.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organisations",
                body: "200–2,000 employees with SharePoint deployments that have outgrown informal governance — where sites proliferate and nobody has a current picture of what exists or who owns it.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "Finance, healthcare, legal, and energy firms where SharePoint governance has direct compliance implications — and where external sharing and permission sprawl create documented liability.",
              },
              {
                icon: Globe,
                title: "Audit-ready compliance teams",
                body: "Healthcare and financial services organisations who need defensible SharePoint security postures, documented lifecycle controls, and audit-ready permission models.",
              },
              {
                icon: RefreshCw,
                title: "SharePoint rebuild organisations",
                body: "Teams planning a SharePoint modernisation or migration who need a clear architectural baseline before they start — so they migrate to a better model rather than recreating the problems they have.",
              },
              {
                icon: AlertTriangle,
                title: "Sprawl-affected environments",
                body: "Environments with thousands of sites, broken permissions, abandoned team sites, and content nobody can find — where the scale of the problem has made remediation feel impossible.",
              },
              {
                icon: Target,
                title: "Copilot-prep organisations",
                body: "Companies planning a Copilot for M365 rollout who need clean, well-governed SharePoint foundations first — because Copilot will surface whatever is in SharePoint, whether it should be surfaced or not.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-5">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-accent-blue" />
                  </div>
                  <h3 className="font-display font-bold text-text-primary mb-1">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 4. How It Works ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">How It Works</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">From first question to architecture report in under five minutes.</h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            Ten questions. Five architecture dimensions. A scoring model built by the M365 Architect at NASA. An instant maturity score, a personalised PDF report, and a recommended next step — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: FolderOpen,
                title: "10 targeted questions",
                desc: "Each question maps to one of five SharePoint architecture dimensions — the same diagnostics Shane uses in a paid engagement, compressed into a 5-minute format. No generic questionnaire.",
              },
              {
                icon: Layers,
                title: "5 architecture dimensions scored",
                desc: "Information Architecture, Search & Metadata, Content Lifecycle, Governance & Permissions, and Copilot & Migration Readiness — each scored independently on a 0–10 scale.",
              },
              {
                icon: Star,
                title: "Scoring built by a NASA architect",
                desc: "Your answers are weighted and scored using the same diagnostic framework Shane applies as M365 Architect at NASA. You receive a total score (0–50), a maturity tier, and a per-dimension breakdown.",
              },
              {
                icon: FileText,
                title: "Instant PDF report emailed",
                desc: "A branded, personalised PDF lands in your inbox the moment you complete the assessment. No waiting, no scheduling — your architecture report is generated and delivered immediately.",
              },
              {
                icon: CheckCircle,
                title: "No account required",
                desc: "There is nothing to sign up for, no login, no subscription. Enter your name and email at the end to receive your PDF. That is the only information required.",
              },
              {
                icon: Users,
                title: "No sales call required",
                desc: "Your report includes a recommended next step — not a sales pitch. If you want to discuss the findings, a booking link is included. The decision is entirely yours.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-5 h-5 text-accent-blue" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                    <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-14 text-center">
            <button
              onClick={() => setModalOpen(true)}
              data-track="cta"
              className="group inline-flex items-center gap-2 text-accent-blue font-semibold hover:text-accent-violet transition-colors"
            >
              Start the assessment now <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* ── 5. Five Architecture Dimensions ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">The Five Architecture Dimensions</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            What the assessment <GradientText>measures</GradientText> — and why it matters.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether your SharePoint environment supports governance, findability, and AI-readiness — or undermines every initiative that depends on it. Each is scored independently so you know exactly where to focus.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {DIMENSIONS.map((dim) => (
              <div key={dim.title} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2 h-10 rounded-full ${dim.colour}`} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">{dim.label}</p>
                    <h3 className="font-display font-bold text-lg text-text-primary">{dim.title}</h3>
                  </div>
                </div>
                <ul className="space-y-2">
                  {dim.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm text-text-secondary leading-relaxed">
                      <CheckCircle className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <GlassPanel className="p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2 h-10 rounded-full" style={GRADIENT_BG} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Your Output</p>
                    <h3 className="font-display font-bold text-lg text-text-primary">Your Report</h3>
                  </div>
                </div>
                <p className="text-text-secondary text-sm leading-relaxed">
                  All five dimensions scored, ranked by architectural risk, and mapped to a tailored service recommendation. Personalised PDF delivered to your inbox the moment you finish.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(true)}
                data-track="cta"
                className="mt-6 inline-flex items-center gap-1.5 text-accent-blue text-sm font-semibold hover:gap-2.5 transition-all"
              >
                Start Assessment <ArrowRight className="w-4 h-4" />
              </button>
            </GlassPanel>
          </div>
        </div>
      </section>

      {/* ── 6. What You Receive ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">What You Receive</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            A personalised SharePoint architecture report. Free. Instant.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real architectural diagnostic report — built on the same framework Shane applies in paid engagements — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Overall architecture score",
                body: "Aggregated maturity score across all five dimensions with your maturity tier: Beginner, Developing, Emerging, Advanced, or Ready.",
              },
              {
                icon: Layers,
                title: "IA maturity score",
                body: "Specific rating for your information architecture design — hub model adoption, naming conventions, and structural intentionality.",
              },
              {
                icon: AlertTriangle,
                title: "Governance gaps",
                body: "Identified governance failures and risk areas — lifecycle policy gaps, orphaned sites, and permission sprawl findings.",
              },
              {
                icon: ShieldCheck,
                title: "Security and permission gaps",
                body: "Permission model issues, oversharing risks, external sharing exposure, and sensitive content visibility to unintended audiences.",
              },
              {
                icon: Database,
                title: "ROT indicators",
                body: "Signals of redundant, outdated, and trivial content volume — and how ROT is affecting findability and Copilot readiness.",
              },
              {
                icon: ArrowRight,
                title: "Recommended next steps",
                body: "Prioritised action items matched to your maturity tier — specific to your environment, not a generic SharePoint checklist.",
              },
              {
                icon: FileText,
                title: "Architecture notes",
                body: "Specific observations from your assessment responses — structural antipatterns, IA decisions, and improvement considerations.",
              },
              {
                icon: Target,
                title: "Priority remediation roadmap",
                body: "A sequenced improvement roadmap based on your results — what to fix first, what to plan next, and what Copilot readiness requires.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-start gap-4 bg-charcoal-1 rounded-2xl border border-white/[0.06] p-5">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-accent-blue" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-text-primary mb-1">{item.title}</h3>
                    <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 7. Inside Your PDF Report ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">Inside Your PDF Report</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            A structured architectural diagnostic — not a marketing brochure.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            Your PDF is structured as a professional diagnostic document — designed to be shared with IT leadership, a SharePoint migration project sponsor, or a procurement committee, not just filed in a personal inbox.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                num: "01",
                title: "Executive summary",
                desc: "A plain-English overview of your SharePoint environment's current state — your score, maturity tier, and the top three architectural risks identified by the assessment.",
              },
              {
                num: "02",
                title: "Dimension-by-dimension scoring",
                desc: "A scored breakdown across all five architecture dimensions with narrative commentary on the strengths and gaps identified in each area.",
              },
              {
                num: "03",
                title: "Architecture heatmap",
                desc: "A visual representation of your maturity across all five dimensions — immediately shows where your environment is thriving and where it is structurally at risk.",
              },
              {
                num: "04",
                title: "Gap analysis",
                desc: "A detailed catalogue of specific IA, governance, security, and content quality issues discovered, ranked by severity and business impact.",
              },
              {
                num: "05",
                title: "Recommended remediation path",
                desc: "A prioritised, step-by-step remediation guide aligned to your maturity tier — so you know what to fix first, what to plan, and what Copilot readiness will require.",
              },
              {
                num: "06",
                title: "Suggested quick wins",
                desc: "Specific Shane McCaw Consulting service recommendations that directly address your highest-priority architectural gaps, with pricing guidance and expected outcomes.",
              },
            ].map((item) => (
              <div key={item.num} className="flex gap-4 bg-charcoal-1 border border-white/[0.06] rounded-2xl p-5">
                <div className="font-numeric text-4xl font-bold text-white/10 leading-none flex-shrink-0 w-12">{item.num}</div>
                <div>
                  <h3 className="font-display font-bold text-text-primary mb-1">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a
              href="/sharepoint-assessment-report-sample.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-glass-border px-6 py-2.5 text-sm font-semibold text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
            >
              <Download className="w-4 h-4" />
              View Sample Report (PDF)
            </a>
          </div>
        </div>
      </section>

      {/* ── 8. Why Shane ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">Why Shane McCaw</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            This framework was built from 30 years of doing this work — not reading about it.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Shane McCaw is not a generalist consultant who added SharePoint to a service catalogue. He has spent three decades designing information architecture, governing content lifecycles, and remediating SharePoint environments for some of the most demanding organisations in the world.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Star,
                title: "Lead M365 Architect at NASA",
                body: "Shane serves as Lead Microsoft 365 Architect at NASA — responsible for SharePoint governance, information architecture, and Copilot readiness across a deeply complex and regulated environment.",
              },
              {
                icon: TrendingUp,
                title: "30 years in the Microsoft ecosystem",
                body: "Shane has worked with SharePoint since its earliest versions — from on-premises farm architecture to modern hub sites, Syntex, and SharePoint Premium at enterprise scale.",
              },
              {
                icon: Users,
                title: "Senior-only delivery",
                body: "Every engagement is delivered personally by Shane. There are no junior consultants, no offshore teams, and no account managers between you and the person who understands your environment.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industry expertise",
                body: "Deep experience in HIPAA and SOC 2 environments where SharePoint governance and permission models must be defensible, documented, and audit-ready.",
              },
              {
                icon: Award,
                title: "Architecture-first methodology",
                body: "Shane's assessments produce an architectural understanding of where your SharePoint environment is and a sequenced path to where it needs to be — not a list of settings changes without strategic context.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 9. CTA Reinforcement ── */}
      <section className="border-t border-white/[0.06] py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-4">
            Your SharePoint architecture determines your findability, your compliance posture, and your <GradientText>Copilot readiness</GradientText>.
          </h2>
          <p className="text-text-secondary text-lg mb-3 leading-relaxed">
            Most organisations discover their SharePoint problems when they try to layer something new on top — Copilot, a migration, or an audit — and find the foundation is not ready.
          </p>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            This assessment takes five minutes. The PDF report is free. The architectural gap analysis it surfaces is the same work Shane charges for in a paid engagement.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            data-track="cta"
            className="inline-flex items-center justify-center gap-2 text-white font-semibold text-base px-8 py-4 rounded-xl transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
          >
            Take the Free Assessment Now
          </button>
          <p className="text-text-tertiary text-sm mt-4">No account required · No sales follow-up · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
