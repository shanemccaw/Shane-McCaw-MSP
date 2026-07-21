import { useState } from "react";
import { Layout } from "@/components/Layout";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import {
  CheckCircle, Shield, Building2, Users, AlertTriangle, FileText,
  BarChart3, Award, Lock, ClipboardList, Target, ShieldCheck,
  Download, ArrowRight, Layers, Star, TrendingUp, Settings2, Network,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

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
      badge: "Critical",
      name: "Governance Foundations Package",
      description:
        "Your organisation is operating without the governance controls required to protect sensitive data, meet regulatory obligations, or pass an audit. The Governance Foundations Package builds the complete framework your environment needs — from DLP and sensitivity labels to retention schedules and compliance alignment.",
      slug: "governance-foundations-package",
      ctaText: "Build Your Governance Framework",
    },
    Developing: {
      badge: "Recommended",
      name: "Governance Foundations Package",
      description:
        "You have some governance controls, but gaps in your DLP, retention, or compliance alignment create real regulatory and security risk. This engagement builds the complete, defensible governance framework your organisation needs.",
      slug: "governance-foundations-package",
      ctaText: "Close Your Governance Gaps",
    },
    Emerging: {
      badge: "Next Step",
      name: "Governance Foundations Package",
      description:
        "Your governance is developing, but it's not yet complete or consistent. A formal Governance Foundations engagement will systematise your controls, fill the gaps, and produce the documentation required for audit readiness.",
      slug: "governance-foundations-package",
      ctaText: "Complete Your Governance Framework",
    },
    Advanced: {
      badge: "High Impact",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your governance is mature and defensible. With strong DLP, sensitivity labels, and compliance controls in place, you're well-positioned to evaluate Copilot — which relies on exactly these controls to operate safely.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Assess Copilot Readiness",
    },
    Ready: {
      badge: "Enterprise Grade",
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

const DIMENSIONS = [
  {
    colour: "bg-blue-500",
    label: "Dimension 1",
    title: "Policies & Roles",
    bullets: [
      "Whether formal governance policies exist, are documented, and are actively maintained.",
      "Ownership structure and the RACI model for M365 governance decision-making.",
      "Policy review cycles — how often governance documents are reviewed and updated.",
      "Accountability assignment — whether clear owners exist for each governance domain.",
      "Escalation and exception handling — documented processes for governance decisions.",
    ],
  },
  {
    colour: "bg-teal-500",
    label: "Dimension 2",
    title: "Lifecycle Management",
    bullets: [
      "Teams, SharePoint sites, and M365 Groups managed from creation to deletion.",
      "Owner accountability and archiving procedures for inactive resources.",
      "Inactive resource remediation — detection, notification, and resolution workflows.",
      "Guest account lifecycle — creation approval, access review, and expiry enforcement.",
      "Expiry policies configured and monitored for all collaboration workloads.",
    ],
  },
  {
    colour: "bg-violet-500",
    label: "Dimension 3",
    title: "Security & Compliance Controls",
    bullets: [
      "Conditional Access policies enforcing device compliance and risk-based access.",
      "Privileged Identity Management deployment for all admin roles.",
      "Sensitivity labels published, applied, and enforced across the tenant.",
      "DLP policies actively blocking — not just alerting on — policy violations.",
      "Purview Compliance Manager configuration and regulatory framework coverage.",
    ],
  },
  {
    colour: "bg-orange-500",
    label: "Dimension 4",
    title: "Monitoring & Reporting",
    bullets: [
      "Compliance Manager score tracking and improvement action management.",
      "M365 admin centre reports reviewed on a regular, documented cadence.",
      "Unified Audit Log enabled, retained, and reviewed for suspicious activity.",
      "Governance health visibility to leadership — dashboards or regular reporting.",
      "Incident detection and response processes for governance policy violations.",
    ],
  },
  {
    colour: "bg-green-500",
    label: "Dimension 5",
    title: "Adoption & Accountability",
    bullets: [
      "Governance policies communicated to end users, admins, and new joiners.",
      "Training approach — how staff are made aware of acceptable use and obligations.",
      "Accountability mechanisms for policy violations and exception handling.",
      "New joiner onboarding covering governance policies and expectations.",
      "Governance culture maturity — whether controls are embedded or exist on paper.",
    ],
  },
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

      {/* ── 1. Hero ── */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Shield className="w-4 h-4" />
            Governance Maturity Assessment
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Your M365 Governance Is <GradientText>Drifting.</GradientText>
            <br className="hidden md:block" /> Most Don't Know It.
          </h1>

          <p className="text-text-secondary text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            Governance drift is silent. It accumulates over years of organic growth — Teams channels created without owners, SharePoint sites with no lifecycle policy, guest accounts that never expire, and DLP rules that were configured once and never reviewed again.
          </p>
          <p className="text-text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question assessment — built on the same governance and compliance framework Shane applies as Lead M365 Architect at NASA — identifies exactly where your governance framework stands across five dimensions before an auditor or a Copilot deployment makes the gaps impossible to ignore.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "governance dimensions" },
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
            Most organisations discover their governance gaps during an audit — not before it.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Microsoft 365 defaults are not governance. A tenant with default settings passes none of the tests that HIPAA, CMMC, SOC 2, or FedRAMP require. Sensitivity labels aren't applied. Retention policies aren't configured. Admin access isn't scoped. Compliance Manager shows a score, but nobody's looking at it.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: Network,
                title: "Governance drift accumulates silently across every tenant",
                body: "Teams channels created without owners, SharePoint sites with no lifecycle policy, guest accounts that never expire, and DLP rules that were configured once and never reviewed. None of it looks broken — until an auditor, a breach, or a Copilot deployment makes it impossible to ignore.",
              },
              {
                icon: AlertTriangle,
                title: "Teams and SharePoint sprawl are governance problems — not productivity problems",
                body: "When ownership is undefined, lifecycle policies don't exist, and identity isn't tightly managed, sensitive data moves freely across a tenant that was never designed to contain it. Sprawl is the visible symptom. Absent governance is the cause.",
              },
              {
                icon: Settings2,
                title: "Paper governance fails when technical enforcement is absent",
                body: "A governance policy document that is not backed by Conditional Access, DLP enforcement, and automated lifecycle controls is not governance — it is aspiration. Auditors and breach investigations do not accept policy documents as evidence of controls that were never implemented.",
              },
              {
                icon: TrendingUp,
                title: "Governance is the foundation for every M365 initiative that follows",
                body: "Security posture, audit readiness, Copilot adoption — all of it depends on governance controls being in place and actively enforced. Organisations that skip governance foundations discover the cost when the next initiative cannot proceed safely without fixing what was skipped.",
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
            Built for organisations where governance risk is real — not theoretical.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            If your organisation is in any of these categories, you need this assessment before your next audit, Copilot deployment, or major M365 initiative begins.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organisations",
                body: "200–2,000 employees with Microsoft 365 tenants that have grown without formal governance controls — where configuration debt accumulates faster than teams realise.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "Healthcare (HIPAA), financial services (SOC 2, FINRA), and legal firms operating under strict data governance obligations where governance gaps create audit risk and liability exposure.",
              },
              {
                icon: Lock,
                title: "Evidence-driven compliance teams",
                body: "Healthcare and financial services organisations who need defensible, documented governance evidence for HIPAA, SOC 2, or similar audits — not just policy documents.",
              },
              {
                icon: AlertTriangle,
                title: "SharePoint and Teams sprawl",
                body: "Environments with hundreds of sites, abandoned groups, unrestricted guest access, and no lifecycle policy in place — where the scale of the problem has made remediation feel impossible to start.",
              },
              {
                icon: Target,
                title: "Copilot and audit preparation",
                body: "Organisations preparing for a Copilot deployment or facing an upcoming compliance audit who need to know their governance posture now — before the stakes are highest.",
              },
              {
                icon: Users,
                title: "IT teams without a framework",
                body: "IT leaders and M365 admins who know governance is important but lack the structured framework to act on it — and want to understand where to start and what matters most.",
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
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">From first question to governance report in under five minutes.</h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            Ten questions. Five governance dimensions. A scoring model built by the M365 Architect at NASA. An instant maturity score, a personalised PDF report, and a recommended next step — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Shield,
                title: "10 targeted questions",
                desc: "Each question maps to one of five governance dimensions — the same diagnostics Shane uses in a paid engagement, compressed into a 5-minute format. No generic questionnaire.",
              },
              {
                icon: Layers,
                title: "5 governance dimensions scored",
                desc: "Policies & Roles, Lifecycle Management, Security & Compliance Controls, Monitoring & Reporting, and Adoption & Accountability — each scored independently on a 0–10 scale.",
              },
              {
                icon: Star,
                title: "Scoring built by a NASA architect",
                desc: "Your answers are weighted and scored using the same governance framework Shane applies as M365 Architect at NASA. You receive a total score (0–50), a maturity tier, and a per-dimension breakdown.",
              },
              {
                icon: FileText,
                title: "Instant PDF report emailed",
                desc: "A branded, personalised PDF lands in your inbox the moment you complete the assessment. No waiting, no scheduling — your governance report is generated and delivered immediately.",
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

      {/* ── 5. Five Governance Dimensions ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">The Five Governance Dimensions</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            What the assessment <GradientText>measures</GradientText> — and why it matters.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether your Microsoft 365 governance framework is audit-ready, breach-resistant, and positioned for Copilot adoption — or carrying silent gaps that compound with every new workload added.
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
                  All five dimensions scored, ranked by governance risk, and mapped to a tailored service recommendation. Personalised PDF delivered to your inbox the moment you finish.
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
            A personalised governance maturity report. Free. Instant.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real diagnostic report — built on the same framework Shane applies in paid engagements — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Overall maturity score",
                body: "Composite score across all five governance dimensions with your maturity tier: Beginner, Developing, Emerging, Advanced, or Ready.",
              },
              {
                icon: ClipboardList,
                title: "Policy and ownership gaps",
                body: "Where governance accountability is undefined — undocumented policies, missing owners, and absence of formal review cycles.",
              },
              {
                icon: Shield,
                title: "Lifecycle management gaps",
                body: "Teams, SharePoint sites, Microsoft 365 Groups, and guest accounts that lack lifecycle controls — and the compliance risk each represents.",
              },
              {
                icon: Lock,
                title: "Security and compliance gaps",
                body: "DLP, sensitivity label, PIM, Conditional Access, and Purview control gaps — what is technically absent versus what policy documents claim is in place.",
              },
              {
                icon: AlertTriangle,
                title: "Monitoring weaknesses",
                body: "Where governance health is invisible — audit log gaps, unreported compliance scores, and leadership visibility failures.",
              },
              {
                icon: ArrowRight,
                title: "Recommended next steps",
                body: "Prioritised by risk and regulatory impact — specific to your environment, not a generic governance checklist.",
              },
              {
                icon: FileText,
                title: "Architecture notes",
                body: "Governance architecture observations relevant to your compliance posture — structural decisions and patterns that affect every initiative that follows.",
              },
              {
                icon: Target,
                title: "Priority remediation roadmap",
                body: "A phased governance remediation roadmap — what to fix first, what to fix next, and what can be deferred without increasing regulatory risk.",
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
            A structured governance diagnostic — not a marketing brochure.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            Your PDF is structured as a professional governance maturity document — designed to be shared with your CISO, CTO, board, or compliance team, not just filed in a personal inbox.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                num: "01",
                title: "Executive summary",
                desc: "A one-page governance maturity verdict your CISO, CTO, or board can read in 90 seconds — your score, tier, and the three most critical governance gaps identified.",
              },
              {
                num: "02",
                title: "Dimension-by-dimension scoring",
                desc: "Individual scores across all five governance dimensions with detailed commentary on each gap, what it means for your organisation, and what remediation requires.",
              },
              {
                num: "03",
                title: "Governance maturity heatmap",
                desc: "A visual representation of your governance posture — showing strengths, gaps, and critical risk areas at a glance for both technical and executive audiences.",
              },
              {
                num: "04",
                title: "Gap analysis",
                desc: "A detailed breakdown of specific control gaps, policy omissions, and lifecycle risks identified by your responses — ranked by severity and regulatory impact.",
              },
              {
                num: "05",
                title: "Recommended remediation path",
                desc: "A sequenced remediation plan — what to fix first, what to fix next, and what can wait without increasing risk — with effort estimates and sequencing rationale.",
              },
              {
                num: "06",
                title: "Suggested quick wins",
                desc: "Targeted service recommendations drawn from the Governance Foundations Package, Tenant Health Audit, and SharePoint IA Rebuild — mapped directly to your identified gaps.",
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
              href="/governance-maturity-report-sample.pdf"
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
            Shane McCaw is not a generalist consultant who added Microsoft 365 governance to a service catalogue. He has spent three decades designing, implementing, and auditing governance frameworks for some of the most demanding organisations in the world.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Star,
                title: "Lead M365 Architect at NASA",
                desc: "Shane designed and implemented the governance framework for one of the world's most security-sensitive Microsoft 365 tenants — a 60,000-user environment where governance failure is never an option.",
              },
              {
                icon: TrendingUp,
                title: "30 years in the Microsoft ecosystem",
                desc: "From early SharePoint deployments through Entra ID, Purview, and Copilot — Shane has navigated every major shift in the M365 governance landscape and knows where organisations consistently fall short.",
              },
              {
                icon: Users,
                title: "Senior-only delivery",
                desc: "Every engagement is delivered by Shane directly. No juniors handed a checklist. You get the expertise you are paying for on every call, in every document, and in every recommendation.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industry expertise",
                desc: "Shane brings governance discipline from one of the most demanding Microsoft 365 environments in the world to financial services and healthcare clients — industries where governance failures carry regulatory, legal, and reputational consequences.",
              },
              {
                icon: Award,
                title: "Governance-first methodology",
                desc: "Shane's approach treats governance as the foundation for everything — security, compliance, Copilot adoption, and audit readiness. Governance done right makes every other initiative easier and safer.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
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
            Your governance maturity determines your audit readiness, your compliance posture, and your <GradientText>Copilot success</GradientText>.
          </h2>
          <p className="text-text-secondary text-lg mb-3 leading-relaxed">
            Don't find out where your governance gaps are during an audit. Take the free assessment now — get your personalised PDF governance maturity report in five minutes, with no account required and no sales call attached.
          </p>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            This assessment takes five minutes. The PDF report is free. The governance gap analysis it surfaces is the same work Shane charges for in a paid engagement.
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
