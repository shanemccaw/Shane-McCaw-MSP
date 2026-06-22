import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import { OfferCard } from "@/components/OfferCard";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import {
  CheckCircle, ArrowRight, Shield, Building2, Rocket, Briefcase,
} from "lucide-react";
import { useServices } from "@/hooks/useServices";
import { useEngagementProjects } from "@/hooks/useEngagementProjects";

const whyPoints = [
  "NASA-grade thinking from 6+ years as Lead M365 Architect — mission-critical standards applied to your business.",
  "30 years of Microsoft ecosystem expertise — from code to cloud, across every major platform evolution.",
  "Direct access to Shane always — no junior consultants, no offshore teams, no handoffs.",
  "Forum of Innovation Award winner, 20+ former Microsoft certifications, ex-Microsoft engineer, founder of McCawSoft.",
];

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
      "Copilot readiness blocked by data hygiene issues",
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


export default function Home() {
  const { services: dbServiceAreas, loading: serviceAreasLoading } = useServices("service_area");
  const { services: dbRetainers, loading: retainersLoading } = useServices("retainer");
  const { services: dbOffers, loading: offersLoading } = useServices("micro_offer");
  const { projects: engagementProjects, loading: projectsLoading } = useEngagementProjects();
  const visibleProjects = engagementProjects.filter(p => p.isVisible);
  const dbServices = [...dbServiceAreas, ...dbRetainers];
  const servicesLoading = serviceAreasLoading || retainersLoading;

  const decisionMakerTriggers = [
    "Microsoft 365 is deployed but nobody's using it effectively",
    "Copilot is on your radar but your tenant isn't ready for it",
    "A compliance audit revealed gaps in your M365 governance",
    "A migration project has stalled or previously failed",
    "Shadow IT is undermining your security posture",
    "You need senior-level expertise without a full-time hire",
  ];

  const entryKeywords = ["audit", "assessment", "readiness", "health"];
  const allEntryPool = [...dbServiceAreas, ...dbOffers];
  const entryPointServices = allEntryPool
    .filter(s => {
      const haystack = `${s.name ?? ""} ${s.category ?? ""} ${s.slug ?? ""}`.toLowerCase();
      return entryKeywords.some(kw => haystack.includes(kw));
    })
    .slice(0, 2);

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

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center bg-[#0A2540] overflow-hidden">
        {/* Grid overlay */}
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
        {/* Radial glow */}
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

          {/* Credential labels */}
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

          <h1 className="text-4xl md:text-5xl lg:text-[3.75rem] font-extrabold text-white leading-[1.1] mb-7 max-w-5xl mx-auto">
            The Architect Who Built at NASA Scale — Available to You.
          </h1>
          <p className="text-lg md:text-xl text-white/75 max-w-3xl mx-auto mb-12 leading-relaxed">
            Shane McCaw brings the same mission-critical Microsoft 365 discipline he built at NASA to regulated industries and mid-market companies. No generalists. No offshore handoffs. Senior Microsoft expertise, available to your organization on a fractional basis.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/book" className="text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30" data-testid="hero-cta-primary">
              Book a Consultation
            </CTAButton>
            <a
              href="/customer-command-center"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors"
            >
              Explore the Client Portal <ArrowRight className="w-4 h-4" />
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

      {/* COPILOT READINESS QUIZ CTA */}
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
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
            Most deployments fail not because of the technology — but because the Microsoft 365 tenant isn't ready for it. Take the Copilot Readiness Quiz and find out exactly where you stand.
          </p>

          {/* Stat strip */}
          <div className="flex flex-wrap items-center justify-center gap-6 mb-10">
            {[
              { value: "5 min", label: "to complete" },
              { value: "Free", label: "no cost, no signup" },
              { value: "Instant", label: "PDF report" },
            ].map((stat, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="text-2xl font-extrabold text-[#00B4D8]">{stat.value}</span>
                <span className="text-white/50 text-xs font-medium uppercase tracking-wider">{stat.label}</span>
              </div>
            ))}
          </div>

          <CTAButton href="/copilot-quiz" className="text-base px-10 py-4 shadow-lg shadow-[#00B4D8]/20" data-testid="quiz-cta-button">
            Take the Free Quiz
          </CTAButton>
          <p className="mt-5 text-white/35 text-sm tracking-wide">
            Personalized readiness score + actionable next steps delivered instantly.
          </p>
        </div>
      </section>

      {/* NASA COMPLIANCE CREDENTIALS */}
      <section className="bg-[#F7F9FC] py-20" data-testid="nasa-compliance-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">NASA Compliance Credentials</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Built on the Standards That Matter Most</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane's tenure as Lead M365 Architect at NASA required mastery of the most demanding compliance frameworks in existence. That expertise now benefits mid-market companies, regulated industries, government contractors, and startups scaling into their first compliance obligations.
            </p>
          </div>
          <p className="text-center text-[#0078D4] font-semibold italic mt-2 mb-10 max-w-2xl mx-auto">
            This experience translates directly into value for mid-market and regulated-industry clients.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
        </div>
      </section>

      {/* POSITIONING STATEMENT CALLOUT */}
      <section className="bg-[#0078D4] py-16" data-testid="positioning-callout">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-white/80 text-sm font-semibold uppercase tracking-[0.15em] mb-4">Core Positioning</p>
          <blockquote className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-white leading-tight max-w-4xl mx-auto">
            "The Architect Who Built at NASA Scale — Available to You."
          </blockquote>
        </div>
      </section>

      {/* ELEVATOR PITCH */}
      <section className="bg-white py-20" data-testid="elevator-pitch-section">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Why Shane</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-8">
            30 Years. One Architect. Your Organization.
          </h2>
          <div className="text-lg text-foreground leading-relaxed space-y-4 text-left md:text-center">
            <p>
              Shane McCaw has spent three decades inside the Microsoft ecosystem — as an engineer, director, founder, and now Lead M365 Architect at NASA — building the deep technical fluency that most consultants simply don't have.
            </p>
            <p>
              For mid-market companies and regulated-industry organizations, that means access to an architect who has designed governance frameworks, led Copilot rollouts, and navigated the most complex compliance environments in the world — on a fractional basis, without the cost of a full-time hire.
            </p>
            <p>
              If Microsoft 365 is holding your business back, Shane can fix it. Let's connect.
            </p>
          </div>
          <div className="mt-10">
            <CTAButton href="/about" className="text-base px-8 py-3.5" data-testid="pitch-cta">
              Learn More About Shane
            </CTAButton>
          </div>
        </div>
      </section>

      {/* WHO I SERVE */}
      <section className="bg-[#F7F9FC] py-20" data-testid="who-i-serve-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ideal Clients</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who I Serve</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane works best with organizations that have real complexity — and the ambition to fix it properly.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {whoIServe.map((segment, i) => {
              const Icon = segment.icon;
              return (
                <div key={i} className="bg-white rounded-xl border border-border p-8 flex flex-col" data-testid={`segment-${i}`}>
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
        </div>
      </section>

      {/* CREDIBILITY BAR */}
      <section className="bg-[#F7F9FC] border-y border-border py-8" data-testid="credibility-bar">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex flex-wrap items-center justify-center gap-4 text-center">
            {[
              { name: "Microsoft", detail: "30+ Years | Former Employee" },
              { name: "NASA", detail: "Current Lead M365 Architect | 6 Years" },
              { name: "Planet Technologies", detail: "Former Director of Technologies" },
              { name: "McCawSoft", detail: "Founder & Principal Architect" },
              { name: "Forum of Innovation", detail: "Award Winner" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="text-center">
                  <div className="font-bold text-[#0A2540] text-sm md:text-base">{item.name}</div>
                  <div className="text-muted-foreground text-xs md:text-sm">{item.detail}</div>
                </div>
                {i < 4 && <div className="hidden sm:block h-10 w-px bg-border" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DECISION-MAKER TRIGGERS */}
      <section className="bg-white py-20" data-testid="decision-maker-triggers-section">
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
              <li key={i} className="flex items-start gap-3 bg-[#F7F9FC] border border-border rounded-lg px-5 py-4">
                <span className="flex-shrink-0 w-2 h-2 rounded-full bg-[#0078D4] mt-2" />
                <span className="text-foreground text-sm leading-relaxed">{trigger}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* SERVICES GRID */}
      <section className="bg-[#F7F9FC] py-20" data-testid="services-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-6">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Services & Engagements</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Six Ways to Engage — All Backed by NASA-Level Expertise</h2>
            <p className="text-[#00B4D8] font-semibold mt-3 text-base">
              Productized offers. Fractional architecture. NASA‑grade governance.
            </p>
            <p className="text-muted-foreground mt-3 max-w-2xl mx-auto leading-relaxed">
              Every engagement is scoped and delivered personally by Shane. No project managers between you and the architect. No junior consultants doing the work.
            </p>
          </div>

          {/* Quick Win Strategy */}
          <div className="max-w-2xl mx-auto mb-10 text-center">
            <p className="text-foreground leading-relaxed">
              Not ready for a full retainer? A great place to start is a focused audit or readiness assessment
              {entryPointServices.length > 0 && (
                <> — such as {entryPointServices.map((s, i) => (
                  <span key={s.slug ?? i}>
                    {i > 0 && " or "}
                    <strong>{s.name}</strong>
                  </span>
                ))}</>
              )}
              {" "}— that delivers clear findings and a prioritized action plan in days, not months.
            </p>
            <p className="text-sm text-muted-foreground italic mt-3">
              For the first few clients, discounted entry‑point engagements may be offered — reach out to discuss availability.
            </p>
          </div>

          <p className="text-center text-foreground font-medium mb-6 max-w-2xl mx-auto">
            My fractional architecture engagements are structured in three tiers — quick win packages for fast, defined results, project-based engagements for larger outcomes, and retainer arrangements for ongoing advisory work.
          </p>

          {servicesLoading && dbServices.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => <div key={i} className="h-96 rounded-xl border border-border bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {dbServices.map((s, i) => (
                <OfferCard
                  key={s.slug ?? i}
                  offer={s}
                  index={i}
                  ctaHref={s.pageHref ?? "/services"}
                  ctaLabel="Learn More"
                />
              ))}
            </div>
          )}

          <p className="text-center text-sm text-muted-foreground mt-6">
            Retainer arrangements require a minimum 3-month commitment.
          </p>

          <div className="text-center mt-4">
            <Link href="/micro-offers" className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-[#0078D4] transition-colors" data-testid="view-all-services">
              View all fixed-price packages and retainer options <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* WHY SHANE */}
      <section className="bg-[#F7F9FC] py-20" data-testid="why-shane-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">The Difference</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane McCaw?</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {whyPoints.map((point, i) => (
              <div key={i} className="flex items-start gap-4 bg-white p-6 rounded-lg border border-border" data-testid={`why-point-${i}`}>
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-[#0078D4]" />
                </div>
                <p className="text-foreground leading-relaxed">{point}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-white py-20" data-testid="how-it-works-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Process</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">How It Works</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {[
              { step: "01", title: "Free Discovery Call", desc: "30-minute assessment of your Microsoft 365 environment, pain points, and goals. No pitch — just clarity." },
              { step: "02", title: "Custom Roadmap", desc: "Tailored plan with transparent scope, timeline, and pricing. You know exactly what you're getting before a single dollar changes hands." },
              { step: "03", title: "Hands-On Execution", desc: "Shane personally builds, configures, and delivers. No handoffs to junior staff. No surprises." },
            ].map((item, i) => (
              <div key={i} className="relative text-center px-4" data-testid={`step-${i}`}>
                <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 border-2 border-[#0078D4] flex items-center justify-center mx-auto mb-6">
                  <span className="text-[#0078D4] font-extrabold text-lg">{item.step}</span>
                </div>
                <h3 className="text-xl font-bold text-[#0A2540] mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                {i < 2 && (
                  <div className="hidden md:block absolute top-8 left-[calc(100%-1rem)] w-8 h-px bg-[#0078D4]/30" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROJECT-BASED ENGAGEMENTS */}
      {(projectsLoading || visibleProjects.length > 0) && (
        <section className="bg-[#F7F9FC] py-20" data-testid="engagement-projects-section">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="text-center mb-14">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Track 02 · Core Tier</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Project-Based Engagements</h2>
              <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
                For larger, multi-phase work — tenant migrations, governance overhauls, Copilot deployments, and intranet builds. Fixed-price after a free scoping call.
              </p>
            </div>
            {projectsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-56 rounded-xl border border-border bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {visibleProjects.map((p, i) => (
                  <EngagementProjectCard key={p.id} project={p} index={i} />
                ))}
              </div>
            )}
            <div className="text-center mt-10">
              <Link href="/services#track-02" className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-[#0078D4] transition-colors">
                See all project types <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* FEATURED MICRO-OFFERS */}
      <section className="bg-[#F7F9FC] py-20" data-testid="micro-offers-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Quick Wins</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Start Small. Win Big.</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Fixed-price packages with clear deliverables. Get results fast without a long commitment.</p>
          </div>
          {offersLoading && dbOffers.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
              {[...Array(6)].map((_, i) => <div key={i} className="h-96 rounded-xl border border-border bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
              {dbOffers.map((offer, i) => (
                <OfferCard key={offer.slug ?? i} offer={offer} index={i} />
              ))}
            </div>
          )}
          <div className="text-center">
            <Link href="/micro-offers" className="text-[#0078D4] font-semibold hover:underline flex items-center justify-center gap-1" data-testid="view-all-offers">
              View All Quick Win Packages <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CONSULTATION CTA SECTION */}
      <section className="relative bg-[#0A2540] py-28 overflow-hidden" data-testid="final-cta-section">
        {/* Radial glow overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        {/* Subtle grid overlay */}
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
