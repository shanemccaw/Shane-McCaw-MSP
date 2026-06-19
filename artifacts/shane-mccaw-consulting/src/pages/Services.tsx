import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ServiceCard } from "@/components/ServiceCard";
import { Cloud, Bot, Layout as LayoutIcon, Zap, Shield, Server, ArrowRight, type LucideIcon } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { useServices } from "@/hooks/useServices";

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud,
  Bot,
  Layout: LayoutIcon,
  Zap,
  Shield,
  Server,
};

export default function Services() {
  const { services, loading } = useServices("service_area");

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Consulting Services | Shane McCaw Consulting"
        description="Explore Shane McCaw's Microsoft 365, Copilot AI, SharePoint, Power Platform, governance, and cloud migration consulting services. Senior-level expertise, delivered personally."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          "name": "Shane McCaw Consulting",
          "url": "https://shanemccaw.com/services",
          "description": "Microsoft 365, Copilot AI, SharePoint, Power Platform, governance, and cloud migration consulting services by Shane McCaw.",
          "founder": { "@type": "Person", "name": "Shane McCaw" },
          "areaServed": "US",
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Microsoft 365 Consulting Services",
            "itemListElement": services.map((s) => ({
              "@type": "Offer",
              "itemOffered": { "@type": "Service", "name": s.name, "url": `https://shanemccaw.com${s.pageHref ?? ""}` }
            }))
          }
        }}
      />
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Services</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            The Complete Microsoft Ecosystem Practice
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            From tenant architecture to Copilot AI deployment, from SharePoint intranets to governance frameworks — Shane McCaw Consulting covers the full Microsoft 365 stack, handled personally by a 30-year veteran.
          </p>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          {loading && services.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-border p-8 h-52 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((s, i) => {
                const Icon = (s.iconName ? ICON_MAP[s.iconName] : null) ?? Cloud;
                return (
                  <ServiceCard
                    key={s.slug ?? i}
                    icon={Icon}
                    title={s.name}
                    description={s.description ?? ""}
                    href={s.pageHref ?? "/services"}
                    data-testid={`service-card-${i}`}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-8 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
            <div>
              <h3 className="text-xl font-bold text-[#0A2540] mb-2">Not sure where to start?</h3>
              <p className="text-foreground">
                The M365 Health Check ($497) is the fastest way to get clarity. Or start a retainer directly — no sales calls required.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
              <CTAButton href="/crm/portal/onboarding/select" className="text-sm whitespace-nowrap" data-testid="services-get-started-link">
                Get Started
              </CTAButton>
              <Link href="/micro-offers" className="inline-flex items-center justify-center border border-[#0078D4] text-[#0078D4] font-semibold px-5 py-2.5 rounded hover:bg-[#0078D4] hover:text-white transition-colors text-sm whitespace-nowrap" data-testid="services-micro-offers-link">
                View Quick Wins
              </Link>
              <Link href="/book" className="inline-flex items-center justify-center border border-[#0078D4] text-[#0078D4] font-semibold px-5 py-2.5 rounded hover:bg-[#0078D4] hover:text-white transition-colors text-sm whitespace-nowrap" data-testid="services-book-link">
                Book Free Call <ArrowRight className="ml-1 w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
      <ConsultationCTA />
    </Layout>
  );
}
