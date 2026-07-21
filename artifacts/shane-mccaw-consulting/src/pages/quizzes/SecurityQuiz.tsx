import { useState } from "react";
import { Layout } from "@/components/Layout";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { WorkflowSteps } from "@/components/design-system/WorkflowSteps";
import {
  ShieldCheck,
  CheckCircle,
  Building2,
  AlertTriangle,
  Target,
  Database,
  ArrowRight,
  Lock,
  Globe,
  Users,
  FileText,
  Award,
  BarChart3,
  Zap,
  Download,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const config: QuizConfig = {
  quizType: "security-compliance",
  title: "M365 Security Posture Assessment",
  introTitle: "How Secure Is Your Microsoft 365 Environment?",
  introDescription:
    "Answer 10 AI-powered questions across 5 security dimensions. Takes around 5 minutes. You'll receive a personalised PDF security report by email.",
  categories: [
    { key: "identityAccess", label: "Identity & Access Control" },
    { key: "dataProtection", label: "Data Protection" },
    { key: "insiderRiskCompliance", label: "Insider Risk & Compliance" },
    { key: "auditEDiscovery", label: "Audit & eDiscovery" },
    { key: "regulatoryReadiness", label: "Regulatory Readiness" },
  ],
  fallbackQuestions: [
    "Is Multi-Factor Authentication enforced for all users in your organisation — including admins, contractors, and shared accounts — and have you implemented Conditional Access policies that go beyond basic MFA to enforce compliant devices, risk-based access, or location restrictions?",
    "Have you deployed Privileged Identity Management (PIM) or equivalent just-in-time access controls for your Global Administrators and other privileged roles, or do admin accounts have persistent standing access?",
    "Does your organisation use Microsoft Purview sensitivity labels to classify and protect sensitive documents — for example, automatically encrypting files or blocking external sharing — or is labelling inconsistent and manually applied?",
    "Are Data Loss Prevention policies configured in Microsoft 365 to detect and prevent exfiltration of sensitive data through email, Teams, SharePoint, or OneDrive — and have those policies been tested to confirm they're blocking as expected?",
    "Has your organisation deployed Microsoft Purview Insider Risk Management policies — for example, detecting data theft, policy violations, or disgruntled employee activity — or is insider risk currently unmonitored?",
    "Is Microsoft Purview Communication Compliance configured to monitor for regulatory violations, harassment, or inappropriate content in Microsoft Teams and email communications?",
    "Are Microsoft 365 Unified Audit Logs enabled and retained for at least 90 days — and does your organisation have a documented process for regularly reviewing audit logs or alerting on suspicious activity?",
    "Has your organisation successfully run an eDiscovery case or Content Search in Microsoft Purview — for example, in response to a legal hold, HR investigation, or regulatory request — or has that capability never been tested?",
    "What compliance frameworks is your organisation subject to — such as HIPAA, CMMC, FedRAMP, SOX, GDPR, or NIST — and have the corresponding Microsoft Purview Compliance Manager controls been configured and assessed?",
    "Has your organisation used Microsoft Purview Compliance Manager to review your current compliance score, identify improvement actions, and prioritise remediation to close regulatory gaps?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Critical",
      name: "Governance Foundations Package",
      description:
        "Your Microsoft 365 security posture has significant gaps that represent real organisational risk. The Governance Foundations Package establishes the DLP policies, sensitivity labels, conditional access framework, and compliance controls your environment urgently needs.",
      slug: "governance-foundations-package",
      ctaText: "Secure Your Environment Now",
    },
    Developing: {
      badge: "Recommended",
      name: "Governance Foundations Package",
      description:
        "You have some controls in place but gaps in your DLP, compliance, or identity governance create exploitable risk. This engagement builds a complete, defensible security and governance framework across your M365 tenant.",
      slug: "governance-foundations-package",
      ctaText: "Close Your Security Gaps",
    },
    Emerging: {
      badge: "Next Step",
      name: "Governance Foundations Package",
      description:
        "Your security posture is developing well. Formalising your governance framework will transform your ad-hoc security controls into a documented, auditable, and defensible compliance posture.",
      slug: "governance-foundations-package",
      ctaText: "Formalise Your Security Governance",
    },
    Advanced: {
      badge: "High Impact",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your security posture is strong. With solid identity, data protection, and compliance controls in place, you're well-positioned to deploy Copilot safely — assess your readiness and do it right.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Deploy Copilot Securely",
    },
    Ready: {
      badge: "Enterprise Grade",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your M365 security is enterprise-grade. Copilot is the natural next step — validate your full deployment readiness and ensure Copilot inherits your strong security and compliance foundations.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Validate Copilot Readiness",
    },
  },
  reportTitle: "Microsoft 365 Security Posture Assessment Report",
  pdfFilename: "m365-security-assessment-report.pdf",
  introFeatureLabels: ["5 security dimensions", "Risk tier rating", "PDF report emailed"],
};

