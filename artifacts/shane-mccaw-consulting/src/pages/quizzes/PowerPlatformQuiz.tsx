import { useState } from "react";
import { Layout } from "@/components/Layout";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import {
  CheckCircle, Cpu, AlertTriangle, ShieldCheck, Users,
  Building2, ArrowRight, FileText, BarChart3, Layers,
  GitBranch, Lock, BookOpen, Zap, ClipboardList, Target,
  Star, Download, TrendingUp, Settings2,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const config: QuizConfig = {
  quizType: "power-platform",
  title: "Power Platform Maturity Quiz",
  introTitle: "How Mature Is Your Power Platform Practice?",
  introDescription:
    "Answer 10 AI-powered questions across 5 maturity dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.",
  categories: [
    { key: "environmentStrategy", label: "Environment Strategy" },
    { key: "dlpMakerPermissions", label: "DLP & Maker Permissions" },
    { key: "appSprawlDataRisk", label: "App Sprawl & Data Risk" },
    { key: "monitoringCompliance", label: "Monitoring & Compliance" },
    { key: "governanceReadiness", label: "Governance Readiness" },
  ],
  fallbackQuestions: [
    "How is your Power Platform environment governed today? Do you have a Centre of Excellence (CoE) toolkit deployed, an environment strategy, and data loss prevention (DLP) policies configured, or is it largely ungoverned?",
    "Have you set up separate Power Platform environments for development, test, and production — or are makers building and testing in the default production environment?",
    "How many active makers (Power Apps or Power Automate builders) does your organisation have, and are they self-taught or have they completed formal Microsoft training?",
    "What training or enablement has your organisation provided for Power Platform? For example, internal champion programmes, Microsoft Learn paths, or external training courses?",
    "What data sources do your Power Platform solutions typically connect to — for example, SharePoint, Dataverse, SQL Server, Dynamics 365, or third-party APIs — and are these connections secured and documented?",
    "Has your organisation evaluated or deployed Microsoft Dataverse as a structured data platform for Power Apps, rather than using SharePoint lists or Excel files as data sources?",
    "What types of automation have your organisation deployed using Power Automate — for example, approval workflows, email notifications, system integrations, or scheduled data processing?",
    "Are your Power Automate flows monitored for failures, and do you have a process for maintaining and updating them when the underlying systems or APIs they connect to change?",
    "Has your organisation explored or deployed AI Builder features — such as document processing, prediction models, or object detection — within any Power Platform solutions?",
    "Are your teams aware of the Copilot features now built into Power Apps and Power Automate — such as natural-language app building and AI-generated flow suggestions — and are you positioning to take advantage of them?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here",
      name: "Power Platform Quick-Start",
      description:
        "Your Power Platform practice needs a strong foundation before it can scale. A focused sprint to establish governance, deploy the CoE toolkit, and deliver your first production-ready app or flow — giving your team a proven pattern to follow.",
      slug: "power-platform-quickstart",
      ctaText: "Start Your Practice Right",
    },
    Developing: {
      badge: "Recommended",
      name: "Power Platform Quick-Start",
      description:
        "You have makers building solutions, but without consistent governance and quality standards. This sprint establishes the guardrails — DLP policies, environment strategy, and maker training — and delivers a production-ready template app.",
      slug: "power-platform-quickstart",
      ctaText: "Build the Right Way",
    },
    Emerging: {
      badge: "Next Step",
      name: "Power Platform Quick-Start",
      description:
        "Your practice is maturing. A focused Quick-Start sprint will formalise your governance, upskill your makers, and deliver one high-impact app or flow that demonstrates what a well-executed Power Platform solution looks like.",
      slug: "power-platform-quickstart",
      ctaText: "Accelerate Your Practice",
    },
    Advanced: {
      badge: "High Impact",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your Power Platform maturity is strong. The next frontier is AI — evaluate your Copilot readiness to understand how Power Platform's AI Builder and Copilot Studio features fit into your automation strategy.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Add AI to Your Automation",
    },
    Ready: {
      badge: "Enterprise Grade",
      name: "Governance Foundations Package",
      description:
        "Your Power Platform practice is excellent. To sustain it at enterprise scale — especially as Copilot Studio and AI Builder deployments expand — formalise your broader M365 governance framework.",
      slug: "governance-foundations-package",
      ctaText: "Govern at Enterprise Scale",
    },
  },
  reportTitle: "Power Platform Maturity Quiz Report",
  pdfFilename: "power-platform-quiz-report.pdf",
  introFeatureLabels: ["5 maturity dimensions", "Maturity tier rating", "PDF report emailed"],
};

