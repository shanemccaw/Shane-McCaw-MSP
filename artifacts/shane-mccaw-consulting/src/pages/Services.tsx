import { useMemo } from "react";
import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  Zap,
  FolderOpen,
  Calendar,
  ArrowRight,
  CheckCircle,
  Shield,
  Activity,
  GitBranch,
} from "lucide-react";
import { useServices, type PublicService } from "@/hooks/useServices";
import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { OfferCard } from "@/components/OfferCard";
import { ServiceProjectCard } from "@/components/ServiceProjectCard";
import { RetainerCard } from "@/components/RetainerCard";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { AssessmentSelector } from "@/components/AssessmentSelector";

/* -------------------------------------------------------------------------- */
/* Tier configuration                                                         */
/* -------------------------------------------------------------------------- */

interface TierConfig {
  title: string;
  trackLabel: string;
  description: string;
  chipLabel: string;
  accent: string;
  icon: any;
}

const TIER_CONFIG: Record<string, TierConfig> = {
  entry: {
    title: "Fixed-Price Quick Wins",
    trackLabel: "Entry Tier",
    chipLabel: "Quick Wins",
    description:
      "Productized, fixed-scope engagements designed to deliver clear value in days — not months. A low-risk way to work together before committing to a larger engagement.",
    accent: "text-emerald-400",
    icon: Zap,
  },
  core: {
    title: "Project-Based Engagements",
    trackLabel: "Core Tier",
    chipLabel: "Projects",
    description:
      "Scoped, fixed-fee projects with a defined Statement of Work. Ideal for organisations ready to implement a specific workload or solve a defined architecture problem.",
    accent: "text-blue-400",
    icon: FolderOpen,
  },
  strategic: {
    title: "Fractional Architecture",
    trackLabel: "Strategic Tier",
    chipLabel: "Retainers",
    description:
      "Ongoing fractional architect support — advisory, execution, or embedded leadership — structured as a monthly retainer so you get a senior architect without a full-time hire.",
    accent: "text-cyan-400",
    icon: Calendar,
  },
};

const TIER_ORDER = ["entry", "core", "strategic"];

/* -------------------------------------------------------------------------- */
/* Card type resolution                                                       */
/* -------------------------------------------------------------------------- */

type CardType = "offer" | "project" | "retainer";

function resolveCardType(svc: PublicService): CardType {
  if (svc.billingType === "recurring_monthly") return "retainer";
  if (svc.tier?.toLowerCase() === "core") return "project";
  return "offer";
}

function toSectionTitle(tier: string): string {
  return tier
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

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
    <section
      id={anchorId}
      className="py-20 border-t border-slate-800/80 bg-slate-950"
    >
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-blue-400/60 text-xs font-bold uppercase tracking-[0.15em]">
              {trackNumber}
            </span>
            <span
              className={`text-xs font-bold uppercase tracking-[0.1em] ${accent}`}
            >
              {trackLabel}
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-4">
            {title}
          </h2>
          {description && (
            <p className="text-slate-400 max-w-2xl leading-relaxed">
              {description}
            </p>
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
    <div className="py-20 bg-slate-950">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="h-4 w-24 bg-slate-800 rounded animate-pulse mb-3" />
        <div className="h-8 w-72 bg-slate-800 rounded animate-pulse mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-slate-900 rounded-xl border border-slate-800 p-8 h-80 animate-pulse"
            />
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
    if (cardType === "retainer")
      return <RetainerCard key={svc.slug ?? svc.id} plan={svc} index={i} />;
    if (cardType === "project")
      return <ServiceProjectCard key={svc.id} service={svc} index={i} />;
    return <OfferCard key={svc.slug ?? svc.id} offer={svc} index={i} />;
  });
}

/* -------------------------------------------------------------------------- */
/* Page component                                                             */
/* -------------------------------------------------------------------------- */

