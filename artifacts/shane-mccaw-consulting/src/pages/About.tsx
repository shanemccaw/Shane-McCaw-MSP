import { Link } from "wouter";
import { ChatCTA } from "@/components/ChatCTA";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import {
  ArrowRight,
  AlertTriangle,
  Award,
  Bot,
  Building2,
  FileCheck,
  MessageSquare,
  Network,
  Quote,
  Rocket,
  Server,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react";

/**
 * About Shane — Fractional Architecture design pass (Design/fractional_architecture/README.md
 * §3, "About Shane.dc.html"). Restores the route hidden per #633 ("hide don't delete") and
 * recreates the design's exact section order, copy and visual tokens.
 *
 * Copy is verbatim from the design source, including two places it differs from the page's
 * pre-redesign copy (flagged in the #2958 issue comment rather than silently resolved):
 *   - "2026 Innovation Forum Award" (design) vs. this page's prior "Forum of Innovation Award".
 *   - The career timeline collapses to three rows (1994–2010 / 2010–2018 / 2018–Present),
 *     folding the prior separate "Planet Technologies" row into the McCawSoft years.
 */

const heroStats = [
  {
    value: "30+",
    label: "Years in Microsoft ecosystem",
    desc: "Since 1994. Writing code first, architecture second, strategy decks never.",
  },
  {
    value: "NASA",
    label: "Current role",
    desc: "Lead M365 Architect and Copilot for M365 SME. His primary day job, since 2018.",
  },
  {
    value: "20+",
    label: "Microsoft certifications",
    desc: "Earned over decades of real-world practice, not exam preparation.",
  },
  {
    value: "2026",
    label: "Innovation Forum Award",
    desc: "For deploying Copilot to the first large federal agency to do so.",
  },
];

const idealClients = [
  {
    pill: "200–2,000 employees",
    icon: Building2,
    title: "Mid-Market Enterprises",
    challenge:
      "Too large to wing their M365 setup, too lean to justify a full-time senior architect on staff. Governance debt accumulates quietly — until it surfaces as a compliance gap, an oversharing incident, or a Copilot deployment that goes sideways.",
    angle:
      "Fills the fractional architect role that mid-market organizations need but rarely have access to — bringing the same structured approach to your 800-seat environment that he applies to NASA's enterprise.",
    quote: "You need NASA-grade governance. You don't need NASA's headcount.",
  },
  {
    pill: "Regulated Industries",
    icon: Shield,
    title: "Healthcare, Finance & Regulated Industries",
    challenge:
      "HIPAA, SOC 2, or industry-specific compliance requirements intersecting with an M365 environment that wasn't designed to meet them. Most consultants have read the frameworks. Few have operated inside one.",
    angle:
      "Shane operates inside one of the federal government's most demanding compliance environments every day. His compliance architecture experience is not theoretical — it's the exact context in which he makes daily production decisions.",
    quote: "Most consultants have read the compliance frameworks. I operate inside one every day.",
  },
  {
    pill: "Growing organizations",
    icon: Rocket,
    title: "Startups & Scale-Ups",
    challenge:
      "M365 was stood up fast, permissions sprawled, governance was never designed — and now the organization is large enough that fixing it is becoming a real project. The longer it's deferred, the more expensive the remediation.",
    angle:
      "Intervenes before the governance debt reaches critical mass — establishing a framework that scales with the organization instead of against it, and conducting the remediation work directly.",
    quote: "It's cheaper to architect it correctly at 200 seats than to remediate it at 2,000.",
  },
];

const triggers = [
  {
    icon: AlertTriangle,
    bold: "An upcoming audit or compliance deadline",
    rest: "— and the M365 environment isn't ready.",
  },
  {
    icon: Network,
    bold: "A failed or stalled migration",
    rest: "— on-premises to M365, or between M365 configurations — that needs a senior architect to diagnose and restart.",
  },
  {
    icon: Bot,
    bold: "Copilot readiness concerns",
    rest: "— the organization has or is evaluating Microsoft 365 Copilot licenses and needs to know if the tenant is actually ready to deploy safely.",
  },
  {
    icon: Users,
    bold: "A departed IT leader or leadership gap",
    rest: "— and no one remaining has the M365 architecture depth to make the decisions in the queue.",
  },
  {
    icon: Network,
    bold: "Teams and SharePoint chaos",
    rest: "— permissions sprawl, abandoned sites, inconsistent governance, and no clear path to remediation.",
  },
  {
    icon: ShieldCheck,
    bold: "A security incident or near-miss",
    rest: "— an oversharing exposure, a sensitivity labeling failure, or a Conditional Access misconfiguration that surfaced before it became a headline.",
  },
];

const nasaPoints = [
  {
    icon: Server,
    title: "Security-first by default",
    desc: "At NASA, there is no acceptable error rate for misconfiguration. Every architecture decision starts with a failure-mode analysis — a discipline Shane applies to every client engagement.",
  },
  {
    icon: Network,
    title: "Governance before deployment",
    desc: "Federal compliance requirements mean governance frameworks aren't optional or retrofittable. They're foundational. Shane designs governance into the architecture from day one.",
  },
  {
    icon: FileCheck,
    title: "Compliance at the highest tier",
    desc: "Operating under one of the strictest security-compliance regimes in the federal government has given Shane instincts for compliance discipline that translate directly to regulated private-sector clients.",
  },
  {
    icon: Bot,
    title: "Real Copilot deployment experience",
    desc: "Shane has navigated Copilot deployment in one of the most constrained M365 environments in existence — working through the actual governance, labeling, and rollout challenges that other consultants are still theorizing about.",
  },
];

const timeline = [
  {
    years: "1994–2010",
    org: "Microsoft ecosystem",
    role: "Software Developer & Architect",
    desc: "Shane's career started when Microsoft was still figuring out what the internet meant for enterprise software. He spent the early years writing production code, building architecture for enterprise clients, and developing a deep intuition for the way Microsoft platforms actually work under the hood — not just how they're documented to work.",
  },
  {
    years: "2010–2018",
    org: "McCawSoft",
    role: "Founder & Principal Architect",
    desc: "Shane founded McCawSoft to build the kind of Microsoft consulting practice that didn't exist at the time: one where a senior architect with real platform knowledge handled engagements personally. McCawSoft served clients across healthcare, financial services, and the public sector — building SharePoint environments, Office 365 migrations, and governance frameworks that actually held up over time.",
  },
  {
    years: "2018–Present",
    org: "NASA",
    role: "Lead Microsoft 365 Architect & Copilot SME",
    desc: "Shane currently serves as Lead M365 Architect and Copilot for Microsoft 365 Subject Matter Expert at NASA. He is responsible for platform governance, compliance architecture, Copilot deployment strategy, and enterprise cloud modernization across one of the most security-sensitive M365 environments in the federal government. This is not a retired role. It is his primary day job.",
    isCurrent: true,
  },
];

const philosophy = [
  {
    title: "Every engagement is personal.",
    desc: "Shane handles his engagements directly. No project managers, no junior consultants, no offshore team. When you hire Shane McCaw Consulting, you get Shane.",
  },
  {
    title: "Governance is not a phase. It's a foundation.",
    desc: "Most M365 problems — oversharing, compliance gaps, Copilot risk — trace back to governance that was never properly designed. Shane builds it in from the start.",
  },
  {
    title: "The goal is your independence.",
    desc: "Shane's engagements are structured to leave organizations more capable, not more dependent. Documentation and knowledge transfer are non-negotiable deliverables.",
  },
  {
    title: "Recommendations are specific to your environment.",
    desc: "No templated playbooks. Shane's advice is based on a real assessment of your tenant, your data, and your organizational context.",
  },
];

const competencies = [
  "Microsoft 365 Architecture",
  "Microsoft Copilot for M365",
  "Copilot Governance & Readiness",
  "SharePoint Online",
  "Microsoft Teams",
  "OneDrive for Business",
  "Exchange Online",
  "Entra ID (Azure AD)",
  "Power Platform",
  "Power Automate",
  "Power Apps",
  "Microsoft Purview",
  "Sensitivity Labels",
  "DLP Policy Design",
  "Retention & Records Management",
  "Conditional Access",
  "Information Architecture",
  "Enterprise Governance Frameworks",
  "Cloud Migration Strategy",
  "M365 Tenant Health & Optimization",
];

// Real destinations, matched from the design's own link targets (About Shane.dc.html) onto
// this app's actual routes — the same route strings the already-shipped Header/Footer (#2954)
// use for these same pages, not invented for this page.
const workWithMe = [
  {
    eyebrow: "Start here · from $900/mo",
    name: "Fractional Architect Retainer",
    desc: "Ongoing senior M365 architecture support on a monthly basis — strategy calls, ad-hoc guidance, and architecture reviews. The fractional architect model, without the enterprise overhead.",
    cta: "See the four tiers",
    href: "/#tiers",
    featured: true,
  },
  {
    eyebrow: "$5,000 flat",
    name: "Copilot Readiness Assessment",
    desc: "A six-dimension evaluation of your tenant's readiness for Microsoft 365 Copilot — licensing, identity, permissions, governance, sensitivity labeling, and oversharing risk. Tells you exactly what to fix before Copilot goes live.",
    cta: "See the assessment",
    href: "/assessment",
  },
  {
    eyebrow: "Scoped after the review",
    name: "Tenant Health Audit",
    desc: "A structured assessment of your M365 environment — governance gaps, permissions sprawl, security posture, and configuration risk — with a prioritized remediation roadmap. The right starting point for any serious engagement.",
    cta: "M365 Health deep dive",
    href: "/solutions/health",
  },
  {
    eyebrow: "Scoped after the review",
    name: "Governance Foundations",
    desc: "A complete governance framework designed for your organization: data classification, access controls, retention policy, DLP, and Copilot guardrails. Built from the same principles Shane applies at NASA.",
    cta: "Governance deep dive",
    href: "/solutions/governance",
  },
  {
    eyebrow: "Scoped after the review",
    name: "Migration Readiness",
    desc: "A focused planning engagement to map your path from on-premises or legacy environments to M365 — sequencing, risk mitigation, and a clear migration architecture. Avoids the stalls and surprises that plague unplanned migrations.",
    cta: "Migration deep dive",
    href: "/solutions/migration",
  },
  {
    eyebrow: "Scoped after the review",
    name: "Power Platform Quick-Start",
    desc: "Structured guidance to deploy Power Automate or Power Apps in a governed, secure way — including environment strategy, DLP policy design, and a working proof-of-concept tailored to your use case.",
    cta: "Power Platform deep dive",
    href: "/solutions/power-platform",
  },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px w-[26px]" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
      <span className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#00B4D8]">{children}</span>
    </div>
  );
}

