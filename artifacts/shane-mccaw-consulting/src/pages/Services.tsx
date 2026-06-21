import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  Cloud, Bot, Layout as LayoutIcon, Zap, Shield, Server, Users, ArrowRight,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award, Sparkles,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock, type LucideIcon,
  AlertTriangle,
} from "lucide-react";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Layout: LayoutIcon, Zap, Shield, Server, Users, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock, AlertTriangle,
};

function resolveIcon(name: string | null, fallback: LucideIcon = Cloud): LucideIcon {
  if (!name) return fallback;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? fallback;
}

const BADGE_COLORS: Record<string, string> = {
  Popular: "bg-[#0078D4]/10 text-[#0078D4]",
  "Most Popular": "bg-[#0078D4] text-white",
  New: "bg-emerald-100 text-emerald-700",
  "Best Value": "bg-amber-100 text-amber-700",
  Featured: "bg-purple-100 text-purple-700",
};

function badgeClass(badge: string): string {
  return BADGE_COLORS[badge] ?? "bg-[#0078D4]/10 text-[#0078D4]";
}

const TIER_CONFIG: Record<string, { label: string; slug: string; description: string; accent: string }> = {
  entry: {
    label: "Quick-Win Packages",
    slug: "Entry Tier",
    description: "Fast, fixed-price engagements that surface what's broken and deliver a prioritized roadmap.",
    accent: "text-emerald-700",
  },
  core: {
    label: "Governance & Readiness",
    slug: "Core Tier",
    description: "Deeper engagements that establish governance foundations and prepare your environment for Copilot AI and organizational scale.",
    accent: "text-[#0078D4]",
  },
  strategic: {
    label: "Fractional Architecture",
    slug: "Strategic Tier",
    description: "Ongoing senior M365 architecture on a monthly retainer — embedded in your operations without full-time overhead.",
    accent: "text-[#00B4D8]",
  },
};

const TIER_ORDER = ["entry", "core", "strategic"];

const CATEGORY_TO_TIER: Record<string, string> = {
  "Microsoft 365": "entry",
  "Power Platform": "entry",
  "Migration": "entry",
  "Training": "entry",
  "Copilot": "core",
  "Governance": "core",
  "Fractional Architecture": "strategic",
};

