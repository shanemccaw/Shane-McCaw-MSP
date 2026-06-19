import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle, Clock, Sparkles, Cloud, Bot, Shield, Zap, Server, Users,
  Layout as LayoutIcon, type LucideIcon
} from "lucide-react";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Shield, Zap, Server, Users, Layout: LayoutIcon, Sparkles,
};

const BADGE_COLORS: Record<string, string> = {
  Popular: "bg-[#0078D4]/10 text-[#0078D4]",
  New: "bg-emerald-100 text-emerald-700",
  "Best Value": "bg-amber-100 text-amber-700",
  Featured: "bg-purple-100 text-purple-700",
};

function badgeClass(badge: string): string {
  return BADGE_COLORS[badge] ?? "bg-[#0078D4]/10 text-[#0078D4]";
}

function OfferCard({ offer, index }: { offer: PublicService; index: number }) {
  const Icon = (offer.iconName ? ICON_MAP[offer.iconName] : null) ?? Sparkles;
  const priceDisplay = formatPriceDisplay(offer);
  const inclusions = offer.inclusions ?? [];
  const features = offer.features ?? [];
  const billingLabel = offer.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time";

  return (
    <div
      className="bg-white rounded-xl border border-border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
      data-testid={`offer-card-${index}`}
    >
      {/* 1. Header row — icon + badge */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[#0078D4]" />
        </div>
        {offer.badge && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badgeClass(offer.badge)}`}>
            {offer.badge}
          </span>
        )}
      </div>

      {/* 2. Category */}
      {offer.category && (
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
          {offer.category}
        </p>
      )}

      {/* 3. Price */}
      <p className="text-[#0078D4] text-3xl font-extrabold mb-1" data-testid={`offer-price-${index}`}>
        {priceDisplay}
      </p>

      {/* 4. Title */}
      <h3 className="text-xl font-bold text-[#0A2540] mb-1">{offer.name}</h3>

      {/* 5. Tagline */}
      {offer.tagline && (
        <p className="text-sm italic text-muted-foreground mb-3">{offer.tagline}</p>
      )}

      {/* 6. Description */}
      {offer.description && (
        <p className="text-sm text-foreground leading-relaxed mb-4">{offer.description}</p>
      )}

      {/* 7. Meta row — turnaround + billing type */}
      <div className="flex flex-wrap gap-3 mb-4">
        {offer.turnaround && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-[#F7F9FC] px-3 py-1.5 rounded-full border border-border">
            <Clock className="w-3.5 h-3.5 text-[#0078D4]" />
            {offer.turnaround}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-[#F7F9FC] px-3 py-1.5 rounded-full border border-border">
          {billingLabel}
        </span>
      </div>

      {/* 8. Target audience */}
      {offer.targetAudience && (
        <p className="text-sm text-muted-foreground italic mb-4">
          <span className="font-semibold not-italic text-[#0A2540]">Best for:</span> {offer.targetAudience}
        </p>
      )}

      {/* 9. Deliverables */}
      {offer.deliverables && (
        <p className="text-sm text-muted-foreground mb-4">
          <span className="font-semibold text-[#0A2540]">Deliverables:</span> {offer.deliverables}
        </p>
      )}

      {/* 10. What's included (inclusions checklist) */}
      {inclusions.length > 0 && (
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-3">What's Included:</p>
          <ul className="space-y-2">
            {inclusions.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-foreground" data-testid={`offer-${index}-inclusion-${j}`}>
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 11. Features (secondary bullet list, only if different from inclusions) */}
      {features.length > 0 && features !== offer.inclusions && (
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-3">Features:</p>
          <ul className="space-y-1.5">
            {features.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`offer-${index}-feature-${j}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Spacer to push CTA to bottom */}
      <div className="flex-grow" />

      {/* 12. CTA */}
      <CTAButton
        href={`/crm/portal/onboarding/select?service=${offer.slug ?? ""}`}
        className="w-full justify-center text-sm mt-6"
        data-testid={`offer-cta-${index}`}
      >
        Get Started
      </CTAButton>
    </div>
  );
}

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
