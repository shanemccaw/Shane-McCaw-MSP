import { useMemo } from "react";
import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  Zap, FolderOpen, Calendar, ArrowRight, CheckCircle,
  type LucideIcon,
} from "lucide-react";
import { useServices, type PublicService } from "@/hooks/useServices";
import { OfferCard } from "@/components/OfferCard";
import { ServiceProjectCard } from "@/components/ServiceProjectCard";
import { RetainerCard } from "@/components/RetainerCard";
import { CopilotQuizCTA } from "@/components/CopilotQuizCTA";

// ─── Tier configuration ───────────────────────────────────────────────────────
// Keys must be lowercase to match the normalised tier value from the DB.
// Card type is NOT stored here — it is derived per-service from serviceType /
// billingType so mixed-type tiers render each card correctly.

interface TierConfig {
  title: string;
  trackLabel: string;
  description: string;
  chipLabel: string;
  accent: string;
  icon: LucideIcon;
}

const TIER_CONFIG: Record<string, TierConfig> = {
  entry: {
    title: "Fixed-Price Quick Wins",
    trackLabel: "Entry Tier",
    chipLabel: "Quick Wins",
    description:
      "Productized, fixed-scope engagements designed to deliver clear value in days — not months. A low-risk way to work together before committing to a larger engagement.",
    accent: "text-emerald-700",
    icon: Zap,
  },
  core: {
    title: "Project-Based Engagements",
    trackLabel: "Core Tier",
    chipLabel: "Projects",
    description:
      "Scoped, fixed-fee projects with a defined Statement of Work. Ideal for organisations ready to implement a specific workload or solve a defined architecture problem.",
    accent: "text-[#0078D4]",
    icon: FolderOpen,
  },
  strategic: {
    title: "Fractional Architecture",
    trackLabel: "Strategic Tier",
    chipLabel: "Retainers",
    description:
      "Ongoing fractional architect support — advisory, execution, or embedded leadership — structured as a monthly retainer so you get a senior architect without a full-time hire.",
    accent: "text-[#00B4D8]",
    icon: Calendar,
  },
};

const TIER_ORDER = ["entry", "core", "strategic"];

// ─── Card type resolution (per-service) ──────────────────────────────────────

type CardType = "offer" | "project" | "retainer";

function resolveCardType(svc: PublicService): CardType {
  if (svc.billingType === "recurring_monthly") return "retainer";
  if (svc.serviceType === "project") return "project";
  return "offer";
}

