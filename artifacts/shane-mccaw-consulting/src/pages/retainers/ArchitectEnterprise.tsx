import { CheckCircle, Clock, ArrowRight, ChevronRight, Shield } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";

const FEATURES = [
  "50 hours of consulting per month",
  "Dedicated Teams support channel",
  "Weekly strategy calls (60 min)",
  "Same-day emergency response",
  "Access to all M365 service areas",
  "Monthly written progress report",
  "Custom technology roadmap",
  "Quarterly strategic review",
];

const WHO_ITS_FOR = [
  "Large organizations or regulated industries where M365 is mission-critical and downtime or misconfiguration is unacceptable",
  "Companies running complex multi-workload deployments — SharePoint, Teams, Power Platform, Copilot, and Azure AD — that need coordinated architectural oversight every week",
  "IT leadership that wants a fractional Chief Technology Architect embedded in their team without the full-time overhead",
  "Organizations undergoing major transformation: a cloud migration, merger M365 consolidation, or enterprise-wide Copilot deployment",
];

const TYPICAL_MONTH = [
  { week: "Week 1", activity: "Weekly strategy call (60 min) to review open workstreams, escalations, and security posture. Shane reviews your tenant health dashboard and flags any risks from the past week." },
  { week: "Week 2", activity: "Deep-dive execution on the month's primary initiative — custom roadmap updates, architecture design sessions, governance policy authoring, Copilot adoption sprint, or Teams telephony rollout." },
  { week: "Week 3", activity: "Weekly check-in call (60 min), mid-month progress review, and asynchronous support via your dedicated Teams channel for anything that surfaces — licence changes, compliance queries, security alerts." },
  { week: "Week 4", activity: "Finalise deliverables, draft the monthly written progress report, and begin scoping for next month. Quarterly months include a 90-minute strategic review with Shane and your leadership team." },
];

export default function ArchitectEnterprise() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: "Architect Enterprise Retainer",
    description:
      "50 hours/month of dedicated senior Microsoft 365 consulting — weekly strategy calls, same-day emergency response, custom technology roadmap, and quarterly strategic reviews for organizations that need a senior architect embedded in their operations.",
    price: "5500.00",
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: "5500.00",
      priceCurrency: "USD",
      unitText: "MONTH",
    },
    seller: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
    },
    url: "https://shanemccaw.com/retainers/architect-enterprise",
  };

  return (
    <Layout>
      <SEOMeta
        title="Architect Enterprise Retainer — $5,500/mo | Shane McCaw Consulting"
        description="50 hours/month of dedicated M365 consulting with weekly strategy calls, same-day emergency response, a custom technology roadmap, and quarterly strategic reviews."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/pricing#retainers" className="hover:text-[#0078D4] transition-colors">Retainer Plans</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#0A2540] font-medium">Architect Enterprise</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-[#0A2540] pt-16 pb-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5 text-[#00B4D8]" />
              50 hours / month
            </div>
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Shield className="w-3.5 h-3.5 text-[#00B4D8]" />
              Same-day response
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
            Architect Enterprise
          </h1>
          <p className="text-[#00B4D8] text-5xl font-extrabold mb-2">$5,500</p>
          <p className="text-white/50 mb-6 text-lg">/month · cancel with 30 days' notice</p>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Right for organizations that need a dedicated senior architect embedded in their operations every week. 50 hours per month, weekly strategy calls, same-day emergency response, a custom technology roadmap, and a quarterly strategic review — the full weight of 30 years of Microsoft ecosystem expertise applied consistently to your environment.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book?plan=architect-enterprise" className="px-8 py-4 text-base">
              Start This Plan
            </CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/80 hover:text-white font-medium text-base transition-colors"
            >
              Talk to Shane first <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-10 text-center">What you get every month</h2>
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

      {/* Who it's for */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">Who this plan is for</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Architect Enterprise is the right fit if any of these describe your organization:
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

      {/* Typical month */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">What a typical month looks like</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Here's how Shane structures your 50 hours across a calendar month:
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

      {/* Tier nudge */}
      <section className="bg-[#F7F9FC] py-14 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="bg-white rounded-2xl border border-border p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">Smaller scope?</p>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Architect Growth — $3,000/mo</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                25 hours/month with priority 4-hour response, two strategy calls, and proactive tenant health monitoring. Most popular for organizations actively modernizing.
              </p>
            </div>
            <Link
              href="/retainers/architect-growth"
              className="inline-flex items-center gap-2 text-[#0078D4] font-semibold whitespace-nowrap hover:text-[#005A9E] transition-colors"
            >
              See Architect Growth <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-[700px] mx-auto">
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready for dedicated M365 leadership?</h2>
          <p className="text-white/60 mb-8 text-lg">
            Book your onboarding call. Shane will review your environment, agree on the first month's priorities, and have your dedicated support channel active within 24 hours.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book?plan=architect-enterprise" className="px-8 py-4 text-base">
              Start This Plan — $5,500/mo
            </CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/70 hover:text-white font-medium text-base transition-colors"
            >
              Talk to Shane first <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
