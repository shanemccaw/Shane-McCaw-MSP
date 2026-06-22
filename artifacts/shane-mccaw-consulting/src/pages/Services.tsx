import { useMemo } from "react";
import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  Zap, FolderOpen, Calendar, ArrowRight,
  CheckCircle, ClipboardList, GraduationCap, Settings, Shield, Cloud,
} from "lucide-react";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";
import { type EngagementProject } from "@/hooks/useEngagementProjects";
import { OfferCard } from "@/components/OfferCard";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { RetainerCard } from "@/components/RetainerCard";
import { CopilotQuizCTA } from "@/components/CopilotQuizCTA";

type CardType = "offer" | "project" | "retainer";

interface SectionConfig {
  title: string;
  description: string;
  trackLabel: string;
  accent: string;
  cardType: CardType;
  icon: React.ElementType;
  chipLabel: string;
}

const CATEGORY_CONFIG: Record<string, SectionConfig> = {
  micro_offer: {
    title: "Fixed-Price Quick Wins",
    description:
      "Scoped deliverables with a defined price, a defined output, and a defined turnaround. No discovery call required — pick the package that matches your need and get in the queue.",
    trackLabel: "Entry Tier",
    accent: "text-emerald-700",
    cardType: "offer",
    icon: Zap,
    chipLabel: "Fixed-Price Quick Wins",
  },
  "quick-win": {
    title: "Fixed-Price Quick Wins",
    description:
      "Scoped deliverables with a defined price, a defined output, and a defined turnaround. No discovery call required — pick the package that matches your need and get in the queue.",
    trackLabel: "Entry Tier",
    accent: "text-emerald-700",
    cardType: "offer",
    icon: Zap,
    chipLabel: "Fixed-Price Quick Wins",
  },
  project: {
    title: "Project-Based Engagements",
    description:
      "For larger, multi-phase work — tenant migrations, full governance overhauls, Copilot deployment programs, intranet builds. Priced as a fixed project after a free scoping call.",
    trackLabel: "Core Tier",
    accent: "text-[#0078D4]",
    cardType: "project",
    icon: FolderOpen,
    chipLabel: "Project-Based Engagements",
  },
  retainer: {
    title: "Monthly Fractional Architecture Retainer",
    description:
      "Consistent, predictable access to Shane's expertise every month — for architecture reviews, ongoing governance, strategic planning, or Copilot rollout support. Cancel with 30 days' notice.",
    trackLabel: "Strategic Tier",
    accent: "text-[#00B4D8]",
    cardType: "retainer",
    icon: Calendar,
    chipLabel: "Fractional Architecture",
  },
  assessment: {
    title: "Assessments & Diagnostics",
    description:
      "Independent evaluations of your Microsoft 365 environment — identifying gaps, risks, and opportunities before you commit to a larger program.",
    trackLabel: "Diagnostic",
    accent: "text-violet-700",
    cardType: "offer",
    icon: ClipboardList,
    chipLabel: "Assessments",
  },
  training: {
    title: "Training & Enablement",
    description:
      "Structured, role-based training programs that turn passive Microsoft 365 users into confident, productive adopters.",
    trackLabel: "Enablement",
    accent: "text-amber-700",
    cardType: "offer",
    icon: GraduationCap,
    chipLabel: "Training",
  },
  "power-platform": {
    title: "Power Platform",
    description:
      "Low-code automation and application development with Power Apps, Power Automate, and Dataverse — governed, secure, and enterprise-ready.",
    trackLabel: "Automation",
    accent: "text-purple-700",
    cardType: "offer",
    icon: Settings,
    chipLabel: "Power Platform",
  },
  governance: {
    title: "Governance & Compliance",
    description:
      "Policy frameworks, lifecycle management, and compliance controls that keep your Microsoft 365 tenant secure, organized, and audit-ready.",
    trackLabel: "Governance",
    accent: "text-rose-700",
    cardType: "offer",
    icon: Shield,
    chipLabel: "Governance",
  },
  migration: {
    title: "Cloud Migration",
    description:
      "End-to-end migration planning and execution — from Exchange on-premises to Exchange Online, from file shares to SharePoint, and from legacy identity to Azure AD.",
    trackLabel: "Migration",
    accent: "text-sky-700",
    cardType: "offer",
    icon: Cloud,
    chipLabel: "Cloud Migration",
  },
};

const PRIMARY_CATEGORIES = ["micro_offer", "quick-win", "project", "retainer"];
const CATEGORY_ORDER = [
  "micro_offer",
  "quick-win",
  "project",
  "retainer",
  "assessment",
  "training",
  "power-platform",
  "governance",
  "migration",
];

function serviceToEngagementProject(s: PublicService): EngagementProject {
  return {
    id: s.id,
    title: s.name,
    priceRange: formatPriceDisplay(s),
    description: s.description ?? null,
    triggeredBy: s.triggers ?? [],
    sowItems: s.deliverables ?? [],
    sortOrder: s.sortOrder,
    isVisible: true,
  };
}