function ServiceCard({ s, index }: { s: PublicService; index: number }) {
  const Icon = resolveIcon(s.iconName);
  const inclusions = s.inclusions ?? [];
  const features = s.features ?? [];
  const priceDisplay = formatPriceDisplay(s);
  const deliverableLines = s.deliverables
    ? s.deliverables.split("\n").filter(l => l.trim())
    : [];
  const isHighlighted = s.highlighted ?? false;
  const href = s.pageHref ?? "/book";
  const ctaLabel = s.pageHref ? "Learn More" : "Book a Discovery Call";

  return (
    <div
      className={`relative rounded-xl border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 ${isHighlighted ? "bg-[#0A2540] border-[#0078D4]/60" : "bg-white border-border"}`}
      data-testid={`service-card-${index}`}
    >
      {isHighlighted && s.badge && (
        <div className="absolute -top-4 left-0 right-0 flex justify-center">
          <span className="bg-[#0078D4] text-white text-xs font-bold uppercase tracking-wider px-4 py-1.5 rounded-full">
            {s.badge}
          </span>
        </div>
      )}

      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${isHighlighted ? "bg-white/10" : "bg-[#0078D4]/10"}`}>
          <Icon className={`w-5 h-5 ${isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`} />
        </div>
        {s.badge && !isHighlighted && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badgeClass(s.badge)}`}>
            {s.badge}
          </span>
        )}
      </div>

      {priceDisplay !== "Contact for pricing" && (
        <p className={`text-2xl font-extrabold mb-2 ${isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{priceDisplay}</p>
      )}

      <h3 className={`text-xl font-bold leading-snug mb-2 ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>{s.name}</h3>

      {s.tagline && (
        <p className={`text-sm italic mb-3 ${isHighlighted ? "text-white/60" : "text-muted-foreground"}`}>{s.tagline}</p>
      )}

      {s.description && (
        <p className={`text-sm leading-relaxed mb-4 ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>{s.description}</p>
      )}

      {(s.turnaround || s.billingType || s.hoursPerMonth) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {s.turnaround && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${isHighlighted ? "bg-white/10 border border-white/20 text-[#00B4D8]" : "bg-[#F7F9FC] border border-border text-muted-foreground"}`}>
              <Clock className="w-3 h-3" /> {s.turnaround}
            </span>
          )}
          {s.hoursPerMonth && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${isHighlighted ? "bg-white/10 border border-white/20 text-[#00B4D8]" : "bg-[#F7F9FC] border border-border text-muted-foreground"}`}>
              {s.hoursPerMonth}/mo
            </span>
          )}
          <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${isHighlighted ? "bg-white/10 border border-white/20 text-white/70" : "bg-[#F7F9FC] border border-border text-muted-foreground"}`}>
            {s.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time"}
          </span>
        </div>
      )}

      {s.targetAudience && (
        <p className={`text-sm mb-4 ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>
          <span className={`font-semibold ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>Best for:</span> {s.targetAudience}
        </p>
      )}

      {inclusions.length > 0 && (
        <div className={`border-t pt-4 mb-4 ${isHighlighted ? "border-white/10" : "border-border"}`}>
          <p className={`text-sm font-semibold mb-3 ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>What's Included:</p>
          <ul className="space-y-2">
            {inclusions.map((item, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${isHighlighted ? "text-white/80" : "text-muted-foreground"}`}>
                <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {features.length > 0 && (
        <div className="mb-4">
          <ul className="space-y-1">
            {features.map((f, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#00B4D8]" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {deliverableLines.length > 0 && (
        <div className="mb-4">
          <p className={`text-sm font-semibold mb-1.5 ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>Deliverables:</p>
          <ul className="space-y-1">
            {deliverableLines.map((line, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                {line.trim()}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-4">
        <CTAButton
          href={href}
          className="w-full justify-center text-sm"
          data-testid={`service-cta-${index}`}
        >
          {ctaLabel}
        </CTAButton>
      </div>
    </div>
  );
}

function TierSection({ category, services }: { category: string; services: PublicService[] }) {
  const config = TIER_CONFIG[category] ?? {
    slug: category.charAt(0).toUpperCase() + category.slice(1),
    label: category.charAt(0).toUpperCase() + category.slice(1),
    description: "",
    accent: "text-[#0078D4]",
  };

  return (
    <section className="py-20 border-b border-border last:border-b-0">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="mb-12">
          <p className={`text-sm font-bold uppercase tracking-[0.1em] mb-3 ${config.accent}`}>
            {config.slug}
          </p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">
            {config.label}
          </h2>
          {config.description && (
            <p className="text-muted-foreground max-w-2xl leading-relaxed">{config.description}</p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
          {services.map((s, i) => (
            <ServiceCard key={s.slug ?? s.id} s={s} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ServicesSkeleton() {
  return (
    <div className="py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="h-6 w-32 bg-border rounded animate-pulse mb-4" />
        <div className="h-8 w-72 bg-border rounded animate-pulse mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-border p-8 h-80 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Services() {
  const { services, loading, error } = useServices();

  const grouped = TIER_ORDER.reduce<Record<string, PublicService[]>>((acc, tier) => {
    acc[tier] = services.filter(s => {
      const mappedTier = s.category ? (CATEGORY_TO_TIER[s.category] ?? s.category) : null;
      return mappedTier === tier;
    });
    return acc;
  }, {});

  const activeTiers = TIER_ORDER.filter(t => grouped[t].length > 0);

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Consulting Services | Shane McCaw Consulting"
        description="NASA-proven Microsoft 365 architecture, governance, automation, and AI services for mid-market and regulated organizations. Productized, predictable, and proven."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          "name": "Shane McCaw Consulting",
          "url": "https://shanemccaw.com/services",
          "description": "Microsoft 365 consulting services by Shane McCaw, NASA Lead M365 Architect. Covering Entry, Core, and Strategic tiers for mid-market and regulated organizations.",
          "founder": { "@type": "Person", "name": "Shane McCaw" },
          "areaServed": [
            { "@type": "Country", "name": "US" },
            { "@type": "AdministrativeArea", "name": "Federal Government" }
          ],
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market organizations, regulated industries, government contractors, healthcare, financial services"
          },
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Microsoft 365 Consulting Services",
            "itemListElement": services.map((s) => ({
              "@type": "Offer",
              "itemOffered": { "@type": "Service", "name": s.name }
            }))
          }
        }}
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Service Directory</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            All Microsoft 365 Services
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            A complete directory of every productized service offered by Shane McCaw Consulting.
          </p>
          <div className="mt-10">
            <CTAButton href="/book" className="text-base px-8 py-3" data-testid="hero-book-cta">
              Book a Free Discovery Call <ArrowRight className="ml-2 w-4 h-4" />
            </CTAButton>
          </div>
        </div>
      </section>

      {/* Dynamic Tier Sections */}
      {loading && services.length === 0 ? (
        <>
          <ServicesSkeleton />
          <ServicesSkeleton />
          <ServicesSkeleton />
        </>
      ) : error ? (
        <section className="py-20">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <p className="text-muted-foreground text-sm">Services are temporarily unavailable. Please try again later or <Link href="/book" className="text-[#0078D4] hover:underline">book a call</Link> directly.</p>
          </div>
        </section>
      ) : activeTiers.length === 0 ? (
        <section className="py-20">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <p className="text-muted-foreground text-sm">No services published yet. Check back soon.</p>
          </div>
        </section>
      ) : (
        <div className="bg-[#F7F9FC]">
          {activeTiers.map(tier => (
            <TierSection key={tier} category={tier} services={grouped[tier]} />
          ))}
        </div>
      )}

      {/* Closing CTA */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Ready to Get Started?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 leading-tight">
            Let's Build Something That Works at Scale
          </h2>
          <p className="text-white/70 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            No pitch. No obligation. 30 minutes with Shane to assess your environment and identify the fastest path to value.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book" className="text-base px-8 py-3" data-testid="closing-book-cta">
              Book a Free Discovery Call <ArrowRight className="ml-2 w-4 h-4" />
            </CTAButton>
            <Link
              href="/services/microsoft-365"
              className="inline-flex items-center justify-center border border-white/30 text-white font-semibold px-8 py-3 rounded hover:bg-white/10 transition-colors text-base whitespace-nowrap"
              data-testid="closing-services-link"
            >
              View Individual Services
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
