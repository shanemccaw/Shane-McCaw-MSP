import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useServices, type PublicService } from "../hooks/useServices";
import { trackPricingInteraction } from "../lib/analytics";
import { Layout } from "../components/Layout";
import { SEOMeta } from "../components/SEOMeta";
import { GlassPanel } from "../components/design-system/GlassPanel";
import { GradientText } from "../components/design-system/GradientText";
import { StatPanel } from "../components/design-system/StatPanel";
import {
  ShieldCheck, Activity, Lock, AlertTriangle, ArrowRight, Zap,
  CheckCircle2, Layers, Clock, ChevronRight, Database, Cpu, Radio,
  BarChart2, RefreshCw, Users, Sparkles, Eye, Wrench, Award,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };
const SEAT_PRESETS = [10, 50, 250, 750];

interface MonitoringTypeAttributes {
  seatMin?: number;
  seatMax?: number | null;
  seatCountFloor?: number;
  pricePerUserMonth?: string;
  flatMonthlySurcharge?: string | null;
  tenantTierLabel?: string;
}

// Tenant-facing engines only — the platform's engine registry runs 12 engines total, but
// several (Pricing, CRM, MSP Portfolio, Priority, Forecasting) are internal business-ops/
// Portal-internal engines that don't belong on customer-facing marketing, so this page never
// states a single "the platform has N engines" total.
const ENGINES = [
  {
    id: "health",
    icon: Activity,
    name: "Health Engine",
    badge: "SLA Remediation",
    color: "emerald",
    benefit: "See tenant health decline before it becomes downtime or a support ticket.",
    description:
      "Calculates a composite tenant health score on every scheduled check, across licensing utilization, service health anomalies, and operational KPIs. When the score degrades below threshold, automated remediation runbooks can execute to correct qualifying anomalies — where write-back remediation is enabled for that tenant, not guaranteed for every customer today.",
    signals: [
      "Composite health score",
      "License utilization efficiency",
      "Automated remediation runbooks",
      "Service health correlation",
    ],
  },
  {
    id: "security",
    icon: Lock,
    name: "Security Engine",
    badge: "Threat Minimization",
    color: "red",
    benefit: "Close the exposures attackers actually look for — before they're used against you.",
    description:
      "Harvests Microsoft Graph telemetry to identify active security exposures: anonymous sharing links left open, stale external guest accounts with residual permissions, over-privileged OAuth application consents, and missing MFA registration on privileged identities.",
    signals: [
      "Anonymous link detection",
      "Stale guest account audits",
      "OAuth app permission risk",
      "MFA coverage analysis",
    ],
  },
  {
    id: "drift",
    icon: Layers,
    name: "Drift Engine",
    badge: "Configuration Baseline",
    color: "blue",
    benefit: "Catch unauthorized configuration changes on a real cadence — not whenever someone happens to notice.",
    description:
      "Compares your live M365 tenant configuration against your approved governance baseline on every scheduled check. Administrative changes — from conditional access policy tweaks to SharePoint guest settings — are flagged as drift the next time your tenant is evaluated, so unauthorized changes don't sit unnoticed indefinitely.",
    signals: [
      "Baseline deviation alerts",
      "Admin action correlation",
      "Configuration snapshot deltas",
      "Unauthorized policy changes",
    ],
  },
  {
    id: "sla",
    icon: Clock,
    name: "SLA Engine",
    badge: "Delivery Performance",
    color: "indigo",
    benefit: "Catch an SLA breach forming before it becomes a hard conversation with your client.",
    description:
      "Tracks every support delivery obligation — response timelines, milestone execution rates, uptime guarantees, and escalation thresholds. Proactively surfaces impending SLA breaches before they become contractual failures.",
    signals: [
      "Response timeline tracking",
      "Milestone execution rates",
      "Uptime SLA dashboards",
      "Escalation threshold alerts",
    ],
  },
  {
    id: "monitoring",
    icon: Eye,
    name: "Monitoring Engine",
    badge: "Check Execution",
    color: "violet",
    benefit: "This is the engine actually running the checks — the real foundation every other score is built on.",
    description:
      "Executes the platform's library of Monitor Checks directly against your tenant via Microsoft Graph, on your package's configured schedule, and classifies what it finds by severity. Every score and alert the other engines surface starts as a real, recorded check result here — not an estimate.",
    signals: [
      "Scheduled Graph-based checks",
      "Severity classification",
      "Full check coverage history",
      "Feeds every other engine's data",
    ],
  },
  {
    id: "scope-creep",
    icon: AlertTriangle,
    name: "Scope Creep Engine",
    badge: "SOW Auditing",
    color: "amber",
    benefit: "Keep every hour of work provably tied to what's actually in the SOW — no billing disputes.",
    description:
      "Monitors ongoing engineer workstreams against the legal Statement of Work parameters. Every hour of work is validated against contracted scope to ensure all client operations are correctly accounted for and no undocumented obligations accumulate.",
    signals: [
      "SOW parameter mapping",
      "Engineer workstream audit",
      "Out-of-scope flagging",
      "Billing accuracy enforcement",
    ],
  },
];

