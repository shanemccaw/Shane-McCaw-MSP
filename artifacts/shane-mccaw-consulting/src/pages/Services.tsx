import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  Zap, FolderOpen, Calendar, ArrowRight,
  CheckCircle, Clock, GraduationCap,
} from "lucide-react";
import { useServices } from "@/hooks/useServices";
import { OfferCard } from "@/components/OfferCard";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { RetainerCard } from "@/components/RetainerCard";

function TrackSection({
  trackLabel,
  trackNumber,
  title,
  description,
  accent,
  children,
  isEmpty,
}: {
  trackLabel: string;
  trackNumber: string;
  title: string;
  description: string;
  accent: string;
  children: React.ReactNode;
  isEmpty: boolean;
}) {
  if (isEmpty) return null;
  return (
    <section className="py-20 border-b border-border last:border-b-0">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[#0078D4]/50 text-xs font-bold uppercase tracking-[0.15em]">{trackNumber}</span>
            <span className={`text-xs font-bold uppercase tracking-[0.1em] ${accent}`}>{trackLabel}</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">{title}</h2>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
          {children}
        </div>
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

export default function Services() {
  const { services, loading, error } = useServices();
  const { projects: engagementProjects, loading: projectsLoading } = useEngagementProjects();

  const microOffers = services.filter(s => s.serviceType === "micro_offer");
  const retainers = services.filter(s => s.serviceType === "retainer");
  const visibleProjects = engagementProjects.filter(p => p.isVisible);

  const isLoading = loading && services.length === 0;

  return (
    <Layout>
      <SEOMeta
        title="All Microsoft 365 Services | Shane McCaw Consulting"
        description="Complete directory of every Microsoft 365 consulting service offered by Shane McCaw — fixed-price micro-offers, project-based engagements, and fractional architecture retainers."
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
          <div className="mt-8 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book" className="text-base px-8 py-3" data-testid="hero-book-cta">
              Book a Free Discovery Call <ArrowRight className="ml-2 w-4 h-4" />
            </CTAButton>
            <a href="/pricing" className="text-[#00B4D8] text-sm font-semibold hover:text-white transition-colors flex items-center gap-1">
              View pricing <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Track overview chips */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { num: "Track 01", tier: "Entry", title: "Fixed-Price Micro-Offers", icon: Zap, anchor: "#track-01" },
              { num: "Track 02", tier: "Core", title: "Project-Based Engagements", icon: FolderOpen, anchor: "#track-02" },
              { num: "Track 03", tier: "Strategic", title: "Fractional Architecture", icon: Calendar, anchor: "#track-03" },
            ].map((t, i) => {
              const Icon = t.icon;
              return (
                <a
                  key={i}
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
        </div>
      </section>

      {/* Three Track Sections */}
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
              Services are temporarily unavailable. <Link href="/book" className="text-[#0078D4] hover:underline">Book a call</Link> directly.
            </p>
          </div>
        </section>
      ) : (
        <div className="bg-[#F7F9FC]">
          {/* Track 01 — Micro-Offers */}
          <div id="track-01">
            <TrackSection
              trackNumber="Track 01"
              trackLabel="Entry Tier"
              title="Fixed-Price Micro-Offers"
              description="Scoped deliverables with a defined price, a defined output, and a defined turnaround. No discovery call required — pick the package that matches your need and get in the queue."
              accent="text-emerald-700"
              isEmpty={microOffers.length === 0}
            >
              {microOffers.map((s, i) => (
                <OfferCard
                  key={s.slug ?? s.id}
                  offer={s}
                  index={i}
                  ctaHref={s.pageHref ?? "/book"}
                  ctaLabel={s.pageHref ? "Learn More" : "Book a Discovery Call"}
                />
              ))}
            </TrackSection>
          </div>

          {/* Track 02 — Project-Based Engagements */}
          <div id="track-02">
            <TrackSection
              trackNumber="Track 02"
              trackLabel="Core Tier"
              title="Project-Based Engagements"
              description="For larger, multi-phase work — tenant migrations, full governance overhauls, Copilot deployment programs, intranet builds. Priced as a fixed project after a free scoping call."
              accent="text-[#0078D4]"
              isEmpty={visibleProjects.length === 0 && !projectsLoading}
            >
              {projectsLoading
                ? [...Array(3)].map((_, i) => (
                    <div key={i} className="bg-white rounded-xl border border-border p-6 h-48 animate-pulse" />
                  ))
                : visibleProjects.map((p, i) => <EngagementProjectCard key={p.id} project={p} index={i} />)
              }
            </TrackSection>
          </div>

          {/* Track 03 — Fractional Architecture */}
          <div id="track-03">
            <TrackSection
              trackNumber="Track 03"
              trackLabel="Strategic Tier"
              title="Monthly Fractional Architecture Retainer"
              description="Consistent, predictable access to Shane's expertise every month — for architecture reviews, ongoing governance, strategic planning, or Copilot rollout support. Cancel with 30 days' notice."
              accent="text-[#00B4D8]"
              isEmpty={retainers.length === 0}
            >
              {retainers.map((tier, i) => (
                <RetainerCard
                  key={tier.slug ?? tier.id}
                  plan={tier}
                  index={i}
                />
              ))}
            </TrackSection>
          </div>
        </div>
      )}

      {/* Track 04 — Training & Enablement */}
      <div id="track-04">
        <section className="py-20 border-b border-border bg-[#F7F9FC]">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="mb-12">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[#0078D4]/50 text-xs font-bold uppercase tracking-[0.15em]">Track 04</span>
                <span className="text-xs font-bold uppercase tracking-[0.1em] text-purple-600">Enablement Tier</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">Training &amp; Enablement</h2>
              <p className="text-muted-foreground max-w-2xl leading-relaxed">
                Instructor-led Microsoft 365 training built around your tenant, your tools, and your team — not a generic vendor demo.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
              <div className="rounded-xl border border-border bg-white p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#0078D4]/10">
                    <GraduationCap className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">New</span>
                </div>
                <h3 className="text-xl font-bold leading-snug mb-2 text-[#0A2540]">M365 Training &amp; Enablement</h3>
                <p className="text-sm italic mb-3 text-muted-foreground">Real-world training from a practitioner, not a slide deck reader</p>
                <p className="text-sm leading-relaxed mb-4 text-muted-foreground">
                  Live, instructor-led training across Outlook, Teams, SharePoint, OneDrive, Copilot, and Power Platform — custom-built for your organization's configuration and delivered remotely or on-site.
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 bg-[#F7F9FC] border border-border text-muted-foreground">
                    <Clock className="w-3 h-3" /> Half-day to multi-day
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 bg-[#F7F9FC] border border-border text-muted-foreground">
                    One-time
                  </span>
                </div>
                <p className="text-sm mb-4 text-muted-foreground">
                  <span className="font-semibold text-[#0A2540]">Best for:</span> Organizations onboarding to M365, migrating from Google Workspace, or rolling out Copilot and needing structured change management.
                </p>
                <div className="border-t pt-4 mb-4 border-border">
                  <p className="text-sm font-semibold mb-3 text-[#0A2540]">What's Included:</p>
                  <ul className="space-y-2">
                    {[
                      "Live instructor-led sessions (remote or on-site)",
                      "Custom agenda built around your M365 configuration",
                      "Session recordings for employees who can't attend live",
                      "Quick-reference cards, tip sheets, and resource packs",
                      "Post-training support window",
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#0078D4]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-auto pt-4">
                  <Link
                    href="/services/m365-training"
                    className="inline-flex items-center justify-center w-full gap-2 bg-[#0078D4] hover:bg-[#006BBE] text-white font-semibold text-sm px-5 py-2.5 rounded transition-colors"
                  >
                    Learn More <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

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
