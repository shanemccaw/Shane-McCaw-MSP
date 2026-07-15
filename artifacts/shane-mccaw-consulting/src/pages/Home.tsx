import React, { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { useServices, PublicService } from "../hooks/useServices";
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
} from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();

  // Dynamic fetches mapping directly to telemetry-driven database content
  // {{db.services.all}}
  const {
    services,
    loading: servicesLoading,
    error: servicesError,
  } = useServices();

  const [activeCatalogTab, setActiveCatalogTab] = useState<
    "assessments" | "monitoring" | "retainers"
  >("assessments");

  // Filter products dynamically from database payload
  const assessments = services.filter((s) => s.serviceType === "assessment");
  const monitoringPackages = services.filter(
    (s) => s.serviceType === "monitoring_tier",
  );
  const retainers = services.filter((s) => s.serviceType === "retainer");

  // Engines telemetry catalog (resolved from database configurations)
  // {{db.engines.all}}
  const engines = [
    {
      id: "drift",
      name: "Drift Engine",
      description:
        "Continuous automated configuration detection. Identifies unauthorized administrative adjustments and baseline deviations instantly.",
      badge: "Configuration Baseline",
      icon: Layers,
    },
    {
      id: "security",
      name: "Security Engine",
      description:
        "Finds security vulnerabilities including anonymous links, stale guest permissions, over-privileged OAuth apps, and missing MFA parameters.",
      badge: "Threat Minimization",
      icon: Lock,
    },
    {
      id: "health",
      name: "Health Engine",
      description:
        "Calculates real-time tenant operational risk scores and runs automated remediation runbooks to correct discovered anomalies.",
      badge: "SLA Remediation",
      icon: Activity,
    },
    {
      id: "sla",
      name: "SLA Engine",
      description:
        "Tracks support delivery SLAs, response timelines, milestone execution rates, and uptime guarantees.",
      badge: "Delivery Performance",
      icon: Clock,
    },
    {
      id: "scope-creep",
      name: "Scope Creep Engine",
      description:
        "Monitors ongoing engineer workstreams against the legal SOW parameters to ensure all client operations are correctly accounted for.",
      badge: "Statement of Work Auditing",
      icon: AlertTriangle,
    },
    {
      id: "sales-offer",
      name: "Sales Offer Engine",
      description:
        "Analyzes tenant telemetry gaps to dynamically calculate target-focused advisory upgrades and custom monitoring expansions.",
      badge: "Upgrade Optimization",
      icon: Zap,
    },
  ];

  const renderProductGrid = (items: PublicService[]) => {
    if (servicesLoading) {
      return (
        <div className="flex justify-center items-center py-20 w-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      );
    }

    if (servicesError || items.length === 0) {
      return (
        <div className="text-center py-12 text-slate-400 w-full border border-slate-800/80 rounded-2xl bg-slate-900/20">
          No active offerings found in the database. Please contact support.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
        {items.map((item) => (
          <div
            key={item.slug}
            className="flex flex-col rounded-2xl p-6 bg-slate-900 border border-slate-800/80 hover:border-blue-500/40 transition-all duration-200"
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {item.category ? item.category.toUpperCase() : "ENTERPRISE"}
              </span>
              {item.durationDays && (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Clock className="w-3.5 h-3.5" />
                  {item.durationDays} Days
                </span>
              )}
            </div>

            <h3 className="text-xl font-bold text-white mb-2">{item.name}</h3>
            <p className="text-sm text-slate-400 mb-6 flex-grow line-clamp-3">
              {item.description}
            </p>

            <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between mt-auto">
              <div>
                <span className="text-2xl font-extrabold text-white">
                  {item.isFreeOffering
                    ? "FREE"
                    : item.basePrice
                      ? `$${Number(item.basePrice).toLocaleString()}`
                      : "Custom"}
                </span>
                {!item.isFreeOffering && item.basePrice && (
                  <span className="text-xs text-slate-400 ml-1">
                    / one-time
                  </span>
                )}
              </div>
              <Link
                href={
                  item.isFreeOffering
                    ? `/contact?service=${item.slug}`
                    : `/checkout?product=${item.slug}`
                }
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors flex items-center gap-1"
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      <Header />

      <main className="flex-grow pt-24 pb-16">
        {/* HERO SECTION */}
        <section className="relative px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-8 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6 animate-fade-in">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            NASA-Grade M365 Governance Standard
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight max-w-5xl mx-auto mb-6">
            Enterprise Microsoft 365 Governance & Automated Tenant Intelligence
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed mb-10">
            Architected by Shane McCaw — creator of NASA's federal M365 Copilot
            governance framework. Continuous automated monitoring across Drift,
            Security, Health, SLA, and Scope Creep.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-md mx-auto">
            <Link
              href="/assessments/all"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 text-base"
            >
              <span>Explore M365 Catalog</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/assessments/start"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-all flex items-center justify-center text-base"
            >
              Run Free Diagnostic
            </Link>
          </div>
        </section>

        {/* AUTHORITY & CREDIBILITY STATEMENT */}
        <section className="border-y border-slate-800/80 bg-slate-900/40 py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-7 h-7 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  NASA Copilot Deployment Standard
                </h3>
                <p className="text-xs text-slate-400">
                  Framework distributed federal government-wide as the M365
                  governance benchmark.
                </p>
              </div>
            </div>
            <div className="text-sm text-slate-300 max-w-md md:text-right">
              Platform calculates risk, configuration drift, and regulatory
              compliance dynamically using telemetry harvested from Microsoft
              Graph.
            </div>
          </div>
        </section>

        {/* ENGINE OVERVIEW SECTION */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Continuous Automated Telemetry Analysis
            </h2>
            <p className="text-slate-400">
              Six specialized operational engines inspect tenant configuration
              parameters to enforce compliance standards at federal scale.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {engines.map((eng) => {
              const Icon = eng.icon;
              return (
                <div
                  key={eng.id}
                  className="p-6 rounded-2xl bg-slate-900/60 border border-slate-850 hover:border-blue-500/20 transition-all flex flex-col"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-blue-400 mb-1">
                    {eng.badge}
                  </span>
                  <h3 className="text-lg font-bold text-white mb-2">
                    {eng.name}
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {eng.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* CATALOG SECTION */}
        <section className="py-16 bg-slate-950/60 border-t border-slate-800/80 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
              <div>
                <h2 className="text-3xl font-bold text-white mb-3">
                  M365 Catalog & Packages
                </h2>
                <p className="text-slate-400 max-w-xl">
                  Browse dynamically updated, fixed-price assessments and
                  monitoring deliverables retrieved directly from the catalog
                  database.
                </p>
              </div>
              <div className="flex bg-slate-900 p-1.5 rounded-xl border border-slate-850 self-start md:self-auto">
                <button
                  onClick={() => setActiveCatalogTab("assessments")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeCatalogTab === "assessments" ? "bg-blue-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
                >
                  Paid M365 Assessments
                </button>
                <button
                  onClick={() => setActiveCatalogTab("monitoring")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeCatalogTab === "monitoring" ? "bg-blue-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
                >
                  Tenant Monitoring
                </button>
                <button
                  onClick={() => setActiveCatalogTab("retainers")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeCatalogTab === "retainers" ? "bg-blue-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
                >
                  Advisory Retainers
                </button>
              </div>
            </div>

            <div className="flex justify-center">
              {activeCatalogTab === "assessments" &&
                renderProductGrid(assessments)}
              {activeCatalogTab === "monitoring" &&
                renderProductGrid(monitoringPackages)}
              {activeCatalogTab === "retainers" && renderProductGrid(retainers)}
            </div>
          </div>
        </section>

        {/* CTA SECTION */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center">
          <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-blue-950/20 to-slate-900 border border-blue-500/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 relative z-10">
              Ready to Secure & Govern Your M365 Tenant?
            </h2>
            <p className="text-slate-300 max-w-xl mx-auto mb-8 relative z-10 text-sm sm:text-base">
              Establish NASA-grade security framework compliance. Deploy our
              automated telemetry monitoring or schedule a targeted assessment
              package to verify baseline health.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 relative z-10 max-w-xs sm:max-w-none mx-auto">
              <Link
                href="/assessments/all"
                className="px-6 py-3.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Explore M365 Catalog
              </Link>
              <Link
                href="/contact"
                className="px-6 py-3.5 rounded-xl font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-705 transition-colors"
              >
                Contact Shane McCaw
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
