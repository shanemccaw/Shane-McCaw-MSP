import { useState } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import {
  CheckCircle,
  FolderOpen,
  Building2,
  ShieldCheck,
  FileText,
  Users,
  BarChart3,
  AlertTriangle,
  Globe,
  Lock,
  Database,
  Target,
  Award,
  Zap,
  ArrowRight,
  BookOpen,
  Search,
  RefreshCw,
  Layers,
  Download,
} from "lucide-react";

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

const DIMENSIONS = [
  {
    label: "Information Architecture",
    icon: <Layers className="w-5 h-5 text-[#0078D4]" />,
    bullets: [
      "Hub site model adoption and associated site hierarchy",
      "Naming conventions for sites, libraries, and folders",
      "Intentional IA design vs. organic ungoverned growth",
      "Navigation structure consistency across departments",
      "Site provisioning process and governance maturity",
    ],
  },
  {
    label: "Governance & Lifecycle",
    icon: <RefreshCw className="w-5 h-5 text-[#0078D4]" />,
    bullets: [
      "Site expiry policies and ownership accountability",
      "Lifecycle documentation for active and inactive sites",
      "Archiving and deletion processes when projects end",
      "Employee offboarding content handling procedures",
      "Provisioning guardrails and request workflows",
    ],
  },
  {
    label: "Security & Permissions",
    icon: <ShieldCheck className="w-5 h-5 text-[#0078D4]" />,
    bullets: [
      "Inherited vs. unique item- and folder-level permissions",
      "RBAC model maturity and group-based access design",
      "External sharing posture and guest access controls",
      "Oversharing risk and sensitive content exposure",
      "Sensitivity label adoption and enforcement",
    ],
  },
  {
    label: "Content Quality & ROT",
    icon: <Database className="w-5 h-5 text-[#0078D4]" />,
    bullets: [
      "Volume of Redundant, Outdated, and Trivial (ROT) content",
      "Metadata and content type adoption across libraries",
      "Folder-based vs. metadata-based document organisation",
      "Search relevance and managed property configuration",
      "Content ownership and review accountability",
    ],
  },
  {
    label: "Integration & Copilot Readiness",
    icon: <Target className="w-5 h-5 text-[#0078D4]" />,
    bullets: [
      "SharePoint as a Copilot knowledge source quality",
      "Teams and SharePoint integration alignment",
      "Compliance and data residency posture for AI use",
      "Power Platform and third-party connector dependencies",
      "Architecture gaps blocking safe Copilot deployment",
    ],
  },
];

const DELIVERABLES = [
  { icon: <BarChart3 className="w-5 h-5 text-[#0078D4]" />, label: "Overall Architecture Score", desc: "Aggregated maturity score across all five dimensions" },
  { icon: <Layers className="w-5 h-5 text-[#0078D4]" />, label: "IA Maturity Score", desc: "Specific rating for your information architecture design" },
  { icon: <AlertTriangle className="w-5 h-5 text-[#0078D4]" />, label: "Governance Gaps", desc: "Identified governance failures and risk areas" },
  { icon: <ShieldCheck className="w-5 h-5 text-[#0078D4]" />, label: "Security Gaps", desc: "Permission model issues and oversharing risks flagged" },
  { icon: <Database className="w-5 h-5 text-[#0078D4]" />, label: "ROT Indicators", desc: "Signals of redundant, outdated, and trivial content volume" },
  { icon: <ArrowRight className="w-5 h-5 text-[#0078D4]" />, label: "Next Steps", desc: "Prioritised action items matched to your maturity tier" },
  { icon: <FileText className="w-5 h-5 text-[#0078D4]" />, label: "Architecture Notes", desc: "Specific observations from your assessment responses" },
  { icon: <Target className="w-5 h-5 text-[#0078D4]" />, label: "Priority Roadmap", desc: "A sequenced improvement roadmap based on your results" },
];

const REPORT_SECTIONS = [
  { label: "Executive Summary", desc: "A plain-English overview of your SharePoint environment's current state and the top three risks identified by the assessment." },
  { label: "Dimension-by-Dimension Scoring", desc: "A scored breakdown across all five architecture dimensions, with narrative commentary on the strengths and gaps in each area." },
  { label: "Architecture Heatmap", desc: "A visual representation of your maturity across all five dimensions — instantly shows where your environment is thriving and where it is failing." },
  { label: "Gap Analysis", desc: "A detailed catalogue of the specific IA, governance, security, and content quality issues discovered, ranked by severity and business impact." },
  { label: "Remediation Path", desc: "A prioritised, step-by-step remediation guide aligned to your maturity tier — so you know what to fix first and why." },
  { label: "Quick Win Suggestions", desc: "Specific Shane McCaw Consulting service recommendations that directly address your highest-priority gaps, with pricing guidance." },
];

