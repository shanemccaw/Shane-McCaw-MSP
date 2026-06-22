import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { CheckCircle, FolderOpen } from "lucide-react";

const config: QuizConfig = {
  quizType: "sharepoint",
  title: "SharePoint Architecture Assessment",
  introTitle: "How Well-Architected Is Your SharePoint Environment?",
  introDescription:
    "Answer 10 AI-powered questions across 5 architecture dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.",
  categories: [
    { key: "infoArchitecture", label: "Information Architecture" },
    { key: "searchMetadata", label: "Search & Metadata" },
    { key: "contentLifecycle", label: "Content Lifecycle" },
    { key: "governanceGaps", label: "Governance Gaps" },
    { key: "migrationReadiness", label: "Migration Readiness" },
  ],
  fallbackQuestions: [
    "How is your SharePoint environment currently structured — for example, do you use a hub site model with associated team/communication sites, or has it grown organically without a deliberate hierarchy?",
    "How many SharePoint site collections or team sites do you have, and do you have a documented naming convention and provisioning process for creating new sites?",
    "How are permissions managed across your SharePoint environment? Are they primarily inherited from parent sites, or are there many unique item-level and folder-level permissions that have accumulated over time?",
    "Do you have lifecycle policies in place for SharePoint sites — for example, automatic expiry, ownership reviews, or archiving processes for inactive sites and teams?",
    "How would users in your organisation rate the findability of content in SharePoint? Can staff reliably find documents they need using search, or do they rely on direct links and shared drives?",
    "Are your SharePoint search results relevant and well-structured? Have you configured managed properties, result sources, or promoted results to surface key content?",
    "What happens to content in SharePoint when an employee leaves the organisation or a project ends? Is there a documented process for content retention, archival, or deletion?",
    "Do you use SharePoint metadata (columns, content types) consistently across your sites to classify and filter documents, or is organisation primarily managed through folder structures?",
    "Which teams or departments in your organisation are actively using SharePoint as their primary document management and collaboration platform, and which ones have avoided adoption?",
    "Have you deployed any SharePoint training or adoption campaigns for staff — for example, intranet guides, champions programmes, or department-specific enablement sessions?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here · From $4,500",
      name: "M365 Tenant Health Audit",
      description:
        "Before SharePoint architecture can be improved, your tenant foundation needs to be solid. A comprehensive audit identifies the licensing, governance, and configuration issues that will undermine any SharePoint redesign.",
      slug: "m365-tenant-health-audit",
      ctaText: "Fix the Foundation First",
    },
    Developing: {
      badge: "Recommended · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your SharePoint environment needs a structured governance framework before it can scale. This engagement designs and implements naming conventions, lifecycle policies, and permission models that bring order to your environment.",
      slug: "governance-foundations-package",
      ctaText: "Build Your Governance Framework",
    },
    Emerging: {
      badge: "Next Step · From $12,000",
      name: "Governance Foundations Package",
      description:
        "You have the basics, but gaps in governance and lifecycle management are creating technical debt. Formalise your SharePoint governance before the complexity compounds further.",
      slug: "governance-foundations-package",
      ctaText: "Formalise Your Governance",
    },
    Advanced: {
      badge: "High Impact · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your SharePoint environment is well-structured. With clean information architecture and good governance in place, you're in a strong position to evaluate Copilot — which relies heavily on well-organised SharePoint content.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Assess Copilot Readiness",
    },
    Ready: {
      badge: "Enterprise Grade · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your SharePoint architecture is excellent. Copilot will be most effective when it has clean, well-governed content to work with — which you have. Validate your full M365 readiness and deploy Copilot confidently.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Deploy Copilot on Strong Foundations",
    },
  },
  reportTitle: "SharePoint Architecture Assessment Report",
  pdfFilename: "sharepoint-assessment-report.pdf",
  introFeatureLabels: ["5 architecture dimensions", "Maturity tier rating", "PDF report emailed"],
};

const PILLARS = [
  { label: "Information Architecture", desc: "Hub site structure, naming conventions, site hierarchy, and whether your environment was intentionally designed or grew organically without a plan." },
  { label: "Search & Metadata", desc: "Content findability, search configuration quality, managed properties, metadata tagging practices, and navigation structure consistency." },
  { label: "Content Lifecycle", desc: "What happens to content when projects end or employees leave, retention and archiving policies, inactive site handling, and lifecycle documentation." },
  { label: "Governance Gaps", desc: "Inherited vs unique permissions, external sharing posture, guest access controls, known governance gaps, oversharing risks, and ownership accountability." },
  { label: "Migration Readiness", desc: "Whether a SharePoint migration or modernisation is planned, technical debt identified, blockers, documentation accuracy, and legacy content volume." },
];

export default function SharePointQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <SEOMeta
        title="SharePoint Readiness Assessment | Free Quiz | Shane McCaw Consulting"
        description="How well-architected is your SharePoint environment? Answer 10 expert questions and receive a personalised maturity report from a NASA-certified Microsoft 365 Architect."
        ogUrl="https://shanemccaw.com/sharepoint-readiness-quiz"
      />
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <FolderOpen className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            SharePoint Architecture Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 architecture dimensions. A personalised report on your SharePoint environment — free, delivered to your inbox.
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Architecture Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">SharePoint environments degrade silently. Ungoverned growth creates permission sprawl, content silos, and findability failure — this assessment finds where yours stands.</p>
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
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Find out if your SharePoint is an asset or a liability.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">Most SharePoint environments start with good intentions and end with 10,000 sites, broken permissions, and content nobody can find. This assessment shows you exactly where you stand.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
