import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle, ArrowRight, Shield, Building2, Rocket, Briefcase, Brain,
  AlertCircle,
} from "lucide-react";

const nasaCompliance = [
  { label: "FedRAMP", desc: "Federal Risk and Authorization Management Program — cloud authorization at the highest level." },
  { label: "FISMA", desc: "Federal Information Security Management Act — data security controls for government-level risk." },
  { label: "ITAR", desc: "International Traffic in Arms Regulations — export-controlled data handling across M365 tenants." },
  { label: "GCC / GCC High", desc: "Government Community Cloud configurations for regulated and defense-adjacent workloads." },
  { label: "Multi-Stakeholder Governance", desc: "Cross-agency, multi-department policy design for complex organizational hierarchies." },
  { label: "High-Risk Compliance Environments", desc: "Architecture designed for environments where misconfiguration carries real legal and mission consequences." },
];

const whoIServe = [
  {
    icon: Building2,
    title: "Mid-Market Enterprises",
    subtitle: "200–2,000 Employees",
    painPoints: [
      "M365 sprawl from years of ungoverned growth",
      "Governance gaps blocking Copilot adoption",
      "Shadow IT undermining security posture",
      "Failed or stalled migration projects",
    ],
    value: "You get NASA-level architecture discipline applied to your tenant — without hiring a full-time team.",
    color: "#0078D4",
  },
  {
    icon: Shield,
    title: "Regulated Industries",
    subtitle: "Healthcare · Legal · Financial · Gov Contractors",
    painPoints: [
      "HIPAA compliance for healthcare orgs on M365",
      "Data residency and sovereignty for legal firms",
      "SOC 2 readiness for financial services",
      "CMMC, FedRAMP, and ITAR for government contractors",
    ],
    value: "Your compliance requirements aren't a constraint — they're Shane's native environment.",
    color: "#00B4D8",
  },
  {
    icon: Rocket,
    title: "Startups & Scale-Ups",
    subtitle: "Rapid Growth · First-Time Architecture",
    painPoints: [
      "Rapid headcount growth outpacing initial M365 setup",
      "Poor tenant foundation from early configuration shortcuts",
      "Audit preparation with no existing governance framework",
      "First-time enterprise architecture needs",
    ],
    value: "Build it right from the start — or fix it before scale makes it exponentially harder.",
    color: "#0A2540",
  },
];

const whoThisIsNotFor = [
  "Organizations looking for low-cost IT support",
  "Companies without a Microsoft 365 tenant",
  "Teams unwilling to adopt governance standards",
];

const decisionMakerTriggers = [
  "Microsoft 365 is deployed but nobody's using it effectively",
  "Copilot is on your radar but your tenant isn't ready for it",
  "A compliance audit revealed gaps in your M365 governance",
  "A migration project has stalled or previously failed",
  "Shadow IT is undermining your security posture",
  "You need senior-level expertise without a full-time hire",
];

const servicesSummary = [
  {
    title: "Fractional Architecture",
    desc: "Three monthly tiers providing ongoing M365 architecture leadership.",
    cta: "View Retainer Tiers",
    href: "/retainers",
    color: "#0078D4",
  },
  {
    title: "Quick Wins",
    desc: "Fast, fixed-price engagements like Tenant Health Audits and Migration Readiness.",
    cta: "View Quick Wins",
    href: "/micro-offers",
    color: "#00B4D8",
  },
  {
    title: "Projects",
    desc: "Governance, Power Platform, and Copilot readiness projects with clear deliverables.",
    cta: "View Projects",
    href: "/services",
    color: "#0A2540",
  },
  {
    title: "Training",
    desc: "Live Microsoft 365 and Copilot training for teams and leadership.",
    cta: "View Training",
    href: "/services",
    color: "#0078D4",
  },
];

