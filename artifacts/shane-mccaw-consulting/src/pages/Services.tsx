import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  Cloud, Bot, Layout as LayoutIcon, Zap, Shield, Server, Users, ArrowRight,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award, Sparkles,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock, type LucideIcon
} from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Layout: LayoutIcon, Zap, Shield, Server, Users, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock,
};

function resolveIcon(name: string | null, fallback: LucideIcon = Cloud): LucideIcon {
  if (!name) return fallback;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? fallback;
}

const BADGE_COLORS: Record<string, string> = {
  Popular: "bg-[#0078D4]/10 text-[#0078D4]",
  New: "bg-emerald-100 text-emerald-700",
  "Best Value": "bg-amber-100 text-amber-700",
  Featured: "bg-purple-100 text-purple-700",
};

function badgeClass(badge: string): string {
  return BADGE_COLORS[badge] ?? "bg-[#0078D4]/10 text-[#0078D4]";
}

function ServiceDetailCard({ s, index }: { s: PublicService; index: number }) {
  const Icon = resolveIcon(s.iconName);
  const inclusions = s.inclusions ?? [];
  const features = s.features ?? [];
  const priceDisplay = formatPriceDisplay(s);
  const deliverableLines = s.deliverables
    ? s.deliverables.split("\n").filter(l => l.trim())
    : [];

  return (
    <div
      className="bg-white rounded-xl border border-border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
      data-testid={`service-card-${index}`}
    >
      {/* Header: icon + badge */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[#0078D4]" />
        </div>
        {s.badge && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badgeClass(s.badge)}`}>
            {s.badge}
          </span>
        )}
      </div>

      {/* Category */}
      {s.category && (
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">{s.category}</p>
      )}

      {/* Price */}
      {priceDisplay !== "Contact for pricing" && (
        <p className="text-[#0078D4] text-2xl font-extrabold mb-2">{priceDisplay}</p>
      )}

      {/* Name */}
      <h3 className="text-xl font-bold text-[#0A2540] leading-snug mb-2">{s.name}</h3>

      {/* Tagline */}
      {s.tagline && (
        <p className="text-sm italic text-muted-foreground mb-3">{s.tagline}</p>
      )}

      {/* Description */}
      {s.description && (
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{s.description}</p>
      )}

      {/* Meta chips */}
      {(s.turnaround || s.billingType) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {s.turnaround && (
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-[#F7F9FC] border border-border rounded-full px-2.5 py-1 text-muted-foreground">
              <Clock className="w-3 h-3" />{s.turnaround}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs font-medium bg-[#F7F9FC] border border-border rounded-full px-2.5 py-1 text-muted-foreground">
            {s.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time"}
          </span>
          {s.hoursPerMonth && (
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-[#F7F9FC] border border-border rounded-full px-2.5 py-1 text-muted-foreground">
              {s.hoursPerMonth}/mo
            </span>
          )}
        </div>
      )}

      {/* Target audience */}
      {s.targetAudience && (
        <p className="text-sm text-muted-foreground mb-4">
          <span className="font-semibold text-[#0A2540]">Best for:</span> {s.targetAudience}
        </p>
      )}

      {/* Deliverables */}
      {deliverableLines.length > 0 && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-1.5">Deliverables:</p>
          <ul className="space-y-1">
            {deliverableLines.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                {line.trim()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Inclusions */}
      {inclusions.length > 0 && (
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-3">What's Included:</p>
          <ul className="space-y-2">
            {inclusions.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Features */}
      {features.length > 0 && (
        <div className="mb-4">
          <ul className="space-y-1">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#00B4D8] flex-shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA */}
      <div className="mt-auto pt-4">
        <Link
          href={s.pageHref ?? "/book"}
          className="inline-flex items-center gap-1.5 text-[#0078D4] text-sm font-semibold hover:gap-2.5 transition-all"
          data-testid={`service-link-${index}`}
        >
          Learn More <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

export default function Services() {
  const { services, loading } = useServices("retainer");

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
          ) : services.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-12">No services published yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((s, i) => (
                <ServiceDetailCard key={s.slug ?? i} s={s} index={i} />
              ))}
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
