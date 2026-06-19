import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";
import { OfferCard } from "@/components/OfferCard";
import { Lightbulb } from "lucide-react";

const TIERS = [
  {
    label: "Entry",
    color: "bg-[#0078D4]/10 text-[#0078D4] border-[#0078D4]/20",
    dotColor: "bg-[#0078D4]",
    purpose: "Establish a clear baseline — the ideal starting point before committing to larger project work.",
    offers: ["M365 Tenant Health Audit", "Migration Readiness Assessment"],
  },
  {
    label: "Core",
    color: "bg-[#00B4D8]/10 text-[#00B4D8] border-[#00B4D8]/20",
    dotColor: "bg-[#00B4D8]",
    purpose: "Targeted deliverables that solve a specific problem or unlock a key M365 capability.",
    offers: ["Power Platform Quick‑Start", "Copilot for M365 Readiness Assessment"],
  },
  {
    label: "Strategic",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    dotColor: "bg-amber-500",
    purpose: "In-depth assessments for regulated environments, compliance requirements, or complex tenant remediation.",
    offers: ["Governance Foundations Package"],
  },
];

export default function MicroOffers() {
  const { services: offers, loading } = useServices("micro_offer");

  return (
    <Layout>
      <SEOMeta
        title="Quick Win Packages — Fixed Price Microsoft 365 Services | Shane McCaw Consulting"
        description="Fixed-price Microsoft 365 quick-win packages by Shane McCaw. Clear scope, flat fees, and senior-level delivery — starting at $397. No hourly billing surprises."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          "name": "Fixed-Price Microsoft 365 Quick-Win Packages",
          "description": "Fixed-price Microsoft 365 consulting packages by Shane McCaw. Clear scope, defined deliverables, no hourly billing.",
          "url": "https://shanemccaw.com/micro-offers",
          "itemListElement": offers.map((o, i) => {
            const hasRange = o.basePrice && o.maxPrice;
            return {
              "@type": "ListItem",
              "position": i + 1,
              "item": {
                "@type": "Offer",
                "name": o.name,
                ...(hasRange
                  ? { "priceRange": formatPriceDisplay(o) }
                  : { "price": o.price ?? o.basePrice ?? "", "priceCurrency": "USD" }),
                "url": "https://shanemccawconsulting.com/micro-offers",
                "seller": { "@type": "Person", "name": "Shane McCaw" }
              }
            };
          })
        }}
      />
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Quick Wins</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Quick Win Packages — Fixed Price. Real Results. No Guesswork.
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            Not ready for a full engagement? Start with a focused, fixed-price package. Clear scope, clear deliverables, clear results.
          </p>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">

          {/* Quick Win Strategy callout */}
          <div className="mb-10 rounded-xl border border-[#0078D4]/30 bg-white p-6 flex gap-4 shadow-sm">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
              <Lightbulb className="w-5 h-5 text-[#0078D4]" />
            </div>
            <div>
              <p className="text-[#0A2540] font-bold text-base mb-1">Not sure where to start?</p>
              <p className="text-foreground text-sm leading-relaxed">
                Most clients begin with the <span className="font-semibold text-[#0A2540]">M365 Tenant Health Audit</span> or the{" "}
                <span className="font-semibold text-[#0A2540]">Migration Readiness Assessment</span>. Both deliver a clear, prioritized picture of where your environment stands — and give you an informed foundation before committing to larger project work.
              </p>
            </div>
          </div>

          {loading && offers.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-border p-8 h-96 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {offers.map((offer, i) => (
                <OfferCard key={offer.slug ?? i} offer={offer} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Tiered engagement model */}
      <section className="bg-white py-20 border-t border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Engagement Model</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">How These Offers Fit Into Your M365 Strategy</h2>
          <p className="text-muted-foreground text-base max-w-2xl mb-12 leading-relaxed">
            Each package is designed to be valuable on its own — but together they form a natural progression from baseline assessment to full strategic capability.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TIERS.map((tier) => (
              <div key={tier.label} className="rounded-xl border border-border bg-[#F7F9FC] p-6">
                <span className={`inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border mb-4 ${tier.color}`}>
                  {tier.label}
                </span>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{tier.purpose}</p>
                <ul className="space-y-2.5">
                  {tier.offers.map((name) => (
                    <li key={name} className="flex items-center gap-2.5 text-sm text-[#0A2540] font-medium">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tier.dotColor}`} />
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Not sure which package fits?</h2>
          <p className="text-white/70 max-w-xl mx-auto mb-8">Book a free 30-minute call and Shane will tell you exactly which package — if any — is the right starting point for your situation.</p>
          <CTAButton href="/book" className="px-10 py-4 text-base" data-testid="micro-offers-final-cta">
            Book a Free Discovery Call
          </CTAButton>
        </div>
      </section>
    </Layout>
  );
}
