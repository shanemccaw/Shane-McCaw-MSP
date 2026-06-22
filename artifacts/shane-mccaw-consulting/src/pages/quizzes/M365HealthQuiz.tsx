import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import {
  CheckCircle,
  Activity,
  Shield,
  Users,
  FileText,
  Award,
  Building2,
  Lock,
  AlertTriangle,
  BarChart3,
  Database,
  Globe,
  ArrowRight,
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

const PILLARS = [
  {
    icon: <Shield className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />,
    label: "Security Posture",
    desc: "Microsoft Secure Score engagement, Defender for Office 365 configuration, anti-phishing and anti-malware policies, email authentication (DKIM/DMARC/SPF), and threat protection maturity across your entire tenant.",
    bullets: [
      "Secure Score reviewed and actively improved",
      "Defender for Office 365 Plan 1/2 configured",
      "Anti-phishing, anti-spam, and safe-links policies",
      "DKIM, DMARC, and SPF enforced on all domains",
      "Threat protection maturity benchmarked",
    ],
  },
  {
    icon: <Lock className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />,
    label: "Identity & Conditional Access",
    desc: "MFA coverage across all account types, Conditional Access policy breadth, Entra ID configuration, Privileged Identity Management, and controls for legacy authentication and risky sign-ins.",
    bullets: [
      "MFA enforced for all users including service accounts",
      "Conditional Access policies active and scoped",
      "Legacy authentication blocked at the tenant level",
      "Entra ID configured for compliant device enforcement",
      "PIM or just-in-time access controls in place",
    ],
  },
  {
    icon: <Globe className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />,
    label: "Teams/SharePoint Sprawl",
    desc: "Teams and SharePoint governance covering naming conventions, site and team lifecycle policies, guest access controls, ownerless group detection, and indicators of unmanaged content sprawl.",
    bullets: [
      "Naming conventions and creation policies enforced",
      "Lifecycle policies with expiry and renewal prompts",
      "Guest access governed and reviewed periodically",
      "Inactive and ownerless sites identified and archived",
      "Teams/Groups inventory and sprawl audit completed",
    ],
  },
  {
    icon: <AlertTriangle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />,
    label: "Admin Roles & Shadow IT",
    desc: "Global Admin headcount, least-privilege role assignment across all admin tiers, monitoring tooling, and awareness of unsanctioned apps or workarounds circumventing your M365 environment.",
    bullets: [
      "Global Admin count minimised (target: 2–4)",
      "Roles assigned on least-privilege principles",
      "Break-glass emergency accounts secured and monitored",
      "Unsanctioned cloud storage and messaging apps identified",
      "Cloud App Security or Defender for Cloud Apps active",
    ],
  },
  {
    icon: <Database className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />,
    label: "DLP & Sensitivity Labels",
    desc: "Sensitivity label deployment and coverage, DLP policy configuration and enforcement scope, auto-labelling for sensitive content, and overall information protection and data classification maturity.",
    bullets: [
      "Sensitivity labels published and applied consistently",
      "Auto-labelling configured for high-value content types",
      "DLP policies block sharing of PII and financial data",
      "Purview compliance portal actively monitored",
      "Data classification aligned to regulatory obligations",
    ],
  },
];

const ICP_SEGMENTS = [
  {
    icon: <Building2 className="w-6 h-6 text-[#0078D4]" />,
    label: "Mid-Market Organisations",
    desc: "200–2,000 employees that have grown into Microsoft 365 without structured governance. Configuration debt accumulates faster than teams realise.",
  },
  {
    icon: <Shield className="w-6 h-6 text-[#0078D4]" />,
    label: "Regulated Industries",
    desc: "Organisations under HIPAA, SOC 2, FINRA, or legal sector compliance obligations where misconfigured M365 tenants create audit risk and liability exposure.",
  },
  {
    icon: <Award className="w-6 h-6 text-[#0078D4]" />,
    label: "Government Contractors",
    desc: "Entities operating under CMMC, ITAR, or FedRAMP requirements that need a defensible, documented M365 configuration before their next compliance review.",
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-[#0078D4]" />,
    label: "Copilot Adopters",
    desc: "IT teams preparing to deploy Microsoft Copilot who need to validate their tenant health, data governance, and identity controls before enabling AI across the organisation.",
  },
  {
    icon: <AlertTriangle className="w-6 h-6 text-[#0078D4]" />,
    label: "Uncertain Security Posture",
    desc: "Organisations that have never formally assessed their M365 security configuration and are concerned about exposure from silent misconfigurations or accumulated technical debt.",
  },
  {
    icon: <Globe className="w-6 h-6 text-[#0078D4]" />,
    label: "Teams & SharePoint Sprawl",
    desc: "Teams where unmanaged Teams channels, SharePoint sites, and Microsoft 365 Groups have proliferated — creating governance, discovery, and security risks that compound over time.",
  },
];

const HOW_STEPS = [
  {
    step: "01",
    title: "10 Targeted Questions",
    desc: "AI-powered questions across five health dimensions, adapted to your responses in real time to surface the most relevant risks for your specific tenant profile.",
  },
  {
    step: "02",
    title: "5 Health Dimensions Scored",
    desc: "Each dimension — Security Posture, Identity, Sprawl, Admin Roles, and DLP — is scored independently to give you a granular view of where you stand.",
  },
  {
    step: "03",
    title: "NASA-Grade Scoring Methodology",
    desc: "The same structured assessment framework used on NASA's Microsoft 365 environment. Scoring benchmarks against enterprise-grade configuration standards, not generic defaults.",
  },
  {
    step: "04",
    title: "Instant PDF Delivered by Email",
    desc: "Your personalised tenant health report is generated and emailed the moment you submit. No waiting, no follow-up required — your findings land in your inbox within seconds.",
  },
  {
    step: "05",
    title: "No Account or Sales Call Required",
    desc: "Zero friction. No account creation, no credit card, no obligation to speak with anyone. Take the assessment on your terms, on your timeline.",
  },
];

const DELIVERABLES = [
  { icon: <BarChart3 className="w-5 h-5 text-[#0078D4]" />, label: "Overall Tenant Health Score", desc: "A composite score across all five dimensions with your maturity tier classification." },
  { icon: <AlertTriangle className="w-5 h-5 text-[#0078D4]" />, label: "Risk Profile Summary", desc: "Prioritised risk areas ranked by potential business and compliance impact." },
  { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, label: "Configuration Gap Analysis", desc: "Specific settings, policies, and controls that are missing or misconfigured in your tenant." },
  { icon: <Globe className="w-5 h-5 text-[#0078D4]" />, label: "Governance Gap Findings", desc: "Lifecycle, naming, and access governance issues that create sprawl and compliance exposure." },
  { icon: <Lock className="w-5 h-5 text-[#0078D4]" />, label: "Identity & Security Issues", desc: "MFA gaps, Conditional Access weaknesses, admin role risks, and shadow IT indicators." },
  { icon: <ArrowRight className="w-5 h-5 text-[#0078D4]" />, label: "Recommended Next Steps", desc: "An ordered action plan telling you what to fix first and why — no vague advice." },
  { icon: <Database className="w-5 h-5 text-[#0078D4]" />, label: "Architecture Notes", desc: "Observations on your current M365 architecture with improvement considerations." },
  { icon: <FileText className="w-5 h-5 text-[#0078D4]" />, label: "Priority Remediation Roadmap", desc: "A phased roadmap you can take directly to your IT team or board." },
];

const REPORT_SECTIONS = [
  { title: "Executive Summary", desc: "One-page overview suitable for leadership briefings — your score, tier, and headline findings." },
  { title: "Dimension-by-Dimension Scoring", desc: "Detailed breakdown of each health dimension with individual scores and explanatory commentary." },
  { title: "Risk Heatmap", desc: "Visual representation of high, medium, and low risk areas across your M365 environment." },
  { title: "Gap Analysis", desc: "Line-by-line catalogue of configuration gaps, with severity ratings and direct Microsoft documentation references." },
  { title: "Remediation Path", desc: "Step-by-step remediation guidance ordered by impact and implementation effort." },
  { title: "Suggested Micro-Offers", desc: "Targeted service recommendations matched to your specific gaps — so you know exactly what help is available if you need it." },
];

const WHY_SHANE = [
  {
    icon: <Award className="w-6 h-6 text-[#0078D4]" />,
    title: "Lead M365 Architect at NASA",
    desc: "Shane currently serves as the Lead Microsoft 365 Architect at NASA — responsible for tenant health, governance, and Copilot readiness across one of the world's most complex and regulated M365 environments.",
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-[#0078D4]" />,
    title: "30 Years in the Microsoft Ecosystem",
    desc: "Three decades of hands-on Microsoft architecture experience — from early Exchange deployments to modern cloud-native M365 governance. Shane has seen every configuration pattern, failure mode, and recovery path.",
  },
  {
    icon: <Users className="w-6 h-6 text-[#0078D4]" />,
    title: "Senior-Only Delivery",
    desc: "No juniors, no account managers, no offshore teams. Every assessment is scoped, conducted, and reported by Shane personally — the same senior-level attention your largest enterprise client would expect.",
  },
  {
    icon: <Shield className="w-6 h-6 text-[#0078D4]" />,
    title: "Regulated Industry Expertise",
    desc: "Deep experience in HIPAA, FedRAMP, CMMC, and SOC 2 environments. Shane's assessments are built to hold up under regulatory scrutiny — not just internal review.",
  },
  {
    icon: <Building2 className="w-6 h-6 text-[#0078D4]" />,
    title: "Architecture-First Methodology",
    desc: "Every tenant health engagement starts with architecture, not tooling. Shane designs configurations that scale, stay defensible over time, and align M365 to your organisation's security and governance objectives.",
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

      {/* ── Section 1: Hero ─────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <Activity className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment · Used at NASA</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Tenant Health Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 health dimensions. A personalised readiness report delivered instantly.
          </p>
          <p className="text-white/45 text-base mt-4 max-w-2xl leading-relaxed">
            Built on the same assessment methodology Shane uses as Lead M365 Architect at NASA — now available free to any organisation that needs to understand its tenant health before Copilot, migrations, or a compliance audit.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <CTAButton onClick={() => setModalOpen(true)}>Take the Free Assessment</CTAButton>
            <CTAButton href="/book" className="bg-transparent border border-white/20 text-white/70 hover:bg-transparent hover:border-white/40 hover:text-white">
              Book a Discovery Call
            </CTAButton>
          </div>
          <div className="mt-10 flex flex-wrap gap-6">
            {["5 minutes", "Free PDF report", "No sales call required"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-white/50 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 2: Why This Assessment Exists ───────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">The Problem</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">Why Most M365 Tenants Need This Assessment</h2>
            <div className="space-y-5 text-[#0A2540]/75 text-base leading-relaxed">
              <p>
                Microsoft 365 is not a set-and-forget platform. Every tenant accumulates <strong className="text-[#0A2540]">configuration debt</strong> — small deviations from best practice that compound silently over months and years. Default settings get left in place. Admin roles multiply. Teams channels proliferate without governance. Conditional Access policies are never broadened beyond the initial rollout. Sensitivity labels are deployed inconsistently or not at all.
              </p>
              <p>
                <strong className="text-[#0A2540]">Identity and security drift</strong> is the most dangerous variant. MFA coverage develops gaps as new accounts are created, service accounts bypass policies, and legacy authentication protocols remain enabled because no one has reviewed them. Conditional Access rules that looked complete at deployment are now missing entire device classes or location contexts.
              </p>
              <p>
                <strong className="text-[#0A2540]">Silent misconfigurations</strong> are particularly insidious — they don't trigger errors or alerts, they just leave your tenant exposed. An SPF record missing from a secondary domain. A DLP policy that alerts but never blocks. A SharePoint site with external sharing enabled that no one noticed.
              </p>
              <p>
                This assessment must happen <strong className="text-[#0A2540]">before</strong> any Copilot deployment, cloud migration, or governance project. AI will surface and amplify whatever data governance problems already exist in your tenant. Migrations that land in a poorly governed tenant inherit its problems at scale. And governance projects that begin without a clear current-state baseline are guessing at what to fix.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Who This Is For ──────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Fit</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who This Assessment Is For</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">This assessment is designed for specific organisational profiles where M365 tenant health directly determines security, compliance, and AI readiness outcomes.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {ICP_SEGMENTS.map((seg) => (
              <div key={seg.label} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <div className="shrink-0 mt-0.5">{seg.icon}</div>
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1.5">{seg.label}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{seg.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 4: How It Works ─────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">The Process</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">How This Assessment Works</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Five steps from start to personalised report — designed to surface real findings in under five minutes.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {HOW_STEPS.map((s) => (
              <div key={s.step} className="bg-white rounded-2xl border border-border p-6 hover:border-[#0078D4]/30 transition-all">
                <div className="text-[#0078D4] text-3xl font-extrabold mb-3 leading-none">{s.step}</div>
                <h3 className="font-bold text-[#0A2540] mb-2">{s.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
            <div className="bg-[#0078D4] rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3">Ready?</p>
                <p className="text-white font-bold text-lg mb-3 leading-snug">Start your free assessment now</p>
                <p className="text-white/60 text-sm leading-relaxed">Takes 5 minutes. No account required.</p>
              </div>
              <CTAButton onClick={() => setModalOpen(true)} className="mt-6 bg-white text-[#0078D4] hover:bg-white/90">
                Take the Assessment <ArrowRight className="w-4 h-4" />
              </CTAButton>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 5: Five Health Dimensions ──────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">What We Assess</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">The Five Health Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Every Microsoft 365 tenant has the same failure modes. This assessment finds yours before they become incidents.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PILLARS.map((p) => (
              <div key={p.label} className="p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <div className="flex gap-3 mb-3">
                  {p.icon}
                  <h3 className="font-bold text-[#0A2540] text-lg">{p.label}</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">{p.desc}</p>
                <ul className="space-y-1.5">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-[#0A2540]/70">
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 6: What You Receive ─────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Your Deliverable</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">What You Receive</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">A personalised PDF report — emailed the moment you complete the assessment — containing eight distinct findings sections.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {DELIVERABLES.map((d) => (
              <div key={d.label} className="bg-white rounded-2xl border border-border p-5 hover:border-[#0078D4]/30 transition-all">
                <div className="mb-3">{d.icon}</div>
                <h3 className="font-bold text-[#0A2540] text-sm mb-1.5">{d.label}</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">{d.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 7: Inside Your PDF Report ──────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Report Structure</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">Inside Your PDF Report</h2>
              <p className="text-[#0A2540]/70 text-base leading-relaxed mb-8">
                Your report is structured for two audiences — a one-page executive summary for leadership, and a detailed technical section for your IT team. Both are included in every PDF.
              </p>
              <div className="space-y-4">
                {REPORT_SECTIONS.map((rs, i) => (
                  <div key={rs.title} className="flex gap-4">
                    <div className="w-7 h-7 rounded-full bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <p className="font-bold text-[#0A2540] text-sm">{rs.title}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{rs.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8 text-white">
              <FileText className="w-10 h-10 text-[#0078D4] mb-5" />
              <p className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-2">Sample Report</p>
              <h3 className="text-2xl font-extrabold mb-2">Microsoft 365 Tenant Health Report</h3>
              <p className="text-white/60 text-sm mb-6 leading-relaxed">Prepared by Shane McCaw Consulting · NASA-Methodology Assessment</p>
              <div className="space-y-3">
                {["Overall Health Score: 34/50", "Maturity Tier: Developing", "High-Risk Areas: 3 identified", "Configuration Gaps: 12 findings", "Priority Actions: 5 immediate"].map((line) => (
                  <div key={line} className="flex items-center gap-2 text-sm text-white/70">
                    <CheckCircle className="w-4 h-4 text-[#00B4D8] shrink-0" />
                    {line}
                  </div>
                ))}
              </div>
              <CTAButton onClick={() => setModalOpen(true)} className="mt-8 w-full">
                Get Your Report Free <ArrowRight className="w-4 h-4" />
              </CTAButton>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 8: Why Shane ────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Why Shane McCaw</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Authority You Can Trust</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">This assessment is built on 30 years of Microsoft ecosystem experience and active, senior-level delivery — not templated tooling or offshore reports.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHY_SHANE.map((w) => (
              <div key={w.title} className="bg-white rounded-2xl border border-border p-6 hover:border-[#0078D4]/30 transition-all">
                <div className="mb-4">{w.icon}</div>
                <h3 className="font-bold text-[#0A2540] mb-2">{w.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 9: CTA Reinforcement ────────────────────────────────────── */}
      <section className="py-20 bg-[#0A2540]">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Know your tenant health before it becomes a problem.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">Most M365 tenants accumulate configuration debt invisibly. Licensing waste, security gaps, and governance lapses compound quietly — until an audit, a breach, or a failed Copilot rollout surfaces them all at once.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly · Built on NASA-grade assessment methodology</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
