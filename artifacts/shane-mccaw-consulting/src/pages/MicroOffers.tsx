import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, Clock } from "lucide-react";

const offers = [
  {
    title: "M365 Health Check",
    price: "$497",
    turnaround: "2 business days",
    forWho: "Organizations unsure how well their M365 tenant is configured or who want a baseline before deeper work.",
    inclusions: [
      "90-minute live audit session via video call",
      "Review of tenant settings, security configuration, and permissions",
      "Assessment of Teams, SharePoint, OneDrive, and Exchange setup",
      "Comprehensive written report with prioritized findings",
      "30-minute debrief call to walk through recommendations",
    ],
  },
  {
    title: "Copilot Readiness Assessment",
    price: "$797",
    turnaround: "5 business days",
    forWho: "Organizations that have purchased or are considering Microsoft Copilot licenses and want to ensure safe, successful deployment.",
    inclusions: [
      "Full audit of data governance, sensitivity labels, and DLP policies",
      "Review of SharePoint permissions and oversharing risks",
      "Licensing review and optimization recommendations",
      "Copilot deployment readiness score with findings report",
      "Custom deployment roadmap and adoption strategy",
      "45-minute debrief and Q&A session",
    ],
  },
  {
    title: "SharePoint Intranet Blueprint",
    price: "$997",
    turnaround: "7 business days",
    forWho: "Organizations planning a new SharePoint intranet or needing to redesign an existing one that isn't working.",
    inclusions: [
      "Discovery session to understand organizational structure and needs",
      "Information architecture design",
      "Site map and navigation strategy",
      "Taxonomy and metadata framework",
      "Wireframe for key page types",
      "Written blueprint document with implementation guidance",
    ],
  },
  {
    title: "Power Automate Quick Win",
    price: "$597",
    turnaround: "5–7 business days",
    forWho: "Organizations with a specific manual process they want to automate using Power Automate.",
    inclusions: [
      "Discovery call to document the target process",
      "Design and build of one Power Automate flow",
      "Testing and error handling configuration",
      "Documentation and knowledge transfer",
      "30-day email support post-delivery",
    ],
  },
  {
    title: "M365 Security & Governance Audit",
    price: "$897",
    turnaround: "5 business days",
    forWho: "Organizations in regulated industries or those who've experienced a security incident and need a compliance assessment.",
    inclusions: [
      "Full review of DLP policies, sensitivity labels, and retention",
      "Conditional access policy audit",
      "Admin role and permissions review",
      "Guest access and external sharing assessment",
      "Purview compliance posture review",
      "Prioritized remediation report",
    ],
  },
  {
    title: "Copilot Prompt Library Build",
    price: "$397",
    turnaround: "5 business days",
    forWho: "Organizations that have deployed Copilot but are struggling with adoption because employees don't know how to use it effectively.",
    inclusions: [
      "Discovery call to understand your team's key use cases",
      "Custom library of 25+ role-specific Copilot prompts",
      "Prompts organized by department and task type",
      "Formatted as a sharable, editable document",
      "Tips for prompt refinement and iteration",
    ],
  },
];

export default function MicroOffers() {
  return (
    <Layout>
      <SEOMeta
        title="Quick Win Packages — Fixed Price Microsoft 365 Services | Shane McCaw Consulting"
        description="Fixed-price Microsoft 365 quick-win packages by Shane McCaw. Clear scope, flat fees, and senior-level delivery — starting at $1,500. No hourly billing surprises."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          "name": "Fixed-Price Microsoft 365 Quick-Win Packages",
          "description": "Fixed-price Microsoft 365 consulting packages by Shane McCaw. Clear scope, defined deliverables, no hourly billing.",
          "url": "https://shanemccaw.com/micro-offers",
          "itemListElement": [
            {
              "@type": "ListItem",
              "position": 1,
              "item": {
                "@type": "Offer",
                "name": "M365 Health Check",
                "price": "497",
                "priceCurrency": "USD",
                "seller": { "@type": "Person", "name": "Shane McCaw" }
              }
            },
            {
              "@type": "ListItem",
              "position": 2,
              "item": {
                "@type": "Offer",
                "name": "Copilot Readiness Assessment",
                "price": "797",
                "priceCurrency": "USD",
                "seller": { "@type": "Person", "name": "Shane McCaw" }
              }
            },
            {
              "@type": "ListItem",
              "position": 3,
              "item": {
                "@type": "Offer",
                "name": "SharePoint Intranet Blueprint",
                "price": "997",
                "priceCurrency": "USD",
                "seller": { "@type": "Person", "name": "Shane McCaw" }
              }
            },
            {
              "@type": "ListItem",
              "position": 4,
              "item": {
                "@type": "Offer",
                "name": "Power Automate Quick Win",
                "price": "597",
                "priceCurrency": "USD",
                "seller": { "@type": "Person", "name": "Shane McCaw" }
              }
            },
            {
              "@type": "ListItem",
              "position": 5,
              "item": {
                "@type": "Offer",
                "name": "M365 Security & Governance Audit",
                "price": "897",
                "priceCurrency": "USD",
                "seller": { "@type": "Person", "name": "Shane McCaw" }
              }
            },
            {
              "@type": "ListItem",
              "position": 6,
              "item": {
                "@type": "Offer",
                "name": "Copilot Prompt Library Build",
                "price": "397",
                "priceCurrency": "USD",
                "seller": { "@type": "Person", "name": "Shane McCaw" }
              }
            }
          ]
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {offers.map((offer, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300" data-testid={`offer-card-${i}`}>
                <div className="mb-6">
                  <p className="text-[#0078D4] text-4xl font-extrabold mb-1">{offer.price}</p>
                  <h3 className="text-xl font-bold text-[#0A2540]">{offer.title}</h3>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
                  <Clock className="w-4 h-4 text-[#0078D4]" />
                  <span>Turnaround: {offer.turnaround}</span>
                </div>

                <p className="text-sm text-muted-foreground italic mb-4 leading-relaxed">
                  For: {offer.forWho}
                </p>

                <div className="border-t border-border pt-4 mb-6 flex-grow">
                  <p className="text-sm font-semibold text-[#0A2540] mb-3">What's Included:</p>
                  <ul className="space-y-2">
                    {offer.inclusions.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-foreground" data-testid={`offer-${i}-inclusion-${j}`}>
                        <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <CTAButton href="/book" className="w-full justify-center text-sm" data-testid={`offer-cta-${i}`}>
                  Get Started
                </CTAButton>
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
