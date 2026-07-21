import { CheckCircle, Clock, ArrowRight, ChevronRight, Zap, XCircle, Shield } from "lucide-react";
import { TestimonialDiscountCallout } from "@/components/TestimonialDiscountCallout";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { useServices, formatPrice } from "@/hooks/useServices";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const FEATURES = [
  "25 hours of senior architecture consulting per month",
  "2-hour priority response during business hours",
  "Two strategy calls per month (60 min each)",
  "8 hours of hands-on configuration and build work",
  "Architecture design and modernisation roadmap",
  "Governance and security framework builds",
  "Copilot adoption framework and readiness scoring",
  "Power Platform solution oversight",
  "Proactive tenant health monitoring",
  "Monthly written summary, risks, and next-step recommendations",
];

const HOURS_INCLUDED = [
  "Architecture design and documentation",
  "Governance and compliance frameworks",
  "Security and identity architecture",
  "SharePoint information architecture and Teams architecture",
  "Power Platform solution oversight",
  "Copilot readiness and deployment guidance",
  "Roadmap and modernisation planning",
  "Escalation support for critical issues",
  "Documentation and clarity deliverables",
];

const NOT_INCLUDED = [
  "Full project execution or end-to-end delivery management",
  "Unlimited meetings or unscheduled calls",
  "Junior staff — all work is done by Shane personally",
  "MSP-style ticket handling or helpdesk support",
  "Device management, endpoint security, or desktop support",
];

const WHO_ITS_FOR = [
  "Organisations mid-way through an M365 modernisation or Copilot rollout who need consistent senior direction every week",
  "Regulated industries — finance and healthcare — that require rigorous governance and security architecture",
  "Complex SharePoint, Teams, and Power Platform IT teams that generate frequent architecture questions and decisions",
  "Companies that have outgrown ad-hoc consulting and need predictable, senior-level access without hiring a full-time architect",
  "Organisations planning a governance overhaul, security hardening, or licence optimisation initiative",
];

const TYPICAL_MONTH = [
  {
    week: "Week 1",
    activity:
      "Strategy and alignment call (60 min) — review open workstreams, confirm this month's priorities, and surface any tenant alerts from proactive health monitoring.",
  },
  {
    week: "Week 2",
    activity:
      "Deep-dive architecture work — design sessions, roadmap documentation, Copilot readiness scoring, governance policy builds, or SharePoint information architecture sprint.",
  },
  {
    week: "Week 3",
    activity:
      "Mid-month check-in call (60 min) — course-correct, review outputs, and resolve anything urgent that arose: policy questions, licence changes, security incidents.",
  },
  {
    week: "Week 4",
    activity:
      "Final deliverables and written summary — complete all month's work, draft the written progress report, log risks, and set next month's strategic priorities.",
  },
];

const WHY_PLAN_EXISTS = [
  "Faster modernisation — weekly senior access collapses timelines that ad-hoc consulting stretches over quarters",
  "Governance maturity — recurring architecture oversight ensures your tenant hardens progressively, not reactively",
  "Reduced risk — proactive monitoring catches configuration drift and security gaps before they become incidents",
  "Clear decision-making — an architect on retainer means technology decisions get made with context, not guesswork",
  "Architecture-first clarity — every piece of work is anchored to a documented roadmap, not reactive firefighting",
  "Predictable access to senior expertise — no scoping delays, no proposals required, no waiting for availability",
];

const WHY_SHANE = [
  "Lead Microsoft 365 Architect at NASA — accountable for one of the world's most demanding M365 environments",
  "30 years in the Microsoft ecosystem — from Active Directory to Azure AD, SharePoint on-prem to Copilot",
  "Senior-only delivery — Shane does the work personally; no junior staff, no outsourcing, no handoffs",
  "Architecture-first methodology — every engagement produces documented decisions, not just verbal recommendations",
  "The same accountability Shane holds himself to at NASA — governance, audit trails, and security treated as non-negotiable",
  "No salespeople — when you contact Shane, you speak to Shane",
];