function toSectionTitle(tier: string): string {
  return tier.replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrackSection({
  trackLabel,
  trackNumber,
  title,
  description,
  accent,
  children,
  anchorId,
  headerExtra,
  footerExtra,
}: {
  trackLabel: string;
  trackNumber: string;
  title: string;
  description?: string;
  accent: string;
  children: React.ReactNode;
  anchorId: string;
  headerExtra?: React.ReactNode;
  footerExtra?: React.ReactNode;
}) {
  return (
    <section id={anchorId} className="py-20 border-b border-border last:border-b-0">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[#0078D4]/50 text-xs font-bold uppercase tracking-[0.15em]">{trackNumber}</span>
            <span className={`text-xs font-bold uppercase tracking-[0.1em] ${accent}`}>{trackLabel}</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">{title}</h2>
          {description && (
            <p className="text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
          )}
          {headerExtra && <div className="mt-6">{headerExtra}</div>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
          {children}
        </div>
        {footerExtra && <div className="mt-8">{footerExtra}</div>}
      </div>
    </section>
  );
}

function ServicesSkeleton() {
  return (
    <div className="py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="h-4 w-24 bg-border rounded animate-pulse mb-3" />
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

const COMMON_TRIGGERS = [
  "Moving from on-premises Exchange or file shares to Microsoft 365",
  "Deploying Microsoft Copilot across the organization",
  "Failing a compliance audit or preparing for one (FedRAMP, ITAR, HIPAA, ISO 27001)",
  "SharePoint intranet that no one uses or that has grown out of control",
  "Teams sprawl, ungoverned groups, and no lifecycle management",
  "New CISO or CTO who needs an independent architecture review before committing to a roadmap",
];

function renderCards(items: PublicService[]) {
  return items.map((svc, i) => {
    const cardType = resolveCardType(svc);
    if (cardType === "retainer") return <RetainerCard key={svc.slug ?? svc.id} plan={svc} index={i} />;
    if (cardType === "project") return <ServiceProjectCard key={svc.id} service={svc} index={i} />;
    return <OfferCard key={svc.slug ?? svc.id} offer={svc} index={i} />;
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Services() {
  const { services, loading, error } = useServices();

  // Group by tier (normalised to lowercase), unknown tiers fall to "other"
  const grouped = useMemo(() => {
    const map: Record<string, PublicService[]> = {};
    for (const svc of services) {
      const tier = svc.tier ? svc.tier.toLowerCase() : "other";
      if (!map[tier]) map[tier] = [];
      map[tier].push(svc);
    }
    return map;
  }, [services]);

  // Ordered: known tiers first (in TIER_ORDER sequence), then any unrecognised
  // tiers alphabetically, then "other" at the end
  const orderedTiers = useMemo(() => {
    const present = Object.keys(grouped);
    const known = TIER_ORDER.filter((t) => present.includes(t));
    const unknown = present
      .filter((t) => !TIER_ORDER.includes(t) && t !== "other")
      .sort();
    const other = present.includes("other") ? ["other"] : [];
    return [...known, ...unknown, ...other];
  }, [grouped]);

  // First three tiers that have data, used for hero anchor chips
  const heroChips = useMemo(() => {
    return orderedTiers.slice(0, 3).map((tier, i) => {
      const cfg = TIER_CONFIG[tier];
      const Icon = cfg?.icon ?? Zap;
      const trackNum = String(i + 1).padStart(2, "0");
      return {
        tier,
        num: `Track ${trackNum}`,
        trackLabel: cfg?.trackLabel ?? toSectionTitle(tier),
        chipLabel: cfg?.chipLabel ?? toSectionTitle(tier),
        icon: Icon,
        anchor: `#section-${tier}`,
      };
    });
  }, [orderedTiers]);

  const isLoading = loading && services.length === 0;

  return (
    <Layout>
      <SEOMeta
        title="All Microsoft 365 Services | Shane McCaw Consulting"
        description="Complete directory of every Microsoft 365 consulting service offered by Shane McCaw — fixed-price Quick Wins, project-based engagements, and fractional architecture retainers."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          "name": "Shane McCaw Consulting",
          "url": "https://shanemccaw.com/services",
          "description": "Complete directory of Microsoft 365 consulting services by Shane McCaw, NASA Lead M365 Architect.",
          "founder": { "@type": "Person", "name": "Shane McCaw" },
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Microsoft 365 Consulting Services",
            "itemListElement": services.map((s) => ({
              "@type": "Offer",
              "itemOffered": { "@type": "Service", "name": s.name },
            })),
          },
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
          <p className="text-[#00B4D8] text-sm font-semibold mt-3 tracking-wide">
            Productized offers. Fractional architecture. NASA-grade governance.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book" className="text-base px-8 py-3" data-testid="hero-book-cta">
              Book a Free Discovery Call <ArrowRight className="ml-2 w-4 h-4" />
            </CTAButton>
            <a href="/pricing" className="text-[#00B4D8] text-sm font-semibold hover:text-white transition-colors flex items-center gap-1">
              View pricing <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Hero chips — anchor links to tier sections, derived from live data */}
          {heroChips.length > 0 && (
            <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {heroChips.map((chip) => {
                const Icon = chip.icon;
                return (
                  <a
                    key={chip.tier}
                    href={chip.anchor}
                    className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-5 py-4 hover:bg-white/10 hover:border-white/20 transition-all"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-[#00B4D8]" />
                    </div>
                    <div>
                      <p className="text-[#0078D4]/60 text-[10px] font-bold uppercase tracking-[0.15em]">
                        {chip.num} · {chip.trackLabel}
                      </p>
                      <p className="text-white text-sm font-semibold leading-snug">{chip.chipLabel}</p>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* NASA Authority Strip */}
      <section className="bg-[#0D2F52] border-t-2 border-[#00B4D8] py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-[0.15em] mb-4">Why It Matters</p>
              <p className="text-white text-xl font-bold leading-snug mb-3">
                NASA is not a resume line — it is a market differentiator of the first order.
              </p>
              <p className="text-white/70 leading-relaxed">
                This experience translates directly into value for mid-market and regulated-industry clients.
              </p>
            </div>
            <div>
              <p className="text-white text-sm font-bold uppercase tracking-[0.1em] mb-5">
                Common Triggers for Engaging an M365 Architect
              </p>
              <ul className="space-y-3">
                {COMMON_TRIGGERS.map((trigger, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-white/70">
                    <CheckCircle className="w-4 h-4 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                    {trigger}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Tier-grouped service sections */}
      {isLoading ? (
        <div className="bg-[#F7F9FC]">
          <ServicesSkeleton />
          <ServicesSkeleton />
          <ServicesSkeleton />
        </div>
      ) : error ? (
        <section className="py-20">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <p className="text-muted-foreground text-sm">
              Services are temporarily unavailable.{" "}
              <Link href="/book" className="text-[#0078D4] hover:underline">Book a call</Link> directly.
            </p>
          </div>
        </section>
      ) : (
        <div className="bg-[#F7F9FC]">
          {orderedTiers.map((tier, sectionIndex) => {
            const items = grouped[tier] ?? [];
            if (items.length === 0) return null;

            const cfg = TIER_CONFIG[tier];
            const accent = cfg?.accent ?? "text-[#0078D4]";
            const trackLabel = cfg?.trackLabel ?? toSectionTitle(tier);
            const title = cfg?.title ?? toSectionTitle(tier);
            const description = cfg?.description;
            const trackNum = String(sectionIndex + 1).padStart(2, "0");

            const isEntry = tier === "entry";
            const isStrategic = tier === "strategic";
            const isCore = tier === "core";

            // Entry: show entry-point offer names if present
            const entryItems = isEntry ? items.filter((s) => resolveCardType(s) === "offer") : [];

            return (
              <TrackSection
                key={tier}
                anchorId={`section-${tier}`}
                trackNumber={`Track ${trackNum}`}
                trackLabel={trackLabel}
                title={title}
                description={description}
                accent={accent}
                headerExtra={
                  isEntry ? (
                    <div className="space-y-4">
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-5 py-4">
                        <p className="text-sm font-semibold text-emerald-800 mb-1">Quick Win Strategy</p>
                        <p className="text-sm text-emerald-700 leading-relaxed">
                          Most clients begin with a fixed-price engagement before moving into deeper governance or fractional architecture.
                          {entryItems.length > 0 && (
                            <>
                              {" "}Current {entryItems.length === 1 ? "entry offer" : "entry offers"}:{" "}
                              <span className="font-semibold">
                                {entryItems.map((o, i) => (
                                  <span key={o.id}>
                                    {i > 0 && i < entryItems.length - 1 ? ", " : ""}
                                    {i > 0 && i === entryItems.length - 1 ? " and " : ""}
                                    {o.name}
                                  </span>
                                ))}
                              </span>.
                            </>
                          )}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground italic">
                        Early clients may receive discounted entry-point engagements in exchange for a testimonial or case study.
                      </p>
                    </div>
                  ) : isCore ? (
                    <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-[#0078D4]/40 pl-4">
                      Project engagements are scoped after an initial assessment. Each project is priced as a fixed-fee engagement with a defined SOW.
                    </p>
                  ) : isStrategic ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Fractional architecture is offered in structured tiers so organisations can choose advisory, execution, or embedded leadership based on their needs.
                    </p>
                  ) : undefined
                }
                footerExtra={
                  isStrategic ? (
                    <p className="text-sm text-muted-foreground text-center italic">
                      A minimum 3-month commitment is recommended for best results.
                    </p>
                  ) : undefined
                }
              >
                {renderCards(items)}
              </TrackSection>
            );
          })}
        </div>
      )}

      <CopilotQuizCTA />

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
              href="/pricing"
              className="inline-flex items-center justify-center border border-white/30 text-white font-semibold px-8 py-3 rounded hover:bg-white/10 transition-colors text-base whitespace-nowrap"
              data-testid="closing-pricing-link"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