export default function Services() {
  const { services, loading, error } = useServices();
  const { projects, loading: projectsLoading } = useEngagementProjects();

  const visibleProjects = useMemo(
    () => projects.filter((p) => p.isVisible),
    [projects],
  );

  const grouped = useMemo(() => {
    const map: Record<string, PublicService[]> = {};
    for (const svc of services) {
      const tier = svc.tier ? svc.tier.toLowerCase() : "other";
      if (!map[tier]) map[tier] = [];
      map[tier].push(svc);
    }
    return map;
  }, [services]);

  const orderedTiers = useMemo(() => {
    const present = Object.keys(grouped).filter((t) => t !== "core");
    if (visibleProjects.length > 0) {
      present.push("core");
    }
    return TIER_ORDER.filter((t) => present.includes(t));
  }, [grouped, visibleProjects]);

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

  const isLoading = loading || projectsLoading;

  return (
    <Layout>
      <SEOMeta
        title="All Microsoft 365 Services | Shane McCaw Consulting"
        description="Complete directory of every Microsoft 365 consulting service offered by Shane McCaw — fixed-price Quick Wins, project-based engagements, and fractional architecture retainers."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          name: "Shane McCaw Consulting",
          url: "https://shanemccaw.com/services",
          description:
            "Complete directory of Microsoft 365 consulting services by Shane McCaw, NASA Lead M365 Architect.",
          founder: { "@type": "Person", name: "Shane McCaw" },
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "Microsoft 365 Consulting Services",
            itemListElement: services.map((s) => ({
              "@type": "Offer",
              itemOffered: { "@type": "Service", name: s.name },
            })),
          },
        }}
      />

      {/* Hero */}
      <section className="relative bg-slate-950 pt-[172px] pb-20 border-b border-slate-800/80">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[180px]" />
        </div>
        <div className="relative max-w-[1200px] mx-auto px-6">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.1em] mb-4">
            Service Directory
          </p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            All Microsoft 365 Services
          </h1>
          <p className="text-slate-300 text-lg mt-6 max-w-2xl leading-relaxed">
            A complete directory of every productized service offered by Shane
            McCaw Consulting.
          </p>
          <p className="text-cyan-400 text-sm font-semibold mt-3 tracking-wide">
            Productized offers. Fractional architecture. NASA-grade governance.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 items-center">
            <CTAButton
              href="/book"
              className="text-base px-8 py-3"
              data-testid="hero-book-cta"
            >
              Book a Free Discovery Call <ArrowRight className="ml-2 w-4 h-4" />
            </CTAButton>
            <Link
              href="/pricing"
              className="text-cyan-400 text-sm font-semibold hover:text-white transition-colors flex items-center gap-1"
            >
              View pricing <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {heroChips.length > 0 && (
            <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {heroChips.map((chip) => {
                const Icon = chip.icon;
                return (
                  <a
                    key={chip.tier}
                    href={chip.anchor}
                    className="flex items-center gap-3 bg-slate-900/60 border border-slate-800/80 rounded-xl px-5 py-4 hover:border-blue-500/40 hover:bg-slate-900 transition-all"
                  >
                    <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-blue-400/70 text-[10px] font-bold uppercase tracking-[0.15em]">
                        {chip.num} · {chip.trackLabel}
                      </p>
                      <p className="text-white text-sm font-semibold leading-snug">
                        {chip.chipLabel}
                      </p>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* NASA Authority Strip */}
      <section className="bg-slate-950 border-t border-slate-800/80 py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-cyan-400 text-xs font-bold uppercase tracking-[0.15em] mb-4">
                Why It Matters
              </p>
              <p className="text-white text-xl font-bold leading-snug mb-3">
                NASA is not a resume line — it is a market differentiator of the
                first order.
              </p>
              <p className="text-slate-300 leading-relaxed">
                This experience translates directly into value for mid-market
                and regulated-industry clients.
              </p>
            </div>
            <div>
              <p className="text-white text-sm font-bold uppercase tracking-[0.1em] mb-5">
                Common Triggers for Engaging an M365 Architect
              </p>
              <ul className="space-y-3">
                {COMMON_TRIGGERS.map((trigger, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 text-sm text-slate-300"
                  >
                    <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
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
        <>
          <ServicesSkeleton />
          <ServicesSkeleton />
          <ServicesSkeleton />
        </>
      ) : error ? (
        <section className="py-20 bg-slate-950 border-t border-slate-800/80">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <p className="text-slate-400 text-sm">
              Services are temporarily unavailable.{" "}
              <Link href="/book" className="text-blue-400 hover:underline">
                Book a call
              </Link>{" "}
              directly.
            </p>
          </div>
        </section>
      ) : (
        <>
          {orderedTiers.map((tier, sectionIndex) => {
            const items = grouped[tier] ?? [];
            const isCoreWithProjects =
              tier === "core" && visibleProjects.length > 0;

            if (items.length === 0 && !isCoreWithProjects) return null;

            const cfg = TIER_CONFIG[tier];
            const accent = cfg?.accent ?? "text-blue-400";
            const trackLabel = cfg?.trackLabel ?? toSectionTitle(tier);
            const title = cfg?.title ?? toSectionTitle(tier);
            const description = cfg?.description;
            const trackNum = String(sectionIndex + 1).padStart(2, "0");

            const isEntry = tier === "entry";
            const isStrategic = tier === "strategic";
            const isCore = tier === "core";

            const entryItems = isEntry
              ? items.filter((s) => resolveCardType(s) === "offer")
              : [];

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
                      <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/40 px-5 py-4">
                        <p className="text-sm font-semibold text-emerald-300 mb-1">
                          Quick Win Strategy
                        </p>
                        <p className="text-sm text-emerald-200 leading-relaxed">
                          Most clients begin with a fixed-price engagement
                          before moving into deeper governance or fractional
                          architecture.
                          {entryItems.length > 0 && (
                            <>
                              {" "}
                              Current{" "}
                              {entryItems.length === 1
                                ? "entry offer"
                                : "entry offers"}
                              :{" "}
                              <span className="font-semibold">
                                {entryItems.map((o, i) => (
                                  <span key={o.id}>
                                    {i > 0 && i < entryItems.length - 1 && ", "}
                                    {i > 0 &&
                                      i === entryItems.length - 1 &&
                                      " and "}
                                    {o.name}
                                  </span>
                                ))}
                              </span>
                              .
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  ) : isCore ? (
                    <p className="text-sm text-slate-400 leading-relaxed border-l-2 border-blue-500/40 pl-4">
                      Project engagements are scoped after an initial
                      assessment. Each project is priced as a fixed-fee
                      engagement with a defined SOW.
                    </p>
                  ) : isStrategic ? (
                    <p className="text-sm text-slate-400 leading-relaxed">
                      Fractional architecture is offered in structured tiers so
                      organisations can choose advisory, execution, or embedded
                      leadership based on their needs.
                    </p>
                  ) : undefined
                }
                footerExtra={
                  isStrategic ? (
                    <p className="text-sm text-slate-500 text-center italic">
                      A minimum 3-month commitment is recommended for best
                      results.
                    </p>
                  ) : undefined
                }
              >
                {isCoreWithProjects
                  ? visibleProjects.map((p, i) => (
                      <EngagementProjectCard key={p.id} project={p} index={i} />
                    ))
                  : renderCards(items)}
              </TrackSection>
            );
          })}
        </>
      )}

      {/* Project Engagement Examples (three dark cards) */}
      <section className="bg-slate-950 border-t border-slate-800/80 py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-blue-400 text-xs font-bold uppercase tracking-[0.15em] mb-3">
              Project Engagements
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
              Typical Microsoft 365 Project Work
            </h2>
            <p className="text-slate-300 max-w-2xl mx-auto leading-relaxed">
              These are representative project patterns — governance
              remediation, migration execution, and Copilot deployment — scoped
              as fixed-fee engagements.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Governance Remediation */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 flex flex-col">
              <h3 className="text-lg font-extrabold text-white mb-2">
                Governance Remediation & Architecture Hardening
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-3">
                Remediate governance gaps, harden Microsoft 365 architecture,
                and align with compliance, security, and operational best
                practices.
              </p>
              <p className="text-sm text-slate-400 mb-2">
                <span className="font-semibold text-white">Typical range:</span>{" "}
                $8,000–$25,000+
              </p>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2">
                Typical SOW Includes
              </p>
              <ul className="space-y-2 mb-6">
                {[
                  "Implement or refine DLP, retention, and sensitivity label policies",
                  "Rebuild Teams and SharePoint information architecture",
                  "Clean up permission sprawl and rationalize access patterns",
                  "Implement lifecycle policies for sites, teams, and groups",
                  "Harden admin roles and privileged access",
                  "Establish governance operating model and documentation",
                ].map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-slate-300"
                  >
                    <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
              <CTAButton href="/book" className="mt-auto px-6 py-3 text-sm">
                Book a Free Scoping Call
              </CTAButton>
            </div>

            {/* Migration Execution */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 flex flex-col">
              <h3 className="text-lg font-extrabold text-white mb-2">
                Microsoft 365 Migration Execution
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-3">
                Execute a structured, low-risk migration into Microsoft 365
                based on risks, blockers, and data issues identified in
                assessment.
              </p>
              <p className="text-sm text-slate-400 mb-2">
                <span className="font-semibold text-white">Typical range:</span>{" "}
                $10,000–$35,000+
              </p>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2">
                Typical SOW Includes
              </p>
              <ul className="space-y-2 mb-6">
                {[
                  "Plan and execute Exchange, SharePoint, and OneDrive migrations",
                  "Perform tenant-to-tenant or cross-platform migrations",
                  "Map and classify data before migration",
                  "Build migration runbooks and rollback plans",
                  "Coordinate cutover and stakeholder communication",
                  "Post-migration stabilization and cleanup",
                ].map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-slate-300"
                  >
                    <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
              <CTAButton href="/book" className="mt-auto px-6 py-3 text-sm">
                Book a Free Scoping Call
              </CTAButton>
            </div>

            {/* Copilot Deployment */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 flex flex-col">
              <h3 className="text-lg font-extrabold text-white mb-2">
                Copilot for Microsoft 365 Deployment Project
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-3">
                Prepare tenant, data, and governance for a safe, effective
                Copilot rollout, then deploy to pilot and broader audiences.
              </p>
              <p className="text-sm text-slate-400 mb-2">
                <span className="font-semibold text-white">Typical range:</span>{" "}
                $12,000–$30,000+
              </p>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2">
                Typical SOW Includes
              </p>
              <ul className="space-y-2 mb-6">
                {[
                  "Clean up high-risk data locations and overshared content",
                  "Implement sensitivity labels and data classification",
                  "Restructure permissions to reduce Copilot exposure risk",
                  "Define Copilot governance and usage guardrails",
                  "Deploy Copilot to pilot groups",
                  "Deliver Copilot training and enablement",
                ].map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-slate-300"
                  >
                    <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
              <CTAButton href="/book" className="mt-auto px-6 py-3 text-sm">
                Book a Free Scoping Call
              </CTAButton>
            </div>
          </div>
        </div>
      </section>

      {/* Not Sure Where You Stand? Pick Your Assessment */}
      <section className="bg-slate-950 border-t border-slate-800/80 py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-blue-400 text-xs font-bold uppercase tracking-[0.15em] mb-3">
              Not Sure Where You Stand?
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
              Pick Your Assessment
            </h2>
            <p className="text-slate-300 max-w-2xl mx-auto leading-relaxed">
              Each assessment is a low-friction way to understand how your
              tenant behaves today — and what it will take to harden it.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Governance Assessment */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <h3 className="text-lg font-extrabold text-white mb-2">
                Governance & Architecture Assessment
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-4">
                Baseline your Microsoft 365 governance, configuration, and
                information architecture against NASA-grade standards.
              </p>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2">
                Best For
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                  New CISO or CTO needing an independent tenant review
                </li>
                <li className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                  Organisations with unclear ownership or sprawl
                </li>
              </ul>
              <CTAButton
                href="/assessments?tab=governance"
                className="mt-auto px-6 py-3 text-sm"
              >
                Start Governance Assessment
              </CTAButton>
            </div>

            {/* Copilot Readiness */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4">
                <Activity className="w-5 h-5 text-cyan-400" />
              </div>
              <h3 className="text-lg font-extrabold text-white mb-2">
                Copilot Readiness Assessment
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-4">
                Understand how Copilot will behave against your current data
                boundaries, permissions, and oversharing patterns.
              </p>
              <p className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2">
                Best For
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-cyan-400 mt-0.5" />
                  Organisations piloting or planning Copilot rollout
                </li>
                <li className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-cyan-400 mt-0.5" />
                  Teams concerned about AI surfacing sensitive content
                </li>
              </ul>
              <CTAButton
                href="/assessments?tab=copilot"
                className="mt-auto px-6 py-3 text-sm"
              >
                Start Copilot Assessment
              </CTAButton>
            </div>

            {/* Migration Readiness */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                <GitBranch className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-lg font-extrabold text-white mb-2">
                Migration Readiness Assessment
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-4">
                Evaluate risks, blockers, and data issues before moving into or
                consolidating Microsoft 365.
              </p>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2">
                Best For
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
                  Organisations with Exchange on-prem or legacy platforms
                </li>
                <li className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5" />
                  M&A scenarios requiring tenant consolidation
                </li>
              </ul>
              <CTAButton
                href="/assessments?tab=migration"
                className="mt-auto px-6 py-3 text-sm"
              >
                Start Migration Assessment
              </CTAButton>
            </div>
          </div>
        </div>
      </section>

      {/* Assessment selector (existing component) */}
      <section className="bg-slate-950 border-t border-slate-800/80 py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <AssessmentSelector />
        </div>
      </section>

      {/* Bridge — Full Diagnostic */}
      <section className="bg-slate-950 py-20 border-t border-slate-800/80">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-cyan-400 text-sm font-semibold uppercase tracking-[0.1em] mb-4">
            Go Deeper
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6 leading-tight max-w-2xl mx-auto">
            Ready for the Full Diagnostic?
          </h2>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
            The free assessments give you a directional score in 5 minutes. Our
            Tier 1 Quick Win packages run a complete automated diagnostic
            against your live Microsoft 365 tenant — no manual surveys, no
            guesswork. You get full health telemetry, a scored report across 5
            categories, and a scoped remediation proposal — all before you speak
            to Shane.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/quick-wins" className="text-base px-8 py-3">
              See Quick Win Packages <ArrowRight className="ml-2 w-4 h-4" />
            </CTAButton>
            <Link
              href="/book"
              className="inline-flex items-center justify-center border border-slate-700 text-white font-semibold px-8 py-3 rounded hover:bg-slate-900 transition-colors text-base whitespace-nowrap"
            >
              Book a Discovery Call
            </Link>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative bg-slate-950 py-20 border-t border-slate-800/80 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[180px]" />
        </div>
        <div className="relative max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.1em] mb-4">
            Ready to Get Started?
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 leading-tight">
            Let&apos;s Build Something That Works at Scale
          </h2>
          <p className="text-slate-300 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            No pitch. No obligation. 30 minutes with Shane to assess your
            environment and identify the fastest path to value.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton
              href="/book"
              className="text-base px-8 py-3"
              data-testid="closing-book-cta"
            >
              Book a Free Discovery Call <ArrowRight className="ml-2 w-4 h-4" />
            </CTAButton>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center border border-slate-700 text-white font-semibold px-8 py-3 rounded hover:bg-slate-900 transition-colors text-base whitespace-nowrap"
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
