import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { ArrowRight, Shield, Zap, Brain, FolderKanban, CheckCircle, Calendar, Activity, Lock } from "lucide-react";
import { Link } from "wouter";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const sections = [
  {
    icon: Lock,
    number: "01",
    title: "Grant Access — No Scripts, No Setup",
    subtitle: "One admin consent, nothing to install",
    body: [
      "After you purchase an engagement, your tenant's Global Administrator grants access with a single Microsoft-hosted admin consent screen — the same one-click flow used by any enterprise Microsoft 365 app. There's no App Registration to create, no secret to generate, and nothing to install in your environment.",
      "The consent screen shows you exactly what's being requested: a fixed set of read-only Microsoft Graph permissions, granted to the platform's own multi-tenant application — never a script or agent that runs inside your tenant. Approving it takes under a minute.",
    ],
    detail: "One click, no setup. You approve read-only access; nothing is installed or executed in your tenant.",
  },
  {
    icon: Zap,
    number: "02",
    title: "The Platform Reads Your Tenant via Microsoft Graph",
    subtitle: "Live data, not survey answers",
    body: [
      "Once consent is granted, the platform authenticates using application permissions — an app-only identity that never impersonates you or any user in your organization. It calls Microsoft Graph directly from the platform's own infrastructure to read your environment. Nothing is approximated or estimated.",
      "Depending on the engagement type, the scan collects: licensing state and SKU assignments across all users, security policy configuration (MFA, Conditional Access, Defender, DLP), SharePoint site inventory and permission structures, Teams membership and guest access configuration, Exchange Online settings and mailbox health, OneDrive adoption rates, sensitivity label deployment, retention policies, Copilot license assignments and readiness prerequisites.",
    ],
    detail: "Every scope granted is read-only. In this release, the platform only reads — it never writes to or configures anything in your tenant.",
  },
  {
    icon: Brain,
    number: "03",
    title: "AI Analysis and Scoring",
    subtitle: "Findings turned into insight",
    body: [
      "The structured output from each scan is passed to Claude (Anthropic's AI) through the same secure, no-logging API pipeline used across Shane's practice. The AI reviews the findings across multiple dimensions and produces a scored assessment of your environment.",
      "Scoring categories include: Security & Compliance posture, Governance maturity, Licensing efficiency, Copilot readiness, Teams and collaboration adoption, and SharePoint structure health. For each category the AI identifies the top risks, ranks them by severity and remediation effort, and generates a plain-English explanation of what was found, why it matters, and what the typical remediation path looks like.",
    ],
    detail: "AI accelerates analysis. Shane reviews every output and validates it before it reaches you.",
  },
  {
    icon: FolderKanban,
    number: "04",
    title: "Auto-Generated Project in Your Portal",
    subtitle: "Structured from day one",
    body: [
      "Based on the assessment findings, a project is automatically created in your client portal — fully structured with a phased workflow, a Kanban task board, and milestones mapped to what the assessment uncovered. You don't start with a blank slate and a kickoff call. You start with a live view of the engagement.",
      "The project includes: a phased workflow with status-tracked steps (Discovery → Analysis → Remediation → Validation), a task board with items pre-populated from the AI findings, document storage for deliverables, status reports that Shane publishes as work progresses, and a direct messaging thread for questions.",
    ],
    detail: "You can see exactly where things stand — and what's coming next — at any point in the engagement.",
  },
  {
    icon: CheckCircle,
    number: "05",
    title: "Shane Reviews and Refines",
    subtitle: "Expert validation of every output",
    body: [
      "Shane reviews every AI output, adds 30 years of practitioner context, and validates the findings against the real-world patterns he's seen across hundreds of Microsoft 365 environments. The AI provides speed and breadth. Shane provides the judgment, the edge-case recognition, and the practitioner confidence that the output is accurate.",
      "This review phase includes: validating that scored risks are genuinely actionable (not theoretical), adding context that the AI couldn't infer from structured data alone, re-ranking items based on the specific industry, size, and maturity of your organisation, and preparing the findings for the client presentation.",
    ],
    detail: "Every recommendation that reaches you has been reviewed and validated by Shane personally.",
  },
  {
    icon: Calendar,
    number: "06",
    title: "Findings Session",
    subtitle: "Clear recommendations, not a data dump",
    body: [
      "The findings session is a structured presentation of what the assessment uncovered — organised by priority, not by technical category. You'll hear what the highest-severity risks are, what remediation typically involves, and what the realistic timeline and effort looks like for each.",
      "The session ends with a concrete recommendation for next steps: whether that's a fixed-scope remediation package, a fractional retainer for ongoing oversight, or internal execution by your own team using the assessment as a roadmap. There's no pressure toward any outcome — the goal is clarity.",
    ],
    detail: "You leave with a written findings report, a prioritised action plan, and a clear recommendation.",
  },
  {
    icon: Activity,
    number: "07",
    title: "Ongoing Health Monitoring",
    subtitle: "Progress you can see",
    body: [
      "For clients on a retainer or multi-phase engagement, the platform re-scans your tenant on a recurring schedule — typically monthly. Each scan produces a new health snapshot that's added to your portal's health score timeline. You can see exactly how your environment's security posture, governance maturity, and Copilot readiness have changed since the baseline.",
      "If a new risk emerges between scheduled scans — a guest permission setting that changed, an MFA policy that was modified, a compliance deadline approaching — Shane can trigger an ad-hoc scan and review the delta without waiting for the next cycle.",
    ],
    detail: "Not a point-in-time audit. A continuous picture of how your M365 environment is evolving.",
  },
  {
    icon: Shield,
    number: "08",
    title: "What We Never Do",
    subtitle: "Hard limits by design",
    body: [
      "Every permission granted is read-only, by design. In this release, the platform never creates, modifies, or deletes anything in your Microsoft 365 environment — no configuration changes, no policy writes, no mailbox edits. The consent you grant is scoped exclusively to read operations; there is no write-capable permission in the request, full stop.",
      "The platform never acts as a specific user — application permissions mean every read happens under the platform's own service identity, never yours and never any employee's, so there's no impersonation and no delegated user context. Scan output is processed and stored within the platform's own infrastructure, under the same security controls that govern the rest of the service. AI analysis happens over a no-logging Anthropic API connection. Nothing is shared with third parties, sold, or used to train any model.",
    ],
    detail: "Read-only, app-only, no-logging. Access lasts only as long as you allow it — revoke it in your own Entra admin center, anytime, in one click.",
  },
];

