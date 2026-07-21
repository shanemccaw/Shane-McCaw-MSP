import { useState } from "react";
import { Layout } from "@/components/Layout";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import {
  CheckCircle, MessageSquare, Building2, ShieldCheck, Globe,
  AlertTriangle, Target, Users, ArrowRight, BarChart3, FileText,
  Award, Activity, Layers, Settings2, TrendingUp, Star, Network, Download,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const config: QuizConfig = {
  quizType: "teams",
  title: "Microsoft Teams Health Quiz",
  introTitle: "How Well Is Your Organisation Using Microsoft Teams?",
  introDescription:
    "Answer 10 AI-powered questions across 5 Teams health dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.",
  categories: [
    { key: "lifecycleNaming", label: "Lifecycle & Naming" },
    { key: "adoptionCulture", label: "Adoption & Culture" },
    { key: "guestChannelStructure", label: "Guest & Channel Structure" },
    { key: "appGovernance", label: "App Usage Governance" },
    { key: "collaborationGovernance", label: "Collaboration Governance" },
  ],
  fallbackQuestions: [
    "How are Teams and channels created in your organisation — can any user create a team at any time, or do you have a provisioning process with naming conventions, defined owners, and purpose documentation?",
    "What happens to Microsoft Teams when a project ends or an employee leaves? Do you have lifecycle policies — such as automated expiry reviews, archiving processes, or ownership transfers — or do teams just linger indefinitely?",
    "How would you describe the quality of meetings in your organisation conducted through Microsoft Teams — are cameras and microphones generally working well, is background noise managed, and do meetings start on time?",
    "Has your organisation evaluated or deployed Microsoft Teams Phone (Teams calling) to replace or supplement your traditional telephony infrastructure — and if so, how has the transition been managed?",
    "How is information organised within your Teams environment? Do channels have a consistent structure across teams, or does each team have its own ad-hoc channel naming convention that makes cross-team navigation confusing?",
    "How effectively are your Teams being used for file storage and collaboration? Are files stored in the Teams/SharePoint backend in an organised way, or are staff emailing attachments and using personal OneDrive as workarounds?",
    "Which departments or groups in your organisation have adopted Microsoft Teams as their primary communication platform, and which ones are still defaulting to email, phone, or other tools for day-to-day communication?",
    "Has your organisation run any structured Teams adoption campaigns — such as champion programmes, Teams tips newsletters, or department-specific enablement workshops — or has adoption been entirely organic?",
    "What third-party apps or custom integrations have been added to Teams in your organisation — for example, project management tools, ticketing systems, or HR platforms — and are these managed and governed centrally?",
    "Are your Teams meetings equipped with the advanced collaboration features available — such as meeting recordings with transcripts, Copilot-powered meeting summaries, breakout rooms, or polls — or are meetings used primarily as audio/video calls?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here",
      name: "M365 Tenant Health Audit",
      description:
        "Before Teams governance can be improved, your broader M365 tenant needs a clean foundation. A comprehensive audit identifies the configuration gaps, governance debt, and licensing inefficiencies that are limiting your Teams environment.",
      slug: "m365-tenant-health-audit",
      ctaText: "Fix the Foundation First",
    },
    Developing: {
      badge: "Recommended",
      name: "Governance Foundations Package",
      description:
        "Your Teams environment needs formal governance before the sprawl becomes unmanageable. This engagement designs and implements lifecycle policies, naming conventions, and governance controls that keep Teams productive and auditable.",
      slug: "governance-foundations-package",
      ctaText: "Govern Your Teams Environment",
    },
    Emerging: {
      badge: "Next Step",
      name: "Governance Foundations Package",
      description:
        "You have good Teams usage, but gaps in governance and lifecycle management are creating technical debt. Formalise your framework before inactive teams and permission drift compound further.",
      slug: "governance-foundations-package",
      ctaText: "Formalise Your Governance",
    },
    Advanced: {
      badge: "High Impact",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your Teams environment is well-governed and actively used. The natural next step is Copilot — Teams is one of the primary surfaces for Copilot features like meeting summaries, chat drafting, and call recaps.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Add Copilot to Teams",
    },
    Ready: {
      badge: "Enterprise Grade",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your Teams environment is excellent. Copilot for Teams — with meeting summaries, intelligent recaps, and AI-assisted chat — will deliver immediate productivity gains on top of your strong foundation.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Deploy Copilot for Teams",
    },
  },
  reportTitle: "Microsoft Teams Health Quiz Report",
  pdfFilename: "teams-quiz-report.pdf",
  introFeatureLabels: ["5 Teams dimensions", "Maturity tier rating", "PDF report emailed"],
};