export default function ArchitectGrowth() {
  const { services, loading: tiersLoading } = useServices("retainer");

  const growthSvc = services.find((s) => s.slug === "architect-growth");
  const displayPrice = formatPrice(growthSvc?.price ?? null);

  const tiers = [...services]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      name: s.name,
      price: formatPrice(s.price) ?? "—",
      hours: s.hoursPerMonth ? `${s.hoursPerMonth.replace(/[^0-9]/g, "")} hrs/mo` : "—",
      href: s.pageHref ?? "#",
      current: s.pageHref === "/retainers/architect-growth",
    }));

  const growthLivePrice = growthSvc?.price ?? "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: "Architect Growth Retainer",
    description:
      "25 hours/month of senior Microsoft 365 consulting from NASA's Lead M365 Architect — 2-hour priority response, two strategy calls, Copilot readiness scoring, governance framework builds, and proactive tenant health monitoring for mid-market and regulated organisations.",
    price: growthLivePrice,
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: growthLivePrice,
      priceCurrency: "USD",
      unitText: "MONTH",
    },
    seller: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
    },
    url: "https://shanemccaw.com/retainers/architect-growth",
  };

  return (
    <Layout>
      <SEOMeta
        title="Architect Growth Retainer | Shane McCaw Consulting"
        description="25 hrs/month of senior M365 architecture from NASA's Lead Architect. 2-hour priority response, Copilot readiness, governance frameworks, and proactive tenant monitoring for mid-market and regulated organisations."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="border-b border-white/[0.06] pt-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-text-tertiary">
          <Link href="/retainers" className="hover:text-accent-blue transition-colors">
            Retainer Plans
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">Architect Growth</span>
        </div>
      </div>

      {/* Hero */}
      <section className="pt-10 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5 text-accent-blue" />
              25 hours / month
            </div>
            <div className="inline-flex items-center gap-2 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full" style={GRADIENT_BG}>
              <Zap className="w-3.5 h-3.5" />
              Most Popular
            </div>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-4 leading-tight">
            Senior M365 Architecture.<br className="hidden md:block" /> <GradientText>Built to NASA Standards.</GradientText>
          </h1>
          {displayPrice && <p className="font-numeric text-5xl font-bold mb-2 text-text-primary">{displayPrice}</p>}
          <p className="text-text-tertiary mb-6 text-lg">{displayPrice ? "/month · cancel with 30 days' notice" : "Cancel with 30 days' notice"}</p>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            The Architect Growth retainer gives mid-market and regulated organisations weekly access to a senior Microsoft 365 architect — no scoping delays, no proposals, no junior handoffs. You get 25 dedicated hours, 2-hour priority response, and a documented roadmap that makes your modernisation programme impossible to stall.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/checkout/architect-growth"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start Architect Growth
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-text-secondary hover:text-text-primary font-medium text-base transition-colors"
            >
              Speak directly with Shane. No salespeople. No pressure. <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Plan comparison strip */}
      <section className="border-y border-white/[0.06] py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-text-tertiary mb-6">
            Compare all retainer tiers
          </p>
          <div className="grid grid-cols-3 gap-3">
            {tiersLoading
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border border-white/[0.06] p-4 text-center bg-charcoal-1 animate-pulse">
                    <div className="h-3 bg-white/[0.08] rounded mb-2 mx-auto w-16" />
                    <div className="h-5 bg-white/[0.1] rounded mb-1 mx-auto w-28" />
                    <div className="h-4 bg-white/[0.08] rounded mx-auto w-20" />
                  </div>
                ))
              : tiers.map((tier) => (
                  <Link
                    key={tier.href}
                    href={tier.href}
                    className={`rounded-2xl border p-4 text-center transition-all ${
                      tier.current
                        ? "border-accent-blue/50 text-white shadow-md"
                        : "bg-charcoal-1 border-white/[0.06] text-text-primary hover:border-accent-blue/30"
                    }`}
                    style={tier.current ? GRADIENT_BG : undefined}
                  >
                    <p
                      className={`text-xs font-bold uppercase tracking-wide mb-1 ${
                        tier.current ? "text-white/70" : "text-text-tertiary"
                      }`}
                    >
                      {tier.hours}
                    </p>
                    <p className="font-display font-bold text-lg mb-0.5 text-text-primary">
                      {tier.name}
                    </p>
                    <p className={`text-sm font-semibold ${tier.current ? "text-white/80" : "text-accent-blue"}`}>
                      {tier.price}/mo
                    </p>
                  </Link>
                ))}
          </div>
        </div>
      </section>

      {/* Why This Plan Exists — Value Proposition */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4 text-center">
            Why the Architect Growth plan exists
          </h2>
          <p className="text-text-secondary text-center mb-10 max-w-2xl mx-auto">
            Most organisations stall their M365 modernisation for the same reason: senior architecture expertise is available by the project, not by the week. Architect Growth changes that — giving you a named senior architect on retainer who already knows your environment and shows up every week without a new statement of work.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WHY_PLAN_EXISTS.map((item, i) => {
              const [label, detail] = item.split(" — ");
              return (
                <div key={i} className="flex items-start gap-3 bg-charcoal-1 rounded-2xl p-5 border border-white/[0.06]">
                  <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span className="text-text-primary leading-relaxed">
                    <span className="font-semibold">{label}</span>
                    {detail ? ` — ${detail}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4 text-center">
            What you get every month
          </h2>
          <p className="text-text-secondary text-center mb-10 max-w-xl mx-auto">
            Ten concrete deliverables, every month, without exception:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-3 bg-charcoal-1 rounded-2xl p-5 border border-white/[0.06]">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-text-primary font-medium">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's Included in the Hours */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4 text-center">
            What's included in the hours
          </h2>
          <p className="text-text-secondary text-center mb-10 max-w-xl mx-auto">
            Your 25 hours can be applied to any of the following senior architecture activities:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {HOURS_INCLUDED.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-charcoal-1 rounded-2xl p-5 border border-white/[0.06]">
                <div className="w-6 h-6 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-accent-blue text-xs font-bold">{i + 1}</span>
                </div>
                <span className="text-text-primary leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What Is Not Included */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4 text-center">
            What is not included
          </h2>
          <p className="text-text-secondary text-center mb-10 max-w-xl mx-auto">
            Architect Growth is a senior architecture retainer — not a managed service or full-delivery engagement. Here's what falls outside scope:
          </p>
          <ul className="space-y-4">
            {NOT_INCLUDED.map((item, i) => (
              <li key={i} className="flex items-start gap-4 bg-charcoal-1 rounded-2xl p-5 border border-white/[0.06]">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-text-secondary leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Who It's For */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4 text-center">
            Who this plan is for
          </h2>
          <p className="text-text-secondary text-center mb-10 max-w-xl mx-auto">
            Architect Growth is the right fit if any of these describe your organisation:
          </p>
          <ul className="space-y-4">
            {WHO_ITS_FOR.map((item, i) => (
              <li key={i} className="flex items-start gap-4 bg-charcoal-1 rounded-2xl p-5 border border-white/[0.06]">
                <div className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-accent-blue text-sm font-bold">{i + 1}</span>
                </div>
                <p className="text-text-secondary leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Monthly Workflow */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4 text-center">
            Your monthly workflow
          </h2>
          <p className="text-text-secondary text-center mb-10 max-w-xl mx-auto">
            Here's how Shane structures your 25 hours across a calendar month:
          </p>
          <div className="relative pl-6 border-l-2 border-accent-blue/20 space-y-8">
            {TYPICAL_MONTH.map((item, i) => (
              <div key={i} className="relative">
                <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-accent-blue border-2 border-charcoal-0 shadow" />
                <p className="text-accent-blue text-xs font-bold uppercase tracking-wider mb-1">{item.week}</p>
                <p className="text-text-secondary leading-relaxed">{item.activity}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Shane */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-accent-blue" />
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4 text-center">
            Why Shane McCaw
          </h2>
          <p className="text-text-secondary text-center mb-10 max-w-xl mx-auto">
            You're not retaining a firm. You're retaining the architect personally — the same person who designed M365 solutions for one of the most demanding environments on Earth.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WHY_SHANE.map((item, i) => {
              const [label, detail] = item.split(" — ");
              return (
                <div key={i} className="flex items-start gap-3 bg-charcoal-1 rounded-2xl p-5 border border-white/[0.06]">
                  <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span className="text-text-secondary leading-relaxed">
                    <span className="font-semibold text-text-primary">{label}</span>
                    {detail ? ` — ${detail}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tier nudges */}
      <section className="py-14 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-1">Lighter workload?</p>
            <h3 className="font-display text-lg font-bold text-text-primary mb-2">Architect Essentials</h3>
            <p className="text-text-secondary text-sm mb-4">
              10 hours/month with a monthly strategy call and async support. Great if your environment is stable.
            </p>
            <Link
              href="/retainers/architect-essentials"
              className="inline-flex items-center gap-2 text-accent-blue font-semibold text-sm hover:text-accent-violet transition-colors"
            >
              See Architect Essentials <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-1">Need full dedication?</p>
            <h3 className="font-display text-lg font-bold text-text-primary mb-2">Architect Enterprise</h3>
            <p className="text-text-secondary text-sm mb-4">
              50 hours/month with weekly calls, same-day emergency response, and a custom technology roadmap.
            </p>
            <Link
              href="/retainers/architect-enterprise"
              className="inline-flex items-center gap-2 text-accent-blue font-semibold text-sm hover:text-accent-violet transition-colors"
            >
              See Architect Enterprise <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Not sure? CTA */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <GlassPanel className="p-8 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-accent-blue mb-1">Not sure which plan is right?</p>
              <h3 className="font-display text-xl font-bold text-text-primary mb-2">Find your best-fit retainer in 2 minutes</h3>
              <p className="text-text-secondary text-sm max-w-md">
                Answer 10 questions about your M365 environment and support needs — get an instant recommendation for Essentials, Growth, or Enterprise.
              </p>
            </div>
            <Link
              href="/retainer-quiz"
              className="inline-flex items-center gap-2 text-white font-semibold px-6 py-3 rounded-xl transition-opacity hover:opacity-90 whitespace-nowrap flex-shrink-0 text-sm"
              style={GRADIENT_BG}
            >
              Take the Retainer Quiz <ArrowRight className="w-4 h-4" />
            </Link>
          </GlassPanel>
        </div>
      </section>

      <TestimonialDiscountCallout />
      {/* Bottom CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 text-center border-t border-white/[0.06]">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display text-3xl font-bold text-text-primary mb-4">
            Start Architect Growth
          </h2>
          <p className="text-text-secondary mb-8 text-lg">
            Speak directly with Shane. No salespeople. No pressure.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/checkout/architect-growth"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start Architect Growth
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-text-secondary hover:text-text-primary font-medium text-base transition-colors"
            >
              Speak directly with Shane <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
