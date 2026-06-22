import { CheckCircle, Clock, ArrowRight, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";

const FEATURES = [
  "10 hours of consulting per month",
  "Email and Teams support",
  "Monthly strategy call (60 min)",
  "Standard response within 1 business day",
  "Access to all M365 service areas",
  "Monthly written summary",
];

const WHO_ITS_FOR = [
  "Organizations with a stable M365 environment that needs periodic expert oversight",
  "IT teams who hit blockers they can't resolve without senior M365 expertise",
  "Companies evaluating Copilot or SharePoint modernization but not yet ready to move fast",
  "SMBs that can't justify a full-time architect but want one available on demand",
];

const TIERS = [
  { name: "Architect Essentials", price: "$1,500", hours: "10 hrs/mo", href: "/retainers/architect-essentials", current: true },
  { name: "Architect Growth", price: "$3,000", hours: "25 hrs/mo", href: "/retainers/architect-growth", current: false },
  { name: "Architect Enterprise", price: "$5,500", hours: "50 hrs/mo", href: "/retainers/architect-enterprise", current: false },
];

const TYPICAL_MONTH = [
  { week: "Week 1", activity: "60-minute strategy call to set priorities — Shane reviews your tenant health, upcoming projects, and open questions from the previous month." },
  { week: "Week 2", activity: "Async work on the agreed deliverable: architecture review, governance policy draft, Teams topology guidance, or Copilot readiness assessment." },
  { week: "Week 3", activity: "Email and Teams Q&A on anything that surfaces mid-month — security alerts, licence questions, SharePoint issues." },
  { week: "Week 4", activity: "Monthly written summary delivered: what was done, recommendations for next month, and any risks flagged in your tenant." },
];

export default function ArchitectEssentials() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: "Architect Essentials Retainer",
    description:
      "10 hours/month of senior Microsoft 365 consulting — strategy calls, async support, and a monthly written summary for organizations that need expert oversight without a full-time hire.",
    price: "1500.00",
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: "1500.00",
      priceCurrency: "USD",
      unitText: "MONTH",
    },
    seller: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
    },
    url: "https://shanemccaw.com/retainers/architect-essentials",
  };

  return (
    <Layout>
      <SEOMeta
        title="Architect Essentials Retainer — $1,500/mo | Shane McCaw Consulting"
        description="10 hours/month of senior M365 consulting for organizations that need expert oversight without a full-time hire. Strategy calls, async support, and a monthly written summary."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/pricing#retainers" className="hover:text-[#0078D4] transition-colors">Retainer Plans</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#0A2540] font-medium">Architect Essentials</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-[#0A2540] pt-16 pb-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Clock className="w-3.5 h-3.5 text-[#00B4D8]" />
            10 hours / month
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
            Architect Essentials
          </h1>
          <p className="text-[#00B4D8] text-5xl font-extrabold mb-2">$1,500</p>
          <p className="text-white/50 mb-6 text-lg">/month · cancel with 30 days' notice</p>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Right for organizations that need a senior M365 resource on call — without the overhead of a full-time hire. You get 10 dedicated hours each month, a strategy call, async support, and a written summary of everything accomplished.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book?plan=architect-essentials" className="px-8 py-4 text-base">
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

      {/* Plan comparison strip */}
      <section className="bg-white border-b border-border py-8 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">Compare all retainer tiers</p>
          <div className="grid grid-cols-3 gap-3">
            {TIERS.map((tier) => (
              <Link
                key={tier.href}
                href={tier.href}
                className={`rounded-xl border p-4 text-center transition-all ${
                  tier.current
                    ? "bg-[#0078D4] border-[#0078D4] text-white shadow-md"
                    : "bg-[#F7F9FC] border-border text-[#0A2540] hover:border-[#0078D4]/50 hover:shadow-sm"
                }`}
              >
                <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${tier.current ? "text-white/70" : "text-muted-foreground"}`}>{tier.hours}</p>
                <p className={`font-extrabold text-lg mb-0.5 ${tier.current ? "text-white" : "text-[#0A2540]"}`}>{tier.name}</p>
                <p className={`text-sm font-semibold ${tier.current ? "text-white/80" : "text-[#0078D4]"}`}>{tier.price}/mo</p>
              </Link>
            ))}
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
            Architect Essentials is the right fit if any of these describe your organization:
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
            Here's how Shane structures your 10 hours across a calendar month:
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
              <p className="text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">Need more hours?</p>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Architect Growth — $3,000/mo</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                25 hours/month with priority 4-hour response, two strategy calls, and proactive tenant health monitoring. The best fit for organizations actively modernizing.
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
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready to get started?</h2>
          <p className="text-white/60 mb-8 text-lg">
            Book your onboarding call. Shane will confirm the scope, answer any questions, and set up your first month's priorities.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book?plan=architect-essentials" className="px-8 py-4 text-base">
              Start This Plan — $1,500/mo
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
