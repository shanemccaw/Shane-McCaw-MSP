import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle, ArrowRight, Shield, Building2, Rocket, Briefcase,
  Clock, Star, ShieldCheck, Zap, Database, BookOpen, Target,
  BarChart2, Sparkles, TrendingUp, Award,
} from "lucide-react";

// ── Icon lookup ───────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldCheck, Zap, Shield, Database, BookOpen, Target, BarChart2, Sparkles,
  TrendingUp, Award, Building2, Briefcase, Rocket,
};
function ServiceIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICON_MAP[name]) ? ICON_MAP[name] : Shield;
  return <Icon className={className} />;
}

// ── API types ─────────────────────────────────────────────────────────────────
interface ServiceRecord {
  id: number;
  name: string;
  description: string | null;
  tagline: string | null;
  category: string;
  basePrice: string | null;
  maxPrice: string | null;
  price: string | null;
  turnaround: string | null;
  hoursPerMonth: string | null;
  inclusions: string[] | null;
  deliverables: string[] | null;
  badge: string | null;
  highlighted: boolean;
  iconName: string | null;
  pageHref: string | null;
  slug: string;
  serviceType: string;
  isPublic: boolean;
}

// ── Static data ───────────────────────────────────────────────────────────────
const whoIWorkWith = [
  {
    icon: Building2,
    title: "Mid-Market Enterprises",
    subtitle: "200–2,000 Employees",
    description:
      "You've deployed Microsoft 365, but governance never followed. Now Copilot is on the roadmap and the tenant isn't ready for it.",
    painPoints: [
      "M365 sprawl from years of ungoverned growth",
      "Governance gaps blocking Copilot adoption",
      "Shadow IT undermining your security posture",
      "Failed or stalled migration projects",
    ],
    color: "#0078D4",
  },
  {
    icon: Shield,
    title: "Regulated Industries & Gov Contractors",
    subtitle: "Healthcare · Legal · Financial · Federal",
    description:
      "Your compliance frameworks demand senior-level architecture. Hiring a full-time M365 architect costs $150k–$220k/year — and takes months to recruit.",
    painPoints: [
      "HIPAA, SOC 2, and CMMC readiness on M365",
      "Data residency and sovereignty requirements",
      "FedRAMP, FISMA, and ITAR for gov contractors",
      "GCC High configuration for defense-adjacent workloads",
    ],
    color: "#00B4D8",
  },
  {
    icon: Rocket,
    title: "Startups & Scale-Ups",
    subtitle: "Rapid Growth · First-Time Architecture",
    description:
      "Headcount is outpacing your initial M365 setup. Build it right before scale makes it exponentially harder to fix.",
    painPoints: [
      "Poor tenant foundation from early configuration shortcuts",
      "Audit preparation with no existing governance framework",
      "Rapid headcount growth with no onboarding automation",
      "First-time enterprise architecture requirements",
    ],
    color: "#0A2540",
  },
];

const complianceBadges = ["FedRAMP", "FISMA", "ITAR", "GCC High"];

