import { CheckCircle, Clock, ArrowRight, ChevronRight, Zap } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";

const FEATURES = [
  "25 hours of consulting per month",
  "Priority email and Teams support",
  "Two strategy calls per month (60 min each)",
  "Priority response within 4 business hours",
  "Access to all M365 service areas",
  "Monthly written progress report",
  "Proactive tenant health monitoring",
];

const WHO_ITS_FOR = [
  "Organizations mid-way through an M365 modernization or Copilot rollout who need hands-on direction every week",
  "IT teams managing complex SharePoint, Teams, or Power Platform projects that require frequent expert input",
  "Companies that have outgrown ad-hoc consulting and need consistent, predictable access to a senior architect",
  "Organizations planning a governance overhaul, security hardening, or licence optimization initiative",
];

const TYPICAL_MONTH = [
  { week: "Week 1", activity: "Kick-off strategy call (60 min) to review open workstreams, agree on this month's priorities, and surface any tenant alerts from proactive health monitoring." },
  { week: "Week 2", activity: "Deep-dive execution: architecture design, roadmap documentation, Copilot adoption framework, governance policy set, or SharePoint information architecture sprint." },
  { week: "Week 3", activity: "Mid-month check-in call (60 min) to course-correct, review outputs, and handle anything urgent that came up — policy questions, licence changes, security incidents." },
  { week: "Week 4", activity: "Completion and wrap-up: finalise deliverables, draft the monthly progress report, and log recommendations for the next month's sprint." },
];

const TIERS = [
  { name: "Architect Essentials", price: "$1,500", hours: "10 hrs/mo", href: "/retainers/architect-essentials", current: false },
  { name: "Architect Growth", price: "$3,000", hours: "25 hrs/mo", href: "/retainers/architect-growth", current: true },
  { name: "Architect Enterprise", price: "$5,500", hours: "50 hrs/mo", href: "/retainers/architect-enterprise", current: false },
];

export default function ArchitectGrowth() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: "Architect Growth Retainer",
    description:
      "25 hours/month of senior Microsoft 365 consulting — two strategy calls, priority 4-hour response, proactive tenant health monitoring, and monthly progress reports for organizations actively modernizing.",
    price: "3000.00",
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: "3000.00",
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
        title="Architect Growth Retainer — $3,000/mo | Shane McCaw Consulting"
        description="25 hours/month of senior M365 consulting with priority 4-hour response, two strategy calls, and proactive tenant health monitoring. Best for organizations actively modernizing."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/pricing#retainers" className="hover:text-[#0078D4] transition-colors">Retainer Plans</Link>
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
            Architect Growth
          </h1>
          <p className="text-[#00B4D8] text-5xl font-extrabold mb-2">$3,000</p>
          <p className="text-white/50 mb-6 text-lg">/month · cancel with 30 days' notice</p>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Right for organizations actively modernizing their M365 environment or planning a Copilot deployment. You get 25 dedicated hours, two strategy calls, priority 4-hour response, and proactive monitoring of your tenant — so nothing falls through the cracks.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book?plan=architect-growth" className="px-8 py-4 text-base">
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
            Architect Growth is the right fit if any of these describe your organization:
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

      {/* Tier nudges */}
      <section className="bg-[#F7F9FC] py-14 px-6">
        <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Lighter workload?</p>
            <h3 className="text-lg font-extrabold text-[#0A2540] mb-2">Architect Essentials — $1,500/mo</h3>
            <p className="text-muted-foreground text-sm mb-4">
              10 hours/month with a monthly strategy call and async support. Great if your environment is stable.
            </p>
            <Link href="/retainers/architect-essentials" className="inline-flex items-center gap-2 text-[#0078D4] font-semibold text-sm hover:text-[#005A9E] transition-colors">
              See Architect Essentials <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="bg-white rounded-2xl border border-border p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Need full dedication?</p>
            <h3 className="text-lg font-extrabold text-[#0A2540] mb-2">Architect Enterprise — $5,500/mo</h3>
            <p className="text-muted-foreground text-sm mb-4">
              50 hours/month with weekly calls, same-day emergency response, and a custom technology roadmap.
            </p>
            <Link href="/retainers/architect-enterprise" className="inline-flex items-center gap-2 text-[#0078D4] font-semibold text-sm hover:text-[#005A9E] transition-colors">
              See Architect Enterprise <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-[700px] mx-auto">
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready to accelerate your M365 programme?</h2>
          <p className="text-white/60 mb-8 text-lg">
            Book your onboarding call. Shane will confirm priorities, set up your first sprint, and get monitoring running on your tenant within the first week.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book?plan=architect-growth" className="px-8 py-4 text-base">
              Start This Plan — $3,000/mo
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
