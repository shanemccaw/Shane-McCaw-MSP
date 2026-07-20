import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import {
  ShieldCheck,
  Zap,
  ArrowRight,
  Activity,
  CheckCircle2,
  Clock,
  ChevronRight,
  Lock,
  AlertTriangle,
  Layers,
  Users,
  Sparkles,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { useServices, type PublicService } from "@/hooks/useServices";
import { useTypewriterHeadline } from "@/hooks/useHeroHeadlines";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useHealthPillars } from "@/hooks/usePersonalizationData";
import { HEALTH_PILLAR_LABELS, PILLAR_TO_TOPIC_SLUG } from "@/data/solutionsTopics";
import { trackEvent } from "@/lib/analytics";

interface MonitoringTypeAttributes {
  seatMin?: number;
  seatMax?: number | null;
  seatCountFloor?: number;
  pricePerUserMonth?: string;
  flatMonthlySurcharge?: string | null;
  tenantTierLabel?: string;
}

const SEAT_PRESETS = [10, 50, 250, 750];

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

// Tenant-facing engines only — the platform's full engine registry (12) also runs internal
// business-ops engines (Pricing, CRM, MSP Portfolio, etc.) that don't watch a customer tenant,
// so this list isn't labeled as "the platform's total engine count" anywhere on this page.
const ENGINES = [
  {
    id: "drift",
    name: "Drift Engine",
    description:
      "Every admin change gets fingerprinted against your baseline the moment it happens — not discovered six months later in an audit.",
    badge: "Configuration Baseline",
    icon: Layers,
  },
  {
    id: "security",
    name: "Security Engine",
    description:
      "Hunts anonymous share links, stale guest access, over-privileged OAuth apps, and MFA gaps before they become the incident report.",
    badge: "Threat Minimization",
    icon: Lock,
  },
  {
    id: "health",
    name: "Health Engine",
    description:
      "Scores tenant risk in real time and fires automated remediation runbooks — most issues get fixed before a human ever sees them.",
    badge: "SLA Remediation",
    icon: Activity,
  },
  {
    id: "sla",
    name: "SLA Engine",
    description:
      "Tracks every support commitment against the clock — response times, milestone delivery, uptime — so nothing slips quietly.",
    badge: "Delivery Performance",
    icon: Clock,
  },
  {
    id: "scope-creep",
    name: "Scope Creep Engine",
    description:
      "Checks live engineering work against the signed SOW continuously, catching drift between what was promised and what's being delivered.",
    badge: "Statement of Work Auditing",
    icon: AlertTriangle,
  },
  {
    id: "sales-offer",
    name: "Sales Offer Engine",
    description:
      "Reads tenant telemetry gaps and surfaces the exact upgrade or monitoring expansion that closes them — no generic upsells.",
    badge: "Upgrade Optimization",
    icon: Zap,
  },
];

/**
 * Assessment-tier real pillar overview (website-rebuild-reference-v2.md §3): a logged-in,
 * Assessment-verified visitor sees their actual Architecture Health Engine score front and
 * center, directing them to whichever topic page needs attention most. Cold and quiz-tier
 * visitors never see this section — it's added on top of Stage 3's hero, not a replacement
 * (Stage 4b task scope). Renders nothing while resolving or outside the "assessment" tier.
 */
