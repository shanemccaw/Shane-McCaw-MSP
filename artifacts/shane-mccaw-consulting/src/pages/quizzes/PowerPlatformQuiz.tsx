import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import {
  CheckCircle,
  Cpu,
  AlertTriangle,
  ShieldCheck,
  Users,
  Building2,
  ArrowRight,
  FileText,
  BarChart3,
  Award,
  Layers,
  GitBranch,
  Lock,
  BookOpen,
  Zap,
  ClipboardList,
  Map,
  Target,
  Star,
} from "lucide-react";

const config: QuizConfig = {
  quizType: "power-platform",
  title: "Power Platform Maturity Assessment",
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
      badge: "Start Here · From $6,000",
      name: "Power Platform Quick-Start",
      description:
        "Your Power Platform practice needs a strong foundation before it can scale. A focused sprint to establish governance, deploy the CoE toolkit, and deliver your first production-ready app or flow — giving your team a proven pattern to follow.",
      slug: "power-platform-quickstart",
      ctaText: "Start Your Practice Right",
    },
    Developing: {
      badge: "Recommended · From $6,000",
      name: "Power Platform Quick-Start",
      description:
        "You have makers building solutions, but without consistent governance and quality standards. This sprint establishes the guardrails — DLP policies, environment strategy, and maker training — and delivers a production-ready template app.",
      slug: "power-platform-quickstart",
      ctaText: "Build the Right Way",
    },
    Emerging: {
      badge: "Next Step · From $6,000",
      name: "Power Platform Quick-Start",
      description:
        "Your practice is maturing. A focused Quick-Start sprint will formalise your governance, upskill your makers, and deliver one high-impact app or flow that demonstrates what a well-executed Power Platform solution looks like.",
      slug: "power-platform-quickstart",
      ctaText: "Accelerate Your Practice",
    },
    Advanced: {
      badge: "High Impact · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your Power Platform maturity is strong. The next frontier is AI — evaluate your Copilot readiness to understand how Power Platform's AI Builder and Copilot Studio features fit into your automation strategy.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Add AI to Your Automation",
    },
    Ready: {
      badge: "Enterprise Grade · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your Power Platform practice is excellent. To sustain it at enterprise scale — especially as Copilot Studio and AI Builder deployments expand — formalise your broader M365 governance framework.",
      slug: "governance-foundations-package",
      ctaText: "Govern at Enterprise Scale",
    },
  },
  reportTitle: "Power Platform Maturity Assessment Report",
  pdfFilename: "power-platform-assessment-report.pdf",
  introFeatureLabels: ["5 maturity dimensions", "Maturity tier rating", "PDF report emailed"],
};

const PILLARS = [
  {
    label: "Governance & Environment Strategy",
    icon: Building2,
    desc: "How environments are structured across dev, test, and production.",
    bullets: [
      "Environment segmentation and naming conventions",
      "Who can create environments and the approval process",
      "DLP policy coverage across all environments",
      "Maker permission tiers and connector governance model",
      "Capacity planning and tenant-level configuration",
    ],
  },
  {
    label: "Application Lifecycle Management",
    icon: GitBranch,
    desc: "How solutions are built, versioned, tested, and promoted.",
    bullets: [
      "Solution layering and managed vs unmanaged solutions",
      "Dev/test/prod pipeline maturity",
      "Use of Power Platform Pipelines or Azure DevOps",
      "Version control and rollback capability",
      "Change management and release governance",
    ],
  },
  {
    label: "Security & Compliance",
    icon: Lock,
    desc: "How data, connectors, and access are protected across the platform.",
    bullets: [
      "RBAC and row-level security in Dataverse",
      "Connector governance and data residency controls",
      "Conditional access policy alignment",
      "Audit logging and compliance reporting",
      "Sensitivity label integration with M365 Purview",
    ],
  },
  {
    label: "Maker Enablement & Training",
    icon: BookOpen,
    desc: "How makers are onboarded, upskilled, and supported at scale.",
    bullets: [
      "Maker onboarding programme and documentation",
      "Centre of Excellence (CoE) toolkit deployment",
      "Internal champion network and community of practice",
      "Shadow IT identification and remediation",
      "Training paths: Microsoft Learn, internal courses, certification",
    ],
  },
  {
    label: "Automation & Integration Maturity",
    icon: Zap,
    desc: "How reliable, monitored, and AI-ready your automation layer is.",
    bullets: [
      "Flow reliability and structured error handling",
      "Failure alerting and operational monitoring",
      "API and system integration governance",
      "Copilot Studio readiness and AI Builder adoption",
      "Readiness to scale automation across the enterprise",
    ],
  },
];