const DIMENSIONS = [
  {
    colour: "bg-blue-500",
    label: "Dimension 1",
    title: "Governance & Environment Strategy",
    bullets: [
      "Environment segmentation across dev, test, and production workloads.",
      "Who can create environments and whether the approval process is enforced.",
      "DLP policy coverage and connector governance across all environments.",
      "Maker permission tiers and access model — who can build what, and where.",
      "Capacity planning and tenant-level Power Platform configuration maturity.",
    ],
  },
  {
    colour: "bg-teal-500",
    label: "Dimension 2",
    title: "Application Lifecycle Management",
    bullets: [
      "Solution layering and managed versus unmanaged solutions discipline.",
      "Dev/test/prod pipeline maturity and promotion governance controls.",
      "Use of Power Platform Pipelines or Azure DevOps for release management.",
      "Version control, rollback capability, and change documentation practices.",
      "Release governance and change management for production-critical solutions.",
    ],
  },
  {
    colour: "bg-violet-500",
    label: "Dimension 3",
    title: "Security & Compliance",
    bullets: [
      "RBAC and row-level security implementation in Dataverse environments.",
      "Connector governance, data residency controls, and sensitive data handling.",
      "Conditional Access policy alignment for Power Platform service access.",
      "Audit logging configuration and compliance reporting coverage.",
      "Sensitivity label integration with Microsoft Purview across workloads.",
    ],
  },
  {
    colour: "bg-orange-500",
    label: "Dimension 4",
    title: "Maker Enablement & Training",
    bullets: [
      "Maker onboarding programme quality and documentation availability.",
      "Centre of Excellence (CoE) toolkit deployment and active management.",
      "Internal champion network and community of practice maturity.",
      "Shadow IT identification, remediation, and governance integration.",
      "Training paths: Microsoft Learn, internal courses, and certification coverage.",
    ],
  },
  {
    colour: "bg-green-500",
    label: "Dimension 5",
    title: "Automation & Integration Maturity",
    bullets: [
      "Flow reliability and structured error handling across production flows.",
      "Failure alerting, operational monitoring, and on-call response processes.",
      "API and system integration governance — documented and reviewed.",
      "Copilot Studio readiness and AI Builder adoption across the practice.",
      "Readiness to scale automation reliably across the enterprise.",
    ],
  },
];

