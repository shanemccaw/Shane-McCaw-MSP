import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { CheckCircle, Shield, Building2, Users, AlertTriangle, FileText, BarChart3, Award, Lock, ClipboardList, Target, BookOpen, ShieldCheck } from "lucide-react";

const config: QuizConfig = {
  quizType: "governance",
  title: "M365 Governance Maturity Assessment",
  introTitle: "How Mature Is Your Microsoft 365 Governance Framework?",
  introDescription:
    "Answer 10 AI-powered questions across 5 governance dimensions. Takes around 5 minutes. You'll receive a personalised PDF governance maturity report — delivered instantly to your inbox.",
  categories: [
    { key: "policiesRoles", label: "Policies & Roles" },
    { key: "lifecycleManagement", label: "Lifecycle Management" },
    { key: "securityComplianceControls", label: "Security & Compliance Controls" },
    { key: "monitoringReporting", label: "Monitoring & Reporting" },
    { key: "adoptionAccountability", label: "Adoption & Accountability" },
  ],
  fallbackQuestions: [
    "Has your organisation deployed Data Loss Prevention (DLP) policies in Microsoft 365 — for example, policies that detect and block the sharing of social security numbers, financial records, or health information via email, Teams, or SharePoint?",
    "Has your organisation implemented Microsoft Purview sensitivity labels to classify documents and emails by confidentiality level — and are these labels applied automatically, manually, or not at all?",
    "Are your records management and retention schedules configured in Microsoft 365 — for example, using Microsoft Purview Retention Policies to automatically retain or delete content according to your legal and regulatory obligations?",
    "How does your organisation handle records that are subject to litigation hold or eDiscovery? Have you tested and documented the process for placing a hold on mailboxes and SharePoint sites when legally required?",
    "Who has administrative access to your Microsoft 365 tenant, and how is that access governed? For example, are admin roles assigned on a least-privilege basis, are they reviewed periodically, and is Privileged Identity Management (PIM) in use?",
    "How is external guest access managed in your Microsoft 365 environment? Do you have policies that control who can be invited, what they can access, and when their access expires — or is guest access largely unrestricted?",
    "Which regulatory or compliance frameworks is your organisation subject to — for example, HIPAA, CMMC Level 2, FedRAMP Moderate/High, SOX, ITAR, GDPR — and have the relevant Microsoft Purview compliance controls been configured to support these requirements?",
    "Has your organisation conducted a compliance assessment or gap analysis against your applicable frameworks within the last 12 months — and are the identified gaps being actively tracked and remediated?",
    "Does your organisation have documented Microsoft 365 governance policies — for example, an acceptable use policy, a Teams and SharePoint governance document, a data classification policy, and an admin access review process — that are current and accessible to staff?",
    "Are your governance policies actively enforced through technical controls in Microsoft 365 — for example, DLP policies that block policy violations, Conditional Access that enforces device compliance, or Purview compliance policies with automated retention actions — or are they primarily paper-based with limited technical enforcement?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Critical · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your organisation is operating without the governance controls required to protect sensitive data, meet regulatory obligations, or pass an audit. The Governance Foundations Package builds the complete framework your environment needs — from DLP and sensitivity labels to retention schedules and compliance alignment.",
      slug: "governance-foundations-package",
      ctaText: "Build Your Governance Framework",
    },
    Developing: {
      badge: "Recommended · From $12,000",
      name: "Governance Foundations Package",
      description:
        "You have some governance controls, but gaps in your DLP, retention, or compliance alignment create real regulatory and security risk. This engagement builds the complete, defensible governance framework your organisation needs.",
      slug: "governance-foundations-package",
      ctaText: "Close Your Governance Gaps",
    },
    Emerging: {
      badge: "Next Step · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your governance is developing, but it's not yet complete or consistent. A formal Governance Foundations engagement will systematise your controls, fill the gaps, and produce the documentation required for audit readiness.",
      slug: "governance-foundations-package",
      ctaText: "Complete Your Governance Framework",
    },
    Advanced: {
      badge: "High Impact · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your governance is mature and defensible. With strong DLP, sensitivity labels, and compliance controls in place, you're well-positioned to evaluate Copilot — which relies on exactly these controls to operate safely.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Assess Copilot Readiness",
    },
    Ready: {
      badge: "Enterprise Grade · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your governance framework is excellent. Copilot will operate safely within your environment because the necessary data governance controls are already in place. Validate your full readiness and deploy with confidence.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Deploy Copilot on Solid Governance",
    },
  },
  reportTitle: "Microsoft 365 Governance Maturity Assessment Report",
  pdfFilename: "governance-maturity-report.pdf",
  introFeatureLabels: ["5 governance dimensions", "Maturity tier rating", "PDF report emailed"],
};