const ICP_PROFILES = [
  { icon: <Building2 className="w-5 h-5 text-[#0078D4]" />, label: "Mid-Market Organisations", desc: "200–2,000 employees with SharePoint deployments that have outgrown informal governance" },
  { icon: <ShieldCheck className="w-5 h-5 text-[#0078D4]" />, label: "Regulated Industries", desc: "Finance, healthcare, legal, and energy firms where SharePoint governance has compliance implications" },
  { icon: <Globe className="w-5 h-5 text-[#0078D4]" />, label: "Government Contractors", desc: "Organisations handling sensitive government data who need defensible SharePoint security postures" },
  { icon: <RefreshCw className="w-5 h-5 text-[#0078D4]" />, label: "SharePoint Rebuild Orgs", desc: "Teams planning a SharePoint modernisation or migration who need a baseline before they start" },
  { icon: <AlertTriangle className="w-5 h-5 text-[#0078D4]" />, label: "Sprawl-Affected Teams", desc: "Environments with thousands of sites, broken permissions, and content nobody can find" },
  { icon: <Target className="w-5 h-5 text-[#0078D4]" />, label: "Copilot-Prep Organisations", desc: "Companies planning a Copilot for M365 rollout who need clean SharePoint foundations first" },
];

export default function SharePointQuiz() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Layout>
      <SEOMeta
        title="SharePoint Architecture & IA Assessment | Free Quiz | Shane McCaw Consulting"
        description="How well-architected is your SharePoint environment? Answer 10 expert questions across 5 dimensions and receive a personalised maturity report from a NASA-certified Microsoft 365 Architect."
        ogImage="/og-image-sharepoint-quiz.png"
        ogUrl="https://shanemccaw.com/sharepoint-readiness-quiz"
      />

      {/* ── Section 1: Hero ──────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <FolderOpen className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment · NASA-Grade Methodology</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            SharePoint Architecture &amp; Information Architecture Assessment
          </h1>
          <p className="text-[#00B4D8] font-semibold mt-5 text-base">
            The same assessment framework used at NASA — now available to your organisation.
          </p>
          <p className="text-white/65 text-xl mt-3 max-w-2xl leading-relaxed">
            Built for mid-market and enterprise teams where ungoverned SharePoint sprawl is blocking Copilot adoption, compliance, and findability.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <CTAButton onClick={() => setModalOpen(true)}>Take the Free Assessment</CTAButton>
            <a href="/book" className="inline-flex items-center gap-2 text-white/70 hover:text-white font-semibold text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40 transition-colors">
              Book a Discovery Call
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-6">
            {["5 minutes", "Free PDF report", "No account required", "No sales call required"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-white/50 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 2: Why This Assessment Exists ────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Why This Exists</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-8">Most SharePoint Environments Are Architecturally Broken — And Admins Can't See It</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1">Organic Sprawl Is the Default</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">SharePoint environments almost always start with good intentions and end with thousands of ungoverned sites, redundant libraries, and abandoned team sites no one owns. Sprawl accumulates silently over years — until it becomes a compliance or migration crisis.</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Database className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1">ROT Content Destroys Findability</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">Redundant, Outdated, and Trivial (ROT) content is the silent productivity killer. When staff can't trust search results, they stop using SharePoint — defaulting to email attachments, shared drives, and tribal knowledge that never gets captured.</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Target className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1">Poor IA Blocks Copilot, Teams, and Compliance</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">Copilot for M365 surfaces content from SharePoint. If your information architecture is chaotic, Copilot will surface the wrong documents to the wrong people — creating security and compliance risks rather than productivity gains. Clean IA isn't optional for AI readiness.</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Lock className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1">Admins Can't See What They Don't Know to Look For</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">SharePoint admin tools show you what exists — not whether it's well-architected. Permission sprawl, broken lifecycle policies, and IA antipatterns are invisible in the admin centre. An expert-designed assessment surfaces what tooling alone cannot.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Who This Is For ───────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal For</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who This Assessment Is For</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">This assessment is designed for organisations where SharePoint is a core platform — not an afterthought.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {ICP_PROFILES.map((profile) => (
              <div key={profile.label} className="bg-white flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:shadow-sm transition-all">
                <div className="flex-shrink-0 mt-0.5">{profile.icon}</div>
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1">{profile.label}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{profile.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 4: How This Assessment Works ─────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">The Process</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">How This Assessment Works</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
            {[
              { stat: "10", label: "Expert Questions", desc: "Tailored to your SharePoint environment" },
              { stat: "5", label: "Dimensions Scored", desc: "IA, governance, security, content, integration" },
              { stat: "NASA", label: "Scoring Methodology", desc: "The same framework used at NASA" },
              { stat: "PDF", label: "Instant Report", desc: "Delivered to your inbox immediately" },
            ].map((card) => (
              <div key={card.label} className="flex flex-col items-center text-center p-6 rounded-2xl border border-border bg-[#F7F9FC]">
                <span className="text-3xl font-extrabold text-[#0078D4] mb-1">{card.stat}</span>
                <span className="font-bold text-[#0A2540] text-sm mb-1">{card.label}</span>
                <span className="text-muted-foreground text-xs leading-relaxed">{card.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-center text-muted-foreground text-sm">No account required · No sales call required</p>
        </div>
      </section>

      {/* ── Section 5: 5 Architecture Dimensions ─────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">What We Assess</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">5 Architecture Dimensions</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">SharePoint environments degrade silently. Ungoverned growth creates permission sprawl, content silos, and findability failure — this assessment finds where yours stands across five critical dimensions.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {DIMENSIONS.map((d) => (
              <div key={d.label} className="bg-white flex flex-col p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:shadow-sm transition-all">
                <div className="flex items-center gap-3 mb-4">
                  {d.icon}
                  <h3 className="font-bold text-[#0A2540]">{d.label}</h3>
                </div>
                <ul className="space-y-2">
                  {d.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                      <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 6: What You Receive ──────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Your Report</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">What You Receive</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Every completed assessment generates a personalised PDF report delivered instantly to your inbox. It includes eight distinct deliverable components.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {DELIVERABLES.map((item) => (
              <div key={item.label} className="flex flex-col gap-3 p-5 rounded-2xl border border-border bg-[#F7F9FC]">
                <div>{item.icon}</div>
                <div>
                  <h3 className="font-bold text-[#0A2540] text-sm mb-1">{item.label}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 7: Inside Your PDF Report ────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Report Structure</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white">Inside Your PDF Report</h2>
            <p className="text-white/60 mt-4 max-w-xl mx-auto">Your report is structured to give you immediate clarity — from an executive overview down to a specific, prioritised remediation path.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {REPORT_SECTIONS.map((section, i) => (
              <div key={section.label} className="flex gap-4 p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/8 transition-all">
                <span className="text-[#00B4D8] font-extrabold text-lg flex-shrink-0 w-6">{i + 1}</span>
                <div>
                  <h3 className="font-bold text-white mb-2">{section.label}</h3>
                  <p className="text-white/55 text-sm leading-relaxed">{section.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a
              href="/sharepoint-architecture-report-sample.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-6 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Download className="w-4 h-4" />
              View Sample Report (PDF)
            </a>
          </div>
        </div>
      </section>

      {/* ── Section 8: Why Shane ─────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">The Assessor</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] leading-tight">
                SharePoint Architecture Expertise You Can Actually Trust
              </h2>
              <p className="text-muted-foreground mt-4 leading-relaxed">
                Most SharePoint consultants learned from documentation. Shane McCaw learned by architecting the platform at scale — inside one of the most complex IT environments on the planet.
              </p>
            </div>
            <div className="space-y-4">
              {[
                { icon: <Award className="w-5 h-5 text-[#0078D4]" />, text: "Lead Microsoft 365 Architect at NASA — responsible for SharePoint architecture across one of the world's most complex M365 tenants" },
                { icon: <Zap className="w-5 h-5 text-[#0078D4]" />, text: "30 years in the Microsoft ecosystem — from on-premises SharePoint Server to modern SharePoint Online and Viva" },
                { icon: <Users className="w-5 h-5 text-[#0078D4]" />, text: "Senior-only delivery — every assessment is conducted personally by Shane, not delegated to junior consultants" },
                { icon: <ShieldCheck className="w-5 h-5 text-[#0078D4]" />, text: "Regulated industry expertise — extensive experience in government, defence contractor, and compliance-heavy SharePoint environments" },
                { icon: <BookOpen className="w-5 h-5 text-[#0078D4]" />, text: "Architecture-first methodology — assessments address root causes, not symptoms, delivering fixes that last beyond the engagement" },
              ].map((item) => (
                <div key={item.text} className="flex items-start gap-4 p-4 rounded-xl border border-border hover:border-[#0078D4]/30 transition-colors">
                  <div className="flex-shrink-0 mt-0.5">{item.icon}</div>
                  <p className="text-[#0A2540] text-sm leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 9: Final CTA ──────────────────────────────────────────────── */}
      <section className="py-20 bg-[#0A2540]">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Your SharePoint architecture determines your search, governance, and Copilot success.</h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">Most organisations don't know where their SharePoint is failing — because the problems are invisible to standard admin tooling. This assessment surfaces exactly what needs to be fixed, and in what order.</p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">Take the Free Assessment Now</CTAButton>
          <p className="text-white/30 text-sm mt-4">5 minutes · Instant results · No sales call</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
