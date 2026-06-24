import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import {
  CheckCircle, Activity, Shield, Users, FileText, Award,
  Building2, Lock, AlertTriangle, BarChart3, Database,
  Globe, ArrowRight, Download, ShieldCheck, Target,
  TrendingUp, Settings2, Network, Star, Layers,
} from "lucide-react";

const config: QuizConfig = {
  quizType: "m365-health",
  title: "M365 Tenant Health Assessment",
  introTitle: "How Healthy Is Your Microsoft 365 Tenant?",
  introDescription:
    "Answer 10 AI-powered questions across 5 health dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and service recommendation by email.",
  categories: [
    { key: "securityPosture", label: "Security Posture" },
    { key: "identityConditionalAccess", label: "Identity & Conditional Access" },
    { key: "collaborationSprawl", label: "Teams/SharePoint Sprawl" },
    { key: "adminRolesShadowIT", label: "Admin Roles & Shadow IT" },
    { key: "dlpSensitivityLabels", label: "DLP & Sensitivity Labels" },
  ],
  fallbackQuestions: [
    "What is your organisation's current Microsoft Secure Score, and do you actively review it? Have you configured Defender for Office 365 anti-phishing and anti-malware policies beyond the defaults?",
    "Do you have DKIM, DMARC, and SPF email authentication records correctly published and enforced for all your domains, or are some domains still using default settings?",
    "Has your organisation deployed Multi-Factor Authentication across all user accounts — including shared accounts, service accounts, and contractors — or are there gaps in MFA coverage?",
    "Have you configured Conditional Access policies in Entra ID? Do policies enforce compliant devices, block legacy authentication, or restrict access based on location or risk signals?",
    "How would you describe your Teams and SharePoint environments — are they structured with naming conventions, lifecycle policies, and clear ownership, or have they grown organically with ad hoc creation?",
    "Do you have visibility into how many Teams, SharePoint sites, and Microsoft 365 Groups exist in your tenant? Are there inactive or ownerless sites and groups that haven't been reviewed or archived?",
    "How many users in your tenant have Global Administrator rights, and are admin roles assigned using least-privilege principles? Are Privileged Identity Management (PIM) or just-in-time access controls in use?",
    "Are you aware of unsanctioned apps or services your staff are using to work around Microsoft 365 limitations — for example, personal cloud storage, external messaging tools, or unapproved third-party apps?",
    "Have you deployed Microsoft Purview sensitivity labels across your tenant? Are labels applied automatically to sensitive content, or is labelling entirely manual and inconsistent?",
    "Do you have Data Loss Prevention (DLP) policies configured in Microsoft Purview, and do those policies actively block or alert on sharing of sensitive data — such as PII, financial data, or classified content?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here · From $4,500",
      name: "M365 Tenant Health Audit",
      description:
        "Your tenant has significant configuration gaps that need immediate attention. A structured NASA-methodology audit identifies every issue — licensing waste, security misconfigurations, governance debt — and delivers a prioritised remediation roadmap.",
      slug: "m365-tenant-health-audit",
      ctaText: "Book Your Audit",
    },
    Developing: {
      badge: "Recommended · From $4,500",
      name: "M365 Tenant Health Audit",
      description:
        "You're making progress, but hidden gaps remain. A comprehensive tenant health audit uncovers the misconfigurations and adoption shortfalls that limit your M365 ROI — before they become security incidents.",
      slug: "m365-tenant-health-audit",
      ctaText: "Get Your Health Report",
    },
    Emerging: {
      badge: "Next Step · From $4,500",
      name: "M365 Tenant Health Audit",
      description:
        "Your tenant is in reasonable shape, but a formal audit will surface the edge cases and technical debt that accumulate over time — giving you a clean, defensible configuration baseline.",
      slug: "m365-tenant-health-audit",
      ctaText: "Validate Your Tenant",
    },
    Advanced: {
      badge: "High Impact · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your tenant is mature and well-managed. The logical next step is evaluating Copilot readiness — assessing whether your data governance, identity, and adoption practices are ready for AI deployment.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Assess Copilot Readiness",
    },
    Ready: {
      badge: "Enterprise Grade · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your tenant health is excellent. To maintain that standard at scale — especially through Copilot adoption or regulatory audits — formalise your governance framework before gaps creep back in.",
      slug: "governance-foundations-package",
      ctaText: "Build Your Governance Framework",
    },
  },
  reportTitle: "Microsoft 365 Tenant Health Report",
  pdfFilename: "m365-health-report.pdf",
  introFeatureLabels: ["5 health dimensions", "Maturity tier rating", "PDF report emailed"],
};

