import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ArrowRight, Shield, Zap, Brain, FolderKanban, CheckCircle, Calendar, Activity, Lock } from "lucide-react";
import { Link } from "wouter";

const sections = [
  {
    icon: <Lock className="w-6 h-6 text-[#00B4D8]" />,
    number: "01",
    title: "Secure Tenant Connection",
    subtitle: "You stay in control",
    body: [
      "After you purchase an engagement, you receive access to your private client portal. A short onboarding wizard walks you through creating an Azure App Registration in your own Microsoft Entra ID — the same identity platform that governs all Microsoft 365 access.",
      "The App Registration is a service identity that you own and control. It gets exactly the read permissions the automation needs, nothing more. The Client Secret you generate is transmitted over HTTPS and stored immediately in Azure Key Vault — Microsoft's managed secrets service. It is never written to any application database. You can revoke access at any time by deleting the registration from your own Azure portal.",
    ],
    detail: "Zero-trust, least-privilege access. You own the identity; the automation operates through it.",
  },
  {
    icon: <Zap className="w-6 h-6 text-[#00B4D8]" />,
    number: "02",
    title: "Automation Runs Inside Your Tenant",
    subtitle: "Live data, not survey answers",
    body: [
      "Once connected, Shane's PowerShell scripts execute inside your tenant via Azure — Microsoft's managed automation service. The automation reads your environment directly from Microsoft Graph and Azure AD APIs. Nothing is approximated or estimated.",
      "Depending on the engagement type, the runbooks collect: licensing state and SKU assignments across all users, security policy configuration (MFA, Conditional Access, Defender, DLP), SharePoint site inventory and permission structures, Teams membership and guest access configuration, Exchange Online settings and mailbox health, OneDrive adoption rates, sensitivity label deployment, retention policies, Copilot license assignments and readiness prerequisites.",
    ],
    detail: "Runbooks are idempotent — they read only, make no changes, and can be re-run safely at any time.",
  },
  {
    icon: <Brain className="w-6 h-6 text-[#00B4D8]" />,
    number: "03",
    title: "AI Analysis and Scoring",
    subtitle: "Findings turned into insight",
    body: [
      "The structured output from each runbook is passed to Claude (Anthropic's AI) through the same secure, no-logging API pipeline used across Shane's practice. The AI reviews the findings across multiple dimensions and produces a scored assessment of your environment.",
      "Scoring categories include: Security & Compliance posture, Governance maturity, Licensing efficiency, Copilot readiness, Teams and collaboration adoption, and SharePoint structure health. For each category the AI identifies the top risks, ranks them by severity and remediation effort, and generates a plain-English explanation of what was found, why it matters, and what the typical remediation path looks like.",
    ],
    detail: "AI accelerates analysis. Shane reviews every output and validates it before it reaches you.",
  },
  {
    icon: <FolderKanban className="w-6 h-6 text-[#00B4D8]" />,
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
    icon: <CheckCircle className="w-6 h-6 text-[#00B4D8]" />,
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
    icon: <Calendar className="w-6 h-6 text-[#00B4D8]" />,
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
    icon: <Activity className="w-6 h-6 text-[#00B4D8]" />,
    number: "07",
    title: "Ongoing Health Monitoring",
    subtitle: "Progress you can see",
    body: [
      "For clients on a retainer or multi-phase engagement, the automation runs on a recurring schedule — typically monthly. Each run produces a new health snapshot that's added to your portal's health score timeline. You can see exactly how your environment's security posture, governance maturity, and Copilot readiness have changed since the baseline.",
      "If a new risk emerges between scheduled runs — a guest permission setting that changed, an MFA policy that was modified, a compliance deadline approaching — Shane can trigger an ad-hoc run and review the delta without waiting for the next cycle.",
    ],
    detail: "Not a point-in-time audit. A continuous picture of how your M365 environment is evolving.",
  },
  {
    icon: <Shield className="w-6 h-6 text-[#00B4D8]" />,
    number: "08",
    title: "What We Never Do",
    subtitle: "Hard limits by design",
    body: [
      "The automation is read-only by design. Shane's runbooks collect data — they never create, modify, or delete anything in your environment. No configuration changes, no policy writes, no mailbox edits. The App Registration's permissions are scoped exclusively to read operations.",
      "Your data never leaves the Microsoft ecosystem during collection. Runbook output is written to a structured Azure Storage account within Shane's Azure subscription, under the same security controls that govern the rest of the engagement. AI analysis happens over a no-logging Anthropic API connection. Nothing is shared with third parties, sold, or used to train any model.",
    ],
    detail: "Read-only, no-logging, no data sharing. Designed to pass your legal and IT security review.",
  },
];

export default function HowItWorks() {
  return (
    <Layout>
      <SEOMeta
        title="How It Works | Shane McCaw Consulting"
        description="See exactly how Shane McCaw Consulting's engagement model works — from secure tenant connection through automation, AI analysis, and your findings session."
        ogUrl="https://shanemccawconsulting.com/how-it-works"
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[172px] pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Process</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            How a Shane McCaw<br className="hidden sm:block" /> Consulting Engagement Works
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            Not questionnaires and kickoff calls. Live automation inside your Microsoft 365 tenant, AI-powered analysis, and a findings session built around your actual environment — not a generic template.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <Link
              href="/how-it-works/technical"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Technical Overview <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Promise summary */}
      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                stat: "Days, not weeks",
                label: "From purchase to first findings — no waiting on questionnaire responses or kickoff logistics.",
              },
              {
                stat: "Read-only",
                label: "Automation never makes changes in your environment. It reads, analyses, and reports — nothing more.",
              },
              {
                stat: "No black boxes",
                label: "You see every step in your portal: what ran, what was found, what Shane reviewed, and what's next.",
              },
            ].map((item, i) => (
              <div key={i} className="text-center px-4">
                <div className="text-2xl font-extrabold text-[#0078D4] mb-3">{item.stat}</div>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8-section breakdown */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="space-y-10">
            {sections.map((s, i) => (
              <div key={i} className="bg-white border border-border rounded-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-[#0A2540] px-8 py-6 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-1">{s.number} · {s.subtitle}</p>
                    <h2 className="text-xl font-extrabold text-white">{s.title}</h2>
                  </div>
                </div>

                {/* Body */}
                <div className="px-8 py-6 space-y-4">
                  {s.body.map((para, j) => (
                    <p key={j} className="text-foreground leading-relaxed text-sm">{para}</p>
                  ))}
                  <div className="mt-5 flex items-start gap-2.5 bg-[#0078D4]/6 rounded-xl px-4 py-3 border border-[#0078D4]/15">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-medium text-[#0A2540]">{s.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Ready to Start</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6 max-w-2xl mx-auto">
            See what's actually inside your Microsoft 365 environment
          </h2>
          <p className="text-white/60 max-w-xl mx-auto leading-relaxed mb-10">
            A free 30-minute discovery call is the fastest way to understand which engagement is right for your situation — and what you're likely to find.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <Link
              href="/how-it-works/technical"
              className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm font-medium border border-white/20 hover:border-white/40 px-6 py-3 rounded-xl transition-colors"
            >
              Read the Technical Overview <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
