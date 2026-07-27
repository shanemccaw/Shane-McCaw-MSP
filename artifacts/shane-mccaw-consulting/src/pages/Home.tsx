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
  ClipboardList,
  FileSearch,
  FolderOpen,
  type LucideIcon,
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
import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { HEALTH_PILLAR_LABELS, PILLAR_TO_TOPIC_SLUG } from "@/data/solutionsTopics";
import { trackEvent } from "@/lib/analytics";
import { ZONES, type ZoneKey, getZoneForService } from "@/lib/assessmentZones";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

// The funnel this site actually runs, in order — replaces the old Monitoring-first hero
// pitch. Each stage links to where a visitor actually goes next.
const FUNNEL_STAGES: { icon: LucideIcon; title: string; description: string; href: string }[] = [
  {
    icon: ClipboardList,
    title: "Take the Quiz",
    description: "A 3-question self-reported read on where your tenant likely stands — 60 seconds, no consent required.",
    href: "/quiz",
  },
  {
    icon: ScanLine,
    title: "Free Assessment",
    description: "A real, consent-gated Graph API scan of your live tenant — not a questionnaire.",
    href: "/assessments?tab=free",
  },
  {
    icon: FileSearch,
    title: "Paid Assessment",
    description: "Go deeper on the zone that matters most — identity, compliance, data, Copilot, cost, or the whole tenant.",
    href: "/assessments",
  },
  {
    icon: FolderOpen,
    title: "Project SOW",
    description: "A real gap becomes a scoped, priced engagement — not a self-checkout cart.",
    href: "/projects",
  },
];

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
// the named engines below (§6/ENGINES): a cold visitor should understand the kind of scan
// this is before meeting the specific engines that do it.
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
    "A real-time scan of your live configuration — not a cached snapshot from a form",
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
                href={`/projects/${worstSlug}`}
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
  const { projects, loading: projectsLoading } = useEngagementProjects();

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

  // Free stays understated/plain glass; Paid gets the gradient-bordered treatment — a
  // starker split than a plain "highlighted vs not" accent border would give within a
  // single tier grid.
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

  const renderProjectsShowcase = () => {
    if (projectsLoading) {
      return (
        <div className="flex justify-center items-center py-20 w-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
        </div>
      );
    }

    const visible = projects.filter((p) => p.isVisible);
    if (visible.length === 0) return null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
        {visible.map((project, i) => (
          <EngagementProjectCard key={project.id} project={project} index={i} />
        ))}
      </div>
    );
  };

  return (
    <Layout>
      <SEOMeta
        title="Shane McCaw Consulting | Microsoft 365 Assessments & Projects"
        description="A free, real Graph API assessment of your Microsoft 365 tenant, with a clear path to scoped projects — built on the governance discipline Shane McCaw wrote for NASA."
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
            <Link
              href="/assessments?tab=free"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold text-white shadow-lg shadow-accent-blue/20 transition-opacity hover:opacity-90 flex items-center justify-center gap-2 text-base whitespace-nowrap"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <span>Start a Free Assessment</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/quiz"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors flex items-center justify-center text-base whitespace-nowrap"
              data-track="cta"
            >
              Take the 60-Second Quiz First
            </Link>
          </div>

          {/* Signature stat panel — verified platform facts only, no fabricated live numbers
              on the cold-visitor hero (personalized real tenant scores are Stage 4, website-rebuild-reference-v2.md §3/§5) */}
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
            Real infrastructure reading your tenant — not marketing numbers
          </p>
          <div className="flex flex-wrap items-stretch justify-center gap-4 max-w-4xl mx-auto">
            <StatPanel label="Platform engines" value="12" className="min-w-[180px]" />
            <StatPanel label="Scan source" value="Live Graph API" className="min-w-[220px]" />
            <StatPanel label="Consent" value="Scoped, read-only" className="min-w-[260px]" />
          </div>
        </div>
      </section>

      {/* FUNNEL STRIP — Quiz → Free Assessment → Paid Assessment → Project SOW */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">How This Works</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
              From a <GradientText>60-second quiz</GradientText> to a scoped project
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FUNNEL_STAGES.map((stage, i) => {
              const Icon = stage.icon;
              return (
                <Link key={stage.title} href={stage.href} className="group relative" data-track="nav">
                  <div className="h-full flex flex-col p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] group-hover:border-accent-blue/30 transition-all">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue shrink-0">
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="font-numeric text-xs font-bold text-text-secondary">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="font-display font-semibold text-text-primary mb-2">{stage.title}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed flex-grow">{stage.description}</p>
                    <span className="mt-4 flex items-center gap-1.5 text-sm font-medium text-accent-blue group-hover:gap-2.5 transition-all">
                      Go <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
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
              Mission-Grade <GradientText>Assessments for Microsoft 365</GradientText>
            </h2>
            <p className="text-text-secondary">
              A real Graph API connection into your tenant — the same category of infrastructure
              teams run for servers and cloud estates, built specifically for Microsoft 365 — scored
              against your actual configuration, not a one-time PDF built from a questionnaire.
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
            The Scan Process
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-text-primary mb-3">
            How the <GradientText>Assessment</GradientText> Actually Works
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
              From Free Assessment to <GradientText>Scoped Project</GradientText>
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              Real catalog pricing, no sales call required. This is commercial Microsoft 365
              assessment and project pricing, not a federal compliance score or a government
              contract vehicle.
            </p>
          </div>

          {/* Full-width stacked rows in funnel order — Assessment (the free qualifying step)
              → Projects (the real engagements a gap turns into) → Retainer (the ongoing
              upgrade path). Each row owns a full-width band and reads cleanly top-to-bottom
              on mobile. */}
          <div className="space-y-16">
            {/* ROW 1 — ASSESSMENT (free qualifying step) */}
            <div>
              <div className="text-center max-w-2xl mx-auto mb-8">
                <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.06] text-accent-blue border border-white/[0.08] mb-3">
                  Start Here — Free
                </span>
                <h3 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
                  Mission Readiness <GradientText>Evaluation</GradientText>
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed mt-2">
                  A real Graph API scan of your tenant — know exactly where you stand before you
                  commit to anything.
                </p>
              </div>
              {renderAssessmentSplit()}
            </div>

            {/* ROW 2 — PROJECTS (what a real gap turns into) */}
            <div className="pt-12 border-t border-white/[0.06]">
              <div className="mb-8">
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full text-white mb-3"
                  style={GRADIENT_BG}
                >
                  <Sparkles className="w-3 h-3" />
                  Where An Assessment Leads
                </span>
                <h3 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
                  Scoped <GradientText>Projects</GradientText>
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed mt-2 max-w-2xl">
                  Once an assessment surfaces a real gap, this is the kind of scoped engagement
                  it turns into — every project starts with a conversation, not a cart.
                </p>
              </div>
              {renderProjectsShowcase()}
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
                  Fractional M365 architecture guidance, best paired with tenants already
                  running projects — but open to anyone ready to start.
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
              today — built on the same discipline I bring to M365 governance at NASA.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 max-w-xs sm:max-w-none mx-auto">
              <Link
                href="/assessments?tab=free"
                className="px-6 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                style={GRADIENT_BG}
                data-track="cta"
              >
                Start a Free Assessment
              </Link>
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