const DIMENSIONS = [
  {
    colour: "bg-blue-500",
    label: "Dimension 1",
    title: "Security Posture",
    bullets: [
      "Microsoft Secure Score engagement and active improvement planning.",
      "Defender for Office 365 Plan 1/2 configuration beyond default settings.",
      "Anti-phishing, anti-spam, safe-links, and safe-attachments policy coverage.",
      "DKIM, DMARC, and SPF enforcement across all domains and subdomains.",
      "Threat protection maturity benchmarked against enterprise standards.",
    ],
  },
  {
    colour: "bg-teal-500",
    label: "Dimension 2",
    title: "Identity & Conditional Access",
    bullets: [
      "MFA enforced for all users including service accounts and contractors.",
      "Conditional Access policies active and scoped across all apps and devices.",
      "Legacy authentication blocked at the tenant level for all users.",
      "Entra ID configured for compliant device enforcement and risk signals.",
      "PIM or just-in-time access controls in place for privileged roles.",
    ],
  },
  {
    colour: "bg-violet-500",
    label: "Dimension 3",
    title: "Teams & SharePoint Sprawl",
    bullets: [
      "Naming conventions and creation policies enforced across all workloads.",
      "Lifecycle policies with expiry reviews and automated renewal prompts.",
      "Guest access governed, reviewed, and time-limited periodically.",
      "Inactive and ownerless sites and groups identified and archived.",
      "Teams and Groups inventory completed — sprawl quantified and monitored.",
    ],
  },
  {
    colour: "bg-orange-500",
    label: "Dimension 4",
    title: "Admin Roles & Shadow IT",
    bullets: [
      "Global Admin count minimised — target 2–4 accounts with break-glass controls.",
      "All admin roles assigned on least-privilege principles and reviewed quarterly.",
      "Break-glass emergency accounts secured, documented, and monitored.",
      "Unsanctioned cloud storage, messaging, and third-party apps identified.",
      "Cloud App Security or Defender for Cloud Apps deployed and actively monitored.",
    ],
  },
  {
    colour: "bg-green-500",
    label: "Dimension 5",
    title: "DLP & Sensitivity Labels",
    bullets: [
      "Sensitivity labels published and applied consistently across tenant workloads.",
      "Auto-labelling configured for high-value and regulated content types.",
      "DLP policies actively block sharing of PII, financial data, and classified content.",
      "Purview compliance portal monitored and reviewed on a regular cadence.",
      "Data classification aligned to regulatory obligations and Copilot readiness.",
    ],
  },
];

