import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";
import { OfferCard } from "@/components/OfferCard";

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
