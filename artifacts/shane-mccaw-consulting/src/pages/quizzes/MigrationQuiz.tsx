import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { CheckCircle, Server } from "lucide-react";

const config: QuizConfig = {
  quizType: "migration",
  title: "Cloud Migration Readiness Assessment",
  introTitle: "How Ready Is Your Organisation to Migrate to Microsoft 365?",
  introDescription:
    "Answer 10 AI-powered questions across 5 migration readiness dimensions. Takes around 5 minutes. You'll receive a personalised PDF readiness report by email.",
  categories: [
    { key: "sourceComplexity", label: "Source Complexity & ROT" },
    { key: "permissionsMetadata", label: "Permissions & Metadata" },
    { key: "securityBlockers", label: "IA & Security Blockers" },
    { key: "timelineRealism", label: "Timeline Realism" },
    { key: "migrationGovernance", label: "Migration Governance" },
  ],
  fallbackQuestions: [
    "What systems are you migrating from — for example, on-premises Exchange, Google Workspace, Lotus Notes, or another legacy platform — and do you have an accurate inventory of all mailboxes, shared inboxes, and distribution groups?",
    "How many users and data volumes are involved in the planned migration — for example, the total number of mailboxes, the total size of email data, and the volume of file share or SharePoint data to be moved?",
    "What is your current identity infrastructure? For example, are you running Active Directory on-premises and planning to sync to Entra ID via Azure AD Connect, or are you moving from a non-Microsoft identity provider entirely?",
    "Is Multi-Factor Authentication (MFA) planned to be enforced from day one of the migration, or are there legacy applications and services that are currently incompatible with modern authentication?",
    "Have you inventoried the data you plan to migrate for sensitive content — for example, files containing personally identifiable information, financial records, or health data — and do you have a plan to apply sensitivity labels or DLP policies before or during migration?",
    "Are there specific compliance requirements — such as HIPAA, CMMC, FedRAMP, or GDPR — that dictate how data must be handled, stored, and protected during and after the migration to Microsoft 365?",
    "Has your executive leadership formally committed to the migration project, with a named project sponsor, an approved budget, and a defined timeline — or is the project still at an exploratory stage without formal sponsorship?",
    "Have the key business stakeholders — including department heads, IT leads, and any external parties affected by the migration — been engaged and consulted on the migration plan, timeline, and communication approach?",
    "What is your plan if the migration encounters a critical failure — for example, data loss, extended mail flow interruption, or user access outages? Do you have documented rollback procedures and tested recovery scenarios?",
    "Have you identified and tested all applications, integrations, and workflows that depend on your current email or collaboration platform — for example, line-of-business apps that send email, or third-party connectors — to confirm they will function correctly post-migration?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here · From $3,500",
      name: "Migration Readiness Assessment",
      description:
        "Your organisation has significant gaps in migration readiness that, if unaddressed, will lead to data loss, extended outages, or a failed migration. A structured readiness assessment identifies every gap and produces a sequenced remediation plan before a single mailbox moves.",
      slug: "migration-readiness-assessment",
      ctaText: "Get Your Readiness Report",
    },
    Developing: {
      badge: "Recommended · From $3,500",
      name: "Migration Readiness Assessment",
      description:
        "You've made progress, but critical readiness gaps remain. A formal readiness assessment will surface the identity, data governance, and stakeholder alignment issues that will derail your migration if left unaddressed.",
      slug: "migration-readiness-assessment",
      ctaText: "Assess Your Readiness",
    },
    Emerging: {
      badge: "Next Step · From $3,500",
      name: "Migration Readiness Assessment",
      description:
        "Your readiness is solid, but a formal assessment will validate your plans, identify edge cases, and give you a go/no-go recommendation — so you migrate with confidence rather than optimism.",
      slug: "migration-readiness-assessment",
      ctaText: "Validate Your Migration Plan",
    },
    Advanced: {
      badge: "High Impact · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your migration readiness is strong. Before you execute, ensure your governance framework is in place — DLP policies, sensitivity labels, and lifecycle controls should be configured before content arrives in Microsoft 365.",
      slug: "governance-foundations-package",
      ctaText: "Govern Before You Migrate",
    },
    Ready: {
      badge: "Enterprise Grade · From $3,500",
      name: "Migration Readiness Assessment",
      description:
        "Your organisation is well-prepared. A formal readiness assessment will validate your plans end-to-end and give you the go/no-go documentation your executive sponsors and compliance teams require.",
      slug: "migration-readiness-assessment",
      ctaText: "Get Your Go/No-Go Report",
    },
  },
  reportTitle: "Cloud Migration Readiness Assessment Report",
  pdfFilename: "migration-readiness-report.pdf",
  introFeatureLabels: ["5 readiness dimensions", "Readiness tier rating", "PDF report emailed"],
};

const PILLARS = [
  { label: "Source Complexity & ROT", desc: "Scale and platform of your source environment, data volumes, Redundant/Obsolete/Trivial (ROT) data, and whether a pre-migration clean-up phase is planned." },
  { label: "Permissions & Metadata", desc: "Permission complexity in the source, inheritance vs unique permissions, metadata richness, and whether permissions and metadata will migrate or be rebuilt." },
  { label: "IA & Security Blockers", desc: "Information architecture blockers, regulatory and security requirements that could slow the migration, legacy authentication systems, and compliance obligations." },
  { label: "Timeline Realism", desc: "Planned migration timeline and approach (phased vs big-bang), cut-over planning, schedule risks, resource constraints, and executive commitment." },
  { label: "Migration Governance", desc: "Migration project governance (named owner, steering committee, communication plan), rollback procedures, success criteria, and end-user training scope." },
];

export default function MigrationQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    document.title = "Cloud Migration Readiness Assessment | Shane McCaw Consulting";
    return () => { document.title = "Shane McCaw Consulting"; };
  }, []);
  return (
    <Layout>
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <Server className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Cloud Migration Readiness Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 readiness dimensions. A personalised migration readiness report — free, delivered to your inbox.
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Readiness Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Most cloud migrations fail due to poor planning — not technical complexity. This assessment identifies your readiness gaps before the first mailbox moves.</p>
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
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Know your migration risk before the first mailbox moves.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">Cloud migrations that skip the readiness phase consistently result in data loss, extended outages, and costly remediation. This assessment tells you exactly where you stand — before you commit.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
