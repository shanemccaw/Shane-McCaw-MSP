import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { CheckCircle, ShieldCheck } from "lucide-react";

const config: QuizConfig = {
  quizType: "security",
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
      badge: "Critical · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your Microsoft 365 security posture has significant gaps that represent real organisational risk. The Governance Foundations Package establishes the DLP policies, sensitivity labels, conditional access framework, and compliance controls your environment urgently needs.",
      slug: "governance-foundations-package",
      ctaText: "Secure Your Environment Now",
    },
    Developing: {
      badge: "Recommended · From $12,000",
      name: "Governance Foundations Package",
      description:
        "You have some controls in place but gaps in your DLP, compliance, or identity governance create exploitable risk. This engagement builds a complete, defensible security and governance framework across your M365 tenant.",
      slug: "governance-foundations-package",
      ctaText: "Close Your Security Gaps",
    },
    Emerging: {
      badge: "Next Step · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your security posture is developing well. Formalising your governance framework will transform your ad-hoc security controls into a documented, auditable, and defensible compliance posture.",
      slug: "governance-foundations-package",
      ctaText: "Formalise Your Security Governance",
    },
    Advanced: {
      badge: "High Impact · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your security posture is strong. With solid identity, data protection, and compliance controls in place, you're well-positioned to deploy Copilot safely — assess your readiness and do it right.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Deploy Copilot Securely",
    },
    Ready: {
      badge: "Enterprise Grade · From $5,000",
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

const PILLARS = [
  { label: "Identity & Access", desc: "MFA coverage, Conditional Access policies, admin role hygiene, and whether access to M365 is appropriately controlled." },
  { label: "Data Protection", desc: "Sensitivity labels, DLP policies, and whether your confidential data is classified, encrypted, and protected from exfiltration." },
  { label: "Device & Endpoint Management", desc: "Intune enrollment, device compliance policies, app protection for unmanaged devices, and remote wipe capability." },
  { label: "Threat Detection & Response", desc: "Microsoft Secure Score, Defender for Office 365 configuration, Safe Links, Safe Attachments, and incident response readiness." },
  { label: "Compliance & Policy", desc: "Framework alignment (HIPAA, CMMC, FedRAMP, SOX, GDPR), Purview compliance controls, and audit-readiness posture." },
];

export default function SecurityQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <ShieldCheck className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Security Posture Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 security dimensions. A personalised risk report — free, delivered to your inbox.
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Security Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Security gaps in Microsoft 365 are often invisible until they're exploited. This assessment surfaces your risk profile before a breach does it for you.</p>
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
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Know your security risk before an auditor — or an attacker — finds it.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">Most Microsoft 365 security failures come from misconfiguration, not sophisticated attacks. MFA gaps, overprivileged admins, and absent DLP policies are found and exploited every day. This assessment finds yours first.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
