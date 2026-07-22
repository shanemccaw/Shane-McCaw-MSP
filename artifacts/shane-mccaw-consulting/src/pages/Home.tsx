import { useState, useMemo, useEffect, useRef, useLayoutEffect } from "react";
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
  ScanLine,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { ChatCTA } from "@/components/ChatCTA";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { HowItWorksShowcase } from "@/components/design-system/HowItWorksShowcase";
import { useServices, type PublicService } from "@/hooks/useServices";
import { useTypewriterHeadline } from "@/hooks/useHeroHeadlines";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useHealthPillars } from "@/hooks/usePersonalizationData";
import { HEALTH_PILLAR_LABELS, PILLAR_TO_TOPIC_SLUG } from "@/data/solutionsTopics";
import { trackEvent } from "@/lib/analytics";
import { ZONES, type ZoneKey, getZoneForService } from "@/lib/assessmentZones";

interface MonitoringTypeAttributes {
  seatMin?: number;
  seatMax?: number | null;
  seatCountFloor?: number;
  pricePerUserMonth?: string;
  flatMonthlySurcharge?: string | null;
  tenantTierLabel?: string;
  includedEngines?: string[] | null;
  includedFeatures?: string[] | null;
}

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

// Checklist copy for `typeAttributes.includedEngines` keys — confirmed against the real
// Engine Registry (api-server/src/lib/engine-registry.ts, 12 keys total, same source the
// admin Monitoring Tier editor's engine-picker reads from). Internal back-office engines
// (priority, pricing, forecasting, crm, msp) are deliberately omitted — never named on the
// public site (website-rebuild-reference-v2.md §6), so a tier row that happens to include
// one of those keys simply drops it from the customer-facing checklist rather than leaking
// the internal name.
const ENGINE_CHECKLIST_LABELS: Record<string, string> = {
  health: "Architecture Health scoring — governance, compliance, adoption, Copilot, and licensing",
  security: "Security Engine — anonymous links, guest access, OAuth risk, and MFA gaps",
  drift: "Drift Engine — every admin change fingerprinted against your baseline",
  sla: "SLA Engine — support commitments tracked against the clock",
  scope_creep: "Scope Creep Engine — live work checked against your signed SOW",
  monitoring: "Scheduled tenant scans on a real schedule",
  sales_offer: "Recommendation Engine — tells you what to fix next",
};

// Checklist copy for `typeAttributes.includedFeatures` keys — confirmed against the real
// Plan Feature Registry (api-server/src/lib/msp-entitlement.ts PLAN_FEATURE_DEFS), the same
// source the admin Monitoring Tier editor's feature-picker reads from. These keys are plain
// snake_case identifiers, not pre-formatted customer copy, so unmapped keys fall back to a
// humanized version of the raw key rather than being silently dropped.
const FEATURE_CHECKLIST_LABELS: Record<string, string> = {
  advanced_signals: "Advanced tenant signal rules and priority scoring",
  custom_workflows: "Custom automation workflows",
  sla_scope_creep_custom_rules: "MSP-authored SLA / Scope-Creep override rules",
  sales_offers: "Sales Offer Engine recommendations",
  custom_bundle_composition: "Custom multi-package monitoring bundles",
};

