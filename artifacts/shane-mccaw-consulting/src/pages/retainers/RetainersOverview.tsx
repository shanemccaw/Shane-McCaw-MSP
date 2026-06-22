import { CheckCircle, Clock, ArrowRight, ChevronRight, Zap } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";

const PLANS = [
  {
    name: "Architect Essentials",
    price: "$1,500",
    hours: "10 hours / month",
    description:
      "Expert M365 oversight on demand — ideal for stable environments that need a senior architect available without a full-time hire.",
    features: [
      "10 hours of consulting per month",
      "Email and Teams support",
      "Monthly strategy call (60 min)",
      "Standard response within 1 business day",
      "Access to all M365 service areas",
      "Monthly written summary",
    ],
    href: "/retainers/architect-essentials",
    bookHref: "/book?plan=architect-essentials",
    highlight: false,
    badge: null,
  },
  {
    name: "Architect Growth",
    price: "$3,000",
    hours: "25 hours / month",
    description:
      "For organizations actively modernizing — more hours, faster response, and proactive monitoring keep your project moving every week.",
    features: [
      "25 hours of consulting per month",
      "Priority 4-hour response time",
      "Two strategy calls per month (60 min each)",
      "Proactive tenant health monitoring",
      "Power Platform & Copilot advisory",
      "Monthly written summary + roadmap",
    ],
    href: "/retainers/architect-growth",
    bookHref: "/book?plan=architect-growth",
    highlight: true,
    badge: "Most Popular",
  },
  {
    name: "Architect Enterprise",
    price: "$6,000",
    hours: "60 hours / month",
    description:
      "Full embedded-architect coverage for complex enterprises — deep delivery, weekly calls, and a dedicated Slack channel.",
    features: [
      "60 hours of consulting per month",
      "Priority same-day response",
      "Weekly strategy calls (60 min each)",
      "Dedicated Slack/Teams channel",
      "Hands-on governance & security builds",
      "Quarterly executive briefing",
    ],
    href: "/retainers/architect-enterprise",
    bookHref: "/book?plan=architect-enterprise",
    highlight: false,
    badge: "Most Comprehensive",
  },
];

const FAQS = [
  {
    q: "Can I change plans after I start?",
    a: "Yes. You can upgrade or downgrade with 30 days' notice. Shane will prorate any balance so you're never paying for hours you haven't used.",
  },
  {
    q: "Do unused hours roll over?",
    a: "Hours reset each month — they don't roll over. This keeps Shane's schedule predictable and ensures every client gets focused attention.",
  },
  {
    q: "What counts as a consulting hour?",
    a: "Everything: strategy calls, async Q&A, document or architecture reviews, hands-on configuration, and written deliverables. Shane tracks time transparently in a shared log.",
  },
  {
    q: "Is there a minimum commitment?",
    a: "No minimum term. Cancel or pause with 30 days' written notice and you're done — no lock-in, no cancellation fees.",
  },
];

export default function RetainersOverview() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Microsoft 365 Architect Retainer Plans",
    description:
      "Monthly retainer plans giving you ongoing access to Shane McCaw, Lead Microsoft 365 Architect at NASA — from 10 to 60 hours per month.",
    provider: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Retainer Plans",
      itemListElement: PLANS.map((p, i) => ({
        "@type": "Offer",
        position: i + 1,
        name: p.name,
        price: p.price.replace("$", ""),
        priceCurrency: "USD",
        url: `https://shanemccaw.com${p.href}`,
      })),
    },
  };

  return (
    <Layout>
      <SEOMeta
        title="M365 Architect Retainer Plans | Shane McCaw Consulting"
        description="Monthly Microsoft 365 retainer plans — 10, 25, or 60 hours of senior consulting per month. Strategy calls, async support, proactive monitoring, and full-stack M365 expertise."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/pricing" className="hover:text-[#0078D4] transition-colors">Pricing</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#0A2540] font-medium">Retainer Plans</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-[#0A2540] pt-16 pb-20 px-6 text-center">
        <div className="max-w-[800px] mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Zap className="w-3.5 h-3.5 text-[#00B4D8]" />
            Ongoing Expert Access
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
            A Senior M365 Architect<br className="hidden sm:block" /> in Your Corner Every Month
          </h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            Choose the engagement level that fits your pace. All plans include strategy calls, async support, and a monthly written summary — no retainer lock-in, cancel with 30 days' notice.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-white/50">
            <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-[#00B4D8]" /> No minimum term</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-[#00B4D8]" /> Transparent hour tracking</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-[#00B4D8]" /> NASA-level expertise</span>
          </div>
        </div>
      </section>

      {/* Plan comparison cards */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-2xl border ${
                  plan.highlight
                    ? "border-[#0078D4] bg-white shadow-xl ring-2 ring-[#0078D4]/20"
                    : "border-border bg-white shadow-sm"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-[#0078D4] text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="p-8 pb-6 border-b border-border">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-[#00B4D8]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#00B4D8]">{plan.hours}</span>
                  </div>
                  <h2 className="text-xl font-extrabold text-[#0A2540] mb-1">{plan.name}</h2>
                  <p className="text-[#0078D4] text-4xl font-extrabold mb-0.5">{plan.price}</p>
                  <p className="text-muted-foreground text-sm mb-4">/month · cancel with 30 days' notice</p>
                  <p className="text-foreground/70 text-sm leading-relaxed">{plan.description}</p>
                </div>

                <div className="p-8 flex-1 flex flex-col">
                  <ul className="space-y-3 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 flex flex-col gap-3">
                    <CTAButton href={plan.bookHref} className={`w-full justify-center ${plan.highlight ? "" : "bg-[#0A2540] hover:bg-[#0A2540]/90"}`}>
                      Start This Plan
                    </CTAButton>
                    <Link
                      href={plan.href}
                      className="flex items-center justify-center gap-1.5 text-sm text-[#0078D4] font-medium hover:text-[#005A9E] transition-colors"
                    >
                      See full details <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">How retainers work</h2>
          <p className="text-muted-foreground mb-12 max-w-xl mx-auto">
            A retainer gives you a reserved block of Shane's time each month — no need to scope a project or wait for a proposal.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
            {[
              { step: "1", title: "Book your onboarding call", body: "Shane reviews your tenant, understands your goals, and sets the first month's priorities in one focused call." },
              { step: "2", title: "Work happens async + on calls", body: "Hours are used across strategy calls, async Q&A, architecture reviews, and hands-on configuration — tracked transparently." },
              { step: "3", title: "Monthly summary delivered", body: "At month-end you receive a written summary: what was done, recommendations, and flagged risks. Renews automatically." },
            ].map((item) => (
              <div key={item.step} className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
                <div className="w-9 h-9 rounded-full bg-[#0078D4] flex items-center justify-center mb-4">
                  <span className="text-white text-sm font-bold">{item.step}</span>
                </div>
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[800px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-10 text-center">Frequently asked questions</h2>
          <div className="space-y-5">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-6 shadow-sm">
                <h3 className="font-bold text-[#0A2540] mb-2">{faq.q}</h3>
                <p className="text-foreground/70 text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-[700px] mx-auto">
          <h2 className="text-3xl font-extrabold text-white mb-4">Not sure which plan fits?</h2>
          <p className="text-white/60 mb-8 text-lg">
            Book a free 30-minute discovery call. Shane will ask a few questions about your environment and recommend the right tier — no pressure, no obligation.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book" className="px-8 py-4 text-base">Book a Free Discovery Call</CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/70 hover:text-white font-medium text-base transition-colors"
            >
              Send Shane a message <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