export default function Home() {
  return (
    <Layout>
      <SEOMeta
        title="Enterprise Microsoft 365 & Copilot AI Consulting | Shane McCaw Consulting"
        description="Shane McCaw is NASA's Lead Microsoft 365 Architect — 30 years of Microsoft expertise, delivering M365 tenant audits, Copilot AI readiness, SharePoint, and governance. Fixed-price packages, senior-level delivery."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          "name": "Shane McCaw Consulting",
          "url": "https://shanemccaw.com",
          "description": "Enterprise Microsoft 365 and Copilot AI consulting by Shane McCaw — NASA's Lead M365 Architect with 30 years of Microsoft expertise.",
          "founder": { "@type": "Person", "name": "Shane McCaw" },
          "areaServed": "US",
          "priceRange": "$3,000 – $35,000+",
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Microsoft 365 Consulting Services",
            "itemListElement": [
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Microsoft 365 Consulting" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Copilot AI Readiness" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "SharePoint Architecture" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Power Platform Development" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Governance & Compliance" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Cloud Migration" } }
            ]
          }
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center bg-[#0A2540] overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(#0078D4 1px, transparent 1px),
              linear-gradient(90deg, #0078D4 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)",
          }}
        />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6 py-32 pt-44 text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Current Microsoft 365 Architect & Copilot SME — NASA
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            <span className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded px-4 py-1.5 text-white/90 text-sm font-semibold">
              <Briefcase className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0" />
              Lead M365 Architect at NASA
            </span>
            <span className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded px-4 py-1.5 text-white/90 text-sm font-semibold">
              <CheckCircle className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0" />
              30 Years Microsoft Ecosystem Experience
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-[3.75rem] font-extrabold text-white leading-[1.1] mb-5 max-w-5xl mx-auto">
            The Architect Who Built at NASA Scale — Available to You.
          </h1>
          <p className="text-base md:text-lg text-[#00B4D8] font-semibold max-w-2xl mx-auto mb-5">
            Enterprise-grade Microsoft 365 and Copilot architecture for mid-market and regulated organizations.
          </p>
          <p className="text-lg md:text-xl text-white/70 max-w-3xl mx-auto mb-12 leading-relaxed">
            Shane McCaw brings the same mission-critical Microsoft 365 discipline he built at NASA to regulated industries and mid-market companies. No generalists. No offshore handoffs. Senior Microsoft expertise, available to your organization on a fractional basis.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/book" className="text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30" data-testid="hero-cta-primary">
              Book a Consultation
            </CTAButton>
            <a
              href="/services"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-3.5 rounded-xl hover:border-white/40"
            >
              See Services <ArrowRight className="w-4 h-4" />
            </a>
          </div>
          <div className="mt-14 pt-10 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
            {[
              "Fractional M365 Architecture",
              "Copilot AI Readiness",
              "Cloud Modernization",
              "Governance & Compliance",
              "30+ Years Microsoft Experience",
            ].map((badge, i) => (
              <span key={i} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>

      {/* ── WHY THIS SITE EXISTS ─────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="why-site-exists-section">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Why This Site Exists</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
            Senior M365 Architecture Shouldn't Require a Full-Time Hire
          </h2>
          <p className="text-lg text-foreground leading-relaxed mb-6 font-medium">
            Most organizations are running Microsoft 365 without governance, architecture, or Copilot readiness. That creates risk, inefficiency, and stalled digital transformation. I help companies fix their tenant, secure their data, and build a scalable M365 foundation.
          </p>
          <div className="text-lg text-foreground leading-relaxed space-y-4 text-left md:text-center">
            <p>
              Mid-market companies and regulated-industry organizations — healthcare, legal, financial services, and government contractors — face a quiet crisis. Their Microsoft 365 tenants are deployed, but ungoverned. Copilot is on the roadmap, but the tenant isn't ready for it. Compliance frameworks demand senior-level architecture, but hiring a full-time M365 architect costs $250,000+ per year.
            </p>
            <p>
              The large enterprise has a team. The small business doesn't need one. It's the organizations in between — and those operating in regulated environments — that fall into the gap. This site exists to close that gap.
            </p>
          </div>
          <div className="mt-10">
            <CTAButton href="/book" className="text-base px-8 py-3.5">
              Book a Call
            </CTAButton>
          </div>
        </div>
      </section>

      {/* ── START HERE ───────────────────────────────────────────────────── */}
      <section className="bg-white py-20" data-testid="start-here-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Start Here</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Where Do You Need to Start?
            </h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              Three paths into Shane's work — pick the one that matches where you are right now.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Card 1 — Diagnose */}
            <div className="bg-[#F7F9FC] rounded-xl border border-border p-8 flex flex-col" data-testid="start-here-diagnose">
              <div className="w-12 h-12 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-5">
                <Shield className="w-6 h-6 text-[#0078D4]" />
              </div>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">I need to diagnose my environment</h3>
              <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-widest mb-3">Quick Wins</p>
              <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                Fast, fixed-price solutions that solve immediate M365 problems.
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed flex-1 mb-2">
                Not sure where your tenant stands? Start with a readiness assessment or tenant health audit — you'll get a clear picture and a prioritized action plan before committing to anything larger.
              </p>
              <p className="text-xs font-semibold text-[#0A2540]/60 italic mb-6">
                Recommended for you if: you're not sure where your M365 tenant stands.
              </p>
              <div className="flex flex-col gap-2">
                <CTAButton href="/m365-health-quiz" className="text-sm px-5 py-2.5 w-full">
                  Take the M365 Health Assessment
                </CTAButton>
                <Link href="/micro-offers" className="inline-flex items-center justify-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline">
                  See Tenant Health Audit <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Card 2 — Quick Win */}
            <div className="bg-[#F7F9FC] rounded-xl border border-border p-8 flex flex-col" data-testid="start-here-quick-win">
              <div className="w-12 h-12 rounded-lg bg-[#00B4D8]/10 flex items-center justify-center mb-5">
                <Rocket className="w-6 h-6 text-[#00B4D8]" />
              </div>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">I need a fast, high-impact win</h3>
              <p className="text-[#00B4D8] text-xs font-semibold uppercase tracking-widest mb-3">Projects</p>
              <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                Structured engagements with clear deliverables and timelines.
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed flex-1 mb-2">
                Fixed-price packages with clear deliverables and defined timelines — results in days, not months. No retainer required. Ideal when you need to demonstrate progress quickly or solve one focused problem.
              </p>
              <p className="text-xs font-semibold text-[#0A2540]/60 italic mb-6">
                Recommended for you if: you have a specific, scoped problem to solve quickly.
              </p>
              <CTAButton href="/micro-offers" className="text-sm px-5 py-2.5 w-full" style={{ backgroundColor: "#00B4D8" }}>
                Browse Quick Win Packages
              </CTAButton>
            </div>

            {/* Card 3 — Fractional */}
            <div className="bg-[#0A2540] rounded-xl border border-[#0A2540] p-8 flex flex-col" data-testid="start-here-fractional">
              <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center mb-5">
                <Briefcase className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-extrabold text-white mb-2">I need ongoing architecture leadership</h3>
              <p className="text-[#00B4D8] text-xs font-semibold uppercase tracking-widest mb-3">Fractional Architecture</p>
              <p className="text-white/70 text-sm leading-relaxed mb-3">
                Ongoing senior architecture leadership without a full-time hire.
              </p>
              <p className="text-white/70 text-sm leading-relaxed flex-1 mb-2">
                Fractional architecture retainers give you a dedicated senior architect without the cost of a full-time hire. Monthly engagements — strategic oversight, hands-on delivery, and direct access to Shane.
              </p>
              <p className="text-xs font-semibold text-white/40 italic mb-6">
                Recommended for you if: you need embedded architecture support on an ongoing basis.
              </p>
              <CTAButton href="/retainers" className="text-sm px-5 py-2.5 w-full bg-[#0078D4] hover:bg-[#005A9E]">
                View Fractional Architecture Tiers
              </CTAButton>
            </div>
          </div>

          <div className="text-center mt-10">
            <CTAButton href="/copilot-quiz" className="text-sm px-8 py-3">
              Take the Quiz
            </CTAButton>
          </div>
        </div>
      </section>

      {/* ── COPILOT READINESS QUIZ ───────────────────────────────────────── */}
      <section className="relative bg-[#0A2540] py-20 overflow-hidden" data-testid="quiz-cta-section">
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#0078D4 1px, transparent 1px), linear-gradient(90deg, #0078D4 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 70% at 50% 50%, rgba(0,180,216,0.12) 0%, transparent 70%)",
          }}
        />
        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#00B4D8]/15 border border-[#00B4D8]/30 flex items-center justify-center mx-auto mb-7">
            <Brain className="w-8 h-8 text-[#00B4D8]" />
          </div>

          <div className="inline-flex items-center gap-2 bg-[#00B4D8]/15 border border-[#00B4D8]/35 rounded-full px-5 py-2 mb-7">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <span className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Free Assessment
            </span>
          </div>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-5">
            Is Your Organization Ready for Copilot AI?
          </h2>
          <p className="text-[#00B4D8] font-bold text-lg mb-4">
            Don't light up Copilot on a dirty tenant.
          </p>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
            Most deployments fail not because of the technology — but because the Microsoft 365 tenant isn't ready for it. Take the Copilot Readiness Quiz and find out exactly where you stand.
          </p>

          <CTAButton href="/copilot-quiz" className="text-base px-10 py-4 shadow-lg shadow-[#00B4D8]/20 mb-8" data-testid="quiz-cta-button">
            Take the 3-Minute Quiz
          </CTAButton>

          <div className="flex flex-wrap items-center justify-center gap-6">
            {[
              { value: "3 min", label: "to complete" },
              { value: "Free", label: "no cost, no signup" },
              { value: "Instant", label: "PDF report" },
            ].map((stat, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="text-2xl font-extrabold text-[#00B4D8]">{stat.value}</span>
                <span className="text-white/50 text-xs font-medium uppercase tracking-wider">{stat.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-white/35 text-sm tracking-wide">
            Personalized readiness score + actionable next steps delivered instantly.
          </p>
        </div>
      </section>

      {/* ── NASA COMPLIANCE CREDENTIALS ──────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="nasa-compliance-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-10">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">NASA Compliance Credentials</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Built on the Standards That Matter Most</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane's tenure as Lead M365 Architect at NASA required mastery of the most demanding compliance frameworks in existence. That expertise now benefits mid-market companies, regulated industries, government contractors, and startups scaling into their first compliance obligations.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
            {nasaCompliance.map((item, i) => (
              <div key={i} className="bg-white rounded-lg border border-border p-6 flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-[#0078D4]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1">{item.label}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-[#0078D4] font-semibold italic max-w-2xl mx-auto">
            Even if you're not in a regulated industry, NASA-level governance ensures your tenant is secure, scalable, and ready for AI.
          </p>
        </div>
      </section>

      {/* ── IDEAL CLIENTS ────────────────────────────────────────────────── */}
      <section className="bg-white py-20" data-testid="who-i-serve-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ideal Clients</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who I Serve</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane works best with organizations that have real complexity — and the ambition to fix it properly.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {whoIServe.map((segment, i) => {
              const Icon = segment.icon;
              return (
                <div key={i} className="bg-[#F7F9FC] rounded-xl border border-border p-8 flex flex-col" data-testid={`segment-${i}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${segment.color}18` }}>
                      <Icon className="w-5 h-5" style={{ color: segment.color }} />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-[#0A2540] text-lg leading-tight">{segment.title}</h3>
                      <p className="text-xs text-muted-foreground font-medium mt-0.5">{segment.subtitle}</p>
                    </div>
                  </div>
                  <div className="w-12 h-0.5 mt-4 mb-5 rounded-full" style={{ backgroundColor: segment.color }} />
                  <ul className="space-y-2.5 flex-1 mb-6">
                    {segment.painPoints.map((point, j) => (
                      <li key={j} className="flex items-start gap-2.5 text-sm text-foreground leading-snug">
                        <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: segment.color }} />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-border pt-5">
                    <p className="text-sm font-semibold text-[#0A2540] leading-snug italic">"{segment.value}"</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Who This Is NOT For */}
          <div className="max-w-2xl mx-auto bg-[#F7F9FC] border border-border rounded-xl p-8 mb-12">
            <h3 className="font-extrabold text-[#0A2540] text-lg mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              Who This Is Not For
            </h3>
            <ul className="space-y-3">
              {whoThisIsNotFor.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="text-center">
            <CTAButton href="/book" className="text-base px-8 py-3.5">
              Book a Call
            </CTAButton>
          </div>
        </div>
      </section>

      {/* ── ENGAGEMENT SIGNALS ───────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="decision-maker-triggers-section">
        <div className="max-w-[860px] mx-auto px-6">
          <div className="text-center mb-10">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Engagement Signals</p>
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540]">Are any of these familiar?</h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto leading-relaxed">
              These are the situations that typically bring organizations to Shane.
            </p>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {decisionMakerTriggers.map((trigger, i) => (
              <li key={i} className="flex items-start gap-3 bg-white border border-border rounded-lg px-5 py-4">
                <span className="flex-shrink-0 w-2 h-2 rounded-full bg-[#0078D4] mt-2" />
                <span className="text-foreground text-sm leading-relaxed">{trigger}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── SERVICES OVERVIEW (COLLAPSED SUMMARY GRID) ───────────────────── */}
      <section className="bg-white py-20" data-testid="services-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Services & Engagements</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Four Ways to Engage</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              Every engagement is scoped and delivered personally by Shane. No project managers, no junior consultants.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {servicesSummary.map((service, i) => (
              <div
                key={i}
                className="bg-[#F7F9FC] rounded-xl border border-border p-7 flex flex-col hover:border-[#0078D4]/30 hover:bg-white transition-all"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-5 flex-shrink-0"
                  style={{ backgroundColor: `${service.color}15` }}
                >
                  <CheckCircle className="w-5 h-5" style={{ color: service.color }} />
                </div>
                <h3 className="font-extrabold text-[#0A2540] text-lg mb-3 leading-snug">{service.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed flex-1 mb-6">{service.desc}</p>
                <a
                  href={service.href}
                  className="inline-flex items-center gap-1.5 text-[#0078D4] text-sm font-semibold hover:underline"
                >
                  {service.cta} <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="relative bg-[#0A2540] py-28 overflow-hidden" data-testid="final-cta-section">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-widest mb-4">
            Free 30-Minute Discovery Call
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Your Microsoft 365 Environment Deserves Senior Expertise
          </h2>
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Work directly with Shane — a 30-year Microsoft veteran and Lead M365 Architect at NASA. No account managers, no junior staff. Just clear, actionable guidance from day one.
          </p>
          <CTAButton href="/book" className="text-lg px-12 py-5" data-testid="final-cta-button">
            Book a Consultation
          </CTAButton>
          <p className="mt-5 text-white/40 text-sm tracking-wide">
            No pitch. No obligation. Just clarity.
          </p>
        </div>
      </section>
    </Layout>
  );
}
