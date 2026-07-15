import React from "react";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { Link } from "wouter";
import { useServices } from "../hooks/useServices";
import {
  ShieldCheck, Activity, Lock, AlertTriangle, ArrowRight, Zap,
  CheckCircle2, Layers, Clock, ChevronRight, Database, Cpu, Radio,
  BarChart2, RefreshCw, TrendingUp
} from "lucide-react";

const ENGINES = [
  {
    id: "drift",
    icon: Layers,
    name: "Drift Engine",
    badge: "Configuration Baseline",
    color: "blue",
    description:
      "Continuously compares your live M365 tenant configuration against your approved governance baseline. Every unauthorized administrative change — from conditional access policy tweaks to SharePoint guest settings — triggers a drift alert before it compounds into a security incident.",
    signals: [
      "Baseline deviation alerts",
      "Admin action correlation",
      "Configuration snapshot deltas",
      "Unauthorized policy changes",
    ],
  },
  {
    id: "security",
    icon: Lock,
    name: "Security Engine",
    badge: "Threat Minimization",
    color: "red",
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
    id: "health",
    icon: Activity,
    name: "Health Engine",
    badge: "SLA Remediation",
    color: "emerald",
    description:
      "Calculates a composite real-time tenant health score across licensing utilization, service health anomalies, and operational KPIs. When the score degrades below threshold, automated remediation runbooks execute to correct discovered anomalies — no human queue required.",
    signals: [
      "Composite health score",
      "License utilization efficiency",
      "Automated remediation runbooks",
      "Service health correlation",
    ],
  },
  {
    id: "sla",
    icon: Clock,
    name: "SLA Engine",
    badge: "Delivery Performance",
    color: "indigo",
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
    id: "scope-creep",
    icon: AlertTriangle,
    name: "Scope Creep Engine",
    badge: "SOW Auditing",
    color: "amber",
    description:
      "Monitors ongoing engineer workstreams against the legal Statement of Work parameters. Every hour of work is validated against contracted scope to ensure all client operations are correctly accounted for and no undocumented obligations accumulate.",
    signals: [
      "SOW parameter mapping",
      "Engineer workstream audit",
      "Out-of-scope flagging",
      "Billing accuracy enforcement",
    ],
  },
  {
    id: "sales-offer",
    icon: TrendingUp,
    name: "Sales Offer Engine",
    badge: "Upgrade Optimization",
    color: "violet",
    description:
      "Analyzes tenant telemetry gaps and signal engine findings to dynamically calculate target-focused advisory upgrades and custom monitoring expansions. Turns compliance data into an intelligent upsell engine.",
    signals: [
      "Telemetry gap analysis",
      "Upgrade opportunity scoring",
      "Package fit recommendations",
      "Risk-to-revenue mapping",
    ],
  },
];