const engagementSteps = [
  {
    step: "01",
    title: "Discover",
    description:
      "A free 30-minute discovery call to understand your current M365 environment, key pain points, and what success looks like for your organization.",
    note: "No pitch. No obligation.",
    color: "#0078D4",
  },
  {
    step: "02",
    title: "Diagnose",
    description:
      "A Quick Entry Engagement — Tenant Health Audit or Migration Readiness Assessment — gives you a clear, prioritized picture of your environment before committing to a larger project.",
    note: "Fixed price. Delivered in 5 business days.",
    color: "#00B4D8",
  },
  {
    step: "03",
    title: "Architect & Execute",
    description:
      "Based on the findings, we scope a fixed-price project, a fractional retainer, or both. Every engagement is delivered personally by Shane.",
    note: "No handoffs. No junior staff.",
    color: "#0A2540",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatPriceRange(base: string | null, max: string | null): string {
  if (!base && !max) return "";
  const fmt = (v: string) => {
    const n = parseFloat(v);
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  };
  if (base && max) return `${fmt(base)} – ${fmt(max)}`;
  if (base) return fmt(base);
  return fmt(max!);
}

export default function Home() {
  const [microOffers, setMicroOffers] = useState<ServiceRecord[]>([]);
  const [retainers, setRetainers] = useState<ServiceRecord[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [retainersLoading, setRetainersLoading] = useState(true);

  useEffect(() => {
    fetch("/api/services?type=micro_offer")
      .then((r) => r.json())
      .then((data: ServiceRecord[]) => setMicroOffers(data.filter((s) => s.isPublic !== false)))
      .catch(() => {})
      .finally(() => setOffersLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/services?type=retainer")
      .then((r) => r.json())
      .then((data: ServiceRecord[]) => setRetainers(data.filter((s) => s.isPublic !== false)))
      .catch(() => {})
      .finally(() => setRetainersLoading(false));
  }, []);

  return (
    <Layout>
      <SEOMeta
        title="Enterprise Microsoft 365 & Copilot AI Consulting | Shane McCaw Consulting"
        description="Shane McCaw is NASA's Lead Microsoft 365 Architect — 30 years of Microsoft expertise, delivering M365 tenant audits, Copilot AI readiness, SharePoint, and governance. Fixed-price packages, senior-level delivery."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          "name": "Shane McCaw Consulting",
          "url": "https://shanemccaw.com",
          "description": "Enterprise Microsoft 365 and Copilot AI consulting by Shane McCaw — NASA's Lead M365 Architect with 30 years of Microsoft expertise.",
          "founder": { "@type": "Person", "name": "Shane McCaw" },
          "areaServed": "US",
          "priceRange": "$3,000 – $35,000+",
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Microsoft 365 Consulting Services",
            "itemListElement": microOffers.map((s) => ({
              "@type": "Offer",
              "itemOffered": { "@type": "Service", "name": s.name },
            })),
          },
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center bg-[#0A2540] overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(#0078D4 1px, transparent 1px),
              linear-gradient(90deg, #0078D4 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)",
          }}
        />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6 py-32 pt-44 text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Current Microsoft 365 Architect & Copilot SME — NASA
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            <span className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded px-4 py-1.5 text-white/90 text-sm font-semibold">
              <Briefcase className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0" />
              Lead M365 Architect at NASA
            </span>
            <span className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded px-4 py-1.5 text-white/90 text-sm font-semibold">
              <CheckCircle className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0" />
              30 Years Microsoft Ecosystem Experience
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-[3.75rem] font-extrabold text-white leading-[1.1] mb-5 max-w-5xl mx-auto">
            The Architect Who Built at NASA Scale — Available to You.
          </h1>
          <p className="text-base md:text-lg text-[#00B4D8] font-semibold max-w-2xl mx-auto mb-5">
            Mission-critical Microsoft 365 architecture for mid-market and regulated organizations — without a full-time hire.
          </p>
          <p className="text-lg md:text-xl text-white/70 max-w-3xl mx-auto mb-12 leading-relaxed">
            Shane McCaw brings the same discipline he built at NASA to your organization. Fixed-price assessments. Fractional architecture retainers. Senior Microsoft expertise delivered personally — no account managers, no offshore handoffs.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/book" className="text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30" data-testid="hero-cta-primary">
              Book a Discovery Call
            </CTAButton>
            <Link
              href="/micro-offers"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-3.5 rounded-xl hover:border-white/40"
            >
              See Fixed-Price Packages <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-14 pt-10 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
            {[
              "Fractional M365 Architecture",
              "Copilot AI Readiness",
              "Governance & Compliance",
              "Cloud Migration",
              "30+ Years Microsoft Experience",
            ].map((badge, i) => (
              <span key={i} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>

      {/* ── WHO I WORK WITH ──────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="who-i-work-with-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Who I Work With</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Organizations With Real Complexity — and the Ambition to Fix It
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane works best with organizations that have outgrown generic IT support and need a senior Microsoft architect who has solved problems at mission-critical scale.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {whoIWorkWith.map((segment, i) => {
              const Icon = segment.icon;
              return (
                <div key={i} className="bg-white rounded-xl border border-border p-8 flex flex-col" data-testid={`who-segment-${i}`}>
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center mb-5 flex-shrink-0"
                    style={{ backgroundColor: `${segment.color}18` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: segment.color }} />
                  </div>
                  <h3 className="text-xl font-extrabold text-[#0A2540] mb-1">{segment.title}</h3>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: segment.color }}>
                    {segment.subtitle}
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-5">{segment.description}</p>
                  <ul className="space-y-2 flex-1">
                    {segment.painPoints.map((point, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-[#0A2540]">
                        <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── PRODUCTIZED SERVICES ─────────────────────────────────────────── */}
      <section className="bg-white py-20" data-testid="productized-services-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Fixed-Price Engagements</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Productized Services
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Scoped packages with fixed pricing, defined timelines, and clear deliverables. No open-ended consulting fees. No scope creep.
            </p>
          </div>

          {offersLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-[#F7F9FC] rounded-xl border border-border p-7 h-64 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {microOffers.map((service, i) => {
                const priceRange = formatPriceRange(service.basePrice, service.maxPrice);
                const isQuickEntry = service.badge === "High Impact" || service.badge === "Quick Win" ||
                  service.name.toLowerCase().includes("audit") || service.name.toLowerCase().includes("assessment");
                return (
                  <div
                    key={service.id}
                    className="bg-[#F7F9FC] rounded-xl border border-border p-7 flex flex-col hover:border-[#0078D4]/30 hover:bg-white transition-all"
                    data-testid={`service-card-${i}`}
                  >
                    {service.badge && (
                      <span className="inline-flex self-start items-center gap-1.5 bg-[#0078D4]/10 text-[#0078D4] text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-4">
                        <Star className="w-3 h-3" />
                        {service.badge}
                      </span>
                    )}
                    <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4 flex-shrink-0">
                      <ServiceIcon name={service.iconName} className="w-5 h-5 text-[#0078D4]" />
                    </div>
                    {service.pageHref ? (
                      <Link href={service.pageHref} className="font-extrabold text-[#0A2540] text-lg mb-1 leading-snug hover:text-[#0078D4] transition-colors">
                        {service.name}
                      </Link>
                    ) : (
                      <h3 className="font-extrabold text-[#0A2540] text-lg mb-1 leading-snug">{service.name}</h3>
                    )}
                    <div className="flex items-center gap-3 mb-4">
                      {priceRange && (
                        <span className="text-sm font-bold text-[#0078D4]">{priceRange}</span>
                      )}
                      {priceRange && service.turnaround && (
                        <span className="text-xs text-muted-foreground">·</span>
                      )}
                      {service.turnaround && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                          <Clock className="w-3 h-3" />
                          {service.turnaround}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm leading-relaxed mb-3 flex-1">
                      {service.tagline ?? service.description}
                    </p>
                    {service.inclusions && service.inclusions.length > 0 && (
                      <ul className="space-y-1.5 mb-5">
                        {service.inclusions.slice(0, 3).map((item, j) => (
                          <li key={j} className="flex items-start gap-2 text-xs text-[#0A2540]">
                            <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-border">
                      <CTAButton href={`/crm/portal/onboarding/select?service=${service.slug}`} className="text-xs px-4 py-2 w-full">
                        Get Started
                      </CTAButton>
                      {service.pageHref && (
                        <Link
                          href={service.pageHref}
                          className="inline-flex items-center justify-center gap-1.5 text-[#0078D4] text-sm font-semibold hover:underline"
                        >
                          Learn More <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-center mt-10">
            <CTAButton href="/micro-offers" className="text-base px-8 py-3.5">
              View All Fixed-Price Packages
            </CTAButton>
          </div>
        </div>
      </section>

      {/* ── FRACTIONAL ARCHITECT RETAINERS ───────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="retainers-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-6">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Fractional Architecture</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Fractional Architect Retainers
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Ongoing senior M365 architecture leadership on a monthly basis — strategic direction, hands-on delivery, and direct access to Shane.
            </p>
          </div>

          <div className="flex justify-center mb-12">
            <div className="bg-[#0A2540] text-white text-sm font-semibold px-6 py-3 rounded-xl text-center max-w-xl">
              A full-time M365 Architect costs $150,000–$220,000/year — plus benefits, equity, and months to recruit.
            </div>
          </div>

          {retainersLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-border p-8 h-80 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {retainers.map((tier, i) => {
                const monthlyPrice = tier.price ? `$${parseFloat(tier.price).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : null;
                const items = tier.deliverables ?? tier.inclusions ?? [];
                const isHighlighted = tier.highlighted;
                return (
                  <div
                    key={tier.id}
                    className={`rounded-xl border p-8 flex flex-col ${
                      isHighlighted
                        ? "bg-[#0A2540] border-[#0078D4]/50 shadow-xl shadow-[#0A2540]/20"
                        : "bg-white border-border"
                    }`}
                    data-testid={`retainer-tier-${i}`}
                  >
                    {tier.badge && (
                      <span className={`inline-flex self-start items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-4 ${
                        isHighlighted
                          ? "bg-[#0078D4]/20 text-[#00B4D8]"
                          : "bg-[#0078D4]/10 text-[#0078D4]"
                      }`}>
                        {tier.badge}
                      </span>
                    )}
                    {tier.pageHref ? (
                      <Link
                        href={tier.pageHref}
                        className={`text-2xl font-extrabold mb-1 hover:underline underline-offset-2 ${isHighlighted ? "text-white" : "text-[#0A2540] hover:text-[#0078D4]"}`}
                      >
                        {tier.name.replace(/^Architect\s+/i, "")}
                      </Link>
                    ) : (
                      <h3 className={`text-2xl font-extrabold mb-1 ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>
                        {tier.name.replace(/^Architect\s+/i, "")}
                      </h3>
                    )}
                    {monthlyPrice && (
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className={`text-3xl font-extrabold ${isHighlighted ? "text-white" : "text-[#0078D4]"}`}>
                          {monthlyPrice}
                        </span>
                        <span className={`text-sm font-medium ${isHighlighted ? "text-white/60" : "text-muted-foreground"}`}>
                          /mo
                        </span>
                      </div>
                    )}
                    {tier.hoursPerMonth && (
                      <p className={`text-sm font-semibold mb-4 ${isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>
                        {tier.hoursPerMonth}/mo
                      </p>
                    )}
                    <p className={`text-sm leading-relaxed mb-6 flex-1 ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>
                      {tier.tagline ?? tier.description}
                    </p>
                    {items.length > 0 && (
                      <ul className="space-y-2 mb-8">
                        {items.slice(0, 5).map((item, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm">
                            <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`} />
                            <span className={isHighlighted ? "text-white/80" : "text-[#0A2540]"}>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-col gap-3 mt-auto">
                      <CTAButton
                        href={`/crm/portal/onboarding/select?service=${tier.slug}`}
                        className={`text-sm w-full ${isHighlighted ? "bg-[#0078D4] hover:bg-[#005A9E]" : ""}`}
                      >
                        Get Started
                      </CTAButton>
                      {tier.pageHref && (
                        <Link
                          href={tier.pageHref}
                          className={`inline-flex items-center justify-center gap-1.5 text-sm font-semibold hover:underline ${
                            isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"
                          }`}
                        >
                          Learn More <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-center mt-8">
            <Link href="/retainers" className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline">
              Compare all retainer tiers in detail <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20" data-testid="why-shane-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-[860px] mx-auto text-center mb-12">
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Why Shane</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6">
              30 Years of Microsoft Ecosystem Depth — Built at Mission-Critical Scale
            </h2>
            <p className="text-white/70 text-lg leading-relaxed mb-6">
              Shane McCaw has spent three decades inside the Microsoft ecosystem — from early infrastructure deployments to leading Microsoft 365 architecture for one of the most compliance-intensive organizations on earth: NASA. As Lead M365 Architect, Shane designed and governed the systems used by scientists, engineers, and administrators whose work cannot fail. That discipline is now available to your organization on a fractional basis.
            </p>
            <p className="text-white/70 text-lg leading-relaxed">
              Most consultants learn compliance frameworks from documentation. Shane learned them under real-world conditions where misconfiguration carried legal and mission consequences. FedRAMP, FISMA, ITAR, and GCC High aren't checklists to him — they're the environment he operated in daily.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
            {complianceBadges.map((badge, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-5 py-2.5 text-white font-bold text-sm"
              >
                <Shield className="w-4 h-4 text-[#00B4D8] flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[860px] mx-auto">
            {[
              { stat: "30+", label: "Years in the Microsoft Ecosystem" },
              { stat: "NASA", label: "Lead M365 Architect — Current Role" },
              { stat: "100%", label: "Senior Delivery — No Junior Staff" },
            ].map((item, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
                <div className="text-3xl font-extrabold text-[#00B4D8] mb-2">{item.stat}</div>
                <div className="text-white/60 text-sm font-medium">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW ENGAGEMENTS WORK ─────────────────────────────────────────── */}
      <section className="bg-white py-20" data-testid="how-it-works-section">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">The Process</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              How Engagements Work
            </h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              Every engagement follows the same three-step discipline — no surprises, no open-ended scope.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-10 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-0.5 bg-gradient-to-r from-[#0078D4] via-[#00B4D8] to-[#0A2540] opacity-20" />
            {engagementSteps.map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center" data-testid={`step-${i}`}>
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6 text-white text-2xl font-extrabold"
                  style={{ backgroundColor: step.color }}
                >
                  {step.step}
                </div>
                <h3 className="text-xl font-extrabold text-[#0A2540] mb-3">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">{step.description}</p>
                <p className="text-xs font-semibold text-[#0078D4] italic">{step.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT WE'LL COVER IN YOUR DISCOVERY CALL ─────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="discovery-call-section">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Free Discovery Call</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-5">
            What We'll Cover in Your Discovery Call
          </h2>
          <p className="text-muted-foreground text-lg mb-10 leading-relaxed">
            A 30-minute conversation to understand your environment and give you a clear sense of what's possible — before you commit to anything.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 text-left">
            {[
              {
                number: "1",
                title: "Your Current Landscape",
                desc: "Where your Microsoft 365 environment stands today — what's working, what's broken, and what's been deferred.",
              },
              {
                number: "2",
                title: "Key Risks & Opportunities",
                desc: "The compliance gaps, governance liabilities, and adoption blockers most likely to be holding your organization back.",
              },
              {
                number: "3",
                title: "Which Offer Fits Best",
                desc: "An honest recommendation — Quick Entry Assessment, fixed-price package, or fractional retainer — based on your actual situation.",
              },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-6">
                <div className="w-8 h-8 rounded-lg bg-[#0078D4] text-white text-sm font-extrabold flex items-center justify-center mb-4">
                  {item.number}
                </div>
                <h3 className="font-extrabold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          <CTAButton href="/book" className="text-base px-10 py-4" data-testid="discovery-call-cta">
            Book Your Discovery Call
          </CTAButton>
          <p className="mt-4 text-muted-foreground text-sm">No pitch. No obligation. Just clarity on your Microsoft 365 environment.</p>
        </div>
      </section>

      {/* ── CLOSING CTA ──────────────────────────────────────────────────── */}
      <section className="relative bg-[#0A2540] py-28 overflow-hidden" data-testid="final-cta-section">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-widest mb-4">
            Free 30-Minute Discovery Call
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Your Microsoft 365 Environment Deserves Senior Expertise.
          </h2>
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Work directly with a 30-year Microsoft veteran and NASA's Lead M365 Architect. No account managers. No junior staff. Clear, actionable guidance — starting with a free call.
          </p>
          <CTAButton href="/book" className="text-lg px-12 py-5" data-testid="final-cta-button">
            Book Your Discovery Call
          </CTAButton>
          <p className="mt-5 text-white/40 text-sm tracking-wide">
            No pitch. No obligation. Just clarity.
          </p>
        </div>
      </section>
    </Layout>
  );
}