function AssessmentHealthOverview() {
  const { tier, loading: tierLoading } = usePersonalizationState();
  const { loading: pillarsLoading, score, pillars } = useHealthPillars();

  const worst = useMemo(
    () => (pillars.length ? [...pillars].sort((a, b) => a.score - b.score)[0] : null),
    [pillars],
  );

  useEffect(() => {
    if (tier === "assessment" && !pillarsLoading && pillars.length > 0) {
      trackEvent("personalization_shown", { tier: "assessment", surface: "home_health_overview" });
    }
  }, [tier, pillarsLoading, pillars.length]);

  if (tierLoading || tier !== "assessment") return null;
  if (pillarsLoading || pillars.length === 0) return null;

  const worstSlug = worst ? PILLAR_TO_TOPIC_SLUG[worst.pillar] : null;
  const worstLabel = worst ? (HEALTH_PILLAR_LABELS[worst.pillar] ?? worst.pillar) : null;

  return (
    <section className="py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <GlassPanel className="p-8 sm:p-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-text-tertiary mb-2">
                Your real tenant health, right now
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
                {score !== null ? (
                  <>
                    Composite score:{" "}
                    <span className="font-numeric text-accent-blue">{Math.round(score)}</span>
                  </>
                ) : (
                  "Composite score not yet available"
                )}
              </h2>
            </div>
            {worst && worstSlug && (
              <Link
                href={`/solutions/${worstSlug}`}
                className="shrink-0 px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                data-track="cta"
                onClick={() =>
                  trackEvent("personalization_nudge_click", {
                    tier: "assessment",
                    surface: "home_health_overview",
                    pillar: worst.pillar,
                    destination: worstSlug,
                  })
                }
              >
                <span>{worstLabel} needs attention</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {pillars.map((p) => (
              <StatPanel
                key={p.pillar}
                label={HEALTH_PILLAR_LABELS[p.pillar] ?? p.pillar}
                value={Math.round(p.score)}
                className={worst && p.pillar === worst.pillar ? "border-accent-violet/50" : undefined}
              />
            ))}
          </div>
        </GlassPanel>
      </div>
    </section>
  );
}

export default function Home() {
  // {{db.services.all}}
  const { services, loading: servicesLoading, error: servicesError } = useServices();

  const [activeCatalogTab, setActiveCatalogTab] = useState<"monitoring" | "assessments" | "retainers">("monitoring");
  const [seatCount, setSeatCount] = useState<number>(25);
  const { leadDisplayed, gradientDisplayed } = useTypewriterHeadline();

  const assessments = services.filter((s) => s.serviceType === "assessment");
  const retainers = services.filter((s) => s.serviceType === "retainer");
  const monitoringRows = services.filter((s) => s.serviceType === "monitoring_tier");

  // Group monitoring rows into packages (Basic/Enhanced/Premium) by their `tier` column, each
  // package holding one row per tenant-size band (seatMin/seatMax in typeAttributes). Nothing here
  // is hardcoded — package names, taglines, and pricing all resolve from the API payload.
  const monitoringPackages = useMemo(() => {
    const groups = new Map<string, PublicService[]>();
    monitoringRows.forEach((row) => {
      const key = row.tier ?? "standard";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    });
    return Array.from(groups.values())
      .map((rows) => [...rows].sort((a, b) => a.sortOrder - b.sortOrder))
      .sort((a, b) => a[0].sortOrder - b[0].sortOrder);
  }, [monitoringRows]);

  const matchRowForSeats = (rows: PublicService[], seats: number): PublicService | null => {
    return (
      rows.find((r) => {
        const attrs = (r.typeAttributes ?? {}) as MonitoringTypeAttributes;
        const min = attrs.seatMin ?? 1;
        const max = attrs.seatMax ?? Infinity;
        return seats >= min && seats <= max;
      }) ?? null
    );
  };

  const computeMonthlyPrice = (row: PublicService, seats: number): number | null => {
    const attrs = (row.typeAttributes ?? {}) as MonitoringTypeAttributes;
    if (!attrs.pricePerUserMonth) return null;
    const perUser = parseFloat(attrs.pricePerUserMonth);
    if (isNaN(perUser)) return null;
    const floor = attrs.seatCountFloor ?? attrs.seatMin ?? 1;
    const surcharge = attrs.flatMonthlySurcharge ? parseFloat(attrs.flatMonthlySurcharge) : 0;
    const billableSeats = Math.max(seats, floor);
    return billableSeats * perUser + surcharge;
  };

  const packageDisplayName = (row: PublicService): string => row.name.split("—")[0].trim();

  const renderProductGrid = (items: PublicService[]) => {
    if (servicesLoading) {
      return (
        <div className="flex justify-center items-center py-20 w-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
        </div>
      );
    }

    if (servicesError || items.length === 0) {
      return (
        <div className="text-center py-12 text-text-secondary w-full border border-white/[0.08] rounded-2xl bg-charcoal-1">
          No active offerings found in the database. Please contact support.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {items.map((item) => (
          <div
            key={item.slug}
            className="flex flex-col rounded-2xl p-6 bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30 transition-all duration-200"
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/[0.06] text-accent-blue border border-white/[0.08]">
                {item.category ? item.category.toUpperCase() : "ENTERPRISE"}
              </span>
              {item.durationDays && (
                <span className="flex items-center gap-1 text-xs text-text-tertiary">
                  <Clock className="w-3.5 h-3.5" />
                  {item.durationDays} Days
                </span>
              )}
            </div>

            <h3 className="font-display text-xl font-bold text-text-primary mb-2">{item.name}</h3>
            <p className="text-sm text-text-secondary mb-6 flex-grow line-clamp-3">{item.description}</p>

            <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between mt-auto">
              <div>
                <span className="font-numeric text-2xl font-medium text-text-primary">
                  {item.isFreeOffering ? "FREE" : item.basePrice ? `$${Number(item.basePrice).toLocaleString()}` : "Custom"}
                </span>
                {!item.isFreeOffering && item.basePrice && (
                  <span className="text-xs text-text-tertiary ml-1">/ one-time</span>
                )}
              </div>
              <Link
                href={item.isFreeOffering ? `/contact?service=${item.slug}` : `/checkout?product=${item.slug}`}
                className="px-4 py-2 rounded-lg text-white text-xs font-bold transition-opacity hover:opacity-90 flex items-center gap-1"
                style={GRADIENT_BG}
                data-track="cta"
              >
                <span>{item.isFreeOffering ? "Request" : "Purchase"}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderMonitoringCalculator = () => {
    if (servicesLoading) {
      return (
        <div className="flex justify-center items-center py-20 w-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
        </div>
      );
    }

    if (servicesError || monitoringPackages.length === 0) {
      return (
        <div className="text-center py-12 text-text-secondary w-full border border-white/[0.08] rounded-2xl bg-charcoal-1">
          No active monitoring packages found. Please contact support.
        </div>
      );
    }

    return (
      <div className="w-full">
        <div className="flex flex-col items-center mb-10">
          <label htmlFor="seat-count" className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-3">
            <Users className="w-4 h-4 text-accent-blue" />
            How many licensed users are in your tenant?
          </label>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <input
              id="seat-count"
              type="number"
              min={1}
              value={seatCount}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setSeatCount(isNaN(v) || v < 1 ? 1 : v);
              }}
              className="w-28 text-center font-numeric text-lg font-medium bg-charcoal-1 border border-white/[0.08] rounded-xl px-3 py-2.5 text-text-primary focus:outline-none focus:border-accent-blue/60"
            />
            <div className="flex items-center gap-2">
              {SEAT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setSeatCount(preset)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                    seatCount === preset
                      ? "text-white"
                      : "bg-charcoal-1 text-text-secondary border border-white/[0.08] hover:text-text-primary hover:border-white/[0.16]"
                  }`}
                  style={seatCount === preset ? GRADIENT_BG : undefined}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {monitoringPackages.map((rows) => {
            const matched = matchRowForSeats(rows, seatCount);
            if (!matched) return null;

            const attrs = (matched.typeAttributes ?? {}) as MonitoringTypeAttributes;
            const price = computeMonthlyPrice(matched, seatCount);
            const isHighlighted = matched.highlighted;

            return (
              <div
                key={matched.tier ?? matched.slug}
                className={`flex flex-col rounded-2xl p-6 transition-all duration-200 relative ${
                  isHighlighted
                    ? "bg-charcoal-1 border-2 border-accent-blue/50 shadow-lg shadow-accent-blue/10"
                    : "bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30"
                }`}
              >
                {isHighlighted && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-wider"
                    style={GRADIENT_BG}
                  >
                    <Sparkles className="w-3 h-3" />
                    Most Comprehensive
                  </span>
                )}

                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-display text-xl font-bold text-text-primary">{packageDisplayName(matched)}</h3>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/[0.06] text-accent-blue border border-white/[0.08] whitespace-nowrap">
                    {attrs.tenantTierLabel ?? "Custom"}
                  </span>
                </div>

                <p className="text-sm text-text-secondary mb-6">{matched.tagline}</p>

                <div className="pt-2 pb-6 border-b border-white/[0.06] mb-6">
                  {price !== null ? (
                    <>
                      <span className="font-numeric text-3xl font-medium text-text-primary">
                        ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-sm text-text-tertiary ml-1">/mo</span>
                    </>
                  ) : (
                    <span className="font-numeric text-2xl font-medium text-text-primary">Custom</span>
                  )}
                  <div className="text-xs text-text-tertiary mt-1">For {seatCount.toLocaleString()} licensed users</div>
                </div>

                {matched.features && matched.features.length > 0 && (
                  <ul className="space-y-2.5 mb-6 flex-grow">
                    {matched.features.slice(0, 4).map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                        <CheckCircle2 className="w-4 h-4 text-accent-blue mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <Link
                  href={`/checkout?product=${matched.slug}`}
                  className={`mt-auto px-4 py-3 rounded-xl text-sm font-bold text-center transition-all flex items-center justify-center gap-1 ${
                    isHighlighted ? "text-white hover:opacity-90" : "bg-white/[0.06] hover:bg-white/[0.1] text-text-primary border border-white/[0.08]"
                  }`}
                  style={isHighlighted ? GRADIENT_BG : undefined}
                  data-track="cta"
                >
                  <span>Start Monitoring</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <SEOMeta
        title="Shane McCaw Consulting | Microsoft 365 Monitoring & Assessments"
        description="Continuous Microsoft 365 tenant monitoring plus a free, real Graph API assessment — built on the governance discipline Shane McCaw wrote for NASA."
      />

      {/* HERO */}
      <section className="relative pt-32 sm:pt-40 pb-20 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            Built by a Former NASA M365 Architect
          </div>

          <h1 className="font-display text-4xl sm:text-6xl font-bold text-text-primary tracking-tight leading-tight max-w-4xl mx-auto mb-6 min-h-[1.2em] sm:min-h-[2.4em]">
            {leadDisplayed}
            <GradientText>{gradientDisplayed}</GradientText>
            <span
              className="inline-block w-[3px] h-[0.85em] bg-accent-blue ml-1 align-middle animate-pulse"
              aria-hidden="true"
            />
          </h1>

          <p className="text-lg sm:text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed mb-10">
            Real Graph-based scans. Real engines. Not a questionnaire pretending to know your
            environment.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-md mx-auto mb-14">
            <a
              href="#catalog"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold text-white shadow-lg shadow-accent-blue/20 transition-opacity hover:opacity-90 flex items-center justify-center gap-2 text-base"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <span>See Monitoring Pricing</span>
              <ArrowRight className="w-5 h-5" />
            </a>
            <Link
              href="/assessments?tab=free"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors flex items-center justify-center text-base"
              data-track="cta"
            >
              Run a Free Assessment First
            </Link>
          </div>

          {/* Signature stat panel — verified platform facts only, no fabricated live numbers
              on the cold-visitor hero (personalized real tenant scores are Stage 4, website-rebuild-reference-v2.md §3/§5) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <StatPanel label="Platform engines" value="12" />
            <StatPanel label="Check cadence" value="Hourly–Daily" />
            <StatPanel label="Scan source" value="Live Graph API" />
          </div>
        </div>
      </section>

      <AssessmentHealthOverview />

      {/* CREDIBILITY */}
      <section className="py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-lg text-text-primary">
                  A Governance Standard Built at NASA
                </h3>
                <p className="text-sm text-text-secondary mt-1">
                  Shane McCaw wrote the M365 Copilot governance framework NASA distributed
                  agency-wide. The same discipline shapes every engine on this platform.
                </p>
              </div>
            </div>
            <div className="text-sm text-text-secondary max-w-md md:text-right">
              Risk, drift, and compliance are checked against your real tenant on a real
              schedule — not estimated from a questionnaire, and not left running in the
              background pretending nothing changes.
            </div>
          </GlassPanel>
        </div>
      </section>

      {/* ENGINE OVERVIEW */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              {ENGINES.length} Engines. <GradientText>Zero Guesswork.</GradientText>
            </h2>
            <p className="text-text-secondary">
              Real checks, on a real schedule, against your actual tenant.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ENGINES.map((eng) => {
              const Icon = eng.icon;
              return (
                <div
                  key={eng.id}
                  className="p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/20 transition-all flex flex-col"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-accent-blue mb-1">{eng.badge}</span>
                  <h3 className="font-display font-semibold text-lg text-text-primary mb-2">{eng.name}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{eng.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CATALOG */}
      <section id="catalog" className="py-16 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div>
              <h2 className="font-display text-3xl font-bold text-text-primary mb-3">
                Pricing That Matches Your Tenant
              </h2>
              <p className="text-text-secondary max-w-xl">
                Tell us your seat count — Monitoring pricing recalculates live from the catalog. No
                sales call required.
              </p>
            </div>
            <div className="flex glass-panel p-1.5 rounded-xl self-start md:self-auto">
              <button
                onClick={() => setActiveCatalogTab("monitoring")}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeCatalogTab === "monitoring" ? "text-white" : "text-text-secondary hover:text-text-primary"
                }`}
                style={activeCatalogTab === "monitoring" ? GRADIENT_BG : undefined}
              >
                Tenant Monitoring
              </button>
              <button
                onClick={() => setActiveCatalogTab("assessments")}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeCatalogTab === "assessments" ? "text-white" : "text-text-secondary hover:text-text-primary"
                }`}
                style={activeCatalogTab === "assessments" ? GRADIENT_BG : undefined}
              >
                Paid M365 Assessments
              </button>
              <button
                onClick={() => setActiveCatalogTab("retainers")}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeCatalogTab === "retainers" ? "text-white" : "text-text-secondary hover:text-text-primary"
                }`}
                style={activeCatalogTab === "retainers" ? GRADIENT_BG : undefined}
              >
                Advisory Retainers
              </button>
            </div>
          </div>

          <div className="flex justify-center">
            {activeCatalogTab === "monitoring" && renderMonitoringCalculator()}
            {activeCatalogTab === "assessments" && renderProductGrid(assessments)}
            {activeCatalogTab === "retainers" && renderProductGrid(retainers)}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Stop Finding Out About Problems Six Months Late
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto mb-8 text-sm sm:text-base">
              Start with a free assessment to see where your tenant stands today, or go straight to
              continuous monitoring built on the governance discipline Shane developed at NASA.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 max-w-xs sm:max-w-none mx-auto">
              <a
                href="#catalog"
                className="px-6 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                style={GRADIENT_BG}
                data-track="cta"
              >
                See Monitoring Pricing
              </a>
              <Link
                href="/contact"
                className="px-6 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
                data-track="cta"
              >
                Contact Shane McCaw
              </Link>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