const DIMENSIONS = [
  {
    colour: "bg-blue-500",
    label: "Dimension 1",
    title: "Identity & Access Control",
    measures: "MFA enforcement across all users including admins and contractors, Conditional Access policy coverage, Privileged Identity Management deployment, admin role hygiene, and whether standing privileged access exists.",
    matters: "Identity is the primary attack vector in Microsoft 365. Overprivileged admins, absent MFA, and weak Conditional Access policies are the most common causes of tenant compromise — and the most preventable.",
    fail: "MFA not enforced for all users; Global Admins with persistent access; no PIM; contractors and shared accounts excluded from baseline controls.",
    ready: "MFA enforced for all users, PIM deployed for privileged roles, Conditional Access covering all apps, device compliance baseline in place.",
  },
  {
    colour: "bg-teal-500",
    label: "Dimension 2",
    title: "Data Protection",
    measures: "Microsoft Purview sensitivity label coverage and enforcement, DLP policy maturity across Exchange, SharePoint, Teams, and OneDrive, automatic labelling rules, and external sharing controls.",
    matters: "Without classification and DLP enforcement, sensitive data is one misconfigured sharing link away from external exposure. This gap is invisible until it's exploited — or until Copilot surfaces it to the wrong user.",
    fail: "No sensitivity labels deployed or inconsistently applied; DLP policies absent or set to audit-only; no auto-labelling for regulated content.",
    ready: "Labels applied across tenant, DLP policies enforced in block mode for key workloads, auto-labelling active for regulated content types.",
  },
  {
    colour: "bg-violet-500",
    label: "Dimension 3",
    title: "Insider Risk & Compliance",
    measures: "Microsoft Purview Insider Risk Management policies, Communication Compliance configuration, retention and deletion policy coverage, and whether high-risk user activity scenarios are actively monitored.",
    matters: "Insider threats — data theft, policy violations, departing employee exfiltration — are often undetected because organisations have never configured the tooling to surface them. The risk is already present.",
    fail: "No Insider Risk Management policies; Communication Compliance not deployed; no documented retention or deletion policies.",
    ready: "Insider Risk policies active for high-risk scenarios, Communication Compliance monitoring regulated communications, retention policies documented and enforced.",
  },
  {
    colour: "bg-orange-500",
    label: "Dimension 4",
    title: "Audit & eDiscovery",
    measures: "Unified Audit Log enablement and retention, Audit Premium licensing, eDiscovery case readiness, Content Search coverage, and litigation hold capability.",
    matters: "When a breach, legal hold, or regulatory investigation occurs, audit logs are your only verifiable record. Organisations without active audit log retention have no defence and no evidence trail.",
    fail: "Audit logs not enabled or retained below 90 days; no Audit Premium licensing; eDiscovery has never been tested; no litigation hold process.",
    ready: "Audit logs enabled for all workloads, retained 12+ months, Audit Premium active, eDiscovery tested end-to-end, litigation hold process documented.",
  },
  {
    colour: "bg-green-500",
    label: "Dimension 5",
    title: "Regulatory Readiness",
    measures: "Compliance Manager score and assessment coverage, framework mapping (HIPAA, CMMC, FedRAMP, SOX, GDPR, NIST), Purview compliance controls configuration, and audit-readiness posture.",
    matters: "Regulatory compliance is not a one-time project — it requires continuous control monitoring. Organisations without an active compliance posture face audit exposure every quarter.",
    fail: "Compliance Manager score never reviewed; no framework assessments configured; compliance controls undocumented; no evidence collection process.",
    ready: "Compliance Manager assessments active for applicable frameworks, controls documented and assigned, improvement actions tracked and prioritised.",
  },
];

