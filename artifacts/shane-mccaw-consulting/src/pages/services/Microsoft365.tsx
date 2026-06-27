import { useState } from "react";
import { ServiceOverviewModal } from "@/components/ServiceOverviewModal";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import {
  CheckCircle, ArrowRight, Shield, Users, Building2, Zap, AlertCircle,
  Clock,
} from "lucide-react";
import { Link } from "wouter";
import { CTAButton } from "@/components/CTAButton";
import { AssessmentCTA } from "@/components/AssessmentCTA";
import { useServices, useServiceHasPdf, formatPriceDisplay } from "@/hooks/useServices";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { OfferCard } from "@/components/OfferCard";
import { useServicePageTriggerKeys } from "@/hooks/useServicePageTriggerKeys";
import { TestimonialDiscountCallout } from "@/components/TestimonialDiscountCallout";
import { AfterPurchaseSection } from "@/components/AfterPurchaseSection";

const WHO_FOR = [
  { icon: <Building2 className="w-5 h-5 text-[#0078D4]" />, label: "Mid-market companies (200–2,000 employees)" },
  { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, label: "Healthcare, legal, financial services, and government contractors" },
  { icon: <Zap className="w-5 h-5 text-[#0078D4]" />, label: "Fast-growing startups needing enterprise-grade M365 architecture" },
  { icon: <Users className="w-5 h-5 text-[#0078D4]" />, label: "IT leaders who need senior-level expertise without a full-time hire" },
];

const WHY_SHANE = [
  {
    title: "NASA-Scale Experience",
    desc: "Shane served as Lead Microsoft 365 Architect at NASA — one of the most complex, security-sensitive M365 environments in the world. That discipline applies directly to your organization.",
  },
  {
    title: "Compliance-First Architecture",
    desc: "Deep expertise in FedRAMP, FISMA High, ITAR, and GCC High requirements. Shane designs environments that satisfy the strictest regulatory frameworks without sacrificing usability.",
  },
  {
    title: "Senior-Level Delivery, Fractional Cost",
    desc: "You get 30 years of Microsoft ecosystem experience on call — without the overhead of a full-time senior hire. Fixed-price packages mean no billing surprises.",
  },
  {
    title: "Practitioner, Not a Generalist",
    desc: "Shane doesn't subcontract or hand your project to a junior team. He does the work himself, with direct accountability for every recommendation and implementation.",
  },
];

const PROBLEMS = [
  "Teams and SharePoint sprawl — hundreds of ungoverned sites and teams",
  "Overshared content with no sensitivity labels or DLP policies",
  "Excessive global admins and over-privileged service accounts",
  "Legacy authentication still enabled, bypassing Conditional Access",
  "No retention or deletion policies — rising compliance exposure",
  "No lifecycle governance — expired groups persist indefinitely",
  "No provisioning standards — every team is configured differently",
  "No security baselines — Secure Score ignored, defaults left in place",
];

const WHAT_YOU_GET = [
  "A governed tenant with documented policies and enforced standards",
  "A secure identity plane — MFA, Conditional Access, PIM in place",
  "A compliant data estate — sensitivity labels, DLP, and retention active",
  "A rationalized Teams and SharePoint architecture with a provisioning model",
  "A modernized security posture aligned to your regulatory requirements",
  "A prioritized remediation roadmap you can hand to your IT team",
  "A clear operating model so governance doesn't drift again",
];