const colorMap: Record<string, { icon: string; badge: string; border: string; check: string }> = {
  blue:   { icon: "text-blue-400",   badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",   border: "border-blue-500/20",   check: "text-blue-400" },
  red:    { icon: "text-red-400",    badge: "bg-red-500/10 text-red-400 border-red-500/20",       border: "border-red-500/20",    check: "text-red-400" },
  emerald:{ icon: "text-emerald-400",badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", border: "border-emerald-500/20", check: "text-emerald-400" },
  indigo: { icon: "text-indigo-400", badge: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",   border: "border-indigo-500/20", check: "text-indigo-400" },
  amber:  { icon: "text-amber-400",  badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",   border: "border-amber-500/20",  check: "text-amber-400" },
  violet: { icon: "text-violet-400", badge: "bg-violet-500/10 text-violet-400 border-violet-500/20", border: "border-violet-500/20", check: "text-violet-400" },
};

const PIPELINE = [
  { icon: Database, label: "Microsoft Graph API", desc: "Tenant telemetry harvested every 15 minutes via authenticated Graph queries" },
  { icon: Cpu, label: "Signal Engine Analysis", desc: "6 specialized engines evaluate telemetry against governance rule sets" },
  { icon: Radio, label: "Alert & Prioritization", desc: "Priority Engine scores findings and routes critical alerts to dashboard" },
  { icon: RefreshCw, label: "Automated Remediation", desc: "Runbook executor resolves qualifying findings without human queue" },
  { icon: BarChart2, label: "Reporting & Insights", desc: "Tenant health score, trend analysis and executive-ready audit reports" },
];


export default function Monitoring() {
  // {{db.monitoring.packages}} -- fetch monitoring tier services from database
  const { services, loading, error } = useServices();
  const monitoringPackages = services.filter(s => s.serviceType === "monitoring_tier");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      <Header />

      <main className="flex-grow pt-24 pb-16">

        {/* HERO */}
        <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-8 pb-20 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            24/7 Automated Tenant Intelligence
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight max-w-5xl mx-auto mb-6">
            Stop Reacting. Start Governing.
          </h1>
          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed mb-10">
            Six specialized signal engines harvest Microsoft Graph telemetry every 15 minutes — detecting drift, surfacing security threats, calculating health scores, and enforcing SLA compliance before incidents reach your clients.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-md mx-auto">
            <Link href="/assessments" className="w-full sm:w-auto px-8 py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 text-base">
              <span>View Monitoring Packages</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link href="/assessments/start" className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-all flex items-center justify-center text-base">
              Run Free Diagnostic First
            </Link>
          </div>
        </section>

        {/* AUTHORITY BANNER */}
        <section className="border-y border-slate-800/80 bg-slate-900/40 py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-7 h-7 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">NASA Copilot Deployment Standard</h3>
                <p className="text-xs text-slate-400">Monitoring framework distributed federal government-wide as the M365 governance benchmark.</p>
              </div>
            </div>
            <div className="flex items-center gap-8 text-center">
              {[
                { value: "6", label: "Signal Engines" },
                { value: "15 min", label: "Telemetry Cadence" },
                { value: "100%", label: "Automated" },
              ].map(stat => (
                <div key={stat.label}>
                  <div className="text-2xl font-extrabold text-white">{stat.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 6 ENGINE GRID */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Six Engines. One Platform. Zero Blind Spots.</h2>
            <p className="text-slate-400">Each engine is a purpose-built analytical module that operates independently and feeds a unified priority queue — so critical findings surface immediately, automatically.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ENGINES.map(engine => {
              const Icon = engine.icon;
              const c = colorMap[engine.color];
              return (
                <div key={engine.id} className="flex flex-col p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all duration-200 group">
                  <div className={`w-11 h-11 rounded-xl bg-slate-800 border ${c.border} flex items-center justify-center mb-4 group-hover:scale-105 transition-transform`}>
                    <Icon className={`w-5 h-5 ${c.icon}`} />
                  </div>
                  <span className={`text-[10px] uppercase font-bold tracking-wider mb-2 px-2 py-0.5 rounded-full border self-start ${c.badge}`}>{engine.badge}</span>
                  <h3 className="text-lg font-bold text-white mb-2">{engine.name}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-5 flex-grow">{engine.description}</p>
                  <ul className="space-y-1.5 border-t border-slate-800 pt-4 mt-auto">
                    {engine.signals.map(s => (
                      <li key={s} className="flex items-center gap-2 text-xs text-slate-400">
                        <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${c.check}`} />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* TELEMETRY PIPELINE */}
        <section className="border-t border-slate-800/80 bg-slate-900/30 py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="text-3xl font-bold text-white mb-4">How the Intelligence Pipeline Works</h2>
              <p className="text-slate-400">From Microsoft Graph API to automated remediation — every step executes without manual intervention.</p>
            </div>
            <div className="flex flex-col md:flex-row items-stretch gap-1">
              {PIPELINE.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={step.label} className="flex flex-col md:flex-row items-start md:items-stretch flex-1">
                    <div className="flex flex-col flex-1 p-5 rounded-2xl bg-slate-900 border border-slate-800">
                      <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-3">
                        <Icon className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Step {i + 1}</div>
                      <div className="text-sm font-bold text-white mb-1.5">{step.label}</div>
                      <p className="text-xs text-slate-400 leading-relaxed">{step.desc}</p>
                    </div>
                    {i < PIPELINE.length - 1 && (
                      <div className="hidden md:flex items-center px-1 text-slate-700">
                        <ChevronRight className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* MONITORING PACKAGES */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl font-bold text-white mb-4">Monitoring Packages</h2>
            <p className="text-slate-400">Tiered packages dynamically loaded from the platform catalog. All packages include full engine coverage and the real-time priority dashboard.</p>
          </div>
          {loading ? (
            <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>
          ) : error || monitoringPackages.length === 0 ? (
            <div className="text-center py-12 text-slate-400 border border-slate-800 rounded-2xl bg-slate-900/20">
              Monitoring package data is currently unavailable. Please <Link href="/contact" className="text-blue-400 hover:underline">contact us</Link> for pricing.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {monitoringPackages.map(pkg => (
                <div key={pkg.slug} className="flex flex-col rounded-2xl p-6 bg-slate-900 border border-slate-800 hover:border-blue-500/40 transition-all duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {pkg.category ? pkg.category.toUpperCase() : "MONITORING TIER"}
                    </span>
                    {pkg.durationDays && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock className="w-3.5 h-3.5" />{pkg.durationDays}d
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{pkg.name}</h3>
                  <p className="text-sm text-slate-400 mb-6 flex-grow line-clamp-3">{pkg.description}</p>
                  <div className="pt-4 border-t border-slate-800 flex items-center justify-between mt-auto">
                    <div>
                      <span className="text-2xl font-extrabold text-white">
                        {pkg.isFreeOffering ? "FREE" : pkg.basePrice ? `$${Number(pkg.basePrice).toLocaleString()}` : "Custom"}
                      </span>
                      {!pkg.isFreeOffering && pkg.basePrice && <span className="text-xs text-slate-400 ml-1">/ mo</span>}
                    </div>
                    <Link
                      href={pkg.isFreeOffering ? `/contact?service=${pkg.slug}` : `/checkout?product=${pkg.slug}`}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors flex items-center gap-1"
                    >
                      <span>{pkg.isFreeOffering ? "Request" : "Get Started"}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* BOTTOM CTA */}
        <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
          <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-blue-950/20 to-slate-900 border border-blue-500/10 shadow-2xl relative overflow-hidden text-center">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 relative z-10">Not Sure Where to Start?</h2>
            <p className="text-slate-300 max-w-xl mx-auto mb-8 relative z-10">
              Run a free tenant diagnostic first. Our signal engines will score your current governance posture and recommend the right monitoring tier.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 relative z-10">
              <Link href="/assessments/start" className="px-6 py-3.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center justify-center gap-2">
                <Zap className="w-4 h-4" />
                Run Free Diagnostic
              </Link>
              <Link href="/contact" className="px-6 py-3.5 rounded-xl font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors">
                Talk to Shane McCaw
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
