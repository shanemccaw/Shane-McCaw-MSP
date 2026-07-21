import { useState } from "react";
import { Layout } from "@/components/Layout";
import { GenericQuizModal, type QuizConfig } from "@/components/GenericQuizModal";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import {
  CheckCircle, Server, Building2, ShieldCheck, Globe,
  AlertTriangle, Target, Users, ArrowRight, BarChart3, FileText,
  Award, Database, Layers, TrendingUp, Star, GitMerge, Lock, Download,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

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
      badge: "Start Here",
      name: "Migration Readiness Assessment",
      description:
        "Your organisation has significant gaps in migration readiness that, if unaddressed, will lead to data loss, extended outages, or a failed migration. A structured readiness assessment identifies every gap and produces a sequenced remediation plan before a single mailbox moves.",
      slug: "migration-readiness-assessment",
      ctaText: "Get Your Readiness Report",
    },
    Developing: {
      badge: "Recommended",
      name: "Migration Readiness Assessment",
      description:
        "You've made progress, but critical readiness gaps remain. A formal readiness assessment will surface the identity, data governance, and stakeholder alignment issues that will derail your migration if left unaddressed.",
      slug: "migration-readiness-assessment",
      ctaText: "Assess Your Readiness",
    },
    Emerging: {
      badge: "Next Step",
      name: "Migration Readiness Assessment",
      description:
        "Your readiness is solid, but a formal assessment will validate your plans, identify edge cases, and give you a go/no-go recommendation — so you migrate with confidence rather than optimism.",
      slug: "migration-readiness-assessment",
      ctaText: "Validate Your Migration Plan",
    },
    Advanced: {
      badge: "High Impact",
      name: "Governance Foundations Package",
      description:
        "Your migration readiness is strong. Before you execute, ensure your governance framework is in place — DLP policies, sensitivity labels, and lifecycle controls should be configured before content arrives in Microsoft 365.",
      slug: "governance-foundations-package",
      ctaText: "Govern Before You Migrate",
    },
    Ready: {
      badge: "Enterprise Grade",
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

const DIMENSIONS = [
  {
    colour: "bg-blue-500",
    label: "Dimension 1",
    title: "Source Complexity & ROT",
    bullets: [
      "Source platform inventory — mailboxes, shared drives, file shares, and legacy collaboration systems in scope.",
      "Data volume and growth rate — total size, active vs. archived content, and migration batch feasibility.",
      "Redundant, Obsolete, and Trivial (ROT) content levels — and whether a pre-migration clean-up phase is planned.",
      "Legacy platform dependencies — Lotus Notes databases, on-premises SharePoint farms, or custom app integrations.",
      "Inventory completeness — whether an accurate data map exists or needs to be created before migration can begin.",
    ],
  },
  {
    colour: "bg-teal-500",
    label: "Dimension 2",
    title: "Permissions & Metadata",
    bullets: [
      "Permission model complexity — unique vs. inherited permissions and the depth of nested group membership.",
      "Permission migration strategy — whether permissions will be migrated, rebuilt, or redesigned for SharePoint Online.",
      "Metadata preservation — whether document metadata, creation dates, and author fields will survive the migration.",
      "Group and distribution list mapping — how on-premises security groups and DLs translate to Entra ID and M365 groups.",
      "OneDrive and SharePoint permission parity — how personal file permissions and sharing links will be handled post-migration.",
    ],
  },
  {
    colour: "bg-violet-500",
    label: "Dimension 3",
    title: "IA & Security Blockers",
    bullets: [
      "Information architecture blockers — how the source IA will map to SharePoint Online libraries, sites, and hubs.",
      "Regulatory and compliance obligations — HIPAA, CMMC, FedRAMP, GDPR, or sector-specific data handling requirements.",
      "Legacy authentication blockers — applications or services requiring NTLM, Basic Auth, or non-modern authentication.",
      "Sensitivity and classification coverage — whether sensitive content is labelled before migration or must be labelled during.",
      "Conditional Access readiness — whether the target environment has Conditional Access policies configured before cutover.",
    ],
  },
  {
    colour: "bg-orange-500",
    label: "Dimension 4",
    title: "Timeline Realism",
    bullets: [
      "Migration approach — phased vs. big-bang vs. hybrid cutover, and whether the approach matches the risk profile.",
      "Resource capacity — whether internal IT bandwidth and vendor resourcing are sufficient to execute the planned timeline.",
      "Cut-over planning — mail flow switchover, DNS changes, co-existence period duration, and rollback triggers.",
      "Executive commitment — whether a named project sponsor, approved budget, and board-level sign-off are in place.",
      "Dependency scheduling — parallel workstreams (identity, governance, training) and their impact on the migration critical path.",
    ],
  },
  {
    colour: "bg-green-500",
    label: "Dimension 5",
    title: "Migration Governance",
    bullets: [
      "Project governance structure — steering committee, named migration owner, and decision-making escalation path.",
      "Communication and change management plan — how users are prepared for the migration and supported post-cutover.",
      "Rollback procedures — documented and tested rollback scenarios with defined triggers and recovery time objectives.",
      "Success criteria definition — measurable go/no-go criteria before cutover and success metrics post-migration.",
      "End-user training scope — whether migration includes structured training or relies on self-service adoption.",
    ],
  },
];

export default function MigrationQuiz() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Layout>
      <SEOMeta
        title="Cloud Migration Readiness Assessment | Microsoft 365 | Shane McCaw Consulting"
        description="Is your organisation ready to migrate to Microsoft 365? Take our free readiness quiz and receive a personalised migration roadmap from a 30-year Microsoft ecosystem veteran."
        ogImage="/og-image-migration-quiz.png"
        ogUrl="https://shanemccaw.com/migration-readiness-quiz"
      />

      {/* ── 1. Hero ── */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Server className="w-4 h-4" />
            Migration Readiness Assessment
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Your Migration Plan Looks Solid.{" "}
            <GradientText>Until It Doesn't.</GradientText>
          </h1>

          <p className="text-text-secondary text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            Most Microsoft 365 migrations that fail don't fail during execution. They fail in the planning phase — when ROT volumes are underestimated, permission complexity is ignored, and compliance obligations are discovered mid-project.
          </p>
          <p className="text-text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question assessment — built on the diagnostic framework Shane applies as Lead M365 Architect at NASA — surfaces your readiness gaps before the first mailbox moves, so your migration doesn't become a recovery project.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "readiness dimensions" },
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
              <div key={item} className="flex items-center gap-2 text-text-secondary text-sm">
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
            Most cloud migrations fail at the planning stage — not the execution stage.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Organisations consistently underestimate the complexity hidden in their source environments. ROT volumes, permission depth, compliance obligations, and legacy authentication blockers rarely appear in a project charter — and surface instead during cutover, when the cost of discovery is highest.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: Database,
                title: "ROT content makes migrations 3–5× harder than projected",
                body: "Redundant, Obsolete, and Trivial content accounts for 40–70% of the average on-premises file share. Migrating it without remediation inflates migration time, licensing costs, and post-migration search noise — permanently degrading the value of the new environment.",
              },
              {
                icon: Lock,
                title: "Permission complexity is the most common migration blocker",
                body: "Unique permissions at the folder and item level — often thousands in a mature file share — cannot be automatically reconstructed in SharePoint Online without a strategy. Organisations that ignore this don't discover the gap until users report access issues in production.",
              },
              {
                icon: AlertTriangle,
                title: "IA decisions made under time pressure become permanent problems",
                body: "Information architecture decisions made mid-migration — under schedule pressure, without a governance framework — tend to reflect the source structure rather than the target model. The result is a SharePoint environment that mirrors the file share it replaced, missing the point of migration entirely.",
              },
              {
                icon: TrendingUp,
                title: "Assessment tools and readiness checklists can't surface the real risks",
                body: "Standard migration readiness checklists cover technical prerequisites — tenant configuration, licensing, DNS. They don't surface the content, permission, compliance, and governance risks that determine whether the migration succeeds. Those require a diagnostic conversation, not a tick-box audit.",
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
            Built for organisations where migration failure carries real business and compliance risk.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            If your organisation is in any of these categories, you need this assessment before your migration project formally starts.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organisations",
                body: "200–2,000 employees migrating from on-premises Exchange, Google Workspace, or legacy file shares — where data volumes and user counts create real execution risk without a readiness baseline.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "Healthcare (HIPAA), financial services (SOC 2 / FINRA), and legal organisations where data handling, residency, and access controls during migration must meet documented compliance obligations.",
              },
              {
                icon: Globe,
                title: "Compliance-critical migrations",
                body: "Healthcare and financial services organizations where migration must preserve data classification, access controls, and audit trails — and where go/no-go documentation is required.",
              },
              {
                icon: Database,
                title: "Organisations planning SharePoint Online or OneDrive migration",
                body: "Organisations with on-premises SharePoint farms, network file shares, or distributed document repositories planning to consolidate into SharePoint Online and OneDrive for Business.",
              },
              {
                icon: AlertTriangle,
                title: "Teams unsure of source complexity or ROT levels",
                body: "IT and project teams who know a migration is needed but don't yet have a clear picture of what's in the source environment — and need a structured way to scope the work before committing to a timeline.",
              },
              {
                icon: Target,
                title: "Organisations preparing for Copilot or governance initiatives",
                body: "Organisations that know Copilot or a governance framework is the next initiative — and understand that a clean, well-governed migration is a prerequisite for either to deliver value.",
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

      {/* ── 4. How This Assessment Works ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">How It Works</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">From first question to readiness report in under five minutes.</h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            Ten questions. Five readiness dimensions. A scoring model built by the M365 Architect at NASA. An instant readiness score, a personalised PDF report, and a recommended next step — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Server,
                title: "10 targeted questions",
                desc: "Each question maps to one of five migration readiness dimensions — the same diagnostics Shane uses in a paid engagement, compressed into a 5-minute format. No generic questionnaire.",
              },
              {
                icon: Layers,
                title: "5 readiness dimensions scored",
                desc: "Source Complexity & ROT, Permissions & Metadata, IA & Security Blockers, Timeline Realism, and Migration Governance — each scored independently on a 0–10 scale.",
              },
              {
                icon: Star,
                title: "Scoring built by a NASA architect",
                desc: "Your answers are weighted and scored using the same diagnostic framework Shane applies as M365 Architect at NASA. You receive a total score (0–50), a readiness tier, and a per-dimension breakdown.",
              },
              {
                icon: FileText,
                title: "Instant PDF report emailed",
                desc: "A branded, personalised PDF lands in your inbox the moment you complete the assessment. No waiting, no scheduling — your readiness report is generated and delivered immediately.",
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

      {/* ── 5. Five Migration Readiness Dimensions ── */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">The Five Readiness Dimensions</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            What the assessment <GradientText>measures</GradientText> — and why it matters.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether a cloud migration executes cleanly or unravels mid-project. Each is scored independently so you know exactly where your readiness gaps lie — and what to address before committing to a timeline.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {DIMENSIONS.map((dim) => (
              <div key={dim.title} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2 h-10 rounded-full ${dim.colour}`} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-text-secondary">{dim.label}</p>
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
                    <p className="text-xs font-bold uppercase tracking-wide text-text-secondary">Your Output</p>
                    <h3 className="font-display font-bold text-lg text-text-primary">Your Report</h3>
                  </div>
                </div>
                <p className="text-text-secondary text-sm leading-relaxed">
                  All five dimensions scored, ranked by readiness risk, and mapped to a tailored service recommendation. Personalised PDF delivered to your inbox the moment you finish.
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
            A personalised migration readiness report. Free. Instant.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real diagnostic report — built on the same framework Shane applies in paid engagements — delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Overall readiness score",
                body: "A total score across all five dimensions with your readiness tier: Beginner, Developing, Emerging, Advanced, or Ready — with a plain-language interpretation.",
              },
              {
                icon: Database,
                title: "Source complexity analysis",
                body: "An assessment of your source platform complexity — data volumes, ROT levels, legacy system dependencies, and the implications for migration timeline and cost.",
              },
              {
                icon: AlertTriangle,
                title: "ROT and clean-up recommendations",
                body: "Specific recommendations for ROT remediation before migration begins — including which content categories to prioritise and what a clean-up phase should cover.",
              },
              {
                icon: Lock,
                title: "Permission and metadata risks",
                body: "The specific permission and metadata risks identified in your environment — unique permission depth, inheritance breakage, and strategies for handling them in SharePoint Online.",
              },
              {
                icon: ShieldCheck,
                title: "IA and compliance blockers",
                body: "Information architecture and compliance gaps that could block or delay migration — legacy authentication, sensitivity labelling gaps, and regulatory data handling requirements.",
              },
              {
                icon: Target,
                title: "Recommended next steps",
                body: "A prioritised list of the three to five actions that will most improve your migration readiness — specific to your environment, not a generic pre-migration checklist.",
              },
              {
                icon: GitMerge,
                title: "Architecture notes",
                body: "Observations on how your current environment architecture will affect the target design — SharePoint hub structure, OneDrive deployment model, and Teams integration considerations.",
              },
              {
                icon: TrendingUp,
                title: "Priority readiness roadmap",
                body: "A sequenced readiness roadmap — what to resolve before migration starts, what to address in parallel, and what to plan for post-migration — based on your maturity tier.",
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
            A structured diagnostic report — not a migration checklist.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            Your PDF is structured as a professional diagnostic document. It is designed to be shared with IT leadership, a project steering committee, or an executive sponsor — not just filed in a personal inbox.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                num: "01",
                title: "Executive summary",
                desc: "A plain-language overview of your migration readiness posture — one page suitable for sharing with a CTO, IT director, or project sponsor who needs context without technical depth.",
              },
              {
                num: "02",
                title: "Dimension-by-dimension scoring",
                desc: "Each of the five readiness dimensions scored on a 0–10 scale with a narrative explanation of what the score indicates and what contributes to it in your specific environment.",
              },
              {
                num: "03",
                title: "Migration risk heatmap",
                desc: "A visual heatmap showing your relative strength and weakness across all five readiness dimensions at a glance — the fastest way to communicate where migration risk is concentrated.",
              },
              {
                num: "04",
                title: "Gap analysis",
                desc: "A structured breakdown of the content, permission, compliance, governance, and timeline gaps identified across your source environment based on your responses.",
              },
              {
                num: "05",
                title: "Recommended remediation path",
                desc: "A sequenced remediation path — what to address before migration starts, what to handle in parallel, and what represents post-migration clean-up — prioritised by risk and business impact.",
              },
              {
                num: "06",
                title: "Suggested Quick Wins",
                desc: "Based on your score and risk profile, one or two specific Shane McCaw Consulting services recommended as the highest-value next steps: Migration Readiness Assessment, Governance Foundations, or Tenant Health Audit.",
              },
              {
                num: "07",
                title: "Senior-only delivery note",
                desc: "A reminder that all work flowing from this assessment is delivered personally by Shane McCaw — not a junior consultant or offshore delivery team — with a direct booking link included.",
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
              href="/migration-readiness-report-sample.pdf"
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
            Shane McCaw is not a generalist consultant who added Microsoft 365 migrations to a service catalogue. He has spent three decades designing, governing, and executing Microsoft 365 migrations for some of the most demanding organisations in the world.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Star,
                title: "Lead M365 Architect at NASA",
                body: "Shane serves as Lead Microsoft 365 Architect at NASA — responsible for governance, architecture, and compliance across one of the most security-sensitive Microsoft 365 tenants in operation.",
              },
              {
                icon: TrendingUp,
                title: "30 years in the Microsoft ecosystem",
                body: "Shane has worked in the Microsoft ecosystem since the early 1990s — across tenant architecture, migration delivery, identity infrastructure, and now AI deployment readiness.",
              },
              {
                icon: Users,
                title: "Senior-only delivery",
                body: "Every engagement is delivered personally by Shane. There are no junior consultants, no offshore teams, and no account managers inserting themselves between you and the person who knows your environment.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industry expertise",
                body: "Shane has delivered migrations for organisations operating under HIPAA, SOC 2, and FINRA — compliance requirements that demand architecture-first thinking and documented go/no-go criteria.",
              },
              {
                icon: Award,
                title: "Architecture-first migration methodology",
                body: "Shane's assessments don't produce a list of pre-migration tasks. They produce an architectural understanding of the source environment and a sequenced path that avoids the mistakes most migrations make.",
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

      {/* ── 9. CTA Reinforcement ── */}
      <section className="border-t border-white/[0.06] py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-4">Free in 5 Minutes</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-4">
            Your migration readiness determines your timeline, risk, and <GradientText>total cost</GradientText>.
          </h2>
          <p className="text-text-secondary text-lg mb-3 leading-relaxed">
            Organisations that skip the readiness phase consistently discover their biggest blockers mid-project — when discovery costs three times as much as it would have upfront, and reversing decisions means business disruption.
          </p>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            This assessment takes five minutes. The PDF report is free. The gap analysis it surfaces is the same work Shane charges for in a paid engagement.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            data-track="cta"
            className="inline-flex items-center justify-center gap-2 text-white font-semibold text-base px-8 py-4 rounded-xl transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
          >
            Take the Free Assessment
          </button>
          <p className="text-text-secondary text-sm mt-4">5 minutes · Instant results · No sales call</p>
        </div>
      </section>

      {modalOpen && <GenericQuizModal config={config} onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
