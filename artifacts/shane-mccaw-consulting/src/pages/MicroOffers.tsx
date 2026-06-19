import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, Clock } from "lucide-react";
import { useServices, formatPrice, type PublicService } from "@/hooks/useServices";

const FALLBACK_OFFERS: PublicService[] = [
  { id: 0, slug: "m365-health-check", name: "M365 Health Check", price: "497.00", turnaround: "2 business days", serviceType: "micro_offer", billingType: "one_time", description: null, deliverables: "Written audit report + remediation priority list", targetAudience: "Organizations unsure how well their M365 tenant is configured or who want a baseline before deeper work.", inclusions: ["90-minute live audit session via video call","Review of tenant settings, security configuration, and permissions","Assessment of Teams, SharePoint, OneDrive, and Exchange setup","Comprehensive written report with prioritized findings","30-minute debrief call to walk through recommendations"], category: null, badge: null, highlighted: false, hoursPerMonth: null, iconName: null, pageHref: null, sortOrder: 0, features: null, tagline: null },
  { id: 0, slug: "copilot-readiness", name: "Copilot Readiness Assessment", price: "797.00", turnaround: "5 business days", serviceType: "micro_offer", billingType: "one_time", description: null, deliverables: "Readiness scorecard + deployment roadmap", targetAudience: "Organizations that have purchased or are considering Microsoft Copilot licenses and want to ensure safe, successful deployment.", inclusions: ["Full audit of data governance, sensitivity labels, and DLP policies","Review of SharePoint permissions and oversharing risks","Licensing review and optimization recommendations","Copilot deployment readiness score with findings report","Custom deployment roadmap and adoption strategy","45-minute debrief and Q&A session"], category: null, badge: "Most requested", highlighted: false, hoursPerMonth: null, iconName: null, pageHref: null, sortOrder: 1, features: null, tagline: null },
  { id: 0, slug: "sharepoint-blueprint", name: "SharePoint Intranet Blueprint", price: "997.00", turnaround: "7 business days", serviceType: "micro_offer", billingType: "one_time", description: null, deliverables: "IA document + governance policy + rollout plan", targetAudience: "Organizations planning a new SharePoint intranet or needing to redesign an existing one that isn't working.", inclusions: ["Discovery session to understand organizational structure and needs","Information architecture design","Site map and navigation strategy","Taxonomy and metadata framework","Wireframe for key page types","Written blueprint document with implementation guidance"], category: null, badge: null, highlighted: false, hoursPerMonth: null, iconName: null, pageHref: null, sortOrder: 2, features: null, tagline: null },
  { id: 0, slug: "power-automate", name: "Power Automate Quick Win", price: "597.00", turnaround: "5–7 business days", serviceType: "micro_offer", billingType: "one_time", description: null, deliverables: "Live flow + documentation + handoff walkthrough", targetAudience: "Organizations with a specific manual process they want to automate using Power Automate.", inclusions: ["Discovery call to document the target process","Design and build of one Power Automate flow","Testing and error handling configuration","Documentation and knowledge transfer","30-day email support post-delivery"], category: null, badge: null, highlighted: false, hoursPerMonth: null, iconName: null, pageHref: null, sortOrder: 3, features: null, tagline: null },
  { id: 0, slug: "security-audit", name: "M365 Security & Governance Audit", price: "897.00", turnaround: "5 business days", serviceType: "micro_offer", billingType: "one_time", description: null, deliverables: "Security audit report + DLP/retention gap analysis", targetAudience: "Organizations in regulated industries or those who've experienced a security incident and need a compliance assessment.", inclusions: ["Full review of DLP policies, sensitivity labels, and retention","Conditional access policy audit","Admin role and permissions review","Guest access and external sharing assessment","Purview compliance posture review","Prioritized remediation report"], category: null, badge: null, highlighted: false, hoursPerMonth: null, iconName: null, pageHref: null, sortOrder: 4, features: null, tagline: null },
  { id: 0, slug: "copilot-prompts", name: "Copilot Prompt Library Build", price: "397.00", turnaround: "5 business days", serviceType: "micro_offer", billingType: "one_time", description: null, deliverables: "Role-specific prompt library (Word + SharePoint-ready)", targetAudience: "Organizations that have deployed Copilot but are struggling with adoption because employees don't know how to use it effectively.", inclusions: ["Discovery call to understand your team's key use cases","Custom library of 25+ role-specific Copilot prompts","Prompts organized by department and task type","Formatted as a sharable, editable document","Tips for prompt refinement and iteration"], category: null, badge: null, highlighted: false, hoursPerMonth: null, iconName: null, pageHref: null, sortOrder: 5, features: null, tagline: null },
];

function OfferCard({ offer, index }: { offer: PublicService; index: number }) {
  const price = formatPrice(offer.price) ?? offer.price ?? "$?";
  const inclusions = offer.inclusions ?? [];

  return (
    <div
      className="bg-white rounded-xl border border-border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
      data-testid={`offer-card-${index}`}
    >
      <div className="mb-6">
        <p className="text-[#0078D4] text-4xl font-extrabold mb-1">{price}</p>
        <h3 className="text-xl font-bold text-[#0A2540]">{offer.name}</h3>
      </div>

      <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
        <Clock className="w-4 h-4 text-[#0078D4]" />
        <span>Turnaround: {offer.turnaround ?? "TBD"}</span>
      </div>

      {offer.targetAudience && (
        <p className="text-sm text-muted-foreground italic mb-4 leading-relaxed">
          For: {offer.targetAudience}
        </p>
      )}

      <div className="border-t border-border pt-4 mb-6 flex-grow">
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

      <CTAButton href={`/crm/portal/onboarding/select?service=${offer.slug ?? ""}`} className="w-full justify-center text-sm" data-testid={`offer-cta-${index}`}>
        Get Started
      </CTAButton>
    </div>
  );
}

export default function MicroOffers() {
  const { services, loading } = useServices("micro_offer");
  const offers = services.length > 0 ? services : (loading ? [] : FALLBACK_OFFERS);

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
          "itemListElement": offers.map((o, i) => ({
            "@type": "ListItem",
            "position": i + 1,
            "item": {
              "@type": "Offer",
              "name": o.name,
              "price": o.price ?? "",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/micro-offers",
              "seller": { "@type": "Person", "name": "Shane McCaw" }
            }
          }))
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
