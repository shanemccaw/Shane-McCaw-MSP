import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useServices, type PublicService } from "../hooks/useServices";
import { trackPricingInteraction } from "../lib/analytics";
import { Layout } from "../components/Layout";
import { SEOMeta } from "../components/SEOMeta";
import { ChatCTA } from "@/components/ChatCTA";
import { GlassPanel } from "../components/design-system/GlassPanel";
import { GradientText } from "../components/design-system/GradientText";
import { StatPanel } from "../components/design-system/StatPanel";
import {
  ShieldCheck, Activity, Lock, AlertTriangle, ArrowRight, Zap,
  CheckCircle2, Layers, Clock, ChevronRight, Database, Cpu, Radio,
  BarChart2, RefreshCw, Users, Sparkles, Eye, Wrench,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };
// Same connected-step visual language as WorkflowSteps.tsx (design-system component): a
// gradient circle per step joined by this connector line, so a pipeline with unevenly long
// step copy reads as one continuous sequence instead of a row of mismatched-height cards.
const CONNECTOR_BG = { background: "linear-gradient(180deg, var(--accent-blue), rgba(255,255,255,0.08))" };
const SEAT_PRESETS = [10, 50, 250, 750];

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

// Checklist copy for `typeAttributes.includedEngines` keys — byte-identical to Home.tsx's own
// copy of this map (confirmed against the real Engine Registry, api-server/src/lib/engine-registry.ts,
// 12 keys total — "live_monitor" is NOT one of them and does not appear in either the Engine
// Registry or the Plan Feature Registry (msp-entitlement.ts PLAN_FEATURE_DEFS), confirmed via
// grep — so it is never added here; the ~5-min live activity feed differentiator stays
// represented as page copy below, not a fabricated catalog key). Internal back-office engines
// (priority, pricing, forecasting, crm, msp) are deliberately omitted from customer-facing copy.
const ENGINE_CHECKLIST_LABELS: Record<string, string> = {
  health: "Architecture Health scoring — governance, compliance, adoption, Copilot, and licensing",
  security: "Security Engine — anonymous links, guest access, OAuth risk, and MFA gaps",
  drift: "Drift Engine — every admin change fingerprinted against your baseline",
  sla: "SLA Engine — support commitments tracked against the clock",
  scope_creep: "Scope Creep Engine — live work checked against your signed SOW",
  monitoring: "Scheduled tenant scans on a real schedule",
  sales_offer: "Recommendation Engine — tells you what to fix next",
};

// Checklist copy for `typeAttributes.includedFeatures` keys — byte-identical to Home.tsx's copy
// (confirmed against msp-entitlement.ts PLAN_FEATURE_DEFS). Unmapped keys fall back to a
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