export default function M365HealthQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Health Check | Free Tenant Assessment | Shane McCaw Consulting"
        description="Take our free M365 tenant health assessment. Score your security posture, identity, governance, and DLP in 5 minutes — and receive a personalised PDF report by email."
        ogImage="/og-image-m365-health-quiz.png"
        ogUrl="https://shanemccaw.com/m365-health-quiz"
      />

      {/* ── 1. Hero ── */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-[#0A2540] pt-[110px] pb-[110px]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A2540] via-[#0d2f50] to-[#0A2540]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(0,120,212,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(0,180,216,0.1),transparent_50%)]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)", backgroundSize: "32px 32px" }}
        />

        <div className="relative z-10 max-w-[900px] mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/20 border border-primary/30 rounded-full px-4 py-1.5 mb-8">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-primary text-sm font-semibold uppercase tracking-wide">M365 Tenant Health Assessment</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight mb-6">
            Your M365 Tenant Is{" "}
            <span className="text-[#00B4D8]">Growing.</span>
            <br className="hidden md:block" /> Is It Healthy?
          </h1>

          <p className="text-white/70 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            Configuration debt accumulates silently in every Microsoft 365 tenant — MFA gaps, ungoverned sprawl, admin role proliferation, and DLP policies that alert but never block. Most IT teams only see the full picture after a security incident or compliance audit.
          </p>
          <p className="text-white/60 text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question assessment — built on the same diagnostic framework Shane applied as Lead M365 Architect at NASA — identifies exactly where your tenant stands across five health dimensions before Copilot, migration, or a compliance review begins.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-8 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "health dimensions" },
              { value: "Free", label: "personalised PDF report" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl font-extrabold text-[#00B4D8]">{stat.value}</p>
                <p className="text-white/50 text-sm mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
            <button
              onClick={() => setModalOpen(true)}
              className="group inline-flex items-center gap-3 bg-primary hover:bg-primary/90 text-white font-semibold text-lg px-8 py-4 rounded-xl transition-all duration-200 shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5"
            >
              Take the Free Assessment
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/70 hover:text-white font-semibold text-sm border border-white/20 px-6 py-4 rounded-xl hover:border-white/40 transition-colors"
            >
              Book a Discovery Call
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-6">
            {["5 minutes", "Free PDF report", "No account required", "No sales call"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-white/40 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. Why This Assessment Exists ── */}
      <section className="py-20 bg-white">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-3">Why This Assessment Exists</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] text-center mb-4">
            M365 configuration debt is invisible — until it becomes a security incident.
          </h2>
          <p className="text-slate-500 text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Every Microsoft 365 tenant accumulates silent misconfigurations over months and years — default settings left unchanged, MFA gaps that develop as new accounts are created, and governance policies that were never put in place. The risk is already present. The question is whether you know where it is.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: Lock,
                colour: "bg-blue-500/10 text-blue-600",
                title: "Identity drift is the leading cause of M365 tenant compromise",
                body: "Admin roles proliferate, MFA exemptions multiply, and Conditional Access policies go untested. What started as a controlled environment develops exploitable gaps year over year — without triggering a single alert or error message.",
              },
              {
                icon: AlertTriangle,
                colour: "bg-orange-500/10 text-orange-600",
                title: "Silent misconfigurations don't announce themselves",
                body: "An SPF record missing from a secondary domain. A DLP policy set to audit-only that has never blocked a transfer. A SharePoint site with external sharing open that no administrator has reviewed. These gaps accumulate invisibly until an auditor or attacker surfaces them.",
              },
              {
                icon: Network,
                colour: "bg-violet-500/10 text-violet-600",
                title: "Teams and SharePoint sprawl creates governance risk at scale",
                body: "Abandoned teams, ownerless SharePoint sites, and ungoverned Microsoft 365 Groups are not a productivity problem — they are a compliance and security risk. Guest access that was never revoked and content with no lifecycle policy compound that risk every quarter.",
              },
              {
                icon: TrendingUp,
                colour: "bg-teal-500/10 text-teal-600",
                title: "Tenant health must be verified before Copilot or any major initiative",
                body: "Copilot surfaces data from across your tenant based on existing permissions and labels. A misconfigured tenant becomes a data governance liability at AI scale. Migrations and governance programmes that begin without a health baseline inherit the problems they were meant to solve.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-[#F7F9FC] rounded-2xl border border-border p-6">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${item.colour}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-extrabold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 3. Who This Is For ── */}
      <section className="py-20 bg-[#0A2540]">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#00B4D8] mb-3">Who This Assessment Is For</p>
          <h2 className="text-3xl font-extrabold text-white text-center mb-4">
            Built for organisations where M365 tenant health directly affects security, compliance, and AI readiness.
          </h2>
          <p className="text-white/60 text-center max-w-xl mx-auto mb-12 text-lg">
            If your organisation is in any of these categories, you need this assessment before your next Microsoft 365 initiative begins.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organisations",
                body: "200–2,000 employees that have grown into Microsoft 365 without structured governance — where configuration debt accumulates faster than teams realise and no formal baseline has ever been established.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "Healthcare (HIPAA), financial services (SOC 2 / FINRA), and legal organisations where misconfigured M365 tenants create audit risk, liability exposure, and direct regulatory consequences.",
              },
              {
                icon: Globe,
                title: "Government contractors",
                body: "Federal and state contractors under CMMC, ITAR, or FedRAMP where M365 configuration is a contractual requirement and tenant health documentation must be defensible and current.",
              },
              {
                icon: Layers,
                title: "Teams and SharePoint sprawl",
                body: "Organisations where unmanaged Teams channels, SharePoint sites, and Microsoft 365 Groups have proliferated — creating governance, discovery, and security risks that compound over time.",
              },
              {
                icon: AlertTriangle,
                title: "Uncertain security posture",
                body: "Organisations that have never formally assessed their M365 security configuration and are concerned about exposure from silent misconfigurations or accumulated technical debt.",
              },
              {
                icon: Target,
                title: "Copilot and AI readiness",
                body: "IT teams preparing to deploy Microsoft Copilot who need to validate tenant health, data governance, and identity controls before enabling AI across the organisation.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/20 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-[#00B4D8]" />
                  </div>
                  <h3 className="font-extrabold text-white mb-1">{item.title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 4. How It Works ── */}
      <section className="py-20 bg-white">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-3">How It Works</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] text-center mb-4">From first question to PDF in under five minutes.</h2>
          <p className="text-slate-500 text-center max-w-xl mx-auto mb-14">
            Ten questions. Five health dimensions. A NASA-grade scoring model. An instant health score, a personalised PDF report, and a recommended next step — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Activity,
                title: "10 targeted questions",
                desc: "Each question maps to one of five tenant health dimensions — the same diagnostics Shane uses in a paid engagement, compressed into a 5-minute format. No generic questionnaire.",
              },
              {
                icon: Layers,
                title: "5 health dimensions scored",
                desc: "Security Posture, Identity & Conditional Access, Teams/SharePoint Sprawl, Admin Roles & Shadow IT, and DLP & Sensitivity Labels — each scored independently on a 0–10 scale.",
              },
              {
                icon: Star,
                title: "NASA-grade scoring model",
                desc: "Your answers are weighted and scored using the same diagnostic framework applied at NASA. You receive a total score (0–50), a maturity tier, and a per-dimension breakdown.",
              },
              {
                icon: FileText,
                title: "Instant PDF report emailed",
                desc: "A branded, personalised PDF lands in your inbox the moment you complete the assessment. No waiting, no scheduling — your results are generated and delivered immediately.",
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
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-[#0A2540] mb-2">{item.title}</h3>
                    <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-14 text-center">
            <button
              onClick={() => setModalOpen(true)}
              className="group inline-flex items-center gap-2 text-[#0078D4] font-semibold hover:text-[#005A9E] transition-colors"
            >
              Start the assessment now <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* ── 5. Five Tenant Health Dimensions ── */}
      <section className="py-20 bg-[#F7F9FC]">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-3">The Five Tenant Health Dimensions</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] text-center mb-4">What the assessment measures — and why it matters.</h2>
          <p className="text-slate-500 text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether your Microsoft 365 tenant is configured to enterprise standard or quietly carrying risk. Each is scored independently so you know exactly where to focus remediation effort.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {DIMENSIONS.map((dim) => (
              <div key={dim.title} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2 h-10 rounded-full ${dim.colour}`} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{dim.label}</p>
                    <h3 className="font-extrabold text-lg text-[#0A2540]">{dim.title}</h3>
                  </div>
                </div>
                <ul className="space-y-2">
                  {dim.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-500 leading-relaxed">
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="bg-[#0A2540] rounded-2xl border border-[#0A2540] p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2 h-10 rounded-full bg-primary" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-white/40">Your Output</p>
                    <h3 className="font-extrabold text-lg text-white">Your Report</h3>
                  </div>
                </div>
                <p className="text-white/60 text-sm leading-relaxed">
                  All five dimensions scored, ranked by health risk, and mapped to a tailored service recommendation. Personalised PDF delivered to your inbox the moment you finish.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(true)}
                className="mt-6 inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:gap-2.5 transition-all"
              >
                Start Assessment <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. What You Receive ── */}
      <section className="py-20 bg-white">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-3">What You Receive</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] text-center mb-4">
            A personalised M365 health report. Free. Instant.
          </h2>
          <p className="text-slate-500 text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real diagnostic report — built on the same framework Shane applies in paid engagements — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Overall tenant health score",
                body: "A composite score across all five dimensions with your maturity tier: Beginner, Developing, Emerging, Advanced, or Ready.",
              },
              {
                icon: AlertTriangle,
                title: "Risk profile summary",
                body: "Prioritised risk areas ranked by potential business and compliance impact — so you know which gaps to address first.",
              },
              {
                icon: Shield,
                title: "Configuration gap analysis",
                body: "Specific settings, policies, and controls that are missing or misconfigured in your tenant — with direct references to the affected admin centre.",
              },
              {
                icon: Globe,
                title: "Governance gap findings",
                body: "Lifecycle, naming, and access governance issues that create sprawl, orphaned content, and compliance exposure over time.",
              },
              {
                icon: Lock,
                title: "Identity and security issues",
                body: "MFA gaps, Conditional Access weaknesses, admin role risks, and shadow IT indicators — the most exploitable gaps in your tenant.",
              },
              {
                icon: ArrowRight,
                title: "Recommended next steps",
                body: "An ordered action plan telling you what to fix first and why — matched to your maturity tier and specific gap profile.",
              },
              {
                icon: Database,
                title: "Architecture notes",
                body: "Observations on your current M365 architecture and configuration with specific improvement considerations for your environment.",
              },
              {
                icon: FileText,
                title: "Priority remediation roadmap",
                body: "A phased roadmap you can take directly to your IT team, board, or executive sponsor — prioritised by impact and implementation effort.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-start gap-4 bg-[#F7F9FC] rounded-2xl border border-border p-5">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-[#0A2540] mb-1">{item.title}</h3>
                    <p className="text-slate-500 text-sm leading-relaxed">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 7. Inside Your PDF Report ── */}
      <section className="py-20 bg-[#0A2540]">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#00B4D8] mb-3">Inside Your PDF Report</p>
          <h2 className="text-3xl font-extrabold text-white text-center mb-4">
            A structured diagnostic report — not a marketing brochure.
          </h2>
          <p className="text-white/60 text-center max-w-xl mx-auto mb-12 text-lg">
            Your PDF is structured as a professional diagnostic document — designed to be shared with IT leadership, a procurement committee, or an executive sponsor, not just filed in a personal inbox.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                num: "01",
                title: "Executive summary",
                desc: "One-page overview of your tenant health posture — suitable for sharing with a CIO, IT director, or operations lead who needs context without technical depth.",
              },
              {
                num: "02",
                title: "Dimension-by-dimension scoring",
                desc: "Each of the five health dimensions scored on a 0–10 scale with a narrative explanation of what the score indicates and what contributes to it in your environment.",
              },
              {
                num: "03",
                title: "Risk heatmap",
                desc: "A visual representation of high, medium, and low risk areas across your M365 environment — the fastest way to communicate where attention is needed.",
              },
              {
                num: "04",
                title: "Gap analysis",
                desc: "Line-by-line catalogue of configuration gaps, with severity ratings, explanation of business impact, and direct Microsoft documentation references.",
              },
              {
                num: "05",
                title: "Recommended remediation path",
                desc: "Step-by-step remediation guidance ordered by impact and implementation effort — what to address immediately, what to plan, and what represents longer-term work.",
              },
              {
                num: "06",
                title: "Suggested quick wins",
                desc: "Targeted service recommendations matched to your specific gaps and maturity tier — so you know exactly what help is available and what it will address.",
              },
            ].map((item) => (
              <div key={item.num} className="flex gap-4 bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className="text-4xl font-black text-primary/20 leading-none flex-shrink-0 w-10">{item.num}</div>
                <div>
                  <h3 className="font-extrabold text-white mb-1">{item.title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a
              href="/m365-health-report-sample.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-6 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Download className="w-4 h-4" />
              View Sample Report (PDF)
            </a>
          </div>
        </div>
      </section>

      {/* ── 8. Why Shane ── */}
      <section className="py-20 bg-white">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-3">Why Shane McCaw</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] text-center mb-4">
            This framework was built from 30 years of doing this work — not reading about it.
          </h2>
          <p className="text-slate-500 text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Shane McCaw is not a generalist consultant who added Microsoft 365 to a service catalogue. He has spent three decades designing, governing, and remediating Microsoft collaboration environments for some of the most demanding organisations in the world.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Star,
                colour: "bg-blue-500/10 text-blue-600",
                title: "Lead M365 Architect at NASA",
                body: "Shane serves as Lead Microsoft 365 Architect at NASA — responsible for tenant health, governance, and Copilot readiness across one of the most complex and regulated M365 environments in operation.",
              },
              {
                icon: TrendingUp,
                colour: "bg-teal-500/10 text-teal-600",
                title: "30 years in the Microsoft ecosystem",
                body: "Shane has worked in the Microsoft ecosystem since the early 1990s — from early Exchange deployments to modern cloud-native M365 tenant architecture, governance, and AI deployment readiness.",
              },
              {
                icon: Users,
                colour: "bg-violet-500/10 text-violet-600",
                title: "Senior-only delivery",
                body: "Every engagement is delivered personally by Shane. There are no junior consultants, no offshore teams, and no account managers between you and the person who understands your environment.",
              },
              {
                icon: ShieldCheck,
                colour: "bg-orange-500/10 text-orange-600",
                title: "Regulated industry expertise",
                body: "Deep experience in HIPAA, FedRAMP, CMMC, ITAR, and SOC 2 environments where M365 configuration must be defensible, documented, and audit-ready — not just functional.",
              },
              {
                icon: Award,
                colour: "bg-green-500/10 text-green-600",
                title: "Architecture-first methodology",
                body: "Shane's assessments produce an architectural understanding of where your tenant is and a sequenced path to where it needs to be — not a list of settings changes without strategic context.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-[#F7F9FC] rounded-2xl border border-border p-6">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${item.colour}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-extrabold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 9. CTA Reinforcement ── */}
      <section className="py-20 bg-[#0A2540]">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Your M365 tenant health determines your security posture, your compliance position, and your Copilot readiness.
          </h2>
          <p className="text-white/60 text-lg mb-3 leading-relaxed">
            Most organisations discover their tenant problems when they try to layer something new on top — Copilot, a migration, or an audit — and find the foundation is not ready.
          </p>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">
            This assessment takes five minutes. The PDF report is free. The gap analysis it surfaces is the same work Shane charges for in a paid engagement.
          </p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">
            Take the Free Assessment Now
          </CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · No sales follow-up · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