function TrackSection({
  trackLabel,
  trackNumber,
  title,
  description,
  accent,
  children,
  isEmpty,
  anchorId,
  headerExtra,
  footerExtra,
}: {
  trackLabel: string;
  trackNumber: string;
  title: string;
  description: string;
  accent: string;
  children: React.ReactNode;
  isEmpty: boolean;
  anchorId: string;
  headerExtra?: React.ReactNode;
  footerExtra?: React.ReactNode;
}) {
  if (isEmpty) return null;
  return (
    <section id={anchorId} className="py-20 border-b border-border last:border-b-0">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[#0078D4]/50 text-xs font-bold uppercase tracking-[0.15em]">{trackNumber}</span>
            <span className={`text-xs font-bold uppercase tracking-[0.1em] ${accent}`}>{trackLabel}</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">{title}</h2>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
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

export default function Services() {
  const { services, loading, error } = useServices();

  const grouped = useMemo(() => {
    const map: Record<string, PublicService[]> = {};
    for (const svc of services) {
      const cat = svc.category ?? svc.serviceType ?? "other";
      if (!map[cat]) map[cat] = [];
      map[cat].push(svc);
    }
    return map;
  }, [services]);

  const orderedCategories = useMemo(() => {
    const present = Object.keys(grouped);
    const known = CATEGORY_ORDER.filter((c) => present.includes(c));
    const unknown = present.filter((c) => !CATEGORY_ORDER.includes(c) && c !== "other");
    const other = present.includes("other") ? ["other"] : [];
    return [...known, ...unknown, ...other];
  }, [grouped]);

  const heroChips = useMemo(() => {
    return orderedCategories
      .filter((cat) => PRIMARY_CATEGORIES.includes(cat))
      .slice(0, 3)
      .map((cat, i) => {
        const config = CATEGORY_CONFIG[cat];
        const Icon = config?.icon ?? Zap;
        const trackNum = String(i + 1).padStart(2, "0");
        return {
          cat,
          num: `Track ${trackNum}`,
          tier: config?.trackLabel ?? cat,
          title: config?.chipLabel ?? config?.title ?? cat,
          icon: Icon,
          anchor: `#section-${cat}`,
        };
      });
  }, [orderedCategories]);

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

          {/* Dynamic track overview chips */}
          {heroChips.length > 0 && (
            <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {heroChips.map((t) => {
                const Icon = t.icon;
                return (
                  <a
                    key={t.cat}
                    href={t.anchor}
                    className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-5 py-4 hover:bg-white/10 hover:border-white/20 transition-all group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-[#00B4D8]" />
                    </div>
                    <div>
                      <p className="text-[#0078D4]/60 text-[10px] font-bold uppercase tracking-[0.15em]">{t.num} · {t.tier}</p>
                      <p className="text-white text-sm font-semibold leading-snug">{t.title}</p>
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

      {/* Dynamic Service Sections */}
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
          {orderedCategories.map((cat, sectionIndex) => {
            const items = grouped[cat] ?? [];
            if (items.length === 0) return null;

            const config = CATEGORY_CONFIG[cat];
            const trackNum = String(sectionIndex + 1).padStart(2, "0");
            const title = config?.title ?? cat;
            const description = config?.description ?? "";
            const trackLabel = config?.trackLabel ?? cat;
            const accent = config?.accent ?? "text-[#0078D4]";
            const cardType: CardType = config?.cardType ?? "offer";

            const isMicroOffer = cat === "micro_offer" || cat === "quick-win";
            const isRetainer = cat === "retainer";

            const entryItems = isMicroOffer ? items.filter((s) => s.tier === "Entry") : [];

            return (
              <TrackSection
                key={cat}
                anchorId={`section-${cat}`}
                trackNumber={`Track ${trackNum}`}
                trackLabel={trackLabel}
                title={title}
                description={description}
                accent={accent}
                isEmpty={false}
                headerExtra={
                  isMicroOffer ? (
                    <div className="space-y-4">
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-5 py-4">
                        <p className="text-sm font-semibold text-emerald-800 mb-1">Quick Win Strategy</p>
                        <p className="text-sm text-emerald-700 leading-relaxed">
                          Most clients begin with an entry-point engagement before moving into deeper governance or fractional architecture.
                          {entryItems.length > 0 && (
                            <> The current entry-point {entryItems.length === 1 ? "offer is" : "offers are"}{" "}
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
                  ) : cat === "project" ? (
                    <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-[#0078D4]/40 pl-4">
                      Track 02 projects are always triggered by Track 01 Quick Wins. Each project is scoped only after the initial assessment is complete.
                    </p>
                  ) : isRetainer ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Fractional architecture is offered in structured tiers so organizations can choose advisory, execution, or embedded leadership based on their needs.
                    </p>
                  ) : undefined
                }
                footerExtra={
                  isRetainer ? (
                    <p className="text-sm text-muted-foreground text-center italic">
                      A minimum 3-month commitment is recommended for best results.
                    </p>
                  ) : undefined
                }
              >
                {cardType === "retainer"
                  ? items.map((plan, i) => (
                      <RetainerCard key={plan.slug ?? plan.id} plan={plan} index={i} />
                    ))
                  : cardType === "project"
                  ? items.map((svc, i) => (
                      <EngagementProjectCard
                        key={svc.id}
                        project={serviceToEngagementProject(svc)}
                        index={i}
                      />
                    ))
                  : items.map((svc, i) => (
                      <OfferCard key={svc.slug ?? svc.id} offer={svc} index={i} />
                    ))}
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