const colorMap: Record<string, { icon: string; badge: string; border: string; check: string }> = {
  blue: { icon: "text-accent-blue", badge: "bg-white/[0.06] text-accent-blue border-white/[0.08]", border: "border-accent-blue/20", check: "text-accent-blue" },
  red: { icon: "text-red-400", badge: "bg-red-500/10 text-red-400 border-red-500/20", border: "border-red-500/20", check: "text-red-400" },
  emerald: { icon: "text-emerald-400", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", border: "border-emerald-500/20", check: "text-emerald-400" },
  indigo: { icon: "text-indigo-400", badge: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20", border: "border-indigo-500/20", check: "text-indigo-400" },
  amber: { icon: "text-amber-400", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20", border: "border-amber-500/20", check: "text-amber-400" },
  violet: { icon: "text-accent-violet", badge: "bg-white/[0.06] text-accent-violet border-white/[0.08]", border: "border-accent-violet/20", check: "text-accent-violet" },
};

const PIPELINE = [
  { icon: Database, label: "Microsoft Graph API", desc: "Tenant telemetry harvested via authenticated Graph queries, on each check's configured schedule" },
  { icon: Cpu, label: "Signal Engine Analysis", desc: "Specialized engines evaluate telemetry against governance rule sets" },
  { icon: Radio, label: "Alert & Prioritization", desc: "Findings are severity-scored and routed to your dashboard, with critical items surfaced first" },
  { icon: RefreshCw, label: "Automated Remediation", desc: "Where write-back remediation is enabled, the runbook executor resolves qualifying findings automatically — configured per tenant, not on by default for every customer" },
  { icon: BarChart2, label: "Reporting & Insights", desc: "Tenant health score, trend analysis and executive-ready audit reports" },
];

export default function Monitoring() {
  // {{db.monitoring.packages}} -- fetch monitoring tier services from database
  const { services, loading, error } = useServices();
  const monitoringRows = services.filter((s) => s.serviceType === "monitoring_tier");

  const [seatCount, setSeatCount] = useState<number>(25);

  // Group monitoring rows into packages by their `tier` column, each package holding one row per
  // tenant-size band (seatMin/seatMax in typeAttributes) — same real catalog shape Home.tsx's
  // calculator uses (website-rebuild-reference-v2.md §2: monitoring rows carry null basePrice by
  // design, real pricing lives in typeAttributes.pricePerUserMonth).
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

  return (
    <Layout>
      <SEOMeta
        title="Monitoring | Shane McCaw Consulting"
        description="Continuous Microsoft 365 tenant monitoring — signal engines watching drift, security, health, and SLA compliance, priced per seat from the real catalog."
      />

      {/* HERO */}
      <section className="relative pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            Continuous Automated Tenant Intelligence
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-bold text-text-primary tracking-tight leading-tight max-w-4xl mx-auto mb-6">
            Stop Finding Out Late. <GradientText>Start Watching Continuously.</GradientText>
          </h1>
          <p className="text-lg sm:text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed mb-10">
            Six signal engines watch your Microsoft 365 tenant on a recurring Graph-based
            schedule — catching drift, security exposure, health decline, and SLA risk before
            they become a real problem.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-md mx-auto mb-14">
            <a
              href="#packages"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold text-white shadow-lg shadow-accent-blue/20 transition-opacity hover:opacity-90 flex items-center justify-center gap-2 text-base"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <span>View Monitoring Packages</span>
              <ArrowRight className="w-5 h-5" />
            </a>
            <Link
              href="/assessments/start"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors flex items-center justify-center text-base"
              data-track="cta"
            >
              Run Free Diagnostic First
            </Link>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <StatPanel label="Engines shown below" value={ENGINES.length} />
            <StatPanel label="Scheduled checks" value="Hourly–Daily" />
            <StatPanel label="Critical events (Enhanced/Premium)" value="~5 min" />
            <StatPanel label="Remediation" value="Automated" />
          </div>
        </div>
      </section>

      {/* WHAT THIS PRODUCT ACTUALLY DOES */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              What Monitoring <GradientText>Actually Does</GradientText>
            </h2>
            <p className="text-text-secondary">
              No AI buzzwords, no guesswork — plain mechanics, running against your real tenant.
            </p>
          </div>
          <GlassPanel className="p-8 sm:p-10">
            <p className="text-text-secondary leading-relaxed mb-4">
              A set of specialized signal engines connect to your Microsoft 365 tenant through
              Microsoft Graph and run a defined library of Monitor Checks on your package's
              configured schedule. Each check's result is compared against your governance
              baseline — configuration drift, security exposure, license waste, SLA
              obligations — and classified by severity the moment it's evaluated.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Nothing here is estimated from a survey or reconstructed after the fact. Every
              score and every alert traces back to a real, recorded check result pulled directly
              from your tenant.
            </p>
          </GlassPanel>
        </div>
      </section>

      {/* CREDIBILITY */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-lg text-text-primary">
                  Built by the Microsoft 365 Architect at NASA
                </h3>
                <p className="text-sm text-text-secondary mt-1">
                  Shane McCaw wrote the M365 Copilot governance framework NASA distributed
                  agency-wide. This monitoring platform runs on that same discipline — a
                  personal credential, not a claim about this platform's own compliance
                  posture or government-contracting status.
                </p>
              </div>
            </div>
            <div className="text-sm text-text-secondary max-w-md md:text-right">
              Every check runs against your live tenant via Microsoft Graph — not estimated from a
              questionnaire, not checked "whenever someone remembers to look."
            </div>
          </GlassPanel>
        </div>
      </section>

      {/* WHY THIS ISN'T JUST A DASHBOARD — real differentiators vs. generic BI/reporting tools. */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Why <GradientText>Continuous Monitoring</GradientText> Matters
            </h2>
            <p className="text-text-secondary">
              A one-time scan or a dashboard nobody refreshes misses what happens in between.
              Scheduled checks run hourly to daily, with critical events on Enhanced/Premium
              tiers surfacing in roughly five minutes — not an instant, always-on feed, but close
              enough that drift and exposure don't sit unnoticed for a quarter.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                icon: Database,
                title: "Built for M365, Not Generic BI",
                desc: "Purpose-built Microsoft Graph scanning for tenant governance — not a repurposed charting tool pointed at a data export.",
              },
              {
                icon: Wrench,
                title: "Most Tools Report. This One Can Act",
                desc: "Automated write-back remediation means qualifying findings can be corrected directly in your tenant where enabled — not just logged for someone to fix by hand.",
              },
              {
                icon: Eye,
                title: "Every Score Traces to a Real Rule",
                desc: "No black-box number. Every finding and score traces back to a configurable Signal Rule you can inspect — full transparency, not a mystery percentage.",
              },
              {
                icon: Award,
                title: "A NASA-Credentialed Architect Behind It",
                desc: "Built and overseen by the architect who wrote NASA's M365 Copilot governance framework — real human judgment behind the automation, not an unaccountable black box.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-start gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-text-primary mb-1.5">{item.title}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* TELEMETRY PIPELINE */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl font-bold text-text-primary mb-4">How Monitoring Works</h2>
            <p className="text-text-secondary">From Microsoft Graph API to your dashboard — detection, scoring, and alerting run automatically on every scheduled check.</p>
          </div>
          <div className="flex flex-col md:flex-row items-stretch gap-1">
            {PIPELINE.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="flex flex-col md:flex-row items-start md:items-stretch flex-1">
                  <div className="flex flex-col flex-1 p-5 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-3">
                      <Icon className="w-4 h-4 text-accent-blue" />
                    </div>
                    <div className="text-[10px] font-bold text-accent-blue uppercase tracking-widest mb-1">Step {i + 1}</div>
                    <div className="text-sm font-bold text-text-primary mb-1.5">{step.label}</div>
                    <p className="text-xs text-text-secondary leading-relaxed">{step.desc}</p>
                  </div>
                  {i < PIPELINE.length - 1 && (
                    <div className="hidden md:flex items-center px-1 text-text-tertiary">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* REMEDIATION / WRITE-BACK — real Graph write-back engine, code-complete but rollout is
          setup-dependent (website-rebuild-reference-v2.md §2 "to-verify" list) — honest-
          availability framing only, no "instant/guaranteed for everyone" claim. */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              What <GradientText>You Get</GradientText>
            </h2>
            <p className="text-text-secondary">
              Detection, prioritized alerts, and — where write-back remediation is enabled for
              your tenant — a direct fix in Microsoft Graph instead of a ticket waiting for
              someone to get to it.
            </p>
          </div>
          <GlassPanel className="p-8 sm:p-10">
            <div className="flex flex-col md:flex-row items-start gap-6 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                <Wrench className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display text-2xl font-bold text-text-primary mb-2">
                  We Don't Just Tell You What's Wrong — <GradientText>We Can Fix It.</GradientText>
                </h3>
                <p className="text-text-secondary leading-relaxed">
                  Most monitoring tools stop at the report. Ours can act: qualifying findings can
                  trigger real automated write-back against Microsoft Graph — the same
                  remediation mechanism behind our Quick-Start configuration packs — to correct
                  the issue directly in your tenant instead of leaving it for someone to fix by
                  hand.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {[
                "Revoke a stale guest account flagged by the Security Engine",
                "Correct a conditional access policy that drifted from baseline",
                "Disable an over-permissioned OAuth app grant",
              ].map((example) => (
                <div key={example} className="flex items-start gap-2 text-xs text-text-secondary bg-charcoal-1 border border-white/[0.06] rounded-xl p-3">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-blue" />
                  {example}
                </div>
              ))}
            </div>
            <p className="text-xs text-text-secondary">
              Write-back remediation is configured per tenant and rolls out where enabled — not
              every finding triggers an automatic fix, and it isn't switched on by default for
              every customer today.
            </p>
          </GlassPanel>
        </div>
      </section>

      {/* ENGINE GRID */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Six <GradientText>Monitoring Engines.</GradientText>
            </h2>
            <p className="text-text-secondary">
              Six purpose-built signal engines, each scanning a different layer of your tenant
              via Microsoft Graph and feeding a unified priority queue — so critical findings
              surface automatically.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ENGINES.map((engine) => {
              const Icon = engine.icon;
              const c = colorMap[engine.color];
              return (
                <div key={engine.id} className="flex flex-col p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-white/[0.12] transition-all duration-200 group">
                  <div className={`w-11 h-11 rounded-xl bg-white/[0.06] border ${c.border} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
                    <Icon className={`w-5 h-5 ${c.icon}`} />
                  </div>
                  <span className={`text-[10px] uppercase font-bold tracking-wider mb-2 px-2 py-0.5 rounded-full border self-start ${c.badge}`}>{engine.badge}</span>
                  <h3 className="font-display text-lg font-bold text-text-primary mb-2">{engine.name}</h3>
                  <p className="text-sm font-medium text-text-primary leading-relaxed mb-2">{engine.benefit}</p>
                  <p className="text-sm text-text-secondary leading-relaxed mb-5 flex-grow">{engine.description}</p>
                  <ul className="space-y-1.5 border-t border-white/[0.06] pt-4 mt-auto">
                    {engine.signals.map((s) => (
                      <li key={s} className="flex items-center gap-2 text-xs text-text-secondary">
                        <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${c.check}`} />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* MONITORING PACKAGES — real per-seat pricing: pricePerUserMonth × max(seats, seatCountFloor)
          + flatMonthlySurcharge, read from typeAttributes (website-rebuild-reference-v2.md §2) */}
      <section id="packages" className="py-12 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl font-bold text-text-primary mb-4">Monitoring Packages</h2>
            <p className="text-text-secondary">
              Tiered packages loaded live from the platform catalog, priced per seat. All packages
              include full engine coverage and access to your tenant health dashboard.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
            </div>
          ) : error || monitoringPackages.length === 0 ? (
            <div className="text-center py-12 text-text-secondary border border-white/[0.08] rounded-2xl bg-charcoal-1">
              Monitoring package data is currently unavailable. Please{" "}
              <Link href="/contact" className="text-accent-blue hover:underline">contact us</Link> for pricing.
            </div>
          ) : (
            <>
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
                    onBlur={() => trackPricingInteraction("plan_compare", { label: `${seatCount} seats`, metadata: { seats: seatCount, method: "custom_input" } })}
                    className="w-28 text-center font-numeric text-lg font-medium bg-charcoal-1 border border-white/[0.08] rounded-xl px-3 py-2.5 text-text-primary focus:outline-none focus:border-accent-blue/60"
                  />
                  <div className="flex items-center gap-2">
                    {SEAT_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        onClick={() => {
                          setSeatCount(preset);
                          trackPricingInteraction("plan_compare", { label: `${preset} seats`, metadata: { seats: preset, method: "preset" } });
                        }}
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
                        <div className="text-xs text-text-secondary mt-1">For {seatCount.toLocaleString()} licensed users</div>
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
                        href={`/checkout/${matched.slug}`}
                        className={`mt-auto px-4 py-3 rounded-xl text-sm font-bold text-center transition-all flex items-center justify-center gap-1 ${
                          isHighlighted ? "text-white hover:opacity-90" : "bg-white/[0.06] hover:bg-white/[0.1] text-text-primary border border-white/[0.08]"
                        }`}
                        style={isHighlighted ? GRADIENT_BG : undefined}
                        data-track="cta"
                      >
                        <span>Get Started</span>
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Begin <GradientText>Mission Readiness</GradientText>
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto mb-8">
              Run a free tenant diagnostic first. Our signal engines will score your current
              governance posture and recommend the right monitoring tier.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link
                href="/assessments/start"
                className="px-6 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
                style={GRADIENT_BG}
                data-track="cta"
              >
                <Zap className="w-4 h-4" />
                Run Free Diagnostic
              </Link>
              <Link
                href="/contact"
                className="px-6 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
                data-track="cta"
              >
                Talk to Shane McCaw
              </Link>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
