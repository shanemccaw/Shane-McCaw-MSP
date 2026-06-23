import { CheckCircle, Clock, ArrowRight, ChevronRight, Zap, XCircle, Shield } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import { useServices, formatPrice } from "@/hooks/useServices";

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
  "Regulated industries — finance, healthcare, federal contractors — that require rigorous governance and security architecture",
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
  "Federal-grade accountability — used to working in environments where governance, audit trails, and security are non-negotiable",
  "No salespeople — when you contact Shane, you speak to Shane",
];

export default function ArchitectGrowth() {
  const { services, loading: tiersLoading } = useServices("retainer");

  const growthSvc = services.find((s) => s.slug === "architect-growth");
  const displayPrice = formatPrice(growthSvc?.price ?? null) ?? "$6,000";

  const tiers = [...services]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      name: s.name,
      price: formatPrice(s.price) ?? "—",
      hours: s.hoursPerMonth ? `${s.hoursPerMonth.replace(/[^0-9]/g, "")} hrs/mo` : "—",
      href: s.pageHref ?? "#",
      current: s.pageHref === "/retainers/architect-growth",
    }));

  const growthLivePrice = growthSvc?.price ?? "6000.00";

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
        title="Architect Growth Retainer — $6,000/mo | Shane McCaw Consulting"
        description="25 hrs/month of senior M365 architecture from NASA's Lead Architect. 2-hour priority response, Copilot readiness, governance frameworks, and proactive tenant monitoring for mid-market and regulated organisations."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/retainers" className="hover:text-[#0078D4] transition-colors">
            Retainer Plans
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#0A2540] font-medium">Architect Growth</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-[#0A2540] pt-16 pb-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5 text-[#00B4D8]" />
              25 hours / month
            </div>
            <div className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Zap className="w-3.5 h-3.5" />
              Most Popular
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
            Senior M365 Architecture.<br className="hidden md:block" /> Built to NASA Standards.
          </h1>
          <p className="text-[#00B4D8] text-5xl font-extrabold mb-2">{displayPrice}</p>
          <p className="text-white/50 mb-6 text-lg">/month · cancel with 30 days' notice</p>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            The Architect Growth retainer gives mid-market and regulated organisations weekly access to a senior Microsoft 365 architect — no scoping delays, no proposals, no junior handoffs. You get 25 dedicated hours, 2-hour priority response, and a documented roadmap that makes your modernisation programme impossible to stall.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton
              href="/crm/portal/onboarding/select?service=architect-growth"
              className="px-8 py-4 text-base"
            >
              Start Architect Growth — {displayPrice}/month
            </CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/80 hover:text-white font-medium text-base transition-colors"
            >
              Speak directly with Shane. No salespeople. No pressure. <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Plan comparison strip */}
      <section className="bg-white border-b border-border py-8 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">
            Compare all retainer tiers
          </p>
          <div className="grid grid-cols-3 gap-3">
            {tiersLoading
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="rounded-xl border p-4 text-center bg-[#F7F9FC] animate-pulse">
                    <div className="h-3 bg-gray-200 rounded mb-2 mx-auto w-16" />
                    <div className="h-5 bg-gray-300 rounded mb-1 mx-auto w-28" />
                    <div className="h-4 bg-gray-200 rounded mx-auto w-20" />
                  </div>
                ))
              : tiers.map((tier) => (
                  <Link
                    key={tier.href}
                    href={tier.href}
                    className={`rounded-xl border p-4 text-center transition-all ${
                      tier.current
                        ? "bg-[#0078D4] border-[#0078D4] text-white shadow-md"
                        : "bg-[#F7F9FC] border-border text-[#0A2540] hover:border-[#0078D4]/50 hover:shadow-sm"
                    }`}
                  >
                    <p
                      className={`text-xs font-bold uppercase tracking-wide mb-1 ${
                        tier.current ? "text-white/70" : "text-muted-foreground"
                      }`}
                    >
                      {tier.hours}
                    </p>
                    <p className={`font-extrabold text-lg mb-0.5 ${tier.current ? "text-white" : "text-[#0A2540]"}`}>
                      {tier.name}
                    </p>
                    <p className={`text-sm font-semibold ${tier.current ? "text-white/80" : "text-[#0078D4]"}`}>
                      {tier.price}/mo
                    </p>
                  </Link>
                ))}
          </div>
        </div>
      </section>

      {/* Why This Plan Exists — Value Proposition */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            Why the Architect Growth plan exists
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-2xl mx-auto">
            Most organisations stall their M365 modernisation for the same reason: senior architecture expertise is available by the project, not by the week. Architect Growth changes that — giving you a named senior architect on retainer who already knows your environment and shows up every week without a new statement of work.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WHY_PLAN_EXISTS.map((item, i) => {
              const [label, detail] = item.split(" — ");
              return (
                <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-border shadow-sm">
                  <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                  <span className="text-[#0A2540] leading-relaxed">
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
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            What you get every month
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Ten concrete deliverables, every month, without exception:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-3 bg-[#F7F9FC] rounded-xl p-5 border border-border">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] font-medium">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's Included in the Hours */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            What's included in the hours
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Your 25 hours can be applied to any of the following senior architecture activities:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {HOURS_INCLUDED.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-border shadow-sm">
                <div className="w-6 h-6 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[#0078D4] text-xs font-bold">{i + 1}</span>
                </div>
                <span className="text-[#0A2540] leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What Is Not Included */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            What is not included
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Architect Growth is a senior architecture retainer — not a managed service or full-delivery engagement. Here's what falls outside scope:
          </p>
          <ul className="space-y-4">
            {NOT_INCLUDED.map((item, i) => (
              <li key={i} className="flex items-start gap-4 bg-[#F7F9FC] rounded-xl p-5 border border-border">
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-foreground leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Who It's For */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            Who this plan is for
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Architect Growth is the right fit if any of these describe your organisation:
          </p>
          <ul className="space-y-4">
            {WHO_ITS_FOR.map((item, i) => (
              <li key={i} className="flex items-start gap-4 bg-white rounded-xl p-5 border border-border shadow-sm">
                <div className="w-8 h-8 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[#0078D4] text-sm font-bold">{i + 1}</span>
                </div>
                <p className="text-foreground leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Monthly Workflow */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            Your monthly workflow
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Here's how Shane structures your 25 hours across a calendar month:
          </p>
          <div className="relative pl-6 border-l-2 border-[#0078D4]/20 space-y-8">
            {TYPICAL_MONTH.map((item, i) => (
              <div key={i} className="relative">
                <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-[#0078D4] border-2 border-white shadow" />
                <p className="text-[#0078D4] text-xs font-bold uppercase tracking-wider mb-1">{item.week}</p>
                <p className="text-foreground leading-relaxed">{item.activity}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Shane */}
      <section className="bg-[#0A2540] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-[#00B4D8]" />
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-4 text-center">
            Why Shane McCaw
          </h2>
          <p className="text-white/60 text-center mb-10 max-w-xl mx-auto">
            You're not retaining a firm. You're retaining the architect personally — the same person who designed M365 solutions for one of the most demanding environments on Earth.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WHY_SHANE.map((item, i) => {
              const [label, detail] = item.split(" — ");
              return (
                <div key={i} className="flex items-start gap-3 bg-white/10 rounded-xl p-5 border border-white/10">
                  <CheckCircle className="w-5 h-5 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                  <span className="text-white/90 leading-relaxed">
                    <span className="font-semibold text-white">{label}</span>
                    {detail ? ` — ${detail}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tier nudges */}
      <section className="bg-[#F7F9FC] py-14 px-6">
        <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Lighter workload?</p>
            <h3 className="text-lg font-extrabold text-[#0A2540] mb-2">Architect Essentials — $1,500/mo</h3>
            <p className="text-muted-foreground text-sm mb-4">
              10 hours/month with a monthly strategy call and async support. Great if your environment is stable.
            </p>
            <Link
              href="/retainers/architect-essentials"
              className="inline-flex items-center gap-2 text-[#0078D4] font-semibold text-sm hover:text-[#005A9E] transition-colors"
            >
              See Architect Essentials <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Need full dedication?</p>
            <h3 className="text-lg font-extrabold text-[#0A2540] mb-2">Architect Enterprise — $5,500/mo</h3>
            <p className="text-muted-foreground text-sm mb-4">
              50 hours/month with weekly calls, same-day emergency response, and a custom technology roadmap.
            </p>
            <Link
              href="/retainers/architect-enterprise"
              className="inline-flex items-center gap-2 text-[#0078D4] font-semibold text-sm hover:text-[#005A9E] transition-colors"
            >
              See Architect Enterprise <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Not sure? CTA */}
      <section className="bg-[#F7F9FC] py-12 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="bg-white border border-[#0078D4]/20 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">Not sure which plan is right?</p>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Find your best-fit retainer in 2 minutes</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                Answer 10 questions about your M365 environment and support needs — get an instant recommendation for Essentials, Growth, or Enterprise.
              </p>
            </div>
            <Link
              href="/retainer-quiz"
              className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0066B8] text-white font-semibold px-6 py-3 rounded-xl transition-colors whitespace-nowrap flex-shrink-0 text-sm"
            >
              Take the Retainer Quiz <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-[700px] mx-auto">
          <h2 className="text-3xl font-extrabold text-white mb-4">
            Start Architect Growth — {displayPrice}/month
          </h2>
          <p className="text-white/60 mb-8 text-lg">
            Speak directly with Shane. No salespeople. No pressure.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton
              href="/crm/portal/onboarding/select?service=architect-growth"
              className="px-8 py-4 text-base"
            >
              Start Architect Growth — {displayPrice}/month
            </CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/70 hover:text-white font-medium text-base transition-colors"
            >
              Speak directly with Shane <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