// Real, per-tier differentiator source — the same live typeAttributes.includedEngines/
// includedFeatures the admin Product Catalog's Monitoring Tier editor writes and every other
// entitlement check in the platform reads. Previously this page instead rendered the row's
// static `features` text column, which was never kept in sync with real per-tier entitlements
// (Basic and Enhanced both showed the identical "Scheduled tenant scans on a real schedule"
// line) — Home.tsx's own monitoring-package teaser already used this correct, real mechanism.
function buildTierChecklist(attrs: MonitoringTypeAttributes): string[] {
  const engineItems = (attrs.includedEngines ?? [])
    .map((key) => ENGINE_CHECKLIST_LABELS[key])
    .filter((label): label is string => Boolean(label));
  const featureItems = (attrs.includedFeatures ?? []).map(
    (key) => FEATURE_CHECKLIST_LABELS[key] ?? humanizeFeatureKey(key),
  );
  return [...engineItems, ...featureItems];
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
            <StatPanel label="Check cadence" value={<span className="whitespace-nowrap">Hourly–Daily</span>} />
            <StatPanel label="Critical alerts (Enhanced+)" value={<span className="whitespace-nowrap">~5 min</span>} />
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
              Most checks run on a scheduled cadence — hourly to daily depending on your
              package — while critical changes on Enhanced/Premium tiers are also caught
              through a live activity feed that reviews your tenant's audit log roughly every
              five minutes: not an instant feed, but close enough that drift and exposure don't
              sit unnoticed for a quarter. On top of your own tenant telemetry, we also track
              Microsoft's own Message Center and Service Health feed for your tenant as that
              access rolls out — so a Microsoft-side outage or planned service change is
              already on our radar, not something you have to go check yourself. Either way,
              anything that crosses a configured severity threshold — including a drop in your
              Health Engine score — is picked up by the same alert-dispatch sweep that runs
              every fifteen minutes, so it reaches the right inbox on its own instead of waiting
              for someone to open the dashboard.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Layers,
                title: "Drift Doesn't Get a Quarter to Hide In",
                desc: "Every scheduled check compares your live configuration against your approved baseline. An unauthorized conditional access change or sharing setting gets flagged the next cycle it runs — not whenever someone happens to go looking.",
              },
              {
                icon: Users,
                title: "Access Sprawl Gets Audited, Not Ignored",
                desc: "Stale guest accounts and over-permissioned OAuth app grants accumulate quietly in every M365 tenant. The Security Engine audits both on a recurring cadence, so sprawl gets caught while it's still a cleanup — not after it's an incident.",
              },
              {
                icon: Clock,
                title: "Cost Overruns Get Caught Before They're a Dispute",
                desc: "The SLA Engine surfaces an impending delivery breach before it becomes a contractual failure, and the Scope Creep Engine validates every engineer hour against your actual SOW — so overruns get caught while they're still fixable, not discovered on an invoice.",
              },
              {
                icon: BarChart2,
                title: "Licensing Waste Becomes a Real Number",
                desc: "The Health Engine tracks license utilization efficiency, and wasted seats get priced against real per-SKU list costs — not a vague \"you might be overspending,\" an actual monthly dollar figure you can act on before the renewal.",
              },
              {
                icon: Sparkles,
                title: "The Same Signals Copilot Readiness Depends On",
                desc: "MFA coverage and SharePoint oversharing exposure are exactly what determines whether an AI rollout is safe to turn on. The Security Engine keeps watching both long after a readiness assessment ends — not just once, at kickoff.",
              },
              {
                icon: Eye,
                title: "You Sleep. This Doesn't.",
                desc: "Scheduled checks keep running hourly to daily around the clock, and higher monitoring tiers add a five-minute activity feed for critical changes — so the infrastructure your business runs on stays watched during the hours nobody's at a desk.",
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
          <ol className="relative max-w-2xl mx-auto">
            {PIPELINE.map((step, i) => {
              const Icon = step.icon;
              return (
                <li key={step.label} className="relative flex gap-5 pb-10 last:pb-0">
                  {i < PIPELINE.length - 1 && (
                    <span
                      className="absolute left-[22px] top-11 bottom-0 w-px"
                      style={CONNECTOR_BG}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className="relative z-10 shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white"
                    style={GRADIENT_BG}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="pt-1">
                    <div className="text-[10px] font-bold text-accent-blue uppercase tracking-widest mb-1">Step {i + 1}</div>
                    <div className="text-base font-bold text-text-primary mb-1.5">{step.label}</div>
                    <p className="text-sm text-text-secondary leading-relaxed">{step.desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
                <h3 className="font-display text-base font-bold text-text-primary">Fixed Automatically, Where Enabled</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed mb-4">
                Findings that are mechanical and reversible — a setting that drifted, an access
                grant that should have been revoked — are what write-back is built to correct
                without waiting on a human.
              </p>
              <ul className="space-y-2">
                {[
                  "Access hygiene — stale guest accounts and over-permissioned OAuth app grants (Security Engine)",
                  "Configuration drift — settings corrected back to your approved baseline (Drift Engine)",
                  "Qualifying Health Engine anomalies with a defined, low-risk correction runbook",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-text-secondary">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-amber-400" />
                <h3 className="font-display text-base font-bold text-text-primary">Routed to a Human</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed mb-4">
                Findings that carry a judgment call, a contractual question, or an action Graph
                itself can't perform are surfaced with full context and routed for review —
                never silently auto-corrected.
              </p>
              <ul className="space-y-2">
                {[
                  "SLA and delivery risk — the SLA Engine surfaces an impending breach; resolving it is engineer work",
                  "Scope Creep findings — validated against your SOW, then reviewed as a billing/contract decision",
                  "MFA registration gaps — flagged immediately, but enrollment itself has to happen on the user's end",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-text-secondary">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
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
              <ChatCTA className="text-accent-blue hover:underline">contact us</ChatCTA> for pricing.
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
                        <div className="text-xs text-text-secondary mt-1">For {seatCount.toLocaleString()} licensed users</div>
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
              <ChatCTA
                className="px-6 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
                data-track="cta"
              >
                Talk to Shane McCaw
              </ChatCTA>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
