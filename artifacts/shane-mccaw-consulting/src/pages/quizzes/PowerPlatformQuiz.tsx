import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { CheckCircle, Cpu } from "lucide-react";

const config: QuizConfig = {
  quizType: "power-platform",
  title: "Power Platform Maturity Assessment",
  introTitle: "How Mature Is Your Power Platform Practice?",
  introDescription:
    "Answer 10 AI-powered questions across 5 maturity dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.",
  categories: [
    { key: "environmentStrategy", label: "Environment Strategy" },
    { key: "dlpMakerPermissions", label: "DLP & Maker Permissions" },
    { key: "appSprawlDataRisk", label: "App Sprawl & Data Risk" },
    { key: "monitoringCompliance", label: "Monitoring & Compliance" },
    { key: "governanceReadiness", label: "Governance Readiness" },
  ],
  fallbackQuestions: [
    "How is your Power Platform environment governed today? Do you have a Centre of Excellence (CoE) toolkit deployed, an environment strategy, and data loss prevention (DLP) policies configured, or is it largely ungoverned?",
    "Have you set up separate Power Platform environments for development, test, and production — or are makers building and testing in the default production environment?",
    "How many active makers (Power Apps or Power Automate builders) does your organisation have, and are they self-taught or have they completed formal Microsoft training?",
    "What training or enablement has your organisation provided for Power Platform? For example, internal champion programmes, Microsoft Learn paths, or external training courses?",
    "What data sources do your Power Platform solutions typically connect to — for example, SharePoint, Dataverse, SQL Server, Dynamics 365, or third-party APIs — and are these connections secured and documented?",
    "Has your organisation evaluated or deployed Microsoft Dataverse as a structured data platform for Power Apps, rather than using SharePoint lists or Excel files as data sources?",
    "What types of automation have your organisation deployed using Power Automate — for example, approval workflows, email notifications, system integrations, or scheduled data processing?",
    "Are your Power Automate flows monitored for failures, and do you have a process for maintaining and updating them when the underlying systems or APIs they connect to change?",
    "Has your organisation explored or deployed AI Builder features — such as document processing, prediction models, or object detection — within any Power Platform solutions?",
    "Are your teams aware of the Copilot features now built into Power Apps and Power Automate — such as natural-language app building and AI-generated flow suggestions — and are you positioning to take advantage of them?",
  ],
  tierUpsells: {
    Beginner: {
      badge: "Start Here · From $6,000",
      name: "Power Platform Quick-Start",
      description:
        "Your Power Platform practice needs a strong foundation before it can scale. A focused sprint to establish governance, deploy the CoE toolkit, and deliver your first production-ready app or flow — giving your team a proven pattern to follow.",
      slug: "power-platform-quickstart",
      ctaText: "Start Your Practice Right",
    },
    Developing: {
      badge: "Recommended · From $6,000",
      name: "Power Platform Quick-Start",
      description:
        "You have makers building solutions, but without consistent governance and quality standards. This sprint establishes the guardrails — DLP policies, environment strategy, and maker training — and delivers a production-ready template app.",
      slug: "power-platform-quickstart",
      ctaText: "Build the Right Way",
    },
    Emerging: {
      badge: "Next Step · From $6,000",
      name: "Power Platform Quick-Start",
      description:
        "Your practice is maturing. A focused Quick-Start sprint will formalise your governance, upskill your makers, and deliver one high-impact app or flow that demonstrates what a well-executed Power Platform solution looks like.",
      slug: "power-platform-quickstart",
      ctaText: "Accelerate Your Practice",
    },
    Advanced: {
      badge: "High Impact · From $5,000",
      name: "Copilot for M365 Readiness Assessment",
      description:
        "Your Power Platform maturity is strong. The next frontier is AI — evaluate your Copilot readiness to understand how Power Platform's AI Builder and Copilot Studio features fit into your automation strategy.",
      slug: "copilot-for-m365-readiness-assessment",
      ctaText: "Add AI to Your Automation",
    },
    Ready: {
      badge: "Enterprise Grade · From $12,000",
      name: "Governance Foundations Package",
      description:
        "Your Power Platform practice is excellent. To sustain it at enterprise scale — especially as Copilot Studio and AI Builder deployments expand — formalise your broader M365 governance framework.",
      slug: "governance-foundations-package",
      ctaText: "Govern at Enterprise Scale",
    },
  },
  reportTitle: "Power Platform Maturity Assessment Report",
  pdfFilename: "power-platform-assessment-report.pdf",
  introFeatureLabels: ["5 maturity dimensions", "Maturity tier rating", "PDF report emailed"],
};

const PILLARS = [
  { label: "Environment Strategy", desc: "How environments are structured (dev/test/prod), naming conventions, who can create environments, the approval process, and capacity planning." },
  { label: "DLP & Maker Permissions", desc: "DLP policy coverage across environments, connector governance model, maker permission tiers, and whether guardrails prevent unsafe building." },
  { label: "App Sprawl & Data Risk", desc: "Number of apps in production, undocumented or abandoned apps, data sensitivity of connected sources, unmanaged connections, and data residency concerns." },
  { label: "Monitoring & Compliance", desc: "Flow failure alerting, CoE toolkit adoption, capacity utilisation awareness, IT governance compliance, and audit capability." },
  { label: "Governance Readiness", desc: "Whether a formal Power Platform governance framework exists, documentation quality, IT strategy alignment, and Centre of Excellence maturity." },
];

export default function PowerPlatformQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <SEOMeta
        title="Power Platform Maturity Assessment | Free Quiz | Shane McCaw Consulting"
        description="How mature is your Power Platform practice? Take our free assessment and receive a personalised PDF report with a tailored service recommendation from a 30-year Microsoft expert."
        ogUrl="https://shanemccaw.com/power-platform-quiz"
      />
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <Cpu className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Power Platform Maturity Assessment
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            10 AI-powered questions. 5 maturity dimensions. A personalised Power Platform report — free, delivered to your inbox.
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Maturity Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Most Power Platform environments are either ungoverned or underutilised. This assessment tells you exactly where yours sits on the maturity curve.</p>
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
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Know if your Power Platform is creating value or creating risk.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">Ungoverned Power Platform environments accumulate shadow IT, broken flows, and unmanaged data connections. This assessment identifies your maturity gaps before they become governance failures.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">No account required · Results delivered instantly</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
