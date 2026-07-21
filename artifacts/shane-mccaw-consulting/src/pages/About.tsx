import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { CheckCircle, Award, Star, Briefcase, Shield, Bot, ArrowRight, AlertTriangle, Users, Building2, Rocket } from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const timeline = [
  {
    years: "1994 — 2010",
    role: "Software Developer & Architect",
    org: "Microsoft ecosystem",
    desc: "Shane's career started when Microsoft was still figuring out what the internet meant for enterprise software. He spent the early years writing production code, building architecture for enterprise clients, and developing a deep intuition for the way Microsoft platforms actually work under the hood — not just how they're documented to work.",
  },
  {
    years: "2010 — 2016",
    role: "Founder & Principal Architect",
    org: "McCawSoft",
    desc: "Shane founded McCawSoft to build the kind of Microsoft consulting practice that didn't exist at the time: one where a senior architect with real platform knowledge handled engagements personally. McCawSoft served clients across healthcare, financial services, and the public sector — building SharePoint environments, Office 365 migrations, and governance frameworks that actually held up over time.",
  },
  {
    years: "2016 — 2018",
    role: "Director of Technologies",
    org: "Planet Technologies",
    desc: "As Director of Technologies at one of Microsoft's leading Gold Partners, Shane oversaw architecture and delivery across large enterprise engagements. This role sharpened his ability to structure complex, multi-workload M365 deployments at scale — and reinforced his conviction that governance and architecture must be designed together, not bolted on afterward.",
  },
  {
    years: "2018 — Present",
    role: "Lead Microsoft 365 Architect & Copilot SME",
    org: "NASA",
    desc: "Shane currently serves as Lead M365 Architect and Copilot for Microsoft 365 Subject Matter Expert at NASA. He is responsible for platform governance, compliance architecture, Copilot deployment strategy, and enterprise cloud modernization across one of the most security-sensitive M365 environments in the federal government. This is not a retired role. It is his primary day job.",
    isCurrent: true,
  },
];