function humanizeFeatureKey(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildTierChecklist(attrs: MonitoringTypeAttributes): string[] {
  const engineItems = (attrs.includedEngines ?? [])
    .map((key) => ENGINE_CHECKLIST_LABELS[key])
    .filter((label): label is string => Boolean(label));
  const featureItems = (attrs.includedFeatures ?? []).map(
    (key) => FEATURE_CHECKLIST_LABELS[key] ?? humanizeFeatureKey(key),
  );
  return [...engineItems, ...featureItems];
}

// Tenant-facing engines only — the platform's full engine registry (12) also runs internal
// business-ops engines (Pricing, CRM, MSP Portfolio, etc.) that don't watch a customer tenant,
// so this list isn't labeled as "the platform's total engine count" anywhere on this page.
const ENGINES = [
  {
    id: "drift",
    name: "Drift Engine",
    description:
      "Every admin change is fingerprinted against your baseline and flagged the next time your tenant is evaluated — not discovered six months later in an audit.",
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
      "Scores tenant risk on every scheduled check. Where write-back remediation is configured for your tenant, common issues get resolved automatically — otherwise, they're flagged for you to act on.",
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
      "Checks live engineering work against the signed SOW on every scheduled review, catching drift between what was promised and what's being delivered.",
    badge: "Statement of Work Auditing",
    icon: AlertTriangle,
  },
  {
    id: "monitoring",
    name: "Monitoring Engine",
    description:
      "Runs platform-authored checks against your tenant on a real cadence — hourly to daily — and classifies what it finds by severity.",
    badge: "Scheduled Tenant Scans",
    icon: ScanLine,
  },
  {
    id: "recommendation",
    name: "Recommendation Engine",
    description:
      "Compares what your tenant actually needs against what you have today, and tells you exactly what to fix first — no generic upsells.",
    badge: "Gap-Closing Guidance",
    icon: Zap,
  },
];

// "What We Do" overview cards (Home §2) — deliberately category-level, not a re-listing of
// the named engines below (§6/ENGINES): a cold visitor should understand the kind of
// monitoring this is before meeting the specific engines that do it.
const WHAT_WE_DO = [
  {
    title: "Configuration & Drift Visibility",
    description:
      "Every admin change in your tenant is checked against your baseline, so configuration drift shows up on a scan instead of an incident report.",
    icon: Layers,
  },
  {
    title: "Security & Access Posture",
    description:
      "Anonymous share links, stale guest access, risky OAuth grants, and MFA gaps get surfaced from real Graph API data — not a self-reported checklist.",
    icon: Lock,
  },
  {
    title: "License, Cost & Adoption Signals",
    description:
      "Seat utilization, Copilot adoption, and licensing waste are tracked from your actual tenant usage, not estimated on a sales call.",
    icon: Users,
  },
  {
    title: "Compliance & Governance Mapping",
    description:
      "Governance and compliance posture are checked against your real tenant configuration on a running schedule, with every finding traceable back to the rule that raised it.",
    icon: ShieldCheck,
  },
];

// Differentiation copy (Home §4) — real Graph-based telemetry vs. the self-reported
// questionnaire/checklist model most MSPs and compliance vendors run on.
const TELEMETRY_COMPARISON = {
  themTitle: "Typical MSPs & Compliance Checklists",
  usTitle: "Real Tenant Telemetry",
  them: [
    "Self-reported surveys and static checklists",
    "A snapshot from the day someone filled out a form",
    'Generic "best practices" scored against a template, not your tenant',
    "Findings you have to take on faith, since nobody actually connected to your environment",
  ],
  us: [
    "A live Graph API connection into your actual tenant",
    "Scheduled re-checks — hourly to daily, with critical events flagged within minutes on Enhanced and Premium",
    "Every score traceable to a real, inspectable signal rule against your real configuration",
    "Findings generated by engines reading your tenant, not a person reading your answers",
  ],
};

// Index-aligned with HowItWorksShowcase's five fixed stage visuals (Connect, Scan, Findings,
// Score, Remediate — HowItWorksShowcase.tsx) so each step's left-column copy pairs with the
// right-column animation that actually illustrates it. Steps 1/2/4 keep this page's existing
// Establish-the-link / Full-spectrum-scan / composite-score copy verbatim; steps 3 and 5 are
// reworded (not reused from Governance) around Home's own real Findings and remediation
// claims — step 5 paraphrases the Health Engine's real remediation behavior from the ENGINES
// list below ("Where write-back remediation is configured for your tenant, common issues get
// resolved automatically. Otherwise, they're flagged for you to act on.").
const HOW_IT_WORKS_STEPS = [
  {
    step: 1,
    title: "Establish the link",
    railLabel: "Connect",
    description:
      "A quick, consent-gated connection to your Microsoft 365 tenant — no agents to install, no scripts to run.",
  },
  {
    step: 2,
    title: "Full-spectrum scan",
    railLabel: "Scan",
    description:
      "Real Graph API checks across governance, compliance, adoption, Copilot readiness, architecture, licensing, and security.",
  },
  {
    step: 3,
    title: "Every gap, logged",
    railLabel: "Findings",
    description:
      "Configuration drift, security gaps, licensing waste, and compliance exceptions are logged as real, inspectable findings — not a generic score with no explanation.",
  },
  {
    step: 4,
    title: "A real number, not a guess",
    railLabel: "Score",
    description:
      "A composite health score plus a pillar-by-pillar breakdown — not a generic questionnaire estimate.",
  },
  {
    step: 5,
    title: "Fixed automatically, or flagged for you",
    railLabel: "Remediate",
    description:
      "Where write-back remediation is configured for your tenant, common issues resolve automatically. Everything else is ranked and re-checked on your next scheduled evaluation.",
  },
];

// Scan-surface rows for the How It Works showcase's Scan stage — condensed from WHAT_WE_DO
// above (same four real categories, same claims, shortened to fit the animated panel's
// compact status-row layout) rather than inventing separate coverage language.
const HOME_SCAN_SURFACES = [
  { icon: Layers, label: "Configuration & Drift", sublabel: "Every admin change checked against your baseline" },
  { icon: Lock, label: "Security & Access Posture", sublabel: "Anonymous links, guest access, OAuth risk, MFA gaps" },
  { icon: Users, label: "License, Cost & Adoption", sublabel: "Seat utilization, Copilot adoption, licensing waste" },
  { icon: ShieldCheck, label: "Compliance & Governance", sublabel: "Governance posture against your real configuration" },
];

// Illustrative-only mockup data for the How It Works showcase's Findings/Score/Remediate
// stages — not a live/real customer score, same convention as the (now-replaced) static
// Mission Control preview panel this section used to show. ringValue 49 (red tier per
// PillarScoreRing's scoreTone) matches the same treatment applied to the Governance topic
// page's illustrative ring; remediatedRingValue 92 (green tier) is the Remediate stage's
// illustrative after-state.
const HOME_HOW_IT_WORKS_DASHBOARD = {
  panelLabel: "Mission Control preview",
  ringLabel: "Composite tenant health",
  ringValue: 49,
  remediatedRingValue: 92,
  metrics: [
    { label: "Configuration drift flags", count: 9 },
    { label: "Security & access gaps", count: 14 },
    { label: "Licensing & adoption gaps", count: 5 },
    { label: "Compliance exceptions", count: 3 },
  ],
  caption: "Example data — not your real score",
};

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
    <section className="py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <GlassPanel className="p-8 sm:p-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-text-secondary mb-2">
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

  const [seatCount, setSeatCount] = useState<number>(25);
  // Narrows the "Go deeper — paid assessments" grid by the same 6-zone taxonomy
  // Assessments.tsx uses for its full zone browsing — null = show every paid
  // assessment, unfiltered.
  const [paidAssessmentZone, setPaidAssessmentZone] = useState<ZoneKey | null>(null);
  const { leadDisplayed, gradientDisplayed, headlines } = useTypewriterHeadline();

  // Measures every candidate headline's actual rendered height (off-screen, visibility:hidden
  // so layout is still computed) and reserves that max as the h1's min-height, instead of a
  // guessed Tailwind min-h that can't account for every headline wrapping differently per
  // viewport width. Re-measures on resize since wrap points shift with width. Runs in
  // useLayoutEffect (before paint) so the reserved space is in place before typing starts.
  const heroMeasureRef = useRef<HTMLDivElement>(null);
  const [heroMinHeight, setHeroMinHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const container = heroMeasureRef.current;
      if (!container) return;
      const max = Array.from(container.children).reduce(
        (tallest, el) => Math.max(tallest, (el as HTMLElement).offsetHeight),
        0,
      );
      if (max > 0) setHeroMinHeight(max);
    };

    measure();

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(measure, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimeout);
    };
  }, [headlines]);

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

  // Seat slider range + tier-boundary tick marks, derived entirely from the real
  // seatMin/seatMax values on the fetched monitoring rows — never hardcoded, so this
  // stays correct if pricing tiers change without a website deploy.
  const seatSlider = useMemo(() => {
    const mins: number[] = [];
    const maxes: number[] = [];
    let hasUnboundedBand = false;
    monitoringRows.forEach((row) => {
      const attrs = (row.typeAttributes ?? {}) as MonitoringTypeAttributes;
      const hasMin = typeof attrs.seatMin === "number";
      if (hasMin) mins.push(attrs.seatMin as number);
      if (typeof attrs.seatMax === "number") {
        maxes.push(attrs.seatMax);
      } else if (hasMin) {
        // A band with a real seatMin but a null/absent seatMax is the unbounded
        // "Enterprise" tier (seatMax: null in the catalog). The slider must extend
        // PAST the highest finite seatMax or this band is never selectable — which
        // is the real defect behind the seat slider capping at the last finite tier.
        hasUnboundedBand = true;
      }
    });
    const sliderMin = mins.length ? Math.min(...mins, 1) : 1;
    const finiteCeiling = maxes.length ? Math.max(...maxes) : null;
    const topMin = mins.length ? Math.max(...mins) : 1;
    // When an unbounded Enterprise band exists, give the slider real headroom above
    // both the highest finite seatMax and the Enterprise band's own seatMin so that
    // band can actually be reached and priced (Enterprise still quotes higher via
    // Contact for tenants beyond this range — the "+" suffix on the max label signals it).
    const sliderMax = hasUnboundedBand
      ? Math.max(finiteCeiling ?? 0, topMin) * 4
      : (finiteCeiling ?? topMin * 4);
    const markers = Array.from(new Set(mins.filter((m) => m > sliderMin && m < sliderMax))).sort(
      (a, b) => a - b,
    );
    const presets = Array.from(new Set(mins.length ? mins : [sliderMin])).sort((a, b) => a - b);
    return { sliderMin, sliderMax, markers, presets };
  }, [monitoringRows]);

  useEffect(() => {
    if (monitoringRows.length === 0) return;
    setSeatCount((prev) => Math.min(Math.max(prev, seatSlider.sliderMin), seatSlider.sliderMax));
  }, [monitoringRows.length, seatSlider.sliderMin, seatSlider.sliderMax]);

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
                <span className="flex items-center gap-1 text-xs text-text-secondary">
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
                  <span className="text-xs text-text-secondary ml-1">/ one-time</span>
                )}
              </div>
              <Link
                href={`/checkout/${item.slug}`}
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

  // Free stays understated/plain glass; Paid gets the gradient-bordered treatment — same
  // gradient-wrap technique implied by the isHighlighted monitoring-tier card's accent
  // border below, just carried to a full gradient ring since Free/Paid needs a starker split
  // than "highlighted vs not" within a single tier grid.
  const renderAssessmentCard = (item: PublicService, isPaid: boolean) => {
    const card = (
      <div
        className={`flex flex-col h-full rounded-2xl p-6 transition-all duration-200 ${
          isPaid ? "bg-charcoal-1" : "glass-panel hover:border-white/[0.18]"
        }`}
      >
        <div className="flex justify-between items-start mb-4">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/[0.06] text-accent-blue border border-white/[0.08]">
            {item.category ? item.category.toUpperCase() : "ENTERPRISE"}
          </span>
          {item.durationDays && (
            <span className="flex items-center gap-1 text-xs text-text-secondary">
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
              <span className="text-xs text-text-secondary ml-1">/ one-time</span>
            )}
          </div>
          <Link
            href={`/checkout/${item.slug}`}
            className="px-4 py-2 rounded-lg text-white text-xs font-bold transition-opacity hover:opacity-90 flex items-center gap-1"
            style={GRADIENT_BG}
            data-track="cta"
          >
            <span>{item.isFreeOffering ? "Begin Mission Readiness" : "Run My Full Evaluation"}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );

    if (!isPaid) {
      return <div key={item.slug}>{card}</div>;
    }

    return (
      <div key={item.slug} className="rounded-2xl p-[1.5px]" style={GRADIENT_BG}>
        {card}
      </div>
    );
  };

  const renderAssessmentSplit = () => {
    if (servicesLoading) {
      return (
        <div className="flex justify-center items-center py-20 w-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
        </div>
      );
    }

    if (servicesError || assessments.length === 0) {
      return (
        <div className="text-center py-12 text-text-secondary w-full border border-white/[0.08] rounded-2xl bg-charcoal-1">
          No active offerings found in the database. Please contact support.
        </div>
      );
    }

    const freeAssessments = assessments.filter((a) => a.isFreeOffering);
    const paidAssessments = assessments.filter((a) => !a.isFreeOffering);

    // Zones actually represented among the paid catalog, in the same fixed
    // ZONES order — a zone with zero paid assessments doesn't get a chip.
    const paidZoneCounts = ZONES.map((zone) => ({
      zone,
      count: paidAssessments.filter((a) => getZoneForService(a) === zone.key).length,
    })).filter((z) => z.count > 0);

    const visiblePaidAssessments = paidAssessmentZone
      ? paidAssessments.filter((a) => getZoneForService(a) === paidAssessmentZone)
      : paidAssessments;

    return (
      <div className="w-full space-y-12">
        {freeAssessments.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">
              Start here — no cost
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {freeAssessments.map((item) => renderAssessmentCard(item, false))}
            </div>
          </div>
        )}
        {paidAssessments.length > 0 && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-xs uppercase tracking-widest text-text-secondary">
                Go deeper — paid assessments
              </p>
              {paidZoneCounts.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setPaidAssessmentZone(null)}
                    aria-pressed={paidAssessmentZone === null}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      paidAssessmentZone === null
                        ? "bg-accent-blue/15 text-accent-blue border-accent-blue/40"
                        : "text-text-secondary border-white/[0.1] hover:text-text-primary hover:border-white/[0.2]"
                    }`}
                  >
                    All
                  </button>
                  {paidZoneCounts.map(({ zone, count }) => (
                    <button
                      key={zone.key}
                      onClick={() => setPaidAssessmentZone(zone.key)}
                      aria-pressed={paidAssessmentZone === zone.key}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        paidAssessmentZone === zone.key
                          ? "bg-accent-blue/15 text-accent-blue border-accent-blue/40"
                          : "text-text-secondary border-white/[0.1] hover:text-text-primary hover:border-white/[0.2]"
                      }`}
                    >
                      {zone.label} <span className="opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visiblePaidAssessments.map((item) => renderAssessmentCard(item, true))}
            </div>
          </div>
        )}
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

    const clampedSeatCount = Math.min(Math.max(seatCount, seatSlider.sliderMin), seatSlider.sliderMax);
    const sliderRange = seatSlider.sliderMax - seatSlider.sliderMin;
    const sliderPct = sliderRange > 0 ? ((clampedSeatCount - seatSlider.sliderMin) / sliderRange) * 100 : 0;

    return (
      <div className="w-full">
        <GlassPanel className="p-4 sm:p-5 mb-6 max-w-xl mx-auto">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <label htmlFor="seat-count" className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
              <Users className="w-3.5 h-3.5 text-accent-blue" />
              Licensed users
            </label>
            <div className="flex items-baseline gap-1">
              <span className="gradient-text font-numeric text-2xl sm:text-3xl font-bold tabular-nums">
                {clampedSeatCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-text-secondary uppercase tracking-wider">seats</span>
            </div>
          </div>

          <div className="relative px-1 mb-1 pt-2.5">
            {seatSlider.markers.map((m) => {
              const markerPct = ((m - seatSlider.sliderMin) / sliderRange) * 100;
              return (
                <div
                  key={m}
                  className="absolute top-0 pointer-events-none w-[2px] h-3 bg-white/25 -translate-x-1/2"
                  style={{ left: `${markerPct}%` }}
                  title={`Tier boundary — ${m.toLocaleString()} seats`}
                />
              );
            })}
            <input
              id="seat-count"
              type="range"
              min={seatSlider.sliderMin}
              max={seatSlider.sliderMax}
              value={clampedSeatCount}
              onChange={(e) => setSeatCount(parseInt(e.target.value, 10))}
              className="seat-slider w-full"
              style={{
                background: `linear-gradient(90deg, var(--accent-blue), var(--accent-violet) ${sliderPct}%, rgba(255,255,255,0.1) ${sliderPct}%, rgba(255,255,255,0.1) 100%)`,
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-text-secondary font-numeric mb-3">
            <span>{seatSlider.sliderMin.toLocaleString()}</span>
            <span>{seatSlider.sliderMax.toLocaleString()}+</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {seatSlider.presets.map((preset) => (
              <button
                key={preset}
                onClick={() => setSeatCount(preset)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                  clampedSeatCount === preset
                    ? "text-white"
                    : "bg-charcoal-1 text-text-secondary border border-white/[0.08] hover:text-text-primary hover:border-white/[0.16]"
                }`}
                style={clampedSeatCount === preset ? GRADIENT_BG : undefined}
              >
                {preset.toLocaleString()}
              </button>
            ))}
          </div>
        </GlassPanel>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {monitoringPackages.map((rows) => {
            const matched = matchRowForSeats(rows, clampedSeatCount);
            if (!matched) return null;

            const attrs = (matched.typeAttributes ?? {}) as MonitoringTypeAttributes;
            const price = computeMonthlyPrice(matched, clampedSeatCount);
            const isHighlighted = matched.highlighted;
            const checklist = buildTierChecklist(attrs);

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
                      <span className="text-sm text-text-secondary ml-1">/mo</span>
                    </>
                  ) : (
                    <span className="font-numeric text-2xl font-medium text-text-primary">Custom</span>
                  )}
                  <div className="text-xs text-text-secondary mt-1">For {clampedSeatCount.toLocaleString()} licensed users</div>
                </div>

                {checklist.length > 0 && (
                  <ul className="space-y-2.5 mb-6 flex-grow">
                    {checklist.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                        <CheckCircle2 className="w-4 h-4 text-accent-blue mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <Link
                  // Carry the selected seat count into checkout. Without ?seats=, the
                  // checkout + server default to 1 seat and charge pricePerUserMonth × 1
                  // (≈ $7) instead of the real per-tenant price — the critical revenue bug.
                  href={`/checkout/${matched.slug}?seats=${clampedSeatCount}`}
                  className={`mt-auto px-4 py-3 rounded-xl text-sm font-bold text-center transition-all flex items-center justify-center gap-1 ${
                    isHighlighted ? "text-white hover:opacity-90" : "bg-white/[0.06] hover:bg-white/[0.1] text-text-primary border border-white/[0.08]"
                  }`}
                  style={isHighlighted ? GRADIENT_BG : undefined}
                  data-track="cta"
                >
                  <span>Start Continuous Monitoring</span>
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
      <section className="relative pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            Built by a NASA M365 Architect
          </div>

          <div
            ref={heroMeasureRef}
            aria-hidden="true"
            className="font-display text-4xl sm:text-6xl font-bold tracking-tight leading-tight max-w-4xl mx-auto invisible"
            style={{ height: 0, overflow: "hidden" }}
          >
            {headlines.map((h, i) => (
              <div key={i}>
                {h.leadText}
                {h.gradientText}
              </div>
            ))}
          </div>

          <h1
            className="font-display text-4xl sm:text-6xl font-bold text-text-primary tracking-tight leading-tight max-w-4xl mx-auto mb-6 min-h-[1.2em] sm:min-h-[2.4em]"
            style={heroMinHeight ? { minHeight: `${heroMinHeight}px` } : undefined}
          >
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

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-2xl mx-auto mb-14">
            <a
              href="#catalog"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold text-white shadow-lg shadow-accent-blue/20 transition-opacity hover:opacity-90 flex items-center justify-center gap-2 text-base whitespace-nowrap"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <span>See Monitoring Pricing</span>
              <ArrowRight className="w-5 h-5" />
            </a>
            <Link
              href="/assessments?tab=free"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors flex items-center justify-center text-base whitespace-nowrap"
              data-track="cta"
            >
              Run a Free Assessment First
            </Link>
          </div>

          {/* Signature stat panel — verified platform facts only, no fabricated live numbers
              on the cold-visitor hero (personalized real tenant scores are Stage 4, website-rebuild-reference-v2.md §3/§5) */}
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
            Real infrastructure watching your tenant — not marketing numbers
          </p>
          <div className="flex flex-wrap items-stretch justify-center gap-4 max-w-4xl mx-auto">
            <StatPanel label="Platform engines" value="12" className="min-w-[180px]" />
            <StatPanel label="Check cadence" value="Hourly–Daily" className="min-w-[220px]" />
            <StatPanel label="Scan source" value="Live Graph API" className="min-w-[260px]" />
          </div>
        </div>
      </section>

      <AssessmentHealthOverview />

      {/* WHAT WE DO */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">What We Do</p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Mission-Grade <GradientText>Monitoring for Microsoft 365</GradientText>
            </h2>
            <p className="text-text-secondary">
              The same category of tool infrastructure teams run for servers and cloud teams
              run for their cloud estate — Datadog, Wiz, New Relic — built specifically for
              Microsoft 365. A real Graph API connection into your tenant, scored and tracked
              on a real schedule, not a one-time PDF that goes stale the day it's delivered.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {WHAT_WE_DO.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/20 transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-semibold text-lg text-text-primary mb-2">{item.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CREDIBILITY */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
              Operator Credential
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary">
              Built by the <GradientText>Microsoft 365 Architect</GradientText> for NASA
            </h2>
          </div>
          <GlassPanel className="p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <p className="text-sm text-text-secondary">
                I wrote the M365 Copilot governance framework NASA distributed agency-wide,
                and I work day-to-day inside NASA's BOD-25 secure-configuration push, CISA's
                SCuBA hardening baselines, and its Zero Trust architecture rollout. This
                platform doesn't score your tenant against those specific federal
                frameworks — that's not what it's built to do — but every engine on it runs
                on the same discipline I bring to NASA's own environment.
              </p>
            </div>
            <div className="text-sm text-text-secondary max-w-md md:text-right">
              Risk, drift, and compliance are checked against your real tenant on a real
              schedule — not estimated from a questionnaire, and not left running in the
              background hoping nothing changed.
            </div>
          </GlassPanel>
        </div>
      </section>

      {/* REAL TENANT TELEMETRY */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">The Difference</p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Real Tenant Telemetry — <GradientText>Not Questionnaires</GradientText>
            </h2>
            <p className="text-text-secondary">
              Most MSPs and compliance vendors start with a form. This platform starts with a
              live connection to your tenant.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl p-6 sm:p-8 bg-charcoal-1 border border-white/[0.06]">
              <h3 className="text-xs uppercase tracking-widest text-text-secondary mb-5">
                {TELEMETRY_COMPARISON.themTitle}
              </h3>
              <ul className="space-y-3">
                {TELEMETRY_COMPARISON.them.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <GlassPanel className="p-6 sm:p-8">
              <h3 className="text-xs uppercase tracking-widest text-accent-blue mb-5">
                {TELEMETRY_COMPARISON.usTitle}
              </h3>
              <ul className="space-y-3">
                {TELEMETRY_COMPARISON.us.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — same text-left/visual-right flagship pairing established on the
          Governance topic page (SolutionTopicPage.tsx): one header block above a single
          max-w-5xl wrapper, then HowItWorksShowcase's own paired grid (real steps on the
          left, one animated visual per step on the right, both columns matched height via
          the showcase's own items-stretch/h-full layout) — replacing the old mismatched
          max-w-6xl grid + max-w-3xl centered header + static Mission Control panel, which
          left a visible height gap next to the short step list. */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
            Continuous Monitoring
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-text-primary mb-3">
            How <GradientText>Continuous Monitoring</GradientText> Actually Works
          </h2>
          <p className="text-text-secondary mb-10 max-w-2xl">
            Five real steps, on a real schedule. No black box.
          </p>

          <HowItWorksShowcase
            steps={HOW_IT_WORKS_STEPS}
            dashboard={HOME_HOW_IT_WORKS_DASHBOARD}
            scanSurfaces={HOME_SCAN_SURFACES}
          />
        </div>
      </section>

      {/* ENGINE OVERVIEW */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
              Operational Intelligence Systems
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              The <GradientText>Engines</GradientText> That Power Your Tenant
            </h2>
            <p className="text-text-secondary">
              {ENGINES.length} real engines, running real checks, on a real schedule against
              your actual tenant — not a marketing number.
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
      <section id="catalog" className="py-12 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
              Commercial Tenant Pricing
            </p>
            <h2 className="font-display text-3xl font-bold text-text-primary mb-3">
              Mission-Grade Pricing for <GradientText>Commercial Tenants</GradientText>
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              Enter your seat count — pricing recalculates live from the real catalog, no
              sales call required. This is commercial Microsoft 365 monitoring and
              assessment pricing, not a federal compliance score or a government contract
              vehicle.
            </p>
          </div>

          {/* Full-width stacked rows in priority order — Monitoring (the recurring hero
              product) → Assessment (the free qualifying step) → Retainer (the upgrade path).
              Replaces the old 3-way tab/path-card layout, where Monitoring's correct visual
              weight left Assessment and Retainer squeezed with no room to present their offer.
              Each row now owns a full-width band and reads cleanly top-to-bottom on mobile. */}
          <div className="space-y-16">
            {/* ROW 1 — MONITORING (hero) */}
            <div>
              <div className="text-center max-w-2xl mx-auto mb-8">
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full text-white mb-3"
                  style={GRADIENT_BG}
                >
                  <Sparkles className="w-3 h-3" />
                  The Recurring Foundation
                </span>
                <h3 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
                  Tenant Telemetry &amp; <GradientText>Drift Enforcement</GradientText>
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed mt-2">
                  Scheduled Graph-based scans across governance, security, compliance, and
                  adoption — the recurring foundation everything else feeds. Priced per licensed
                  seat, live from the real catalog.
                </p>
              </div>
              {renderMonitoringCalculator()}
            </div>

            {/* ROW 2 — ASSESSMENT (free qualifying step) */}
            <div className="pt-12 border-t border-white/[0.06]">
              <div className="mb-8">
                <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.06] text-accent-blue border border-white/[0.08] mb-3">
                  Start Here — Free
                </span>
                <h3 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
                  Mission Readiness <GradientText>Evaluation</GradientText>
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed mt-2 max-w-2xl">
                  A real Graph API scan of your tenant — know exactly where you stand before you
                  commit to anything.
                </p>
              </div>
              {renderAssessmentSplit()}
            </div>

            {/* ROW 3 — RETAINER / ADVISORY (upgrade path) */}
            <div className="pt-12 border-t border-white/[0.06]">
              <div className="mb-8">
                <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.06] text-accent-blue border border-white/[0.08] mb-3">
                  Ongoing Advisory
                </span>
                <h3 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
                  Advisory <GradientText>Retainers</GradientText>
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed mt-2 max-w-2xl">
                  Fractional M365 architecture guidance, best paired with tenants already under
                  monitoring — but open to anyone ready to start.
                </p>
              </div>
              {renderProductGrid(retainers)}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Begin <GradientText>Mission Readiness</GradientText>
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto mb-8 text-sm sm:text-base">
              Start with a free Mission Readiness Evaluation to see where your tenant stands
              today, or move straight to Tenant Telemetry &amp; Drift Enforcement — built on the
              same discipline I bring to M365 governance at NASA.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 max-w-xs sm:max-w-none mx-auto">
              <a
                href="#catalog"
                className="px-6 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                style={GRADIENT_BG}
                data-track="cta"
              >
                Start Continuous Monitoring
              </a>
              <ChatCTA
                className="px-6 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
                data-track="cta"
              >
                Contact Shane McCaw
              </ChatCTA>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