const DIMENSIONS = [
  {
    colour: "bg-blue-500",
    label: "Dimension 1",
    title: "Lifecycle & Naming",
    bullets: [
      "Team and channel creation policies — provisioned on-demand vs. controlled request workflows.",
      "Naming convention enforcement via sensitivity labels, prefix/suffix policies, and blocked-word lists.",
      "Ownership requirements at provisioning — minimum owner count and owner verification.",
      "Lifecycle management: expiry policies, automated renewal notifications, and archiving thresholds.",
      "Inactive team remediation — discovery, remediation workflows, and audit trails for deleted teams.",
    ],
  },
  {
    colour: "bg-teal-500",
    label: "Dimension 2",
    title: "Adoption & Culture",
    bullets: [
      "Department-level adoption mapping — which teams use Teams as primary tool vs. defaulting to email.",
      "Adoption barriers: feature awareness, executive modelling, and cultural resistance to change.",
      "Training provision — whether structured onboarding, tips programmes, and champion networks exist.",
      "Meeting culture quality: camera discipline, punctuality, background noise, and meeting hygiene.",
      "Advanced feature utilisation — recording, transcription, breakout rooms, and Copilot meeting summaries.",
    ],
  },
  {
    colour: "bg-violet-500",
    label: "Dimension 3",
    title: "Guest & Channel Structure",
    bullets: [
      "External guest access policies — whether B2B guest access is open, restricted, or governed by request.",
      "Guest access review processes — periodic access reviews and removal workflows for departed guests.",
      "Standard, private, and shared channel governance — when each type is appropriate and who can create them.",
      "External collaboration policies aligned to compliance requirements (CMMC, HIPAA, SOC 2, FINRA).",
      "Cross-tenant collaboration readiness for Teams Connect and shared channel configurations.",
    ],
  },
  {
    colour: "bg-orange-500",
    label: "Dimension 4",
    title: "App Usage Governance",
    bullets: [
      "Third-party app inventory — what apps have been added to Teams and whether they are still in use.",
      "App approval and governance policies — whether IT controls which apps can be installed by users.",
      "App permission scope review — whether approved apps have overly broad Graph API permissions.",
      "Custom app and bot catalogue governance — approval gates, retirement processes, and testing standards.",
      "Advanced feature utilisation: connectors, webhooks, Power Automate flows, and Power Apps within Teams.",
    ],
  },
  {
    colour: "bg-green-500",
    label: "Dimension 5",
    title: "Collaboration Governance",
    bullets: [
      "Meeting recording retention policies — storage location, retention duration, and access controls.",
      "Information architecture within Teams — channel structure consistency, tab organisation, and findability.",
      "Content governance alignment — how Teams file storage aligns with the broader SharePoint governance model.",
      "DLP policy coverage for Teams chat and channel messages — sensitivity labels and communication compliance.",
      "Copilot and SharePoint migration readiness — whether the Teams structure will support an AI-ready data model.",
    ],
  },
];