export default function Microsoft365() {
  const { services, loading, error } = useServices("micro_offer");
  const { services: retainerServices, loading: retainerLoading } = useServices("retainer");
  const { projects: engagementProjects, loading: engagementLoading } = useEngagementProjects();
  const { triggerKeys: m365TriggerKeys } = useServicePageTriggerKeys("microsoft-365");

  const matchedProjects = engagementProjects.filter(
    (p) => p.isVisible && p.triggeredBy.some((t) => m365TriggerKeys.includes(t))
  );

  const [modalOpen, setModalOpen] = useState(false);
  const hasPdf = useServiceHasPdf("/services/microsoft-365");

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Architecture, Governance & Optimization | Shane McCaw Consulting"
        description="NASA-proven Microsoft 365 expertise for mid-market and regulated organizations. Fixed-price Quick Win packages and fractional architecture retainers from Lead M365 Architect Shane McCaw."
        ogUrl="https://shanemccawconsulting.com/services/microsoft-365"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Architecture, Governance & Optimization",
          "description": "Senior-level Microsoft 365 architecture, governance, and modernization services through fixed-price Quick Wins and fractional retainers.",
          "url": "https://shanemccawconsulting.com/services/microsoft-365",
          "serviceType": "Microsoft 365 Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market and regulated organizations (200–2,000 employees)"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          },
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-[172px] pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)"
        }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Microsoft 365 Services</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Architecture,<br className="hidden md:block" /> Governance &amp; Optimization
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            NASA-proven Microsoft 365 expertise for mid-market and regulated organizations.
          </p>
          <p className="text-white/40 text-sm mt-3 max-w-xl">
            Built on the same architecture principles Shane applied as NASA's Lead M365 Architect.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </a>
            {hasPdf && (
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm"
              >
                Download Overview <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── WHY THIS MATTERS ─────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Why It Matters</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
              Your Most Critical Business Platform Deserves Senior-Level Architecture
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Microsoft 365 is the operating system of the modern organization — email, identity, collaboration, compliance, and automation all run through it. Yet most deployments are under-configured, under-governed, and under-utilized.
            </p>
            <p className="text-muted-foreground text-lg leading-relaxed mt-4">
              Architecture is the missing layer. Most organizations deploy M365 and assume it's configured. It isn't. Without deliberate architecture, governance, and operational standards, every new team, site, and app adds to the debt.
            </p>
            <p className="text-muted-foreground text-lg leading-relaxed mt-4">
              Shane provides senior-level architecture, governance, and modernization services through fixed-price Quick Win packages and fractional architecture retainers — so you get NASA-grade expertise without the cost of a full-time hire.
            </p>
          </div>
        </div>
      </section>

      {/* ── COMMON PROBLEMS WE FIX ───────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Common Problems</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                What We Fix
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Most tenants have accumulated years of configuration drift. These are the patterns Shane sees in almost every engagement.
              </p>
              <ul className="space-y-3">
                {PROBLEMS.map((problem) => (
                  <li key={problem} className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-[#0A2540] text-sm leading-relaxed">{problem}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Outcomes</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                What You Get
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Every engagement — from a Quick Win audit to a full retainer — moves your tenant closer to this state.
              </p>
              <ul className="space-y-3">
                {WHAT_YOU_GET.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-[#0A2540] text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── QUICK WIN SUITE ──────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Track 01 · Entry Tier</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Recommended Quick Wins</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Scoped, delivered, and priced upfront. No retainer required to get started.
            </p>
          </div>

          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white border border-border rounded-2xl p-6 flex flex-col gap-4 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10" />
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-full" />
                    <div className="h-3 bg-muted rounded w-5/6" />
                  </div>
                  <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                    <div className="h-4 bg-muted rounded w-24" />
                    <div className="h-3 bg-muted rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
              <AlertCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0" />
              <span className="text-sm">Unable to load offers right now. Please try refreshing the page.</span>
            </div>
          )}

          {!loading && !error && services.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((offer, i) => (
                <OfferCard key={offer.slug ?? offer.id} offer={offer} index={i} />
              ))}
            </div>
          )}

          <div className="text-center mt-10">
            <Link
              href="/micro-offers"
              className="inline-flex items-center gap-2 text-[#0078D4] font-semibold hover:underline"
            >
              View all Quick Win packages <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── PROJECT ENGAGEMENTS ──────────────────────────────────────────── */}
      {(engagementLoading || matchedProjects.length > 0) && (
        <section className="bg-[#F7F9FC] py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="text-center mb-12">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Track 02 · Core Tier</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Recommended Projects</h2>
              <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
                Most M365 health audits surface deeper work. Shane can lead that work through a scoped project engagement.
              </p>
            </div>
            {engagementLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[0, 1].map((i) => (
                  <div key={i} className="rounded-xl border bg-white border-border p-8 h-56 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
                {matchedProjects.map((project, i) => (
                  <EngagementProjectCard key={project.id} project={project} index={i} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── FRACTIONAL RETAINERS (COMPACT) ───────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-10">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Track 03 · Strategic Tier</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Fractional Architecture Retainers</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Embedded architecture leadership on a monthly basis — strategy, governance, roadmap execution, and escalation support.
            </p>
          </div>

          {retainerLoading ? (
            <div className="space-y-3 max-w-3xl mx-auto">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="max-w-3xl mx-auto divide-y divide-border border border-border rounded-2xl overflow-hidden">
              {retainerServices.map((tier) => (
                <div key={tier.slug ?? tier.name} className="flex items-center justify-between gap-4 px-6 py-5 bg-white hover:bg-[#F7F9FC] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#0A2540] leading-snug">{tier.name}</p>
                    {tier.hoursPerMonth && (
                      <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                        {tier.hoursPerMonth} hrs/mo
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-extrabold text-[#0A2540] text-lg leading-none">
                      {formatPriceDisplay(tier)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">per month</p>
                  </div>
                  <Link
                    href={tier.pageHref ?? "/retainers"}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 text-[#0078D4] text-sm font-semibold hover:underline"
                  >
                    Learn more <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-sm text-muted-foreground mt-6">
            All retainers are month-to-month. Cancel anytime.{" "}
            <Link href="/retainers" className="text-[#0078D4] hover:underline font-medium">
              See full retainer details →
            </Link>
          </p>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ideal Clients</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">Who This Is For</h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Shane works with organizations where Microsoft 365 is mission-critical and the cost of misconfiguration — a breach, a compliance gap, a failed migration — is unacceptable.
              </p>
              <ul className="space-y-4">
                {WHO_FOR.map((item) => (
                  <li key={item.label} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      {item.icon}
                    </div>
                    <span className="text-[#0A2540] font-medium text-sm">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">Compliance Coverage</p>
              <p className="text-white font-bold text-lg">Regulated industry? Shane's built for it.</p>
              <div className="grid grid-cols-2 gap-3">
                {["FedRAMP", "FISMA High", "ITAR", "GCC High", "HIPAA", "CMMC"].map((label) => (
                  <div key={label} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                    <span className="text-white text-sm font-semibold">{label}</span>
                  </div>
                ))}
              </div>
              <p className="text-white/50 text-xs leading-relaxed">
                Shane designed and maintained Microsoft 365 environments at NASA, one of the most compliance-intensive deployments in the U.S. federal government.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Credentials</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ARCHITECTURE READINESS QUIZ ──────────────────────────────────── */}
      <AssessmentCTA
        label="Microsoft 365 Architecture Readiness Quiz"
        title="How Ready Is Your M365 Tenant?<br class='hidden sm:block' /> Take the Architecture Readiness Quiz."
        description="Most tenants have blind spots across identity, governance, security, and architecture. This assessment surfaces yours in minutes — with a prioritised action plan."
        supportingCopy="Answer targeted questions across identity &amp; access baseline, governance maturity, security &amp; compliance posture, Teams/SharePoint architecture, configuration hygiene, and operational readiness. Delivered instantly. No account required."
        quizUrl="/m365-health-quiz"
        ctaLabel="Take the Architecture Readiness Quiz"
        stats={[
          { label: "10 questions · ~5 minutes" },
          { label: "Personalised report emailed instantly" },
          { label: "No sales follow-up" },
        ]}
      />

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <AfterPurchaseSection serviceName="Microsoft 365 Architecture" />
      <TestimonialDiscountCallout />
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)"
        }} />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ready to Start?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Let's Talk About Your Microsoft 365 Environment
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            A free discovery call takes 30 minutes. You'll leave with clarity on where your tenant stands and what to do next.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/book" className="px-8 py-3.5 text-base">
              Book a Free Discovery Call
            </CTAButton>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-white/80 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              Download M365 Services Overview <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      <ServiceOverviewModal
        serviceName="Microsoft 365"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Layout>
  );
}