export default function SecurityQuiz() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Security & Compliance Assessment | Shane McCaw Consulting"
        description="How secure is your Microsoft 365 environment? Take our free security posture quiz covering Defender, Conditional Access, DLP, and sensitivity labels — with a PDF report included."
        ogImage="/og-image-security-quiz.png"
        ogUrl="https://shanemccaw.com/security-compliance-quiz"
      />

      {/* ── 1. Hero ── */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            Free Security Assessment
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Most M365 Security Gaps <GradientText>Are Silent.</GradientText>
            <br className="hidden md:block" /> Until They're Exploited.
          </h1>

          <p className="text-text-secondary text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            Misconfigured Conditional Access, overprivileged admins, absent DLP policies, and unmonitored insider risk are found and exploited every day in Microsoft 365 tenants that assume they're secure.
          </p>
          <p className="text-text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question assessment — built on the same Zero Trust and compliance framework Shane applies as Lead M365 Architect at NASA — identifies exactly where your security posture is exposed before an auditor or attacker does.
          </p>

          <p className="text-text-tertiary text-sm font-medium mb-10 max-w-xl mx-auto">
            Built for mid-market organisations and regulated industries where a security gap is never just a technical problem.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "security dimensions" },
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
            {["5 minutes", "Free PDF report", "No sales call required"].map((item) => (
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
            Microsoft 365 security gaps are invisible — until they're catastrophic.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Most M365 breaches don't come from sophisticated attacks. They come from misconfiguration: MFA gaps, overprivileged admins, absent DLP, and inactive audit logging. These gaps exist silently in the majority of tenants — and surface only when an auditor finds them, or an attacker does it first.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Lock,
                title: "Identity drift accumulates over time",
                body: "Admin roles proliferate, MFA exemptions multiply, and Conditional Access policies go untested. What started as a controlled environment develops exploitable gaps year over year — without anyone noticing.",
              },
              {
                icon: AlertTriangle,
                title: "Misconfiguration is the leading cause of breach",
                body: "Absent DLP policies, overpermissioned SharePoint sites, unreviewed external sharing, and uninvestigated audit events are responsible for the majority of M365 data exposure incidents. They're not sophisticated attacks — they're overlooked defaults.",
              },
              {
                icon: ShieldCheck,
                title: "Security posture must be verified before Copilot or migrations",
                body: "Copilot surfaces data from across your tenant based on the permissions already in place. A weak security posture before deployment becomes a data governance liability at scale. The same applies to SharePoint migrations and governance initiatives.",
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
            Built for organisations where a security gap has real consequences.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            If you're in any of these groups, you need this assessment before your next audit, deployment, or migration.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organisations",
                body: "200–2,000 employees with a Microsoft 365 tenancy that has grown over time and whose security controls have never been formally assessed or benchmarked.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "Healthcare, financial services, insurance, and legal organisations operating under HIPAA, SOC 2, FINRA, or sector-specific frameworks where a misconfigured tenant creates direct regulatory exposure.",
              },
              {
                icon: Globe,
                title: "Contractually obligated compliance teams",
                body: "Healthcare and financial services organizations subject to HIPAA, SOC 2, or similar requirements where M365 security posture is part of a contractual or audit obligation.",
              },
              {
                icon: AlertTriangle,
                title: "Organisations preparing for an audit",
                body: "Any organisation that has received an audit notice, failed a previous review, or knows their compliance controls are undocumented and needs to understand the gaps before auditors arrive.",
              },
              {
                icon: Target,
                title: "Teams uncertain about identity or DLP posture",
                body: "IT and security teams who manage M365 day-to-day but have never run a structured assessment across identity, data protection, insider risk, and compliance dimensions end-to-end.",
              },
              {
                icon: Database,
                title: "Organisations preparing for Copilot or governance work",
                body: "Any organisation considering Copilot deployment, a SharePoint migration, or a governance initiative that needs to verify their security foundation is sound before proceeding.",
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
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">From first question to PDF in under five minutes.</h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            Ten questions. Five security dimensions. A scoring model built by the M365 Architect at NASA. An instant risk score, a personalised PDF report, and a recommended next step — delivered to your inbox the moment you finish.
          </p>
          <div className="max-w-2xl mx-auto">
            <WorkflowSteps
              steps={[
                {
                  title: "Answer 10 targeted security questions",
                  description: "Each question maps to one of five security dimensions. These are the same diagnostic questions Shane uses in a paid security assessment engagement, compressed into a 5-minute format designed for IT leads and compliance officers.",
                },
                {
                  title: "Receive an instant risk score across 5 dimensions",
                  description: "Your answers are scored across all five dimensions using a structured scoring model. You receive a total risk score, a maturity tier (Critical / At Risk / Developing / Secure), and a per-dimension breakdown showing exactly where you're exposed.",
                },
                {
                  title: "Get a personalised PDF security report delivered to your inbox",
                  description: "A branded, personalised PDF lands in your inbox immediately. It includes your score, gap analysis, the specific security risks identified in your environment, and Shane's recommended next step — no sales call required.",
                },
              ]}
            />
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

      {/* ── 5. The Five Security & Compliance Dimensions ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">The Five Security & Compliance Dimensions</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            What the assessment <GradientText>measures</GradientText> — and why it matters.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether your Microsoft 365 environment is genuinely secure or quietly exposed. Each is scored independently so you know exactly where to focus your remediation effort.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {DIMENSIONS.map((item) => (
              <div key={item.title} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2 h-10 rounded-full ${item.colour}`} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">{item.label}</p>
                    <h3 className="font-display font-bold text-lg text-text-primary">{item.title}</h3>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-semibold text-text-primary text-xs uppercase tracking-wide mb-1">What it measures</p>
                    <p className="text-text-secondary leading-relaxed">{item.measures}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary text-xs uppercase tracking-wide mb-1">Why it matters</p>
                    <p className="text-text-secondary leading-relaxed">{item.matters}</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">Failure looks like</p>
                      <p className="text-xs text-text-secondary leading-relaxed">{item.fail}</p>
                    </div>
                    <div className="flex-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                      <p className="text-xs font-bold text-emerald-400 uppercase tracking-wide mb-1">Readiness looks like</p>
                      <p className="text-xs text-text-secondary leading-relaxed">{item.ready}</p>
                    </div>
                  </div>
                </div>
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
                  All five dimensions scored, ranked by risk level, and mapped to a tailored service recommendation. Personalised PDF security report delivered to your inbox the moment you finish.
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
            A personalised security risk report. Free. Instant.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real report — the same diagnostic framework Shane applies in paid security assessment engagements — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Overall security risk score",
                body: "A 0–50 risk score across all five dimensions with your maturity tier — Critical, At Risk, Developing, or Secure — so you know exactly where you stand.",
              },
              {
                icon: Users,
                title: "Identity & access gap analysis",
                body: "The specific MFA, Conditional Access, and privileged access gaps identified in your environment, ranked by exploitability and remediation priority.",
              },
              {
                icon: ShieldCheck,
                title: "Threat protection gaps",
                body: "An assessment of your Defender for Office 365 configuration, Safe Links, Safe Attachments, and incident response readiness against current threat patterns.",
              },
              {
                icon: FileText,
                title: "DLP & labelling gap report",
                body: "Where your data classification and DLP policies have coverage gaps — and which workloads are currently unprotected and most exposed to data exfiltration.",
              },
              {
                icon: Globe,
                title: "External access risk profile",
                body: "An assessment of external sharing settings, guest access policies, and third-party app permissions across your tenant that could expose sensitive data.",
              },
              {
                icon: Award,
                title: "Compliance posture & roadmap",
                body: "Your current regulatory posture mapped against applicable frameworks, with a prioritised remediation roadmap aligned to your compliance obligations.",
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
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">Inside Your PDF Report</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                A structured security report your leadership team can act on.
              </h2>
              <p className="text-text-secondary text-lg leading-relaxed">
                This isn't a score card with generic advice. The PDF report is structured to be shared — with your IT team, your compliance officer, or your executive sponsor — and includes everything needed to prioritise remediation without a follow-up engagement.
              </p>
            </div>
            <div className="space-y-3">
              {[
                {
                  n: "01",
                  title: "Executive summary",
                  desc: "A concise, non-technical risk narrative and overall score formatted for leadership review and board reporting.",
                },
                {
                  n: "02",
                  title: "Dimension-by-dimension scoring",
                  desc: "Detailed score breakdown for each of the five security dimensions with individual risk ratings.",
                },
                {
                  n: "03",
                  title: "Security heatmap",
                  desc: "A visual representation of risk concentration across your tenant workloads, showing where exposure is highest.",
                },
                {
                  n: "04",
                  title: "Gap analysis",
                  desc: "Specific control gaps identified across identity, data, insider risk, audit, and compliance — each rated by severity.",
                },
                {
                  n: "05",
                  title: "Recommended remediation path",
                  desc: "A prioritised action plan ordered by risk impact and implementation effort, with effort estimates for each item.",
                },
                {
                  n: "06",
                  title: "Suggested Quick Wins",
                  desc: "Targeted service recommendations matched to your most critical gaps — with fixed pricing so you can plan budget immediately.",
                },
                {
                  n: "07",
                  title: "Priority roadmap",
                  desc: "A 30/60/90-day remediation timeline aligned to your compliance framework obligations and audit schedule.",
                },
              ].map((item) => (
                <div key={item.n} className="flex items-start gap-4 bg-charcoal-1 border border-white/[0.06] rounded-xl p-4">
                  <span className="font-numeric text-2xl font-bold text-white/10 leading-none mt-0.5 w-8 flex-shrink-0">{item.n}</span>
                  <div>
                    <p className="font-display font-bold text-text-primary text-sm">{item.title}</p>
                    <p className="text-text-secondary text-sm leading-relaxed mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-10 text-center">
            <a
              href="/security-compliance-report-sample.pdf"
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
            Security assessments delivered by someone who has done this at the highest level.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            Not every Microsoft consultant has secured a NASA tenant. Shane has — and that same discipline informs every assessment he delivers.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: ShieldCheck,
                title: "Lead M365 Architect at NASA",
                body: "Shane designs and delivers Zero Trust and compliance architecture for one of the world's most security-sensitive Microsoft 365 tenants. That discipline is the standard behind every assessment he delivers.",
              },
              {
                icon: Award,
                title: "30 years in the Microsoft ecosystem",
                body: "Three decades of hands-on experience across every generation of Microsoft security and compliance tooling — from on-premises to Entra ID, Defender, and Purview.",
              },
              {
                icon: Users,
                title: "Senior-only delivery",
                body: "Every assessment is led personally by Shane. No junior consultants, no knowledge handoffs, no diluted output. You get the expert you engaged, every time.",
              },
              {
                icon: Target,
                title: "Regulated industry expertise",
                body: "Deep experience securing M365 environments under HIPAA, SOX, and GDPR requirements — not just understanding the frameworks, but implementing the controls that pass audit.",
              },
              {
                icon: Lock,
                title: "Zero Trust and compliance-first methodology",
                body: "Every recommendation is built on a compliance-first architecture that makes your security posture documentable, auditable, and defensible — not just technically sound.",
              },
              {
                icon: Zap,
                title: "Fixed-price, no-surprise engagements",
                body: "Every service recommendation that follows from this assessment has a fixed price published upfront. No scope creep, no hourly billing, no surprises.",
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

      {/* ── 9. Bottom CTA ── */}
      <section className="border-t border-white/[0.06] py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-4">
            Your security posture determines your audit readiness, compliance maturity, and <GradientText>Copilot safety</GradientText>.
          </h2>
          <p className="text-text-secondary text-lg mb-3 leading-relaxed">
            Most Microsoft 365 security failures come from misconfiguration, not sophisticated attacks. MFA gaps, overprivileged admins, and absent DLP policies are found and exploited every day in tenants that believe they're secure.
          </p>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            This assessment takes five minutes. The PDF report is free. The gaps it surfaces could cost you far more to ignore.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            data-track="cta"
            className="inline-flex items-center justify-center gap-2 text-white font-semibold text-base px-8 py-4 rounded-xl transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
          >
            Take the Free Assessment
          </button>
          <p className="text-text-tertiary text-sm mt-4">5 minutes · Instant results · No sales call</p>
          <div className="mt-6">
            <a href="/book" data-track="cta" className="text-text-secondary hover:text-text-primary text-sm font-medium transition-colors">
              Prefer to talk first? Book a Discovery Call →
            </a>
          </div>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