const WHO_ITS_FOR = [
  { icon: Building2, label: "Mid-market organisations", desc: "200–5,000 users scaling Power Apps and Power Automate across departments." },
  { icon: ShieldCheck, label: "Regulated industries", desc: "HIPAA, SOC 2, and FINRA-regulated teams needing compliant automation governance." },
  { icon: Target, label: "Government contractors", desc: "CMMC and FedRAMP environments where governance isn't optional." },
  { icon: Zap, label: "Teams scaling automation", desc: "Organisations running dozens of flows but lacking ALM and monitoring discipline." },
  { icon: AlertTriangle, label: "App sprawl situations", desc: "Environments with undocumented apps, orphaned flows, and unmanaged connectors." },
  { icon: Cpu, label: "Copilot Studio aspirants", desc: "Orgs planning AI automation who need to know if their platform foundation is ready." },
];

const HOW_IT_WORKS_STATS = [
  { value: "10", label: "targeted questions" },
  { value: "5", label: "maturity dimensions scored" },
  { value: "NASA", label: "scoring methodology" },
  { value: "Free", label: "instant PDF report" },
  { value: "0", label: "account required" },
  { value: "0", label: "sales calls required" },
];

const WHAT_YOU_RECEIVE = [
  { icon: BarChart3, text: "Overall Power Platform maturity score across all 5 dimensions" },
  { icon: AlertTriangle, text: "Governance and environment strategy gaps with severity ratings" },
  { icon: GitBranch, text: "ALM maturity gaps — pipeline, solution management, and release governance" },
  { icon: Lock, text: "Security and compliance exposures identified by dimension" },
  { icon: BookOpen, text: "Maker enablement gaps and CoE readiness assessment" },
  { icon: Zap, text: "Automation reliability and integration maturity findings" },
  { icon: Map, text: "Recommended next steps in priority order, matched to your tier" },
  { icon: Layers, text: "Architecture notes tailored to your environment and scale" },
];

const PDF_SECTIONS = [
  {
    title: "Executive Summary",
    desc: "A one-page overview of your maturity tier, overall score, and the most critical gaps — suitable for sharing with leadership.",
  },
  {
    title: "Dimension-by-Dimension Scoring",
    desc: "Individual scores for each of the 5 maturity dimensions with narrative interpretation and benchmark context.",
  },
  {
    title: "Maturity Heatmap",
    desc: "A visual representation of where your practice is strong, developing, or at risk — immediately actionable at a glance.",
  },
  {
    title: "Gap Analysis",
    desc: "A structured breakdown of every identified gap, ranked by impact and remediation complexity.",
  },
  {
    title: "Remediation Path",
    desc: "A sequenced action plan mapping your gaps to concrete remediation steps, with recommended sequencing and effort estimates.",
  },
  {
    title: "Suggested Micro-Offers",
    desc: "Matched service recommendations — Power Platform Quick-Start, Governance Foundations, or Automation Hardening — based on your exact maturity tier.",
  },
];

const WHY_SHANE = [
  {
    icon: Award,
    title: "Lead M365 Architect at NASA",
    desc: "Shane built and governs the Power Platform environment for one of the world's most security-conscious and complex Microsoft 365 tenants.",
  },
  {
    icon: Star,
    title: "30-Year Microsoft Ecosystem Veteran",
    desc: "Three decades across every generation of the Microsoft stack — from on-premises SharePoint to modern Power Platform, Copilot Studio, and Dataverse at enterprise scale.",
  },
  {
    icon: Users,
    title: "Senior-Only Delivery",
    desc: "No juniors, no project managers as intermediaries. Every assessment and engagement is delivered personally by Shane — the same expert you read about.",
  },
  {
    icon: ShieldCheck,
    title: "Regulated Industry Expertise",
    desc: "Deep experience in federal, healthcare, and financial services environments where governance, compliance, and audit-readiness are non-negotiable.",
  },
  {
    icon: ClipboardList,
    title: "Architecture-First Methodology",
    desc: "Shane's approach starts with the platform architecture, not the tooling. Every recommendation is grounded in sustainable governance design, not quick fixes.",
  },
];

