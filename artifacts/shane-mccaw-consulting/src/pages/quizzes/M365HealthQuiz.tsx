import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { CheckCircle, Activity } from "lucide-react";

const config: QuizConfig = {
  quizType: "m365-health",
  title: "M365 Tenant Health Assessment",
  introTitle: "How Healthy Is Your Microsoft 365 Tenant?",
  introDescription:
    "Answer 10 AI-powered questions across 5 health dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and service recommendation by email.",
  categories: [
    { key: "licensing", label: "Licensing & Entitlements" },
    { key: "security", label: "Security & Identity" },
    { key: "collaboration", label: "Collaboration Hygiene" },
    { key: "adminGovernance", label: "Admin & Governance" },
    { key: "adoption", label: "Adoption & Training" },
  ],
  fallbackQuestions: [
    "What Microsoft 365 licensing tier does your organisation currently have (e.g., Business Basic, Business Standard, E3, E5), and are all users on the same plan or a mix?",
    "Are there any users in your tenant with licences they don't actively use — for example, former employees still licensed, or users with premium features they've never accessed?",
    "Has your organisation deployed Multi-Factor Authentication (MFA) across all user accounts, or are there gaps — for example, shared accounts, service accounts, or contractors without MFA?",
    "How would you describe your Azure Active Directory / Entra ID setup? Are all user identities managed in the cloud, synced from on-premises AD, or a mixed environment with inconsistencies?",
    "Are your Teams and SharePoint environments structured and governed — with naming conventions, lifecycle policies, and clear ownership — or have they grown organically with teams and sites created ad hoc?",
    "How is email security configured? Do you have DKIM, DMARC, and SPF records in place, and are your Exchange Online protection policies tuned beyond the defaults?",
    "Who manages your Microsoft 365 tenant day-to-day, and how many users have Global Administrator rights? Are admin roles assigned using least-privilege principles?",
    "Are you currently using any Microsoft 365 admin tools for monitoring — such as Microsoft 365 Admin Center, Microsoft Secure Score, or third-party monitoring — to proactively identify issues?",
    "How would you rate overall end-user adoption of Microsoft 365 tools across your organisation? Are staff actively using Teams, SharePoint, and OneDrive, or defaulting to older habits?",
    "Has your organisation provided any formal Microsoft 365 training to staff — such as onboarding sessions, self-paced learning paths, or department-specific enablement — or has adoption been largely self-serve?",
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
  { label: "Licensing & Entitlements", desc: "Are you paying for licences your organisation isn't using? Are users on the right plans for their roles?" },
  { label: "Security & Identity", desc: "MFA coverage, Entra ID configuration, admin role hygiene, and your Microsoft Secure Score baseline." },
  { label: "Collaboration Hygiene", desc: "Teams and SharePoint sprawl, naming conventions, lifecycle policies, and email security configuration." },
  { label: "Admin & Governance", desc: "Who's managing your tenant, how many Global Admins exist, and what monitoring is in place?" },
  { label: "Adoption & Training", desc: "Are staff actually using the tools you're paying for, and have they been trained to use them effectively?" },
];

export default function M365HealthQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <Activity className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Tenant Health Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 health dimensions. A personalised readiness report delivered to your inbox — free.
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Health Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Every Microsoft 365 tenant has the same failure modes. This assessment finds yours before they become incidents.</p>
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
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Know your tenant health before it becomes a problem.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">Most M365 tenants accumulate configuration debt invisibly. Licensing waste, security gaps, and governance lapses compound quietly — until an audit, a breach, or a failed Copilot rollout surfaces them all at once.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