const nasaPoints = [
  {
    title: "Security-first by default",
    desc: "At NASA, there is no acceptable error rate for misconfiguration. Every architecture decision starts with a failure-mode analysis — a discipline Shane applies to every client engagement.",
  },
  {
    title: "Governance before deployment",
    desc: "Federal compliance requirements mean governance frameworks aren't optional or retrofittable. They're foundational. Shane designs governance into the architecture from day one.",
  },
  {
    title: "Compliance at the highest tier",
    desc: "Operating under one of the strictest security-compliance regimes in the federal government has given Shane instincts for compliance discipline that translate directly to regulated private-sector clients.",
  },
  {
    title: "Real Copilot deployment experience",
    desc: "Shane has navigated Copilot deployment in one of the most constrained M365 environments in existence — working through the actual governance, labeling, and rollout challenges that other consultants are still theorizing about.",
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

export default function About() {
  return (
    <Layout>
      <SEOMeta
        title="About Shane McCaw | NASA's M365 Architect & Copilot SME | Shane McCaw Consulting"
        description="Meet Shane McCaw — NASA's Lead Microsoft 365 Architect, 30-year Microsoft veteran, and Copilot SME. Learn why top organizations trust Shane to transform their M365 environments."
      />
      {/* Hero */}
      <section className="pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
            About Shane McCaw
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            30 Years in the Microsoft Ecosystem. Currently NASA's Lead M365 Architect. <GradientText>Still Doing the Work.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed max-w-3xl mx-auto">
            Shane McCaw is not a former Microsoft executive turned consultant, or a generalist who
            took a few certifications. He is a working architect who has spent three decades inside
            this platform — and is actively doing at NASA today what he can do for your organization
            tomorrow.
          </p>
        </div>
      </section>

      {/* Positioning Callout + Elevator Pitch Intro */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 md:p-10 mb-8">
            <div className="inline-flex items-center gap-2 bg-white/[0.06] border border-white/[0.1] rounded-full px-4 py-1.5 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
              <span className="text-accent-blue text-xs font-semibold uppercase tracking-[0.1em]">Available for Engagements</span>
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary leading-tight mb-4">
              The Architect Who Built at NASA Scale — Available to You.
            </h2>
            <p className="text-text-secondary leading-relaxed">
              The governance rigor, security-first architecture, and hands-on Copilot deployment
              experience that Shane has developed running one of the most scrutinized Microsoft 365
              environments in the federal government don't stay at NASA. Every private engagement
              draws directly from what he is solving in production today — at a compliance level and
              operational scale that most enterprise consultants have never operated at. You are not
              getting a consultant who studied NASA. You are getting the architect who works there.
            </p>
          </GlassPanel>
          <p className="text-text-primary text-lg leading-relaxed mb-4">
            Most organizations running Microsoft 365 are using a fraction of what they're paying for —
            and carrying governance, security, and compliance risk they don't fully see yet. Shane's
            consulting practice exists to fix that, personally. He brings the same structured thinking
            he applies at NASA to mid-market and regulated organizations that can't afford to get it
            wrong — and delivers it without the overhead of a large firm.
          </p>
          <p className="text-text-secondary leading-relaxed mb-4">
            Engagements are direct: you work with Shane, not a project manager or a junior consultant
            who escalates to him. Every piece of advice comes from current production experience, not
            from conference playbooks. And every engagement is designed to leave your organization
            more capable — not more dependent on a retainer.
          </p>
          <p className="text-text-secondary leading-relaxed">
            Whether you're facing an upcoming audit, a Copilot deployment you're not sure your tenant
            is ready for, or an M365 environment that has grown beyond your team's ability to govern
            it — this is exactly the kind of problem Shane solves every day at NASA.
          </p>
        </div>
      </section>

      {/* Who I Help — and Why */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Ideal Clients</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary">Who I Help — and Why</h2>
            <p className="text-text-secondary mt-4 max-w-2xl mx-auto leading-relaxed">
              Three types of organizations get the most from Shane's practice. Each has a different
              situation, but the same underlying need: senior-level Microsoft architecture expertise,
              delivered without the overhead.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Mid-Market Enterprises */}
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-7 flex flex-col" data-testid="who-i-help-0">
              <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-5 text-accent-blue">
                <Building2 className="w-5 h-5" />
              </div>
              <p className="text-accent-blue text-xs font-bold uppercase tracking-wider mb-2">200–2,000 employees</p>
              <h3 className="font-display text-xl font-bold text-text-primary mb-4">Mid-Market Enterprises</h3>
              <div className="space-y-4 text-sm text-text-secondary leading-relaxed flex-grow">
                <div>
                  <p className="font-semibold text-text-primary mb-1">Core challenge</p>
                  <p>Too large to wing their M365 setup, too lean to justify a full-time senior architect on staff. Governance debt accumulates quietly — until it surfaces as a compliance gap, an oversharing incident, or a Copilot deployment that goes sideways.</p>
                </div>
                <div>
                  <p className="font-semibold text-text-primary mb-1">Shane's angle</p>
                  <p>Fills the fractional architect role that mid-market organizations need but rarely have access to — bringing the same structured approach to your 800-seat environment that he applies to NASA's enterprise.</p>
                </div>
              </div>
              <blockquote className="mt-6 border-l-2 border-accent-blue/40 pl-4 italic text-sm text-text-secondary">
                "You need NASA-grade governance. You don't need NASA's headcount."
              </blockquote>
            </div>

            {/* Regulated Industries */}
            <div className="rounded-2xl bg-charcoal-1 border border-accent-violet/30 p-7 flex flex-col" data-testid="who-i-help-1">
              <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-5 text-accent-violet">
                <Shield className="w-5 h-5" />
              </div>
              <p className="text-accent-violet text-xs font-bold uppercase tracking-wider mb-2">Regulated Industries</p>
              <h3 className="font-display text-xl font-bold text-text-primary mb-4">Healthcare, Finance &amp; Regulated Industries</h3>
              <div className="space-y-4 text-sm text-text-secondary leading-relaxed flex-grow">
                <div>
                  <p className="font-semibold text-text-primary mb-1">Core challenge</p>
                  <p>HIPAA, SOC 2, or industry-specific compliance requirements intersecting with an M365 environment that wasn't designed to meet them. Most consultants have read the frameworks. Few have operated inside one.</p>
                </div>
                <div>
                  <p className="font-semibold text-text-primary mb-1">Shane's angle</p>
                  <p>Shane operates inside one of the federal government's most demanding compliance environments every day. His compliance architecture experience is not theoretical — it's the exact context in which he makes daily production decisions.</p>
                </div>
              </div>
              <blockquote className="mt-6 border-l-2 border-accent-violet/40 pl-4 italic text-sm text-text-secondary">
                "Most consultants have read the compliance frameworks. I operate inside one every day."
              </blockquote>
            </div>

            {/* Startups & Scale-Ups */}
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-7 flex flex-col" data-testid="who-i-help-2">
              <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-5 text-accent-blue">
                <Rocket className="w-5 h-5" />
              </div>
              <p className="text-accent-blue text-xs font-bold uppercase tracking-wider mb-2">Growing organizations</p>
              <h3 className="font-display text-xl font-bold text-text-primary mb-4">Startups &amp; Scale-Ups</h3>
              <div className="space-y-4 text-sm text-text-secondary leading-relaxed flex-grow">
                <div>
                  <p className="font-semibold text-text-primary mb-1">Core challenge</p>
                  <p>M365 was stood up fast, permissions sprawled, governance was never designed — and now the organization is large enough that fixing it is becoming a real project. The longer it's deferred, the more expensive the remediation.</p>
                </div>
                <div>
                  <p className="font-semibold text-text-primary mb-1">Shane's angle</p>
                  <p>Intervenes before the governance debt reaches critical mass — establishing a framework that scales with the organization instead of against it, and conducting the remediation work directly.</p>
                </div>
              </div>
              <blockquote className="mt-6 border-l-2 border-accent-blue/40 pl-4 italic text-sm text-text-secondary">
                "It's cheaper to architect it correctly at 200 seats than to remediate it at 2,000."
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      {/* Why NASA Experience Matters */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-4 text-center">Compliance Depth</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-8 text-center leading-tight">
            Why NASA Experience Matters for Your Organization
          </h2>
          <div className="space-y-6 text-text-secondary leading-relaxed text-[1.0625rem]">
            <p>
              NASA operates its Microsoft 365 environment under one of the most demanding tiers of
              federal security compliance. That means every architectural decision is made against a
              backdrop of mandatory security controls, continuous monitoring requirements, and zero
              tolerance for misconfiguration — a security posture that's independently assessed and
              must be maintained continuously, not just certified once.
            </p>
            <p>
              In practice, this means Shane works daily with the kind of governance and compliance
              architecture that most private-sector organizations encounter only when they're facing
              an audit or a regulatory inquiry. Multi-agency collaboration requirements, sensitivity
              labeling at the highest classification tiers, Conditional Access policies designed for a
              workforce distributed across federal facilities — this is the environment Shane manages,
              not the environment he studied.
            </p>
            <p>
              For mid-market organizations, the practical benefit is a consultant who has been forced —
              under real-stakes accountability — to develop an instinct for where M365 governance
              breaks down. He has seen what happens when retention policies conflict with legal hold
              requirements, when oversharing surfaces in a Copilot response, when sensitivity labels
              are misconfigured in ways that expose controlled data. He has fixed those problems in
              production, under federal scrutiny.
            </p>
            <p>
              For regulated private-sector clients — healthcare organizations managing PHI, financial
              services firms under SOC 2 or FINRA requirements — the relevance is direct. The
              compliance rigor Shane's day job demands is structurally similar to what these
              frameworks require. He doesn't need to extrapolate from theory; he can apply tested
              judgment from one of the most demanding M365 compliance contexts in the federal
              government.
            </p>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.08] p-6 mt-2">
              <p className="text-text-primary font-semibold mb-2">The difference that matters</p>
              <p className="text-text-secondary text-sm leading-relaxed">
                Most enterprise consultants apply best practices learned from documentation,
                whitepapers, and other client engagements. Shane applies what he validated last week,
                in a live production environment, under federal compliance requirements. That's not a
                marginal difference in quality — it's a fundamentally different basis for advice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Why IT Leaders Bring Me In */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">Engagement Triggers</p>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-6 leading-tight">
                Why IT Leaders Bring Me In
              </h2>
              <p className="text-text-secondary leading-relaxed mb-8">
                There's almost always a specific trigger — a moment when the organization realizes it
                needs someone who has solved this problem before, at a level of complexity and risk
                that makes getting it wrong genuinely costly.
              </p>
              <ul className="space-y-4">
                {[
                  { icon: AlertTriangle, text: "An upcoming audit or compliance deadline — and the M365 environment isn't ready." },
                  { icon: AlertTriangle, text: "A failed or stalled migration — on-premises to M365, or between M365 configurations — that needs a senior architect to diagnose and restart." },
                  { icon: Bot, text: "Copilot readiness concerns — the organization has or is evaluating Microsoft 365 Copilot licenses and needs to know if the tenant is actually ready to deploy safely." },
                  { icon: Users, text: "A departed IT leader or leadership gap — and no one remaining has the M365 architecture depth to make the decisions in the queue." },
                  { icon: Building2, text: "Teams and SharePoint chaos — permissions sprawl, abandoned sites, inconsistent governance, and no clear path to remediation." },
                  { icon: Shield, text: "A security incident or near-miss — an oversharing exposure, a sensitivity labeling failure, or a Conditional Access misconfiguration that surfaced before it became a headline." },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <li key={i} className="flex items-start gap-4" data-testid={`trigger-${i}`}>
                      <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5 text-accent-blue">
                        <Icon className="w-4 h-4" />
                      </div>
                      <p className="text-text-secondary text-sm leading-relaxed pt-1.5">{item.text}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-8 lg:sticky lg:top-8">
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">Why It Works</p>
              <h3 className="font-display text-xl font-bold text-text-primary mb-4 leading-snug">
                High-Stakes Decisions. Tested Judgment. No Ramp-Up.
              </h3>
              <p className="text-text-secondary leading-relaxed text-sm mb-4">
                In every one of these situations, the underlying need is the same: someone has to make
                high-stakes decisions about a complex Microsoft 365 environment — quickly, confidently,
                and without a months-long ramp-up period to get oriented.
              </p>
              <p className="text-text-secondary leading-relaxed text-sm mb-4">
                Shane reduces risk because he has already solved these problems at NASA scale, under
                federal compliance accountability. He doesn't theorize about what might work. He
                applies what he has tested in production.
              </p>
              <p className="text-text-secondary leading-relaxed text-sm">
                And because every engagement is direct — no account managers, no subcontractors, no
                junior team doing the actual work — the institutional knowledge Shane brings to your
                engagement doesn't get filtered or diluted before it reaches you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Narrative */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-16 items-start">
            <div>
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-6">Background</p>
              <div className="space-y-6 text-[1.0625rem] text-text-secondary leading-relaxed">
                <p>
                  Shane McCaw's career in the Microsoft ecosystem began in 1994. At the time, Office
                  was still delivered on floppy disks, and the idea of enterprise software living in
                  the cloud was science fiction. Over the three decades since, he has watched Microsoft
                  evolve from a desktop software company into the dominant enterprise cloud platform —
                  and he has been an architect of that transformation, not a spectator.
                </p>
                <p>
                  He started his career writing code. Not configuring platforms or presenting strategy
                  decks — writing production software and building real architecture for real
                  organizations. That foundation matters. It means Shane understands why the M365
                  platform behaves the way it does, not just how to navigate its admin portals. When a
                  governance policy doesn't behave as expected or a Copilot deployment surfaces data it
                  shouldn't, he knows where to look.
                </p>
                <p>
                  In 2010, Shane founded McCawSoft — a consulting practice built on the belief that
                  enterprise Microsoft technology deserves genuine enterprise expertise. McCawSoft
                  served clients across healthcare, financial services, manufacturing, and government:
                  building SharePoint environments that didn't collapse under their own permissions
                  sprawl, migrating organizations to Exchange Online without losing data, and designing
                  governance frameworks that still hold up years later.
                </p>
                <div className="rounded-2xl bg-charcoal-1 border border-accent-blue/20 p-7 mt-2">
                  <h3 className="font-display text-lg font-bold text-text-primary mb-3">
                    The Architect Who Built at NASA Scale — Available to You
                  </h3>
                  <p className="text-text-secondary leading-relaxed text-[1rem]">
                    The governance discipline, security-first architecture, and Copilot deployment
                    experience Shane has developed running NASA's M365 environment do not stay at
                    NASA. Every private engagement draws directly from what he is solving in
                    production today — at a scale and compliance level most enterprise consultants have
                    never operated at. You are not getting a consultant who studied NASA. You are
                    getting the architect who works there.
                  </p>
                </div>
                <p>
                  Today, Shane's primary role is Lead Microsoft 365 Architect and Copilot Subject
                  Matter Expert at NASA. That is not a credential or a title from a past position. It
                  is what he does every day — managing the governance, compliance, and platform
                  architecture of one of the most security-constrained Microsoft 365 environments in
                  the federal government. He consults on the side, which means every engagement
                  benefits directly from what he is working on in production right now.
                </p>
              </div>
            </div>
            <div className="space-y-4 lg:pt-10">
              {[
                { icon: Briefcase, label: "Years in Microsoft ecosystem", value: "30+" },
                { icon: Shield, label: "Current role", value: "Lead M365 Architect, NASA" },
                { icon: Bot, label: "AI designation", value: "Copilot for M365 SME" },
                { icon: Award, label: "Microsoft certifications", value: "20+" },
                { icon: Star, label: "Recognition", value: "Forum of Innovation Award" },
              ].map((stat, i) => {
                const Icon = stat.icon;
                return (
                  <div key={i} className="flex items-center gap-5 rounded-2xl bg-charcoal-1 border border-white/[0.06] p-5" data-testid={`bio-stat-${i}`}>
                    <div className="w-10 h-10 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-accent-blue">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-text-secondary text-xs">{stat.label}</p>
                      <p className="font-numeric font-semibold text-text-primary text-base">{stat.value}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Quote */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] text-center">
        <div className="max-w-[900px] mx-auto">
          <Star className="w-8 h-8 text-accent-blue mx-auto mb-6" />
          <blockquote className="text-xl md:text-2xl text-text-primary font-light leading-relaxed mb-6 italic">
            "I got into this field because I love what Microsoft technology can actually do when it's
            properly architected and governed. Too many organizations are running M365 at 20% of its
            capability — not because the platform is limited, but because it was stood up incorrectly
            and never fixed. That's the problem I spend my career solving."
          </blockquote>
          <p className="font-semibold text-text-primary text-base">Shane McCaw</p>
          <p className="text-text-secondary text-sm mt-1">Lead M365 Architect & Copilot SME, NASA · Founder, McCawSoft</p>
        </div>
      </section>

      {/* NASA section */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">The NASA Advantage</p>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-6 leading-tight">
                What Working at NASA Every Day Means for You
              </h2>
              <p className="text-text-secondary leading-relaxed mb-4">
                NASA's Microsoft 365 environment operates under constraints that most enterprise IT
                teams will never encounter — top-tier federal security compliance requirements,
                sensitive research data, multi-agency collaboration needs, and zero tolerance for
                misconfiguration.
              </p>
              <p className="text-text-secondary leading-relaxed mb-4">
                Working inside that environment since 2018 has fundamentally shaped how Shane thinks
                about architecture, governance, and deployment risk. He is not applying theoretical
                best practices. He is applying what he learned yesterday, in production, under real
                stakes.
              </p>
              <p className="text-text-secondary leading-relaxed mb-4">
                Most consultants talk about best practices learned from whitepapers and conference
                sessions. Shane applies what he validated last week in one of the most scrutinized
                M365 environments on earth. That is not a marginal difference — it is the difference
                between repeating advice and delivering tested judgment.
              </p>
              <p className="text-text-secondary leading-relaxed">
                For your organization, that means access to a level of governance discipline and
                platform depth that even most large consulting firms cannot offer — delivered
                directly, without layers of overhead.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {nasaPoints.map((point, i) => (
                <div key={i} className="rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30 transition-all p-6" data-testid={`nasa-point-${i}`}>
                  <h3 className="font-display font-bold text-text-primary mb-2 text-base">{point.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{point.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Career Timeline */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Career</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary">30 Years. One Ecosystem.</h2>
          </div>
          <div className="relative">
            <div className="absolute left-8 top-4 bottom-4 w-px bg-white/[0.08] hidden md:block" />
            <div className="space-y-6">
              {timeline.map((item, i) => (
                <div key={i} className="relative md:pl-24" data-testid={`timeline-item-${i}`}>
                  <div
                    className="hidden md:flex absolute left-4 top-7 w-9 h-9 rounded-full items-center justify-center"
                    style={item.isCurrent ? GRADIENT_BG : { background: "var(--charcoal-1)", border: "2px solid var(--accent-blue)" }}
                  >
                    <div className={`w-3 h-3 rounded-full ${item.isCurrent ? "bg-white" : "bg-accent-blue"}`} />
                  </div>
                  <div
                    className={`rounded-2xl p-7 border ${item.isCurrent ? "bg-charcoal-1 border-accent-violet/40" : "bg-charcoal-1 border-white/[0.06]"}`}
                  >
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span className={`text-sm font-semibold ${item.isCurrent ? "text-accent-violet" : "text-accent-blue"}`}>{item.years}</span>
                      {item.isCurrent && (
                        <span className="inline-flex items-center gap-1.5 bg-white/[0.06] border border-accent-violet/30 rounded-full px-3 py-0.5 text-xs font-semibold text-accent-violet">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-violet animate-pulse" />
                          Current role
                        </span>
                      )}
                    </div>
                    <h3 className="font-display text-xl font-bold mb-1 text-text-primary">{item.role}</h3>
                    <p className={`font-semibold text-sm mb-4 ${item.isCurrent ? "text-accent-violet" : "text-accent-blue"}`}>{item.org}</p>
                    <p className="leading-relaxed text-sm text-text-secondary">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Award */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-8 flex items-start gap-6">
            <div className="flex-shrink-0 w-14 h-14 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue">
              <Award className="w-7 h-7" />
            </div>
            <div>
              <p className="text-accent-blue text-xs font-bold uppercase tracking-wider mb-2">Recognition</p>
              <h3 className="font-display text-lg font-bold text-text-primary mb-2">Forum of Innovation Award Winner · 20+ Microsoft Certifications</h3>
              <p className="text-text-secondary leading-relaxed text-sm">
                Shane has been recognized with the Forum of Innovation Award for contributions to
                enterprise technology and Microsoft ecosystem innovation. He holds more than 20
                Microsoft certifications — earned over decades of real-world practice, not exam
                preparation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Elevator Pitch */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-[860px] mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-6 text-center">Elevator Pitch</p>
          <GlassPanel className="relative p-10">
            <div className="absolute -top-4 left-10 text-accent-blue text-6xl font-serif leading-none select-none">"</div>
            <p className="text-text-primary text-lg md:text-xl leading-relaxed mb-6">
              I'm Shane McCaw. I've spent thirty years inside the Microsoft ecosystem — writing code,
              building enterprise architecture, and for the past six years running M365 governance and
              Copilot deployment strategy at NASA. That's my day job. I also consult with
              organizations that need someone who has actually operated at that level.
            </p>
            <p className="text-text-secondary text-lg md:text-xl leading-relaxed mb-6">
              Most Microsoft consultants will give you best practices from a playbook. I give you what
              I tested last week in one of the most security-constrained, compliance-heavy Microsoft
              environments in the federal government. If your organization is serious about getting
              M365 right — governance, Copilot readiness, SharePoint, security architecture — I can
              help you do it the way it's done when there's no margin for error.
            </p>
            <p className="text-text-secondary text-lg md:text-xl leading-relaxed">
              Engagements are direct. You work with me, not a team I oversee. Everything I deliver is
              designed to leave your organization more capable, not more dependent on a retainer.
            </p>
            <div className="absolute -bottom-4 right-10 text-accent-blue text-6xl font-serif leading-none select-none rotate-180">"</div>
          </GlassPanel>
          <div className="mt-8 text-center">
            <p className="font-semibold text-text-primary text-base">Shane McCaw</p>
            <p className="text-text-secondary text-sm mt-1">Lead M365 Architect & Copilot SME, NASA · Founder, McCawSoft</p>
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">How Shane Works</p>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-8 leading-tight">
                Hands-On. Direct. No Shortcuts.
              </h2>
              <div className="space-y-6">
                {philosophy.map((item, i) => (
                  <div key={i} className="flex items-start gap-4" data-testid={`philosophy-item-${i}`}>
                    <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-text-primary mb-1">{item.title}</p>
                      <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-8">
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-6">Who Works With Shane</p>
              <div className="space-y-5">
                {[
                  { label: "Mid-market organizations (100–5,000 seats)", desc: "Too large to wing their M365 setup, too lean to hire a full-time architect. Shane fills that gap." },
                  { label: "Regulated industries", desc: "Healthcare, financial services, and legal organizations with data governance and compliance requirements that demand precision." },
                  { label: "Organizations evaluating Copilot", desc: "Companies that want to deploy Copilot AI but need someone who has actually done it in a demanding environment first." },
                ].map((item, i) => (
                  <div key={i} className="border-l-2 border-accent-blue/30 pl-4" data-testid={`client-type-${i}`}>
                    <p className="font-semibold text-text-primary text-sm mb-1">{item.label}</p>
                    <p className="text-text-secondary text-xs leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Competencies */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Technical Expertise</p>
            <h2 className="font-display text-3xl font-bold text-text-primary">Core Competencies</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {competencies.map((comp, i) => (
              <span
                key={i}
                className="bg-white/[0.06] border border-white/[0.08] text-text-secondary px-4 py-2 rounded-full text-sm font-medium hover:border-accent-blue/50 hover:text-accent-blue transition-colors cursor-default"
                data-testid={`competency-${i}`}
              >
                {comp}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How Organizations Engage */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Working Together</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary">How Organizations Engage With Shane</h2>
            <p className="text-text-secondary mt-4 max-w-2xl mx-auto leading-relaxed">
              Every engagement is scoped and priced clearly — no open-ended retainers you didn't agree
              to, no surprise expansions. Six ways to work together, matched to where you are.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                name: "M365 Tenant Health Check",
                desc: "A structured audit of your Microsoft 365 environment — governance gaps, security posture, permissions sprawl, and configuration risk — with a prioritized remediation roadmap.",
              },
              {
                name: "Copilot Readiness Assessment",
                desc: "A pre-deployment evaluation of your tenant's governance, sensitivity labeling, and data hygiene. Tells you exactly what to fix before Copilot goes live — not after.",
              },
              {
                name: "SharePoint Architecture Review",
                desc: "An expert assessment of your SharePoint Online information architecture: site structure, permissions model, navigation, and long-term scalability. Delivered with specific recommendations.",
              },
              {
                name: "Governance Framework Design",
                desc: "A complete M365 governance framework tailored to your organization — covering data classification, access controls, retention, DLP policy, and Copilot guardrails.",
              },
              {
                name: "Power Platform Quick Start",
                desc: "Structured guidance to deploy Power Automate or Power Apps in a governed, secure way — including environment strategy, DLP policy, and a working proof-of-concept.",
              },
              {
                name: "Cloud Migration Strategy Session",
                desc: "A focused planning engagement to map your path from on-premises or legacy environments to M365 — sequencing, risk mitigation, and a clear migration architecture.",
              },
            ].map((offer, i) => (
              <div
                key={i}
                className="rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30 transition-all p-7"
                data-testid={`engagement-offer-${i}`}
              >
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                  <span className="font-numeric font-bold text-sm">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-display font-bold text-text-primary mb-3 text-base leading-snug">{offer.name}</h3>
                <p className="text-text-secondary text-sm leading-relaxed">{offer.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How You Can Work With Me */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">Engagements</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary">How You Can Work With Me</h2>
            <p className="text-text-secondary mt-4 max-w-2xl mx-auto leading-relaxed">
              The governance discipline, compliance depth, and hands-on Microsoft 365 experience Shane
              has built at NASA translate directly into six structured ways to engage — each scoped to
              a specific organizational need, with clear deliverables and no open-ended surprises.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
            {[
              {
                name: "Tenant Health Audit",
                desc: "A structured assessment of your M365 environment — governance gaps, permissions sprawl, security posture, and configuration risk — with a prioritized remediation roadmap. The right starting point for any serious engagement.",
                href: "/platform/quick-start",
              },
              {
                name: "Governance Foundations",
                desc: "A complete governance framework designed for your organization: data classification, access controls, retention policy, DLP, and Copilot guardrails. Built from the same principles Shane applies at NASA.",
                href: "/platform/quick-start",
              },
              {
                name: "Copilot Readiness Assessment",
                desc: "A six-dimension evaluation of your tenant's readiness for Microsoft 365 Copilot — licensing, identity, permissions, governance, sensitivity labeling, and oversharing risk. Tells you exactly what to fix before Copilot goes live.",
                href: "/platform/quick-start",
              },
              {
                name: "Migration Readiness",
                desc: "A focused planning engagement to map your path from on-premises or legacy environments to M365 — sequencing, risk mitigation, and a clear migration architecture. Avoids the stalls and surprises that plague unplanned migrations.",
                href: "/platform/quick-start",
              },
              {
                name: "Power Platform Quick-Start",
                desc: "Structured guidance to deploy Power Automate or Power Apps in a governed, secure way — including environment strategy, DLP policy design, and a working proof-of-concept tailored to your use case.",
                href: "/platform/quick-start",
              },
              {
                name: "Fractional Architect Retainer",
                desc: "Ongoing senior M365 architecture support on a monthly basis — strategy calls, ad-hoc guidance, architecture reviews, and proactive tenant monitoring. The fractional architect model, without the enterprise overhead.",
                href: "/solutions",
              },
            ].map((offer, i) => (
              <div
                key={i}
                className="rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30 transition-all p-7 flex flex-col"
                data-testid={`work-with-me-${i}`}
              >
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 flex-shrink-0 text-accent-blue">
                  <span className="font-numeric font-bold text-sm">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-display font-bold text-text-primary mb-3 text-base leading-snug">{offer.name}</h3>
                <p className="text-text-secondary text-sm leading-relaxed flex-grow mb-5">{offer.desc}</p>
                <Link
                  href={offer.href}
                  className="inline-flex items-center gap-1.5 text-accent-blue text-sm font-semibold hover:gap-2.5 transition-all mt-auto"
                >
                  See details <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
          <div className="text-center">
            <p className="text-text-secondary text-sm mb-4">Explore all service areas and fixed-price packages</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/solutions"
                className="inline-flex items-center justify-center gap-2 text-white font-semibold px-6 py-3 rounded-lg transition-opacity hover:opacity-90 text-sm"
                style={GRADIENT_BG}
                data-testid="about-services-link"
              >
                View All Solutions <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/platform/quick-start"
                className="inline-flex items-center justify-center gap-2 border border-white/[0.12] text-text-secondary hover:text-text-primary hover:border-white/[0.2] font-semibold px-6 py-3 rounded-lg transition-colors text-sm"
                data-testid="about-micro-offers-link"
              >
                View Quick-Start Packs <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 text-center border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Your Microsoft 365 environment deserves <GradientText>senior expertise</GradientText>.
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto mb-8 text-sm sm:text-base">
              Work directly with Shane — a 30-year Microsoft veteran and Lead M365 Architect at NASA.
              No account managers, no junior staff. Just clear, actionable guidance from day one.
            </p>
            <a
              href="/book"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
              data-testid="consultation-cta-button"
            >
              Book a Consultation
            </a>
            <p className="mt-5 text-text-secondary text-sm tracking-wide">No pitch. No obligation. Just clarity.</p>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