const PILLARS = [
  {
    label: "Policies & Roles",
    desc: "Whether formal governance policies exist and are actively maintained. Covers ownership structure, the RACI model for M365 governance decisions, policy review cycles, and whether accountability for governance outcomes is clearly assigned. Without a defined owner, governance erodes silently.",
  },
  {
    label: "Lifecycle Management",
    desc: "How Teams, SharePoint sites, Microsoft 365 Groups, mailboxes, and guest accounts are managed from creation to deletion. Covers owner accountability, archiving and deletion procedures, inactive resource remediation, expiry policies, and the sprawl risk that accumulates without lifecycle controls.",
  },
  {
    label: "Security & Compliance Controls",
    desc: "Technical enforcement of governance through native M365 controls — Conditional Access policies, Privileged Identity Management (PIM), sensitivity labels, DLP policies, retention schedules, and Purview Compliance Manager configuration. Measures the gap between policy intent and technical reality.",
  },
  {
    label: "Monitoring & Reporting",
    desc: "How governance compliance is monitored and reported over time. Covers Compliance Manager score tracking, M365 admin reports, audit log review frequency, who reviews what, and whether governance health is visible to leadership — or invisible until an incident forces attention.",
  },
  {
    label: "Adoption & Accountability",
    desc: "How governance policies are communicated to end users, new joiners, and administrators. Covers training approach, awareness of acceptable use, accountability mechanisms for policy violations, exception handling, and whether governance culture is embedded or exists only on paper.",
  },
];

const ICP_TARGETS = [
  { icon: <Building2 className="w-5 h-5" />, label: "Mid-market organisations", desc: "200–2,000 employees with Microsoft 365 tenants that have grown without formal governance controls." },
  { icon: <ShieldCheck className="w-5 h-5" />, label: "Regulated industries", desc: "Healthcare (HIPAA), financial services (SOC 2, FINRA), and legal firms operating under strict data governance obligations." },
  { icon: <Lock className="w-5 h-5" />, label: "Government contractors", desc: "Organisations pursuing or maintaining CMMC Level 2, ITAR compliance, or FedRAMP authorisation who need defensible governance evidence." },
  { icon: <AlertTriangle className="w-5 h-5" />, label: "SharePoint & Teams sprawl", desc: "Environments with hundreds of sites, abandoned groups, unrestricted guest access, and no lifecycle policy in place." },
  { icon: <Target className="w-5 h-5" />, label: "Copilot or audit preparation", desc: "Organisations preparing for a Copilot deployment or facing an upcoming compliance audit who need to know their posture now." },
  { icon: <Users className="w-5 h-5" />, label: "IT teams without a framework", desc: "IT leaders and M365 admins who know governance is important but lack the structured framework to act on it." },
];

const HOW_IT_WORKS_STATS = [
  { stat: "10", label: "Targeted questions", desc: "Precisely calibrated to surface governance gaps across all five dimensions." },
  { stat: "5", label: "Governance dimensions", desc: "Policies & Roles, Lifecycle, Security Controls, Monitoring, and Adoption." },
  { stat: "NASA", label: "Grade scoring", desc: "Scored using the same governance framework Shane applied as Lead M365 Architect at NASA." },
  { stat: "PDF", label: "Instant report", desc: "A personalised governance maturity report delivered to your inbox immediately." },
  { stat: "0", label: "Account required", desc: "No login, no account, no subscription. Just your answers and your report." },
  { stat: "0", label: "Sales call required", desc: "Your results are yours. No follow-up calls unless you ask for them." },
];

const WHAT_YOU_RECEIVE = [
  "Overall maturity score across all five governance dimensions",
  "Policy and ownership gap analysis — where accountability is undefined",
  "Lifecycle management gaps — Teams, Sites, Groups, and guest accounts",
  "Security and compliance control gaps — DLP, sensitivity labels, PIM, Purview",
  "Monitoring weaknesses — where governance health is invisible",
  "Recommended next steps prioritised by risk and regulatory impact",
  "Architecture notes relevant to your compliance posture",
  "A priority remediation roadmap for your governance programme",
];

const PDF_SECTIONS = [
  { title: "Executive Summary", desc: "A one-page governance maturity verdict your CISO, CTO, or board can read in 90 seconds." },
  { title: "Dimension-by-Dimension Scoring", desc: "Individual scores across all five governance dimensions with detailed commentary on each gap." },
  { title: "Governance Maturity Heatmap", desc: "A visual representation of your governance posture — showing strengths, gaps, and critical risk areas at a glance." },
  { title: "Gap Analysis", desc: "A detailed breakdown of specific control gaps, policy omissions, and lifecycle risks identified by your responses." },
  { title: "Remediation Path", desc: "A sequenced remediation plan — what to fix first, what to fix next, and what can wait without increasing risk." },
  { title: "Suggested Quick Wins", desc: "Targeted service recommendations drawn from the Governance Foundations Package, Tenant Health Audit, and SharePoint IA Rebuild — mapped directly to your gaps." },
];

