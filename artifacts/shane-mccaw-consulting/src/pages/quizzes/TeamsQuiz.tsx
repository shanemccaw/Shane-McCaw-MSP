import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { CheckCircle, MessageSquare } from "lucide-react";

const config: QuizConfig = {
  quizType: "teams",
  title: "Microsoft Teams Health Assessment",
  introTitle: "How Well Is Your Organisation Using Microsoft Teams?",
  introDescription:
    "Answer 10 AI-powered questions across 5 Teams health dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.",
  categories: [
    { key: "lifecycleNaming", label: "Lifecycle & Naming" },
    { key: "adoptionCulture", label: "Adoption & Culture" },
    { key: "guestChannelStructure", label: "Guest & Channel Structure" },
    { key: "appGovernance", label: "App Usage Governance" },
    { key: "collaborationGovernance", label: "Collaboration Governance" },
  ],
  fallbackQuestions: [
    "How are Teams and channels created in your organisation — can any user create a team at any time, or do you have a provisioning process with naming conventions, defined owners, and purpose documentation?",
    "What happens to Microsoft Teams when a project ends or an employee leaves? Do you have lifecycle policies — such as automated expiry reviews, archiving processes, or ownership transfers — or do teams just linger indefinitely?",
    "How would you describe the quality of meetings in your organisation conducted through Microsoft Teams — are cameras and microphones generally working well, is background noise managed, and do meetings start on time?",
    "Has your organisation evaluated or deployed Microsoft Teams Phone (Teams calling) to replace or supplement your traditional telephony infrastructure — and if so, how has the transition been managed?",
    "How is information organised within your Teams environment? Do channels have a consistent structure across teams, or does each team have its own ad-hoc channel naming convention that makes cross-team navigation confusing?",
    "How effectively are your Teams being used for file storage and collaboration? Are files stored in the Teams/SharePoint backend in an organised way, or are staff emailing attachments and using personal OneDrive as workarounds?",
    "Which departments or groups in your organisation have adopted Microsoft Teams as their primary communication platform, and which ones are still defaulting to email, phone, or other tools for day-to-day communication?",
    "Has your organisation run any structured Teams adoption campaigns — such as champion programmes, Teams tips newsletters, or department-specific enablement workshops — or has adoption been entirely organic?",
    "What third-party apps or custom integrations have been added to Teams in your organisation — for example, project management tools, ticketing systems, or HR platforms — and are these managed and governed centrally?",
    "Are your Teams meetings equipped with the advanced collaboration features available — such as meeting recordings with transcripts, Copilot-powered meeting summaries, breakout rooms, or polls — or are meetings used primarily as audio/video calls?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here · From $4,500",
      name: "M365 Tenant Health Audit",
      description:
        "Before Teams governance can be improved, your broader M365 tenant needs a clean foundation. A comprehensive audit identifies the configuration gaps, governance debt, and licensing inefficiencies that are limiting your Teams environment.",
      slug: "m365-tenant-health-audit",
      ctaText: "Fix the Foundation First",
    },
    Developing: {
      badge: "Recommended · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your Teams environment needs formal governance before the sprawl becomes unmanageable. This engagement designs and implements lifecycle policies, naming conventions, and governance controls that keep Teams productive and auditable.",
      slug: "governance-foundations-package",
      ctaText: "Govern Your Teams Environment",
    },
    Emerging: {
      badge: "Next Step · From $12,000",
      name: "Governance Foundations Package",
      description:
        "You have good Teams usage, but gaps in governance and lifecycle management are creating technical debt. Formalise your framework before inactive teams and permission drift compound further.",
      slug: "governance-foundations-package",
      ctaText: "Formalise Your Governance",
    },
    Advanced: {
      badge: "High Impact · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your Teams environment is well-governed and actively used. The natural next step is Copilot — Teams is one of the primary surfaces for Copilot features like meeting summaries, chat drafting, and call recaps.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Add Copilot to Teams",
    },
    Ready: {
      badge: "Enterprise Grade · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your Teams environment is excellent. Copilot for Teams — with meeting summaries, intelligent recaps, and AI-assisted chat — will deliver immediate productivity gains on top of your strong foundation.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Deploy Copilot for Teams",
    },
  },
  reportTitle: "Microsoft Teams Health Assessment Report",
  pdfFilename: "teams-assessment-report.pdf",
  introFeatureLabels: ["5 Teams dimensions", "Maturity tier rating", "PDF report emailed"],
};

const PILLARS = [
  { label: "Lifecycle & Naming", desc: "Team and channel creation policies, naming convention enforcement, ownership at provisioning, lifecycle management (expiry, archiving, inactive team remediation)." },
  { label: "Adoption & Culture", desc: "Which departments use Teams as their primary tool vs defaulting to email, adoption barriers, training provided, and executive modelling of Teams use." },
  { label: "Guest & Channel Structure", desc: "External guest access controls and review processes, standard vs private vs shared channel governance, and external collaboration policies." },
  { label: "App Usage Governance", desc: "Third-party apps added to Teams, app approval and governance policies, app catalogue governance, and advanced feature utilisation." },
  { label: "Collaboration Governance", desc: "Meeting recording retention policies, information architecture within Teams, content findability, and alignment with SharePoint governance." },
];

export default function TeamsQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <SEOMeta
        title="Microsoft Teams Maturity Assessment | Free Quiz | Shane McCaw Consulting"
        description="Is your organisation getting full value from Microsoft Teams? Take our free maturity quiz assessing governance, adoption, and technical configuration — PDF report emailed to you."
        ogUrl="https://shanemccaw.com/teams-maturity-quiz"
      />
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <MessageSquare className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft Teams Health Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 Teams health dimensions. A personalised report on your collaboration environment — free, delivered to your inbox.
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Teams Health Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Most organisations have Teams deployed but few have it genuinely governed. Team sprawl, inactive channels, and ungoverned apps accumulate faster than most IT teams realise.</p>
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
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Find out if Teams is driving productivity or creating chaos.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">500 teams. Nobody knows who owns them. Files stored in channels nobody reads. Apps added by whoever felt like it. This assessment shows you exactly where your Teams environment stands before it gets worse.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