export default function PowerPlatformQuiz() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Layout>
      <SEOMeta
        title="Power Platform Maturity Quiz | Shane McCaw Consulting"
        description="How mature is your Power Platform practice? Take our free quiz and receive a personalised PDF report with a tailored service recommendation from a 30-year Microsoft expert."
        ogImage="/og-image-power-platform-quiz.png"
        ogUrl="https://shanemccaw.com/power-platform-quiz"
      />

      {/* ── 1. Hero ── */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Cpu className="w-4 h-4" />
            Power Platform Maturity Quiz
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Your Power Platform Is <GradientText>Creating Value</GradientText>
            <br className="hidden md:block" /> or Creating Risk.
          </h1>

          <p className="text-text-secondary text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            Ungoverned Power Platform environments accumulate shadow IT, broken flows, and unmanaged data connections — often without anyone realising until it becomes a governance failure or a compliance exposure.
          </p>
          <p className="text-text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question quiz — built on the same diagnostic framework Shane applies as Lead M365 Architect at NASA — identifies exactly where your practice stands across five maturity dimensions before Copilot Studio, AI Builder, or an enterprise-scale rollout begins.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "maturity dimensions" },
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
            Most Power Platform environments are ungoverned. Most organisations don't know it until something breaks.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Microsoft's low-code platform is powerful and accessible — which is exactly why it creates problems at scale. When any employee can build an app or flow without governance guardrails, the result is app sprawl, data exposure, and automation that fails silently in production.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: AlertTriangle,
                title: "App sprawl accumulates faster than governance frameworks can keep up",
                body: "Hundreds of undocumented solutions running on production data — with no owner, no monitoring, and no remediation path. Shadow development flourishes when any user can build with no IT visibility and no security review. The result is a catalogue of technical debt, not a governed practice.",
              },
              {
                icon: Lock,
                title: "DLP gaps leave sensitive connectors exposed to unmanaged makers",
                body: "DLP policies that only cover the default environment, or that were configured once and never reviewed, leave sensitive data connectors open to any maker who finds them. The gap is invisible in the admin centre — until a data exposure incident surfaces it.",
              },
              {
                icon: Settings2,
                title: "ALM absence means production critical flows have no recovery path",
                body: "When makers build directly in the default environment and promote without a test cycle, version control is absent and rollback is manual. A broken flow in production has no documented fix path — and may have been built by someone who has since left the organisation.",
              },
              {
                icon: Zap,
                title: "Ungoverned Power Platform becomes an AI readiness blocker",
                body: "Copilot Studio and AI Builder deployments require a governed, monitored Power Platform foundation. App sprawl, absent ALM, and unmanaged connectors are not just current risks — they are blockers to the AI automation investments your organisation is planning.",
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
            Built for organisations where Power Platform governance is falling behind adoption.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            If your organisation is in any of these categories, you need this quiz before your next Power Platform initiative begins.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organisations",
                body: "200–5,000 users scaling Power Apps and Power Automate across departments — where organic adoption has outpaced governance and a formal practice has never been established.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "HIPAA, SOC 2, and FINRA-regulated teams needing compliant automation governance — where unmanaged connectors and absent audit logging create direct regulatory exposure.",
              },
              {
                icon: Target,
                title: "Compliance-driven environments",
                body: "Healthcare and financial services environments where Power Platform governance is a compliance requirement — and where maker permissions and data residency controls must be documented and defensible.",
              },
              {
                icon: Zap,
                title: "Teams scaling automation",
                body: "Organisations running dozens of flows but lacking ALM, monitoring discipline, and documented ownership — where a single point of failure can bring a business process down silently.",
              },
              {
                icon: AlertTriangle,
                title: "App sprawl situations",
                body: "Environments with undocumented apps, orphaned flows, and unmanaged connectors — where IT has lost visibility over what is running, who owns it, and what data it accesses.",
              },
              {
                icon: Cpu,
                title: "Copilot Studio aspirants",
                body: "Organisations planning AI automation through Copilot Studio or AI Builder who need to know whether their Power Platform foundation is mature enough to support it safely.",
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
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">From first question to maturity report in under five minutes.</h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            Ten questions. Five maturity dimensions. A scoring model built by the M365 Architect at NASA. An instant maturity score, a personalised PDF report, and a recommended next step — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Cpu,
                title: "10 targeted questions",
                desc: "Each question maps to one of five Power Platform maturity dimensions — the same diagnostics Shane uses in a paid engagement, compressed into a 5-minute format. No generic questionnaire.",
              },
              {
                icon: Layers,
                title: "5 maturity dimensions scored",
                desc: "Governance & Environment Strategy, Application Lifecycle Management, Security & Compliance, Maker Enablement, and Automation Maturity — each scored independently on a 0–10 scale.",
              },
              {
                icon: Star,
                title: "Scoring built by a NASA architect",
                desc: "Your answers are weighted and scored using the same diagnostic framework Shane applies as M365 Architect at NASA. You receive a total score (0–50), a maturity tier, and a per-dimension breakdown.",
              },
              {
                icon: FileText,
                title: "Instant PDF report emailed",
                desc: "A branded, personalised PDF lands in your inbox the moment you complete the quiz. No waiting, no scheduling — your maturity report is generated and delivered immediately.",
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

      {/* ── 5. Five Maturity Dimensions ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">The Five Maturity Dimensions</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            What the quiz <GradientText>measures</GradientText> — and why it matters.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether your Power Platform practice is governed, scalable, and AI-ready — or carrying technical debt and compliance risk that compounds with every new app and flow added.
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
                  All five dimensions scored, ranked by maturity risk, and mapped to a tailored service recommendation. Personalised PDF delivered to your inbox the moment you finish.
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
            A personalised Power Platform maturity report. Free. Instant.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real diagnostic report — built on the same framework Shane applies in paid engagements — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Overall maturity score",
                body: "Aggregated score across all five dimensions with your maturity tier: Beginner, Developing, Emerging, Advanced, or Ready.",
              },
              {
                icon: AlertTriangle,
                title: "Governance and environment gaps",
                body: "Environment strategy failures, DLP gaps, and maker permission issues — with severity ratings and specific remediation direction.",
              },
              {
                icon: GitBranch,
                title: "ALM maturity gaps",
                body: "Pipeline, solution management, and release governance findings — what's missing and how it creates risk in your production environment.",
              },
              {
                icon: Lock,
                title: "Security and compliance exposures",
                body: "Security risks identified by dimension — RBAC gaps, connector vulnerabilities, audit logging failures, and data residency issues.",
              },
              {
                icon: BookOpen,
                title: "Maker enablement gaps",
                body: "CoE readiness assessment and maker training gaps — what's preventing your makers from building reliably at scale.",
              },
              {
                icon: Zap,
                title: "Automation reliability findings",
                body: "Flow failure monitoring, integration governance, and automation maturity findings — what is running unmonitored in your environment.",
              },
              {
                icon: ArrowRight,
                title: "Recommended next steps",
                body: "Prioritised action items in priority order, matched to your maturity tier — specific to your environment, not a generic Power Platform checklist.",
              },
              {
                icon: Layers,
                title: "Architecture notes",
                body: "Architectural observations tailored to your environment and scale — structural decisions and patterns that will determine your platform's ceiling.",
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
            A structured maturity diagnostic — not a marketing brochure.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            Your PDF is structured as a professional diagnostic document — designed to be shared with IT leadership, a procurement committee, or an executive sponsor, not just filed in a personal inbox.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                num: "01",
                title: "Executive summary",
                desc: "A one-page overview of your maturity tier, overall score, and the most critical governance gaps — suitable for sharing with IT leadership or a business sponsor.",
              },
              {
                num: "02",
                title: "Dimension-by-dimension scoring",
                desc: "Individual scores for each of the five maturity dimensions with narrative interpretation and benchmark context against enterprise Power Platform standards.",
              },
              {
                num: "03",
                title: "Maturity heatmap",
                desc: "A visual representation of where your practice is strong, developing, or at risk — immediately actionable at a glance for both technical and business audiences.",
              },
              {
                num: "04",
                title: "Gap analysis",
                desc: "A structured breakdown of every identified gap, ranked by impact and remediation complexity — governance failures, ALM gaps, security exposures, and maker issues.",
              },
              {
                num: "05",
                title: "Recommended remediation path",
                desc: "A sequenced action plan mapping your gaps to concrete remediation steps — with recommended sequencing and effort estimates for your maturity tier.",
              },
              {
                num: "06",
                title: "Suggested quick wins",
                desc: "Matched service recommendations — Power Platform Quick-Start, Governance Foundations, or Copilot Readiness — based on your exact maturity tier and gap profile.",
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
              href="/power-platform-maturity-report-sample.pdf"
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
            Shane McCaw is not a generalist consultant who added Power Platform to a service catalogue. He has spent three decades building and governing Microsoft automation environments for some of the most demanding and regulated organisations in the world.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Star,
                title: "Lead M365 Architect at NASA",
                body: "Shane built and governs the Power Platform environment for one of the world's most security-conscious and complex Microsoft 365 tenants — a 60,000-user environment where citizen development runs at enterprise scale.",
              },
              {
                icon: TrendingUp,
                title: "30-year Microsoft ecosystem veteran",
                body: "Three decades across every generation of the Microsoft stack — from on-premises SharePoint to modern Power Platform, Copilot Studio, and Dataverse at enterprise scale.",
              },
              {
                icon: Users,
                title: "Senior-only delivery",
                body: "No juniors, no project managers as intermediaries. Every assessment and engagement is delivered personally by Shane — the same expert you read about on this page.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industry expertise",
                body: "Deep experience in healthcare and financial services environments where Power Platform governance, compliance, and audit-readiness are non-negotiable requirements.",
              },
              {
                icon: ClipboardList,
                title: "Architecture-first methodology",
                body: "Shane's approach starts with the platform architecture, not the tooling. Every recommendation is grounded in sustainable governance design, not quick fixes or generic best practices.",
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
            Your Power Platform maturity determines your automation reliability, your compliance posture, and your <GradientText>AI readiness</GradientText>.
          </h2>
          <p className="text-text-secondary text-lg mb-3 leading-relaxed">
            Most organisations discover their Power Platform problems when they try to scale — when Copilot Studio deployment begins, when a compliance audit starts, or when a critical flow fails in production and nobody knows how to fix it.
          </p>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            This quiz takes five minutes. The PDF report is free. The maturity gap analysis it surfaces is the same work Shane charges for in a paid engagement.
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