export default function About() {
  return (
    <Layout>
      <SEOMeta
        title="About Shane McCaw | NASA's M365 Architect & Copilot SME | Shane McCaw Consulting"
        description="Meet Shane McCaw — NASA's Lead Microsoft 365 Architect, 30-year Microsoft veteran, and Copilot SME. Learn why top organizations trust Shane to transform their M365 environments."
      />

      {/* Hero */}
      <section
        id="top"
        className="relative overflow-hidden"
        style={{
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), rgba(2,6,23,0) 66%)",
        }}
      >
        <div className="mx-auto grid max-w-[1160px] items-center gap-[clamp(40px,6vw,80px)] px-[clamp(16px,4vw,32px)] py-[clamp(56px,9vw,104px)] pb-[clamp(48px,7vw,80px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
          <div className="max-w-[640px]">
            <Eyebrow>About Shane McCaw</Eyebrow>
            <h1 className="mt-[22px] mb-5 text-[clamp(26px,3.8vw,40px)] font-extrabold leading-[1.1] tracking-[-.022em] text-[#f8fafc] [text-wrap:pretty]">
              30 Years in the Microsoft Ecosystem. Currently NASA's Lead M365 Architect.{" "}
              <span className="text-[#a78bfa]">Still Doing the Work.</span>
            </h1>
            <p className="mb-8 max-w-[580px] text-[clamp(16px,2.2vw,18px)] leading-[1.6] text-[#94a3b8] [text-wrap:pretty]">
              Shane McCaw is not a former Microsoft executive turned consultant, or a generalist who
              took a few certifications. He is a working architect who has spent three decades inside
              this platform — and is actively doing at NASA today what he can do for your organization
              tomorrow.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ChatCTA
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-[26px] text-base font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}
                data-track="cta"
                data-testid="about-hero-cta"
              >
                Work with Shane <ArrowRight className="h-4 w-4" />
              </ChatCTA>
              <a
                href="#timeline"
                className="inline-flex min-h-[52px] items-center justify-center rounded-xl border px-[22px] text-base font-semibold text-[#e2e8f0] transition-colors hover:border-[rgba(148,163,184,.5)]"
                style={{ borderColor: "rgba(148,163,184,.3)" }}
              >
                30 years, one ecosystem
              </a>
            </div>
          </div>
          <div
            className="w-full max-w-[520px] justify-self-end rounded-[18px] border px-[22px] py-5 backdrop-blur-[3px]"
            style={{
              borderColor: "rgba(139,92,246,.22)",
              background: "linear-gradient(160deg,rgba(139,92,246,.10),rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))",
              boxShadow: "0 0 60px rgba(139,92,246,.13), inset 0 1px 0 rgba(148,163,184,.08)",
            }}
            data-testid="about-hero-stat-panel"
          >
            {heroStats.map((stat, i) => (
              <div
                key={stat.label}
                className={`grid grid-cols-[minmax(110px,auto)_1fr] items-start gap-x-[clamp(16px,3vw,28px)] py-[18px] ${i > 0 ? "border-t" : ""}`}
                style={i > 0 ? { borderColor: "rgba(30,41,59,.9)" } : undefined}
                data-testid={`hero-stat-${i}`}
              >
                <span className="text-[clamp(40px,5vw,60px)] font-extrabold leading-[.9] tracking-[-.045em] text-[#f8fafc]">
                  {stat.value}
                </span>
                <div className="pt-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#00B4D8]">{stat.label}</div>
                  <p className="mt-1.5 text-sm leading-[1.5] text-[#94a3b8]">{stat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Available for Engagements */}
      <section className="border-y" style={{ borderColor: "rgba(30,41,59,.8)", background: "rgba(15,23,42,.4)" }}>
        <div className="mx-auto grid max-w-[1160px] items-start gap-[clamp(32px,5vw,64px)] px-[clamp(16px,4vw,32px)] py-[clamp(48px,7vw,80px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
          <div
            className="relative overflow-hidden rounded-[20px] border p-[clamp(24px,4vw,40px)]"
            style={{
              borderColor: "rgba(0,120,212,.3)",
              background:
                "radial-gradient(700px 300px at 8% -10%,rgba(0,120,212,.18),transparent 60%),linear-gradient(168deg,rgba(10,37,64,.5),#070d1e 64%)",
            }}
          >
            <span
              className="inline-flex rounded-full border px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[.12em] text-[#00B4D8]"
              style={{ background: "rgba(0,180,216,.1)", borderColor: "rgba(0,180,216,.3)" }}
            >
              Available for Engagements
            </span>
            <h2 className="mt-[18px] mb-4 text-[clamp(24px,3.6vw,34px)] font-extrabold leading-[1.14] tracking-[-.025em] text-[#f8fafc] [text-wrap:pretty]">
              The Architect Who Built at NASA Scale — Available to You.
            </h2>
            <p className="text-[15.5px] leading-[1.65] text-[#cbd5e1] [text-wrap:pretty]">
              The governance rigor, security-first architecture, and hands-on Copilot deployment
              experience that Shane has developed running one of the most scrutinized Microsoft 365
              environments in the federal government don't stay at NASA. Every private engagement
              draws directly from what he is solving in production today — at a compliance level and
              operational scale that most enterprise consultants have never operated at. You are not
              getting a consultant who studied NASA. You are getting the architect who works there.
            </p>
          </div>
          <div className="flex flex-col gap-[18px] text-base leading-[1.7] text-[#94a3b8]">
            <p className="[text-wrap:pretty]">
              Most organizations running Microsoft 365 are using a fraction of what they're paying for —
              and carrying governance, security, and compliance risk they don't fully see yet. Shane's
              consulting practice exists to fix that, personally. He brings the same structured thinking
              he applies at NASA to mid-market and regulated organizations that can't afford to get it
              wrong — and delivers it without the overhead of a large firm.
            </p>
            <p className="[text-wrap:pretty]">
              Engagements are direct: you work with Shane, not a project manager or a junior consultant
              who escalates to him. Every piece of advice comes from current production experience, not
              from conference playbooks. And every engagement is designed to leave your organization
              more capable — not more dependent on a retainer.
            </p>
            <p className="[text-wrap:pretty]">
              Whether you're facing an upcoming audit, a Copilot deployment you're not sure your tenant
              is ready for, or an M365 environment that has grown beyond your team's ability to govern
              it — this is exactly the kind of problem Shane solves every day at NASA.
            </p>
          </div>
        </div>
      </section>

      {/* Who I Help — and Why */}
      <section className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)]">
        <div className="mb-7 max-w-[760px]">
          <Eyebrow>Ideal Clients</Eyebrow>
          <h2 className="mt-3.5 mb-3 text-[clamp(26px,4.4vw,38px)] font-extrabold leading-[1.12] tracking-[-.025em] text-[#f8fafc] [text-wrap:pretty]">
            Who I Help — and Why
          </h2>
          <p className="text-base leading-[1.65] text-[#94a3b8] [text-wrap:pretty]">
            Three types of organizations get the most from Shane's practice. Each has a different
            situation, but the same underlying need: senior-level Microsoft architecture expertise,
            delivered without the overhead.
          </p>
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          {idealClients.map((client, i) => {
            const Icon = client.icon;
            return (
              <div
                key={client.title}
                className="flex flex-col rounded-2xl border p-6 transition-colors hover:border-[rgba(0,120,212,.4)]"
                style={{ borderColor: "rgba(30,41,59,.9)", background: "rgba(15,23,42,.5)" }}
                data-testid={`who-i-help-${i}`}
              >
                <span
                  className="inline-flex w-fit items-center gap-1 rounded-full border px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[.1em] text-[#60a5fa]"
                  style={{ background: "rgba(96,165,250,.1)", borderColor: "rgba(96,165,250,.2)" }}
                >
                  <Icon className="h-3.5 w-3.5" /> {client.pill}
                </span>
                <h3 className="mt-4 mb-3.5 text-lg font-bold tracking-[-.015em] text-[#f8fafc]">{client.title}</h3>
                <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#94a3b8]">Core challenge</div>
                <p className="mt-1.5 mb-3.5 text-sm leading-[1.6] text-[#94a3b8]">{client.challenge}</p>
                <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#00B4D8]">Shane's angle</div>
                <p className="mt-1.5 mb-4 flex-1 text-sm leading-[1.6] text-[#cbd5e1]">{client.angle}</p>
                <p
                  className="border-t pt-3.5 text-sm italic leading-[1.5] text-[#f1f5f9]"
                  style={{ borderColor: "rgba(30,41,59,.9)" }}
                >
                  "{client.quote}"
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Why IT Leaders Bring Me In */}
      <section className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)]">
        <div className="mb-7 max-w-[760px]">
          <Eyebrow>Engagement Triggers</Eyebrow>
          <h2 className="mt-3.5 mb-3 text-[clamp(26px,4.4vw,38px)] font-extrabold leading-[1.12] tracking-[-.025em] text-[#f8fafc] [text-wrap:pretty]">
            Why IT Leaders Bring Me In
          </h2>
          <p className="text-base leading-[1.65] text-[#94a3b8] [text-wrap:pretty]">
            There's almost always a specific trigger — a moment when the organization realizes it
            needs someone who has solved this problem before, at a level of complexity and risk
            that makes getting it wrong genuinely costly.
          </p>
        </div>
        <div className="grid items-start gap-[clamp(24px,4vw,40px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
          <div className="grid gap-x-7 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
            {triggers.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.bold}
                  className="flex items-start gap-3.5 border-t py-[18px]"
                  style={{ borderColor: "rgba(30,41,59,.9)" }}
                  data-testid={`trigger-${i}`}
                >
                  <span
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border text-[#60a5fa]"
                    style={{ background: "rgba(0,120,212,.12)", borderColor: "rgba(0,120,212,.25)" }}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <p className="text-[14.5px] leading-[1.6] text-[#cbd5e1]">
                    <b className="font-semibold text-[#f8fafc]">{item.bold}</b> {item.rest}
                  </p>
                </div>
              );
            })}
          </div>
          <div
            className="rounded-2xl border p-[clamp(22px,3vw,28px)]"
            style={{ borderColor: "rgba(0,180,216,.3)", background: "rgba(15,23,42,.6)" }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#00B4D8]">Why It Works</div>
            <h3 className="mt-3 mb-3.5 text-[clamp(19px,2.6vw,23px)] font-bold leading-[1.25] tracking-[-.018em] text-[#f8fafc]">
              High-Stakes Decisions. Tested Judgment. No Ramp-Up.
            </h3>
            <div className="flex flex-col gap-3 text-[14.5px] leading-[1.65] text-[#94a3b8]">
              <p>
                In every one of these situations, the underlying need is the same: someone has to make
                high-stakes decisions about a complex Microsoft 365 environment — quickly, confidently,
                and without a months-long ramp-up period to get oriented.
              </p>
              <p>
                Shane reduces risk because he has already solved these problems at NASA scale, under
                federal compliance accountability. He doesn't theorize about what might work. He
                applies what he has tested in production.
              </p>
              <p>
                And because every engagement is direct — no account managers, no subcontractors, no
                junior team doing the actual work — the institutional knowledge Shane brings to your
                engagement doesn't get filtered or diluted before it reaches you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Background */}
      <section className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)]">
        <div className="grid items-start gap-[clamp(28px,5vw,64px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
          <div>
            <div className="mb-[22px]">
              <Eyebrow>Background</Eyebrow>
            </div>
            <div className="flex flex-col gap-[18px] text-base leading-[1.7] text-[#94a3b8]">
              <p className="[text-wrap:pretty]">
                Shane McCaw's career in the Microsoft ecosystem began in 1994. At the time, Office
                was still delivered on floppy disks, and the idea of enterprise software living in
                the cloud was science fiction. Over the three decades since, he has watched Microsoft
                evolve from a desktop software company into the dominant enterprise cloud platform —
                and he has been an architect of that transformation, not a spectator.
              </p>
              <p className="[text-wrap:pretty]">
                He started his career writing code. Not configuring platforms or presenting strategy
                decks — writing production software and building real architecture for real
                organizations. That foundation matters. It means Shane understands why the M365
                platform behaves the way it does, not just how to navigate its admin portals. When a
                governance policy doesn't behave as expected or a Copilot deployment surfaces data it
                shouldn't, he knows where to look.
              </p>
              <p className="[text-wrap:pretty]">
                In 2010, Shane founded McCawSoft — a consulting practice built on the belief that
                enterprise Microsoft technology deserves genuine enterprise expertise. McCawSoft
                served clients across healthcare, financial services, manufacturing, and government:
                building SharePoint environments that didn't collapse under their own permissions
                sprawl, migrating organizations to Exchange Online without losing data, and designing
                governance frameworks that still hold up years later.
              </p>
              <p className="[text-wrap:pretty]">
                Today, Shane's primary role is Lead Microsoft 365 Architect and Copilot Subject
                Matter Expert at NASA. That is not a credential or a title from a past position. It
                is what he does every day — managing the governance, compliance, and platform
                architecture of one of the most security-constrained Microsoft 365 environments in
                the federal government. He consults on the side, which means every engagement
                benefits directly from what he is working on in production right now.
              </p>
            </div>
          </div>
          <div
            className="sticky top-24 border-l pl-[clamp(20px,3vw,32px)]"
            style={{ borderColor: "rgba(0,180,216,.35)" }}
          >
            <Quote className="mb-3.5 h-[30px] w-[30px]" style={{ fill: "rgba(0,180,216,.5)", color: "rgba(0,180,216,.5)" }} />
            <p className="mb-[18px] text-[clamp(18px,2.4vw,22px)] font-medium leading-[1.45] tracking-[-.012em] text-[#f1f5f9] [text-wrap:pretty]">
              "I got into this field because I love what Microsoft technology can actually do when it's
              properly architected and governed. Too many organizations are running M365 at 20% of its
              capability — not because the platform is limited, but because it was stood up incorrectly
              and never fixed. That's the problem I spend my career solving."
            </p>
            <div className="flex items-center gap-3">
              <span
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] text-xs font-extrabold tracking-[-.5px] text-white"
                style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
              >
                SM
              </span>
              <div>
                <div className="text-sm font-bold text-[#f8fafc]">Shane McCaw</div>
                <div className="text-[12.5px] text-[#94a3b8]">
                  Lead M365 Architect &amp; Copilot SME, NASA · Founder, Shane McCaw Consulting
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The NASA Advantage */}
      <section className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)]">
        <div className="grid items-start gap-[clamp(28px,5vw,64px)] [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
          <div>
            <Eyebrow>The NASA Advantage</Eyebrow>
            <h2 className="mt-3.5 mb-[18px] text-[clamp(26px,4.4vw,38px)] font-extrabold leading-[1.12] tracking-[-.025em] text-[#f8fafc] [text-wrap:pretty]">
              What Working at NASA Every Day Means for You
            </h2>
            <div className="flex flex-col gap-4 text-base leading-[1.7] text-[#94a3b8]">
              <p className="[text-wrap:pretty]">
                NASA's Microsoft 365 environment operates under constraints that most enterprise IT
                teams will never encounter — top-tier federal security compliance requirements,
                sensitive research data, multi-agency collaboration needs, and zero tolerance for
                misconfiguration.
              </p>
              <p className="[text-wrap:pretty]">
                Working inside that environment since 2018 has fundamentally shaped how Shane thinks
                about architecture, governance, and deployment risk. He is not applying theoretical
                best practices. He is applying what he learned yesterday, in production, under real
                stakes.
              </p>
              <p className="[text-wrap:pretty]">
                Most consultants talk about best practices learned from whitepapers and conference
                sessions. Shane applies what he validated last week in one of the most scrutinized
                M365 environments on earth. That is not a marginal difference — it is the difference
                between repeating advice and delivering tested judgment.
              </p>
              <p className="[text-wrap:pretty]">
                For your organization, that means access to a level of governance discipline and
                platform depth that even most large consulting firms cannot offer — delivered
                directly, without layers of overhead.
              </p>
            </div>
            <div
              className="mt-[26px] rounded-2xl border px-[22px] py-5"
              style={{ borderColor: "rgba(0,180,216,.3)", background: "rgba(0,180,216,.06)" }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#00B4D8]">
                The difference that matters
              </div>
              <p className="mt-2.5 text-[15px] leading-[1.6] text-[#f1f5f9]">
                Most enterprise consultants apply best practices learned from documentation,
                whitepapers, and other client engagements. Shane applies what he validated last week,
                in a live production environment, under federal compliance requirements. That's not a
                marginal difference in quality — it's a fundamentally different basis for advice.
              </p>
            </div>
          </div>
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))]">
            {nasaPoints.map((point, i) => {
              const Icon = point.icon;
              return (
                <div
                  key={point.title}
                  className="rounded-2xl border p-[22px]"
                  style={{ borderColor: "rgba(30,41,59,.9)", background: "rgba(15,23,42,.5)" }}
                  data-testid={`nasa-point-${i}`}
                >
                  <span
                    className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[11px] border text-[#60a5fa]"
                    style={{ background: "rgba(0,120,212,.12)", borderColor: "rgba(0,120,212,.25)" }}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <h3 className="mb-2 text-base font-bold tracking-[-.01em] text-[#f8fafc]">{point.title}</h3>
                  <p className="text-[13.5px] leading-[1.6] text-[#94a3b8]">{point.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Career Timeline + Award band */}
      <section
        id="timeline"
        className="mt-[clamp(56px,8vw,88px)] border-t"
        style={{ borderColor: "rgba(30,41,59,.8)", background: "linear-gradient(180deg,#020617,#040b1e 40%,#020617)" }}
      >
        <div className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] py-[clamp(56px,8vw,88px)]">
          <div className="mb-2 max-w-[760px]">
            <Eyebrow>Career Timeline</Eyebrow>
            <h2 className="mt-3.5 mb-7 text-[clamp(26px,4.4vw,38px)] font-extrabold leading-[1.12] tracking-[-.025em] text-[#f8fafc]">
              30 Years. One Ecosystem.
            </h2>
          </div>
          <div className="border-t" style={{ borderColor: "rgba(30,41,59,.9)" }}>
            {timeline.map((item, i) => (
              <div
                key={item.years}
                className="flex flex-wrap gap-x-[clamp(20px,4vw,48px)] gap-y-3 border-b py-[26px]"
                style={{ borderColor: "rgba(30,41,59,.9)" }}
                data-testid={`timeline-item-${i}`}
              >
                <div className="flex-[0_0_clamp(120px,15vw,180px)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] tracking-[.08em] text-[#00B4D8]">{item.years}</span>
                    {item.isCurrent && (
                      <span className="rounded-full bg-[#00B4D8] px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[.14em] text-[#020617]">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[12.5px] text-[#94a3b8]">{item.org}</div>
                </div>
                <div className="min-w-0 flex-[1_1_380px]">
                  <h3 className="mb-2 text-lg font-bold tracking-[-.015em] text-[#f8fafc]">{item.role}</h3>
                  <p className="max-w-[760px] text-[15px] leading-[1.65] text-[#94a3b8]">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-7 flex flex-wrap items-center gap-4 rounded-2xl border p-[clamp(20px,3vw,28px)]"
            style={{ borderColor: "rgba(0,120,212,.3)", background: "rgba(15,23,42,.6)" }}
            data-testid="award-band"
          >
            <span
              className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border text-[#60a5fa]"
              style={{ background: "rgba(0,120,212,.12)", borderColor: "rgba(0,120,212,.25)" }}
            >
              <Award className="h-7 w-7" />
            </span>
            <div className="flex-[1_1_320px]">
              <div className="text-lg font-bold tracking-[-.015em] text-[#f8fafc]">
                2026 Innovation Forum Award Winner · 20+ Microsoft Certifications
              </div>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-[#94a3b8]">
                Shane won the 2026 Innovation Forum Award for deploying Copilot to the first large
                federal agency to do so. He holds more than 20 Microsoft certifications — earned over
                decades of real-world practice, not exam preparation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)]">
        <div className="mb-6 max-w-[760px]">
          <Eyebrow>How Shane Works</Eyebrow>
          <h2 className="mt-3.5 text-[clamp(26px,4.4vw,38px)] font-extrabold leading-[1.12] tracking-[-.025em] text-[#f8fafc] [text-wrap:pretty]">
            Hands-On. Direct. No Shortcuts.
          </h2>
        </div>
        <div className="grid gap-x-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr))]">
          {philosophy.map((item, i) => (
            <div
              key={item.title}
              className="border-t py-5"
              style={{ borderColor: "rgba(0,180,216,.35)" }}
              data-testid={`philosophy-item-${i}`}
            >
              <div className="font-mono text-[11px] tracking-[.12em] text-[#00B4D8]">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="mt-2.5 mb-2 text-base font-bold leading-[1.3] tracking-[-.01em] text-[#f8fafc]">{item.title}</h3>
              <p className="text-sm leading-[1.6] text-[#94a3b8]">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Core Competencies */}
      <section className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)]">
        <Eyebrow>Technical Expertise</Eyebrow>
        <h2 className="mt-3.5 mb-[22px] text-[clamp(26px,4.4vw,38px)] font-extrabold leading-[1.12] tracking-[-.025em] text-[#f8fafc]">
          Core Competencies
        </h2>
        <div className="flex flex-wrap gap-2">
          {competencies.map((comp, i) => (
            <span
              key={comp}
              className="rounded-full border px-3.5 py-2 text-sm font-medium text-[#cbd5e1]"
              style={{ borderColor: "rgba(148,163,184,.22)", background: "rgba(15,23,42,.5)" }}
              data-testid={`competency-${i}`}
            >
              {comp}
            </span>
          ))}
        </div>
      </section>

      {/* How You Can Work With Me */}
      <section className="mx-auto max-w-[1160px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)]">
        <div className="mb-7 max-w-[760px]">
          <Eyebrow>Engagements</Eyebrow>
          <h2 className="mt-3.5 mb-3 text-[clamp(26px,4.4vw,38px)] font-extrabold leading-[1.12] tracking-[-.025em] text-[#f8fafc] [text-wrap:pretty]">
            How You Can Work With Me
          </h2>
          <p className="text-base leading-[1.65] text-[#94a3b8] [text-wrap:pretty]">
            The governance discipline, compliance depth, and hands-on Microsoft 365 experience Shane
            has built at NASA translate directly into six structured ways to engage — each scoped to
            a specific organizational need, with clear deliverables and no open-ended surprises.
          </p>
        </div>
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          {workWithMe.map((offer, i) => (
            <Link
              key={offer.name}
              href={offer.href}
              className="flex flex-col gap-2 rounded-2xl border p-[22px] no-underline transition-colors"
              style={
                offer.featured
                  ? {
                      borderColor: "rgba(0,120,212,.4)",
                      background: "linear-gradient(160deg,rgba(10,37,64,.55),rgba(15,23,42,.5) 70%)",
                    }
                  : { borderColor: "rgba(30,41,59,.9)", background: "rgba(15,23,42,.5)" }
              }
              data-testid={`work-with-me-${i}`}
            >
              <span className="text-[10.5px] font-bold uppercase tracking-[.12em] text-[#00B4D8]">{offer.eyebrow}</span>
              <span className="text-[17px] font-bold leading-[1.3] tracking-[-.01em] text-[#f8fafc]">{offer.name}</span>
              <span className="flex-1 text-sm leading-[1.6] text-[#94a3b8]">{offer.desc}</span>
              <span className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[#00B4D8]">
                {offer.cta} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-[940px] px-[clamp(16px,4vw,32px)] pt-[clamp(56px,8vw,88px)] pb-[clamp(72px,10vw,120px)]">
        <div
          className="relative overflow-hidden rounded-[24px] border px-[clamp(20px,5vw,52px)] py-[clamp(32px,6vw,60px)] text-center"
          style={{
            borderColor: "rgba(0,120,212,.3)",
            background:
              "radial-gradient(800px 340px at 50% -20%,rgba(0,120,212,.18),transparent 60%),linear-gradient(168deg,rgba(10,37,64,.5),#070d1e 64%)",
          }}
        >
          <h2 className="mb-3.5 text-[clamp(26px,4.4vw,40px)] font-extrabold leading-[1.1] tracking-[-.028em] text-[#f8fafc] [text-wrap:pretty]">
            Your Microsoft 365 environment deserves senior expertise.
          </h2>
          <p className="mx-auto mb-[26px] max-w-[560px] text-base leading-[1.65] text-[#94a3b8]">
            Work directly with Shane — a 30-year Microsoft veteran and Lead M365 Architect at NASA.
            No account managers, no junior staff. Just clear, actionable guidance from day one.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <ChatCTA
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-[26px] text-base font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}
              data-track="cta"
              data-testid="consultation-cta-button"
            >
              <MessageSquare className="h-4 w-4" /> Book a Consultation
            </ChatCTA>
            <a
              href="/#tiers"
              className="inline-flex min-h-[52px] items-center justify-center rounded-xl border px-[22px] text-base font-semibold text-[#e2e8f0] transition-colors hover:border-[rgba(148,163,184,.5)]"
              style={{ borderColor: "rgba(148,163,184,.3)" }}
              data-testid="about-start-retainer-link"
            >
              Start at $900/mo
            </a>
          </div>
          <p className="mt-[18px] text-[13px] tracking-[.02em] text-[#94a3b8]">No pitch. No obligation. Just clarity.</p>
          <p
            className="mx-auto mt-[22px] max-w-[620px] border-t pt-[18px] text-[12.5px] leading-[1.55] text-[#94a3b8]"
            style={{ borderColor: "rgba(30,41,59,.9)" }}
          >
            Shane's role at NASA is a personal credential, not an endorsement. The practice is
            independent of NASA and cannot take on organizations that work with, contract to, or
            partner with NASA.
          </p>
        </div>
      </section>
    </Layout>
  );
}
