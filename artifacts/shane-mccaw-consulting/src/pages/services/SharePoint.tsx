import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Layout as LayoutIcon, CheckCircle, ArrowRight } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";
export default function SharePoint() {
  const price = "Contact for pricing";
  const loading = false;
  return (
    <Layout>
      <SEOMeta
        title="SharePoint Architecture & Modern Intranets | Shane McCaw Consulting"
        description="SharePoint architecture and modern intranet design by Shane McCaw. 30 years of Microsoft expertise, delivering intranets that employees actually use and IT can govern."
        ogImage="/og-image-sharepoint.png"
        ogUrl="https://shanemccawconsulting.com/services/sharepoint"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "SharePoint Architecture & Modern Intranets",
          "description": "SharePoint architecture and modern intranet design by Shane McCaw. 30 years of Microsoft expertise, delivering intranets that employees actually use and IT can govern.",
          "url": "https://shanemccawconsulting.com/services/sharepoint",
          "serviceType": "SharePoint Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States"
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "Enterprise IT teams and organizations building or modernizing SharePoint intranets"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          },
          "offers": [
            {
              "@type": "Offer",
              "name": "SharePoint Intranet Blueprint",
              "price": "997",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/micro-offers"
            }
          ]
        }}
      />
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <LayoutIcon className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Service</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            SharePoint Architecture & Modern Intranets
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl">
            Most SharePoint intranets fail because they were built without a coherent architecture. Shane designs and builds intranets that employees actually use.
          </p>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Scope</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">What's Included</h2>
              <ul className="space-y-4">
                {[
                  "Modern intranet design using SharePoint hub architecture",
                  "Information architecture planning and documentation",
                  "Taxonomy and metadata framework design",
                  "Global and local navigation strategy",
                  "Search configuration and relevance tuning",
                  "Permissions governance model",
                  "Legacy SharePoint migration planning and execution",
                  "Department and team site templates",
                  "Home page and key page design",
                  "User training and adoption plan",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-6">
              <div className="bg-[#F7F9FC] rounded-xl border border-border p-6">
                <h3 className="font-bold text-[#0A2540] text-lg mb-3">The Architecture-First Approach</h3>
                <p className="text-muted-foreground leading-relaxed">Most SharePoint implementations jump straight to building without a clear information architecture. The result is a site that looks fine at launch and becomes unusable within six months. Shane starts with IA — understanding your organization's structure, content types, and user journeys — before writing a single line of configuration.</p>
              </div>
              <div className="bg-[#F7F9FC] rounded-xl border border-border p-6">
                <h3 className="font-bold text-[#0A2540] text-lg mb-3">Intranets Employees Actually Use</h3>
                <p className="text-muted-foreground leading-relaxed">The measure of a successful intranet isn't launch day traffic — it's whether employees use it six months later. Shane designs for real usage patterns: fast search, logical navigation, and content that's actually findable.</p>
              </div>
              <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-6">
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-wide mb-2">Quick Win</p>
                <h4 className="font-bold text-[#0A2540] mb-1">SharePoint Intranet Blueprint — $997</h4>
                <p className="text-muted-foreground text-sm">Architecture plan, sitemap, taxonomy, and wireframe. The blueprint for your intranet in 7 business days.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Get Started CTA */}
      <section className="bg-[#F7F9FC] py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0A2540] rounded-3xl p-10 md:p-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="flex-1">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-wide mb-3">Monthly Retainer</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-3">Ready to get started?</h2>
              <p className="text-white/70 text-base max-w-md">
                Ongoing SharePoint architecture, intranet design, and governance consulting. Monthly strategy calls and IA review. Cancel any time.
              </p>
            </div>
            <div className="flex flex-col items-start md:items-end gap-4">
              <div>
                <span className="text-3xl font-extrabold text-white">
                  {loading ? (
                    <span className="inline-block h-9 w-24 rounded bg-white/20 animate-pulse align-middle" aria-hidden="true" />
                  ) : (
                    price
                  )}
                </span>
                <span className="text-lg font-normal text-white/60">/mo</span>
              </div>
              <a
                href="/crm/portal/onboarding/select?service=sharepoint-consulting"
                className="inline-flex items-center gap-2 bg-[#0078D4] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0066B8] transition-colors"
              >
                Get Started <ArrowRight className="w-4 h-4" />
              </a>
              <p className="text-white/50 text-xs">No long-term commitment required.</p>
            </div>
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