export default function HowItWorks() {
  return (
    <Layout>
      <SEOMeta
        title="How It Works | Shane McCaw Consulting"
        description="See exactly how Shane McCaw Consulting's engagement model works — from a one-click Microsoft admin consent through Graph API scanning, AI analysis, and your findings session."
        ogUrl="https://shanemccawconsulting.com/how-it-works"
      />

      {/* Hero */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Process</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            How a Shane McCaw Consulting Engagement Works
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Not questionnaires and kickoff calls. A one-click Microsoft admin consent, live Graph API scanning, AI-powered analysis, and a findings session built around your actual environment — not a generic template.
          </p>
          <div className="flex flex-wrap gap-4 items-center justify-center">
            <ChatCTA
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Ask a Question
            </ChatCTA>
            <Link
              href="/technical-overview"
              className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary font-semibold transition-colors text-sm border border-white/[0.12] px-6 py-3.5 rounded-xl hover:border-white/[0.2]"
            >
              Technical Overview <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Promise summary */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              stat: "Days, not weeks",
              label: "From purchase to first findings — no waiting on questionnaire responses or kickoff logistics.",
            },
            {
              stat: "Read-only",
              label: "The platform never makes changes in your environment. It reads, analyses, and reports — nothing more.",
            },
            {
              stat: "No black boxes",
              label: "You see every step in your portal: what ran, what was found, what Shane reviewed, and what's next.",
            },
          ].map((item, i) => (
            <div key={i} className="text-center px-4">
              <div className="font-numeric text-2xl font-bold text-accent-blue mb-3">{item.stat}</div>
              <p className="text-text-secondary text-sm leading-relaxed">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 8-section breakdown */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto space-y-8">
          {sections.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="bg-charcoal-1 border border-white/[0.06] rounded-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-white/[0.03] border-b border-white/[0.06] px-8 py-6 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-1">{s.number} · {s.subtitle}</p>
                    <h2 className="font-display text-xl font-bold text-text-primary">{s.title}</h2>
                  </div>
                </div>

                {/* Body */}
                <div className="px-8 py-6 space-y-4">
                  {s.body.map((para, j) => (
                    <p key={j} className="text-text-secondary leading-relaxed text-sm">{para}</p>
                  ))}
                  <div className="mt-5 flex items-start gap-2.5 bg-accent-blue/[0.08] rounded-xl px-4 py-3 border border-accent-blue/20">
                    <CheckCircle className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-medium text-text-primary">{s.detail}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Ready to Start</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-6">
            See what's actually inside your Microsoft 365 environment
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto leading-relaxed mb-10">
            A free assessment is the fastest way to understand which engagement is right for your situation — and what you're likely to find.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <ChatCTA
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Ask a Question
            </ChatCTA>
            <Link
              href="/technical-overview"
              className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm font-medium border border-white/[0.12] hover:border-white/[0.2] px-6 py-3.5 rounded-xl transition-colors"
            >
              Read the Technical Overview <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