const WHY_SHANE = [
  { title: "Lead M365 Architect at NASA", desc: "Shane designed and implemented the governance framework for one of the world's most security-sensitive Microsoft 365 tenants — a 60,000-user environment operating under ITAR, CMMC, and FedRAMP requirements." },
  { title: "30 years in the Microsoft ecosystem", desc: "From early SharePoint deployments through Entra ID, Purview, and Copilot — Shane has navigated every major shift in the M365 governance landscape and knows where organisations consistently fall short." },
  { title: "Senior-only delivery", desc: "Every engagement is delivered by Shane directly. No juniors handed a checklist. You get the expertise you're paying for on every call, in every document, and in every recommendation." },
  { title: "Regulated industry expertise", desc: "Shane has worked across federal government, defence contractors, financial services, and healthcare — industries where governance failures carry regulatory, legal, and reputational consequences." },
  { title: "Governance-first methodology", desc: "Shane's approach treats governance as the foundation for everything — security, compliance, Copilot adoption, and audit readiness. Governance done right makes every other initiative easier and safer." },
];

export default function GovernanceQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Governance Maturity Assessment | Shane McCaw Consulting"
        description="How mature is your M365 governance framework? Take our free assessment to benchmark your policies, lifecycle management, and compliance posture — with a personalised PDF report."
        ogImage="/og-image-governance-quiz.png"
        ogUrl="https://shanemccaw.com/governance-maturity-quiz"
      />

      {/* ── 1. Hero ────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <Shield className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Governance Maturity Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 governance dimensions. A personalized maturity report delivered instantly.
          </p>
          <p className="text-[#00B4D8] text-sm font-medium mt-4 max-w-2xl">
            Built on the same governance and compliance framework Shane applied as Lead M365 Architect at NASA.
          </p>
          <p className="text-white/45 text-sm mt-2 max-w-2xl">
            Designed for mid-market organisations, regulated industries, and government contractors who need to know their M365 governance posture before an auditor does.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <CTAButton onClick={() => setModalOpen(true)}>Take the Free Assessment</CTAButton>
            <a href="/book" className="inline-flex items-center gap-2 text-white/70 hover:text-white font-semibold text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40 transition-colors">
              Book a Discovery Call
            </a>
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

      {/* ── 2. Why This Assessment Exists ─────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Why This Exists</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
              Most organisations discover their governance gaps during an audit — not before it.
            </h2>
            <div className="space-y-5 text-[#4A5568] leading-relaxed text-base">
              <p>
                Governance drift is silent. It accumulates over years of organic growth — Teams channels created without owners, SharePoint sites with no lifecycle policy, guest accounts that never expire, and DLP rules that were configured once and never reviewed. None of it looks broken until an auditor, a breach, or a Copilot deployment makes it impossible to ignore.
              </p>
              <p>
                Microsoft 365 defaults are not governance. A tenant with default settings passes none of the tests that HIPAA, CMMC, SOC 2, or FedRAMP require. Sensitivity labels aren't applied. Retention policies aren't configured. Admin access isn't scoped. Compliance Manager shows a score, but nobody's looking at it.
              </p>
              <p>
                Teams sprawl and SharePoint proliferation aren't productivity problems — they're governance problems. When ownership is undefined, lifecycle policies don't exist, and identity isn't tightly managed, sensitive data moves freely across a tenant that was never designed to contain it.
              </p>
              <p>
                Governance is the foundation for everything. Security posture, audit readiness, Copilot adoption — all of it depends on governance controls being in place and actively enforced. This assessment tells you exactly where your foundation is solid and where it isn't.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Who This Is For ────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Candidate Profile</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white">Who This Assessment Is For</h2>
            <p className="text-white/55 mt-4 max-w-xl mx-auto">
              This assessment is built for organisations where governance risk is real — not theoretical.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {ICP_TARGETS.map((item) => (
              <div key={item.label} className="flex gap-4 p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/8 hover:border-[#0078D4]/30 transition-all">
                <div className="text-[#0078D4] flex-shrink-0 mt-0.5">{item.icon}</div>
                <div>
                  <h3 className="font-bold text-white mb-1.5">{item.label}</h3>
                  <p className="text-white/55 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. How This Assessment Works ─────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">How It Works</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">A Rigorous Assessment in 5 Minutes</h2>
            <p className="text-[#4A5568] mt-4 max-w-xl mx-auto">
              10 carefully structured questions. AI-scored across 5 dimensions. Benchmarked against the governance framework used at NASA.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {HOW_IT_WORKS_STATS.map((item) => (
              <div key={item.label} className="bg-white rounded-2xl border border-border p-6 hover:border-[#0078D4]/30 hover:shadow-sm transition-all">
                <p className="text-4xl font-extrabold text-[#0078D4] mb-2">{item.stat}</p>
                <p className="font-bold text-[#0A2540] mb-1">{item.label}</p>
                <p className="text-[#4A5568] text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. Five Governance Dimensions ────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">What We Assess</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Governance Dimensions</h2>
            <p className="text-[#4A5568] mt-4 max-w-2xl mx-auto">
              Each dimension represents a critical layer of Microsoft 365 governance. Together, they determine whether your organisation is audit-ready, breach-resistant, and positioned to adopt Copilot safely.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PILLARS.map((p, i) => (
              <div key={p.label} className="flex gap-5 p-7 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <div className="w-9 h-9 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[#0078D4] text-sm font-extrabold">{i + 1}</span>
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] text-lg mb-2">{p.label}</h3>
                  <p className="text-[#4A5568] text-sm leading-relaxed">{p.desc}</p>
                </div>
              </div>
            ))}
            <div className="flex gap-5 p-7 rounded-2xl border border-[#0078D4]/20 bg-[#0078D4]/5 md:col-span-2 items-center">
              <CheckCircle className="w-8 h-8 text-[#0078D4] flex-shrink-0" />
              <p className="text-[#0A2540] text-sm leading-relaxed">
                <strong>Each dimension is scored independently.</strong> Your report shows exactly which dimensions are mature, which are developing, and which represent the highest-priority risk for your organisation — so remediation effort goes where it matters most.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. What You Receive ───────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Your Deliverable</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-5">
                What You Receive
              </h2>
              <p className="text-[#4A5568] leading-relaxed mb-8">
                Every assessment produces a personalised PDF governance maturity report — tailored to your specific responses, not a generic template. It's the same diagnostic rigour Shane applies in paid client engagements, delivered free in five minutes.
              </p>
              <CTAButton onClick={() => setModalOpen(true)}>Take the Free Assessment</CTAButton>
              <p className="text-[#4A5568] text-xs mt-3">5 minutes · Free PDF report · No sales call required</p>
            </div>
            <div className="space-y-3">
              {WHAT_YOU_RECEIVE.map((item) => (
                <div key={item} className="flex items-start gap-3 bg-white p-4 rounded-xl border border-border">
                  <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                  <p className="text-[#0A2540] text-sm font-medium">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. Inside Your PDF Report ────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Report Structure</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white">Inside Your PDF Report</h2>
            <p className="text-white/55 mt-4 max-w-xl mx-auto">
              Your governance maturity report is structured for both technical and executive audiences — actionable at every level.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {PDF_SECTIONS.map((section, i) => (
              <div key={section.title} className="p-6 rounded-2xl border border-white/10 bg-white/5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-[#0078D4]/20 flex items-center justify-center text-[#0078D4] text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  <h3 className="font-bold text-white">{section.title}</h3>
                </div>
                <p className="text-white/55 text-sm leading-relaxed">{section.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. Why Shane ─────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Why Shane</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">The Authority Behind This Assessment</h2>
            <p className="text-[#4A5568] mt-4 max-w-xl mx-auto">
              This isn't a vendor quiz designed to generate leads. It's a practitioner-built diagnostic grounded in 30 years of real enterprise governance work.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl bg-white border border-border hover:border-[#0078D4]/30 hover:shadow-sm transition-all">
                <BookOpen className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-1" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1.5">{item.title}</h3>
                  <p className="text-[#4A5568] text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 9. CTA Reinforcement ─────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 800px 400px at 50% 100%, rgba(0,120,212,0.10) 0%, transparent 70%)" }} />
        <div className="max-w-[700px] mx-auto px-6 text-center relative">
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-5 leading-tight">
            Your governance maturity determines your audit readiness, compliance posture, and Copilot success.
          </h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">
            Don't find out where your gaps are during an audit. Take the free assessment now — get your personalised PDF governance maturity report in five minutes, with no account required and no sales call attached.
          </p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">
            Take the Free Assessment
          </CTAButton>
          <div className="mt-6 flex justify-center flex-wrap gap-5">
            {["5 minutes", "Free PDF report", "No sales call required"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-white/40 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                {item}
              </div>
            ))}
          </div>
          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="text-white/40 text-sm mb-3">Prefer a conversation first?</p>
            <a href="/book" className="inline-flex items-center gap-2 text-white/70 hover:text-white font-semibold text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40 transition-colors">
              Book a Discovery Call
            </a>
          </div>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
