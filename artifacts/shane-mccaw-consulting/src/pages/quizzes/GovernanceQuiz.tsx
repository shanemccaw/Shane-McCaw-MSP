import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { CheckCircle, Shield } from "lucide-react";

const config: QuizConfig = {
  quizType: "governance",
  title: "M365 Governance Maturity Assessment",
  introTitle: "How Mature Is Your Microsoft 365 Governance Framework?",
  introDescription:
    "Answer 10 AI-powered questions across 5 governance dimensions. Takes around 5 minutes. You'll receive a personalised PDF governance report by email.",
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
  { label: "Policies & Roles", desc: "Whether formal governance policies exist, who owns governance, the RACI model for M365 governance decisions, and whether policies are reviewed regularly." },
  { label: "Lifecycle Management", desc: "Team, site, group, and mailbox lifecycle policies, owner accountability, archiving and deletion procedures, inactive resource remediation, and guest account expiry." },
  { label: "Security & Compliance Controls", desc: "Technical enforcement of governance through M365 controls — Conditional Access, sensitivity labels, DLP policies, retention, and Purview compliance framework implementation." },
  { label: "Monitoring & Reporting", desc: "How governance compliance is monitored and reported, what reports are reviewed and by whom, audit frequency, and tooling used (Compliance Manager, M365 admin reports)." },
  { label: "Adoption & Accountability", desc: "How governance policies are communicated to end users and new joiners, training approach, accountability mechanisms for violations, and exception handling." },
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
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <Shield className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            M365 Governance Maturity Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 governance dimensions. A personalised maturity report — free, delivered to your inbox.
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

      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">What We Assess</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Governance Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Most organisations discover their governance gaps during an audit — not before it. This assessment finds yours first, so you can fix them on your timeline, not an auditor's.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {PILLARS.map((p) => (
              <div key={p.label} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1.5">{p.label}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-[#0A2540]">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Know your governance gaps before an auditor finds them.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">For regulated organisations, the gap between default M365 settings and defensible governance is where audit failures, breach liability, and accreditation loss live. This assessment shows you exactly where that gap is.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