export default function PowerPlatformQuiz() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Layout>
      <SEOMeta
        title="Power Platform Maturity Assessment | Free Quiz | Shane McCaw Consulting"
        description="How mature is your Power Platform practice? Take our free assessment and receive a personalised PDF report with a tailored service recommendation from a 30-year Microsoft expert."
        ogUrl="https://shanemccaw.com/power-platform-quiz"
      />

      {/* ── 1. Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.14) 0%, transparent 70%)" }}
        />
        <div
          className="absolute inset-0 opacity-[0.035] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "32px 32px" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-full px-4 py-1.5 mb-6">
            <Cpu className="w-4 h-4 text-[#0078D4]" />
            <span className="text-[#0078D4] text-sm font-semibold uppercase tracking-wide">Free Power Platform Assessment</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Is Your Power Platform{" "}
            <span className="text-[#00B4D8]">Creating Value</span>
            {" "}or Creating Risk?
          </h1>
          <p className="text-white/70 text-xl mt-6 max-w-3xl leading-relaxed">
            Ungoverned Power Platform environments accumulate shadow IT, broken flows, and unmanaged data connections — often without anyone realising until it becomes a governance failure. This assessment uses the same diagnostic framework Shane applies as Lead Microsoft 365 Architect at NASA to tell you exactly where your practice stands.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <CTAButton onClick={() => setModalOpen(true)}>Take the Free Assessment</CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/70 hover:text-white font-semibold text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40 transition-colors"
            >
              Book a Discovery Call
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-6">
            {["5 minutes", "Free PDF report", "No sales call required"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-white/55 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. Why This Assessment Exists ───────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-3">Why This Assessment Exists</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] max-w-3xl mx-auto leading-tight">
              Most Power Platform environments are ungoverned. Most organisations don't know it until something breaks.
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div className="space-y-5 text-slate-600 leading-relaxed text-base">
              <p>
                Microsoft's low-code platform is powerful and accessible — which is exactly why it creates problems at scale. When any employee can build an app or flow without governance guardrails, the result is <strong className="text-[#0A2540]">app sprawl</strong>: hundreds of undocumented solutions running on production data, with no owner, no monitoring, and no remediation path.
              </p>
              <p>
                DLP policies either don't exist or are misconfigured, leaving sensitive connectors exposed. ALM is absent — makers build directly in the default environment and push to production without a test cycle. Shadow development flourishes: business units solve their own problems with no IT visibility and no security review.
              </p>
              <p>
                The result isn't just technical debt. It's a compliance risk, a data governance failure, and — when Copilot Studio enters the picture — an AI readiness blocker.
              </p>
            </div>
            <div className="bg-[#F7F9FC] rounded-2xl p-8 border border-border space-y-4">
              <p className="text-[#0A2540] font-bold text-sm uppercase tracking-wide mb-4">Common signals of ungoverned growth</p>
              {[
                "No formal environment strategy — everything runs in Default",
                "DLP policies that only cover the default environment",
                "Makers with no training building production-critical flows",
                "Apps connecting to sensitive data with no security review",
                "Zero flow failure monitoring or alerting",
                "No CoE toolkit or governance documentation",
              ].map((signal) => (
                <div key={signal} className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-600 text-sm leading-relaxed">{signal}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Who This Is For ──────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-3">Who This Is For</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white max-w-2xl mx-auto leading-tight">
              Built for organisations where Power Platform governance is falling behind adoption.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WHO_ITS_FOR.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="flex gap-4 p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/[0.08] transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-[#0078D4]" />
                </div>
                <div>
                  <h3 className="font-bold text-white mb-1">{label}</h3>
                  <p className="text-white/55 text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. How It Works ─────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-3">How It Works</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">
              10 questions. 5 dimensions. One actionable report.
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto text-lg leading-relaxed">
              Designed to surface the governance gaps that matter — and skip everything that doesn't.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-12">
            {HOW_IT_WORKS_STATS.map(({ value, label }) => (
              <div key={label} className="bg-white border border-border rounded-2xl p-6 text-center">
                <p className="text-4xl font-extrabold text-[#0078D4] mb-1">{value}</p>
                <p className="text-slate-500 text-sm">{label}</p>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { step: "01", title: "Answer 10 questions", body: "AI-powered questions adapt to your context, covering all 5 maturity dimensions in sequence." },
              { step: "02", title: "Scored against NASA benchmarks", body: "Each answer is scored using the same Power Platform governance framework applied at NASA." },
              { step: "03", title: "Receive your maturity tier", body: "Your overall tier — Beginner through Ready — is calculated instantly with per-dimension scores." },
              { step: "04", title: "Get your PDF report", body: "A full diagnostic PDF is emailed immediately. No account required, no call scheduled." },
            ].map(({ step, title, body }) => (
              <div key={step} className="relative">
                <p className="text-[#0078D4]/30 font-extrabold text-5xl mb-3 leading-none">{step}</p>
                <h3 className="font-bold text-[#0A2540] mb-2">{title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. 5 Maturity Dimensions ────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">What We Assess</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Maturity Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto text-lg leading-relaxed">
              Every Power Platform environment is measured across the same five dimensions — scored independently and combined into your overall maturity tier.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {PILLARS.map(({ label, icon: Icon, desc, bullets }) => (
              <div
                key={label}
                className="p-7 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all"
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0A2540] text-lg leading-snug">{label}</h3>
                    <p className="text-muted-foreground text-sm mt-1">{desc}</p>
                  </div>
                </div>
                <ul className="space-y-2">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5">
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                      <span className="text-slate-600 text-sm leading-relaxed">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {/* 5th pillar spans full width on md */}
            <div className="md:col-span-2">
              {/* Already rendered in the map above — pillar index 4 is Automation */}
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. What You Receive ─────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-3">Your Deliverable</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">What You Receive</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-lg leading-relaxed">
              Every assessment produces a structured PDF report, emailed instantly. No summary slides. No vague findings. Actionable findings tied to your specific maturity gaps.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {WHAT_YOU_RECEIVE.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3 bg-white border border-border rounded-xl p-5">
                <Icon className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-slate-700 text-sm leading-relaxed">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. Inside Your PDF Report ───────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-3">Report Anatomy</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">Inside Your PDF Report</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-lg leading-relaxed">
              Six structured sections designed to move from diagnosis to action — shareable with your leadership team or IT governance board.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {PDF_SECTIONS.map(({ title, desc }, i) => (
              <div key={title} className="rounded-2xl border border-border p-6 hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[#0078D4]/40 font-extrabold text-2xl leading-none">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="font-bold text-[#0A2540]">{title}</h3>
                </div>
                <p className="text-slate-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 bg-[#0A2540]/5 border border-[#0078D4]/15 rounded-2xl p-6 text-center">
            <p className="text-[#0A2540] font-semibold mb-1">Suggested micro-offers included in every report</p>
            <p className="text-slate-500 text-sm">
              Based on your maturity tier, your report includes a matched service recommendation — Power Platform Quick-Start, Governance Foundations Package, or Automation Hardening — with full scope and pricing detail.
            </p>
          </div>
        </div>
      </section>

      {/* ── 8. Why Shane ────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-3">Your Assessor</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Why Shane McCaw</h2>
            <p className="text-white/60 max-w-xl mx-auto text-lg leading-relaxed">
              The assessment is designed and interpreted by the same person who governs Power Platform at NASA. Not a consultant who read the documentation — an architect who built the controls.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {WHY_SHANE.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex gap-4 p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/[0.08] transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-[#0078D4]" />
                </div>
                <div>
                  <h3 className="font-bold text-white mb-1.5">{title}</h3>
                  <p className="text-white/55 text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 9. Final CTA ────────────────────────────────────────────────────── */}
      <section className="py-24 bg-[#F7F9FC]">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-5 leading-tight">
            Your Power Platform maturity determines your automation reliability, governance posture, and Copilot success.
          </h2>
          <p className="text-slate-500 text-lg mb-10 leading-relaxed">
            Take the free assessment now. Receive a personalised PDF report — scored across all 5 maturity dimensions — delivered instantly to your inbox. No account required. No sales call triggered.
          </p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">
            Take the Free Assessment
          </CTAButton>
          <div className="mt-8 flex flex-wrap justify-center gap-6">
            {["5 minutes", "Free PDF report", "No sales call required"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-slate-400 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                {item}
              </div>
            ))}
          </div>
          <div className="mt-8 pt-8 border-t border-border">
            <p className="text-slate-400 text-sm mb-3">Prefer to talk through your situation first?</p>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-[#0078D4] hover:text-[#005A9E] font-semibold text-sm transition-colors"
            >
              Book a Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
