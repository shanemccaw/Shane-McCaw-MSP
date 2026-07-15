import React, { useState, useMemo } from "react";
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
  Users,
  Sparkles,
  Radar,
} from "lucide-react";

interface MonitoringTypeAttributes {
  seatMin?: number;
  seatMax?: number | null;
  seatCountFloor?: number;
  pricePerUserMonth?: string;
  monthlyFloor?: string;
  flatMonthlySurcharge?: string | null;
  tenantTierLabel?: string;
}

const SEAT_PRESETS = [10, 50, 250, 750];

export default function Home() {
  const [, setLocation] = useLocation();

  // Dynamic fetches mapping directly to telemetry-driven database content
  // {{db.services.all}}
  const {
    services,
    loading: servicesLoading,
    error: servicesError,
  } = useServices();

  const [activeCatalogTab, setActiveCatalogTab] = useState("monitoring" as "monitoring" | "assessments" | "retainers");

  const [seatCount, setSeatCount] = useState<number>(25);

  // Filter products dynamically from database payload
  const assessments = services.filter((s) => s.serviceType === "assessment");
  const retainers = services.filter((s) => s.serviceType === "retainer");
  const monitoringRows = services.filter(
    (s) => s.serviceType === "monitoring_tier",
  );

  // Group monitoring rows into packages (Basic/Enhanced/Premium) by their
  // `tier` column, each package holding one row per tenant-size band
  // (seatMin/seatMax in typeAttributes). Nothing here is hardcoded — package
  // names, taglines, and pricing all resolve from the API payload.
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

  const matchRowForSeats = (
    rows: PublicService[],
    seats: number,
  ): PublicService | null => {
    return (
      rows.find((r) => {
        const attrs = (r.typeAttributes ?? {}) as MonitoringTypeAttributes;
        const min = attrs.seatMin ?? 1;
        const max = attrs.seatMax ?? Infinity;
        return seats >= min && seats <= max;
      }) ?? null
    );
  };

  const computeMonthlyPrice = (
    row: PublicService,
    seats: number,
  ): number | null => {
    const attrs = (row.typeAttributes ?? {}) as MonitoringTypeAttributes;
    if (!attrs.pricePerUserMonth) return null;
    const perUser = parseFloat(attrs.pricePerUserMonth);
    if (isNaN(perUser)) return null;
    const floor = attrs.seatCountFloor ?? attrs.seatMin ?? 1;
    const surcharge = attrs.flatMonthlySurcharge
      ? parseFloat(attrs.flatMonthlySurcharge)
      : 0;
    const billableSeats = Math.max(seats, floor);
    return billableSeats * perUser + surcharge;
  };

  const packageDisplayName = (row: PublicService): string =>
    row.name.split("—")[0].trim();

  // Engines telemetry catalog (resolved from database configurations)
  // {{db.engines.all}}
  const engines = [
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

  const renderMonitoringCalculator = () => {
    if (servicesLoading) {
      return (
        <div className="flex justify-center items-center py-20 w-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      );
    }

    if (servicesError || monitoringPackages.length === 0) {
      return (
        <div className="text-center py-12 text-slate-400 w-full border border-slate-800/80 rounded-2xl bg-slate-900/20">
          No active monitoring packages found. Please contact support.
        </div>
      );
    }

    return (
      <div className="w-full">
        {/* SEAT COUNT INPUT */}
        <div className="flex flex-col items-center mb-10">
          <label
            htmlFor="seat-count"
            className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3"
          >
            <Users className="w-4 h-4 text-blue-400" />
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
              className="w-28 text-center text-lg font-bold bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500/60"
            />
            <div className="flex items-center gap-2">
              {SEAT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setSeatCount(preset)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                    seatCount === preset
                      ? "bg-blue-600 text-white"
                      : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-white hover:border-slate-700"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* PACKAGE CARDS — reshape live as seatCount changes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {monitoringPackages.map((rows) => {
            const matched = matchRowForSeats(rows, seatCount);
            if (!matched) return null;

            const attrs = (matched.typeAttributes ??
              {}) as MonitoringTypeAttributes;
            const price = computeMonthlyPrice(matched, seatCount);
            const isHighlighted = matched.highlighted;

            return (
              <div
                key={matched.tier ?? matched.slug}
                className={`flex flex-col rounded-2xl p-6 transition-all duration-200 relative ${
                  isHighlighted
                    ? "bg-slate-900 border-2 border-blue-500/50 shadow-lg shadow-blue-600/10"
                    : "bg-slate-900 border border-slate-800/80 hover:border-blue-500/30"
                }`}
              >
                {isHighlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider">
                    <Sparkles className="w-3 h-3" />
                    Most Comprehensive
                  </span>
                )}

                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-xl font-bold text-white">
                    {packageDisplayName(matched)}
                  </h3>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 whitespace-nowrap">
                    {attrs.tenantTierLabel ?? "Custom"}
                  </span>
                </div>

                <p className="text-sm text-slate-400 mb-6">{matched.tagline}</p>

                <div className="pt-2 pb-6 border-b border-slate-800/80 mb-6">
                  {price !== null ? (
                    <>
                      <span className="text-3xl font-extrabold text-white">
                        $
                        {price.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </span>
                      <span className="text-sm text-slate-400 ml-1">/mo</span>
                    </>
                  ) : (
                    <span className="text-2xl font-extrabold text-white">
                      Custom
                    </span>
                  )}
                  <div className="text-xs text-slate-500 mt-1">
                    For {seatCount.toLocaleString()} licensed users
                  </div>
                </div>

                {matched.features && matched.features.length > 0 && (
                  <ul className="space-y-2.5 mb-6 flex-grow">
                    {matched.features.slice(0, 4).map((f, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-slate-300"
                      >
                        <CheckCircle2 className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <Link
                  href={`/checkout?product=${matched.slug}`}
                  className={`mt-auto px-4 py-3 rounded-xl text-sm font-bold text-center transition-colors flex items-center justify-center gap-1 ${
                    isHighlighted
                      ? "bg-blue-600 hover:bg-blue-500 text-white"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
                  }`}
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      <Header />

      <main className="flex-grow pt-24 pb-16">
        {/* HERO SECTION */}
        <section className="relative px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-8 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6 animate-fade-in">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            Built by NASA's M365 Copilot Architect
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight max-w-5xl mx-auto mb-6">
            Your Microsoft 365 Tenant, Watched Every Hour of Every Day
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed mb-10">
            An assessment tells you what's wrong today. Monitoring tells you the
            second it happens again. Six automated engines track drift,
            security, health, SLA, and scope creep — continuously, not once a
            year.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 max-w-md mx-auto">
            <a
              href="#catalog"
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 text-base"
            >
              <span>See Monitoring Pricing</span>
              <ArrowRight className="w-5 h-5" />
            </a>
            <Link
              href="/assessments?tab=free"
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
                  NASA's Federal M365 Copilot Standard
                </h3>
                <p className="text-xs text-slate-400">
                  Shane McCaw wrote the governance framework NASA distributed
                  agency-wide — the same discipline runs this platform.
                </p>
              </div>
            </div>
            <div className="text-sm text-slate-300 max-w-md md:text-right">
              Risk, drift, and compliance are calculated continuously from live
              telemetry pulled directly through Microsoft Graph — not estimated
              from a questionnaire.
            </div>
          </div>
        </section>

        {/* STATS STRIP */}
        <section className="py-10 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="flex items-center gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                <Layers className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-xl font-extrabold text-white">6</div>
                <div className="text-xs text-slate-400">
                  Automated telemetry engines
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                <Radar className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-xl font-extrabold text-white">
                  Hourly–Daily
                </div>
                <div className="text-xs text-slate-400">
                  Check execution cadence
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-xl font-extrabold text-white">
                  Federal-Grade
                </div>
                <div className="text-xs text-slate-400">
                  Standard, built for NASA
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ENGINE OVERVIEW SECTION */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Six Engines. Watching Constantly.
            </h2>
            <p className="text-slate-400">
              Every check runs against your live tenant on a schedule — not when
              someone remembers to look.
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
        <section
          id="catalog"
          className="py-16 bg-slate-950/60 border-t border-slate-800/80 px-4 sm:px-6 lg:px-8 scroll-mt-24"
        >
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
              <div>
                <h2 className="text-3xl font-bold text-white mb-3">
                  Pricing That Matches Your Tenant
                </h2>
                <p className="text-slate-400 max-w-xl">
                  Tell us your seat count — Monitoring pricing recalculates live
                  from the catalog. No sales call required.
                </p>
              </div>
              <div className="flex bg-slate-900 p-1.5 rounded-xl border border-slate-850 self-start md:self-auto">
                <button
                  onClick={() => setActiveCatalogTab("monitoring")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeCatalogTab === "monitoring" ? "bg-blue-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
                >
                  Tenant Monitoring
                </button>
                <button
                  onClick={() => setActiveCatalogTab("assessments")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeCatalogTab === "assessments" ? "bg-blue-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
                >
                  Paid M365 Assessments
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
              {activeCatalogTab === "monitoring" &&
                renderMonitoringCalculator()}
              {activeCatalogTab === "assessments" &&
                renderProductGrid(assessments)}
              {activeCatalogTab === "retainers" && renderProductGrid(retainers)}
            </div>
          </div>
        </section>

        {/* CTA SECTION */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center">
          <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-blue-950/20 to-slate-900 border border-blue-500/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 relative z-10">
              Stop Finding Out About Problems Six Months Late
            </h2>
            <p className="text-slate-300 max-w-xl mx-auto mb-8 relative z-10 text-sm sm:text-base">
              Start with a free diagnostic to see where your tenant stands
              today, or go straight to continuous monitoring built on the same
              framework NASA runs on.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 relative z-10 max-w-xs sm:max-w-none mx-auto">
              <a
                href="#catalog"
                className="px-6 py-3.5 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                See Monitoring Pricing
              </a>
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
