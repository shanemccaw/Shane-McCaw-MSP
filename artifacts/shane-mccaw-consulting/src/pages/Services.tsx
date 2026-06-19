import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ServiceCard } from "@/components/ServiceCard";
import { Cloud, Bot, Layout as LayoutIcon, Zap, Shield, Server, ArrowRight } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";

const services = [
  {
    icon: Cloud,
    title: "Microsoft 365 Setup & Optimization",
    description: "Whether starting fresh or fixing a misconfigured tenant, I architect M365 environments that are secure, scalable, and built for your team.",
    href: "/services/microsoft-365",
  },
  {
    icon: Bot,
    title: "Copilot AI Readiness & Deployment",
    description: "I assess readiness, govern your data, configure your environment, and coach your team so your Copilot investment pays off from day one.",
    href: "/services/copilot-ai",
  },
  {
    icon: LayoutIcon,
    title: "SharePoint Architecture & Intranets",
    description: "Modern intranets employees actually use — built with expert information architecture, navigation, and taxonomy design.",
    href: "/services/sharepoint",
  },
  {
    icon: Zap,
    title: "Power Platform & Automation",
    description: "Replace manual processes with Power Automate workflows and custom Power Apps at a fraction of traditional development cost.",
    href: "/services/power-platform",
  },
  {
    icon: Shield,
    title: "Governance, Compliance & Security",
    description: "DLP policies, sensitivity labels, retention, Purview, and permissions built to NASA-grade standards.",
    href: "/services/governance",
  },
  {
    icon: Server,
    title: "Cloud Migration Services",
    description: "Exchange, SharePoint, and M365 migrations executed with zero-drama precision and zero data loss.",
    href: "/services/cloud-migration",
  },
];

export default function Services() {
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
            "itemListElement": [
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Microsoft 365 Consulting", "url": "https://shanemccaw.com/services/microsoft-365" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Copilot AI Readiness & Deployment", "url": "https://shanemccaw.com/services/copilot-ai" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "SharePoint Architecture & Intranet Design", "url": "https://shanemccaw.com/services/sharepoint" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Power Platform Development", "url": "https://shanemccaw.com/services/power-platform" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Governance, Risk & Compliance", "url": "https://shanemccaw.com/services/governance" } },
              { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Cloud Migration", "url": "https://shanemccaw.com/services/cloud-migration" } }
            ]
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {services.map((s, i) => (
              <ServiceCard key={i} {...s} data-testid={`service-card-${i}`} />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-8 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
            <div>
              <h3 className="text-xl font-bold text-[#0A2540] mb-2">Not sure where to start?</h3>
              <p className="text-foreground">
                The M365 Health Check ($497) is the fastest way to get clarity. Or book a free discovery call and Shane will tell you exactly what your situation needs.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
              <CTAButton href="/micro-offers" className="text-sm whitespace-nowrap" data-testid="services-micro-offers-link">
                View Quick Wins
              </CTAButton>
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