export default function TeamsQuiz() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Layout>
      <SEOMeta
        title="Microsoft Teams Maturity Quiz | Shane McCaw Consulting"
        description="Is your organisation getting full value from Microsoft Teams? Take our free maturity quiz assessing governance, adoption, and technical configuration — PDF report emailed to you."
        ogImage="/og-image-teams-quiz.png"
        ogUrl="https://shanemccaw.com/teams-maturity-quiz"
      />

      {/* ── 1. Hero ── */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <MessageSquare className="w-4 h-4" />
            Teams Health Quiz
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Your Teams Environment Is <GradientText>Growing.</GradientText>
            <br className="hidden md:block" /> Is It Governed?
          </h1>

          <p className="text-text-secondary text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            Teams sprawl accumulates silently — abandoned teams, ungoverned apps, inconsistent channel structures, and guest access nobody has reviewed in two years. Most IT teams only see the problem after it becomes unmanageable.
          </p>
          <p className="text-text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question quiz — built on the same diagnostic framework Shane applies as Lead M365 Architect at NASA — identifies exactly where your Teams environment stands before Copilot, SharePoint migration, or governance remediation begins.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "health dimensions" },
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
              Take the Free Quiz
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
              <div key={item} className="flex items-center gap-2 text-text-secondary text-sm">
                <CheckCircle className="w-4 h-4 text-accent-blue" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. Why This Quiz Exists ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">Why This Quiz Exists</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            Teams is deployed everywhere. It is governed almost nowhere.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Microsoft Teams grew faster than any governance framework could keep up with. Most organisations deployed it during remote work acceleration and never returned to formalise the rules. The result is a collaboration environment that actively undermines the SharePoint, Copilot, and governance investments now being planned on top of it.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: Network,
                title: "Teams sprawl compounds faster than most IT teams realise",
                body: "The average mid-market organisation accumulates hundreds of inactive or abandoned teams within 18 months of deployment. Without lifecycle policies, the number grows unchecked — creating orphaned content, stale channels, and permission drift that is expensive to remediate.",
              },
              {
                icon: TrendingUp,
                title: "Ungoverned Teams degrades productivity, not just compliance",
                body: "When staff cannot find files, channels have no consistent structure, and meetings lack governance around recordings and transcripts, Teams becomes a source of friction rather than productivity. The ROI case for Microsoft 365 licensing erodes.",
              },
              {
                icon: Settings2,
                title: "Deployment without architecture creates structural debt",
                body: "Teams deployed reactively — without provisioning workflows, ownership requirements, or naming conventions — creates structural debt that is difficult to unwind without business disruption. Architecture decisions made at deployment determine the governance ceiling for years.",
              },
              {
                icon: AlertTriangle,
                title: "Admin visibility blind spots hide risk before Copilot or migration",
                body: "Before deploying Copilot or migrating to SharePoint Premium, organisations need to understand what is actually in their Teams environment — which apps have Graph API access, which guests are still present, and which channels contain sensitive unclassified content.",
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
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">Who This Quiz Is For</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            Built for organisations where Teams health directly affects business outcomes.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            If your organisation is in any of these categories, you need this quiz before your next Microsoft 365 initiative begins.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organisations",
                body: "200–2,000 employees with Teams deployed but no formal governance framework — where sprawl is already visible but remediation has not been prioritised or resourced.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "Healthcare (HIPAA), financial services (SOC 2 / FINRA), and legal organisations where ungoverned guest access, app permissions, and retention gaps create direct compliance exposure.",
              },
              {
                icon: Globe,
                title: "Audit-ready compliance organisations",
                body: "Healthcare and financial services organizations where Teams governance is a compliance requirement and external collaboration controls must be documented and auditable.",
              },
              {
                icon: Layers,
                title: "Teams sprawl organisations",
                body: "Organisations with hundreds of teams and no lifecycle management — where staff cannot find content, owners are unknown, and IT has lost visibility over what exists in the environment.",
              },
              {
                icon: Activity,
                title: "Adoption and usage organisations",
                body: "Organisations still defaulting to email for communication and file sharing, where Teams has been deployed but not embedded — and leadership wants to understand why adoption has stalled.",
              },
              {
                icon: Target,
                title: "Copilot and SharePoint prep organisations",
                body: "Organisations planning a Copilot deployment or SharePoint Premium migration that need to understand whether their Teams environment is architecturally ready to support either initiative.",
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

      {/* ── 4. How This Quiz Works ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">How It Works</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">From first question to PDF in under five minutes.</h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            Ten questions. Five health dimensions. A scoring model built by the M365 Architect at NASA. An instant health score, a personalised PDF report, and a recommended next step — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: MessageSquare,
                title: "10 targeted questions",
                desc: "Each question maps to one of five Teams health dimensions — the same diagnostics Shane uses in a paid engagement, compressed into a 5-minute format. No generic questionnaire.",
              },
              {
                icon: Layers,
                title: "5 health dimensions scored",
                desc: "Lifecycle & Naming, Adoption & Culture, Guest & Channel Structure, App Usage Governance, and Collaboration Governance — each scored independently on a 0–10 scale.",
              },
              {
                icon: Star,
                title: "Scoring built by a NASA architect",
                desc: "Your answers are weighted and scored using the same diagnostic framework Shane applies as M365 Architect at NASA. You receive a total score (0–50), a maturity tier, and a per-dimension breakdown.",
              },
              {
                icon: FileText,
                title: "Instant PDF report emailed",
                desc: "A branded, personalised PDF lands in your inbox the moment you complete the quiz. No waiting, no scheduling — your results are generated and delivered immediately.",
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
              Start the quiz now <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* ── 5. Five Teams Health Dimensions ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">The Five Teams Health Dimensions</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            What the quiz <GradientText>measures</GradientText> — and why it matters.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether a Teams environment supports governance, productivity, and AI-readiness — or undermines every initiative that depends on it. Each is scored independently so you know exactly where to focus.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {DIMENSIONS.map((dim) => (
              <div key={dim.title} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2 h-10 rounded-full ${dim.colour}`} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-text-secondary">{dim.label}</p>
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
                    <p className="text-xs font-bold uppercase tracking-wide text-text-secondary">Your Output</p>
                    <h3 className="font-display font-bold text-lg text-text-primary">Your Report</h3>
                  </div>
                </div>
                <p className="text-text-secondary text-sm leading-relaxed">
                  All five dimensions scored, ranked by health risk, and mapped to a tailored service recommendation. Personalised PDF delivered to your inbox the moment you finish.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(true)}
                data-track="cta"
                className="mt-6 inline-flex items-center gap-1.5 text-accent-blue text-sm font-semibold hover:gap-2.5 transition-all"
              >
                Start Quiz <ArrowRight className="w-4 h-4" />
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
            A personalised Teams health report. Free. Instant.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real diagnostic report — built on the same framework Shane applies in paid engagements — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Overall Teams health score",
                body: "A total score across all five dimensions with your maturity tier: Beginner, Developing, Emerging, Advanced, or Ready.",
              },
              {
                icon: AlertTriangle,
                title: "Governance gap analysis",
                body: "The specific governance gaps identified in your environment — lifecycle, naming, and permission issues most likely to compound over time.",
              },
              {
                icon: Activity,
                title: "Adoption gap analysis",
                body: "Which departments and use cases are underutilising Teams and the likely causes — cultural, training, or configuration barriers.",
              },
              {
                icon: Settings2,
                title: "App governance risks",
                body: "Third-party app and integration risks identified in your environment, including overly broad permissions and ungoverned app catalogue gaps.",
              },
              {
                icon: Layers,
                title: "Channel structure issues",
                body: "Structural problems with how teams and channels are organised — findability, duplication, and information architecture gaps.",
              },
              {
                icon: Target,
                title: "Recommended next steps",
                body: "A prioritised list of the three to five actions that will most improve your Teams health score — specific to your environment, not a generic checklist.",
              },
              {
                icon: Network,
                title: "Architecture notes",
                body: "Observations on how your current Teams architecture will support or hinder your next initiative — Copilot, SharePoint migration, or governance remediation.",
              },
              {
                icon: TrendingUp,
                title: "Priority remediation roadmap",
                body: "A sequenced roadmap of recommended remediation work — what to fix first, what to schedule, and what to monitor — based on your maturity tier.",
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
            A structured diagnostic report — not a marketing brochure.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            Your PDF is structured as a professional diagnostic document. It is designed to be shared with IT leadership, a procurement committee, or an executive sponsor — not just kept in a personal inbox.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                num: "01",
                title: "Executive summary",
                desc: "A plain-language overview of your Teams health posture — one page suitable for sharing with a CIO, IT director, or operations lead who needs context without technical depth.",
              },
              {
                num: "02",
                title: "Dimension-by-dimension scoring",
                desc: "Each of the five Teams health dimensions scored on a 0–10 scale with a narrative explanation of what the score indicates and what contributes to it in your environment.",
              },
              {
                num: "03",
                title: "Teams health heatmap",
                desc: "A visual heatmap showing your relative strength and weakness across all five dimensions at a glance — the fastest way to communicate where attention is needed.",
              },
              {
                num: "04",
                title: "Gap analysis",
                desc: "A structured breakdown of the governance, adoption, structural, and compliance gaps identified across your Teams environment based on your responses.",
              },
              {
                num: "05",
                title: "Recommended remediation path",
                desc: "A sequenced remediation path — what to address immediately, what to plan for, and what represents longer-term architectural work — prioritised by risk and business impact.",
              },
              {
                num: "06",
                title: "Suggested Quick Wins",
                desc: "Based on your score and risk profile, one or two specific Shane McCaw Consulting services recommended as the highest-value next steps for your maturity tier.",
              },
              {
                num: "07",
                title: "Senior-only delivery note",
                desc: "A reminder that all work flowing from this quiz is delivered personally by Shane McCaw — not a junior consultant or offshore delivery team — with a direct booking link included.",
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
              href="/teams-health-report-sample.pdf"
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
            Shane McCaw is not a generalist consultant who added Microsoft 365 to a service catalogue. He has spent three decades designing, governing, and remediating Microsoft collaboration environments for some of the most demanding organisations in the world.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Star,
                title: "Lead M365 Architect at NASA",
                body: "Shane serves as Lead Microsoft 365 Architect at NASA — responsible for governance, architecture, and compliance across one of the most security-sensitive Microsoft 365 tenants in operation.",
              },
              {
                icon: TrendingUp,
                title: "30 years in the Microsoft ecosystem",
                body: "Shane has worked in the Microsoft ecosystem since the early 1990s — across tenant architecture, collaboration governance, identity, and now AI deployment readiness.",
              },
              {
                icon: Users,
                title: "Senior-only delivery",
                body: "Every engagement is delivered personally by Shane. There are no junior consultants, no offshore teams, and no account managers inserting themselves between you and the person who knows your environment.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industry expertise",
                body: "Shane has designed governance frameworks for organisations operating under HIPAA, SOC 2, and FINRA — compliance requirements that demand architecture-first thinking, not configuration-only fixes.",
              },
              {
                icon: Award,
                title: "Architecture-first methodology",
                body: "Shane's assessments do not produce a list of settings to change. They produce an architectural understanding of where your environment is and a sequenced path to where it needs to be.",
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
            Your Teams health determines your collaboration effectiveness, your <GradientText>Copilot readiness</GradientText>, and your governance posture.
          </h2>
          <p className="text-text-secondary text-lg mb-3 leading-relaxed">
            Most organisations discover their Teams problems when they try to layer something new on top — Copilot, SharePoint migration, or a security audit — and find the foundation isn't ready.
          </p>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            This quiz takes five minutes. The PDF report is free. The gap analysis it surfaces is the same work Shane charges for in a paid engagement.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            data-track="cta"
            className="inline-flex items-center justify-center gap-2 text-white font-semibold text-base px-8 py-4 rounded-xl transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
          >
            Take the Free Quiz Now
          </button>
          <p className="text-text-secondary text-sm mt-4">No account required · No sales follow-up · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
