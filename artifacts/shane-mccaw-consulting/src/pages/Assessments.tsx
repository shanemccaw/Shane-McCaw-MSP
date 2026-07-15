import React from 'react';
import { useLocation, Link } from 'wouter';
import { useServices, PublicService } from '../hooks/useServices';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { ShieldCheck, Clock, ChevronRight, Activity, Shield, Lock, AlertTriangle, Layers, TrendingUp, Zap } from 'lucide-react';

export default function Assessments() {
  const [location, setLocation] = useLocation();

  // Dynamic fetches mapping directly to telemetry-driven database content
  // {{db.assessments.list}}
  const { services, loading, error } = useServices({ category: 'assessment' });

  const activeTab = location.includes('/start')
    ? 'free'
    : location.includes('/premium')
      ? 'paid'
      : 'all';

  const paidAssessments = services.filter((s) => !s.isFreeOffering);
  const freeAssessments = services.filter((s) => s.isFreeOffering);

  const displayedServices =
    activeTab === 'paid'
      ? paidAssessments
      : activeTab === 'free'
        ? freeAssessments
        : services;

  const handleCheckout = (service: PublicService) => {
    if (service.isFreeOffering) {
      setLocation(`/contact?service=${encodeURIComponent(service.slug ?? "")}`);
    } else {
      setLocation(`/checkout?product=${encodeURIComponent(service.slug ?? "")}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased">
      <Header />

      <main className="flex-grow pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {/* NASA Authority & Engine Hero */}
        <div className="text-center max-w-4xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            NASA M365 Governance Framework Standard
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight mb-5">
            Six Signal Engines.<br />
            <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">One Tenant. Zero Blind Spots.</span>
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed max-w-3xl mx-auto mb-8">
            Architected by Shane McCaw — creator of NASA's federal Copilot governance standard. Every assessment is powered by automated signal engines that harvest Microsoft Graph telemetry to surface Drift, Security, Health, SLA, Scope Creep, and Sales Offer intelligence.
          </p>

          {/* Engine signal badges */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {[
              { icon: Layers, label: 'Drift Engine', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
              { icon: Lock, label: 'Security Engine', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
              { icon: Activity, label: 'Health Engine', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
              { icon: Clock, label: 'SLA Engine', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
              { icon: AlertTriangle, label: 'Scope Creep Engine', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
              { icon: TrendingUp, label: 'Sales Offer Engine', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
            ].map(({ icon: Icon, label, color }) => (
              <span key={label} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${color}`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
              </span>
            ))}
          </div>

          {/* Tab Filter */}
          <div className="inline-flex bg-slate-900 border border-slate-800 p-1.5 rounded-xl gap-1">
            <button
              onClick={() => setLocation('/assessments/all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'all'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
                }`}
            >
              All ({services.length})
            </button>
            <button
              onClick={() => setLocation('/assessments/premium')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'paid'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
                }`}
            >
              Paid Deliverables ({paidAssessments.length})
            </button>
            <button
              onClick={() => setLocation('/assessments/start')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'free'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
                }`}
            >
              Free Snapshots ({freeAssessments.length})
            </button>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-center max-w-xl mx-auto my-8">
            Failed to load assessment catalog. Please refresh or contact support.
          </div>
        )}

        {/* Catalog Grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {displayedServices.map((service) => {
              const isFree = service.isFreeOffering;
              const priceDisplay = isFree
                ? 'FREE'
                : service.basePrice
                  ? `$${Number(service.basePrice).toLocaleString()}`
                  : 'Custom';

              return (
                <div
                  key={service.slug}
                  className={`flex flex-col rounded-2xl p-6 transition-all duration-200 border ${isFree
                      ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      : 'bg-slate-900 border-blue-500/30 hover:border-blue-500/60 shadow-lg shadow-blue-950/20'
                    }`}
                >
                  {/* Card Header Tag */}
                  <div className="flex items-center justify-between mb-4">
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${isFree
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}
                    >
                      {isFree ? 'Free Telemetry Snapshot' : 'Paid Deliverable Assessment'}
                    </span>
                    {service.durationDays && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock className="w-3.5 h-3.5" />
                        {service.durationDays} Day Turnaround
                      </span>
                    )}
                  </div>

                  {/* Title & Tagline */}
                  <h2 className="text-xl font-bold text-white mb-2">{service.name}</h2>
                  <p className="text-sm text-slate-400 mb-4 line-clamp-3">
                    {service.description}
                  </p>

                  {/* Pricing Display */}
                  <div className="mt-auto pt-4 border-t border-slate-800/80 mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-white">{priceDisplay}</span>
                      {!isFree && service.billingType === 'one_time' && (
                        <span className="text-xs text-slate-400">/ one-time</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => handleCheckout(service)}
                    className={`w-full py-3 px-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${isFree
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/10'
                      }`}
                  >
                    <span>{isFree ? 'Request Snapshot' : 'Buy Assessment'}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Signal Engine Methodology Section */}
        <section className="mt-24 pt-16 border-t border-slate-800/80">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">What the Signal Engines Surface</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Every assessment is driven by automated engines that connect via secure read-only Microsoft Graph API to instantly harvest and score your tenant governance posture.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Layers, title: 'Drift Engine', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', desc: 'Detects unauthorized configuration deviations from your approved baseline across all M365 workloads.' },
              { icon: Lock, title: 'Security Engine', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', desc: 'Identifies anonymous links, stale guest accounts, OAuth app over-privileges, and MFA coverage gaps.' },
              { icon: Activity, title: 'Health Engine', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', desc: 'Calculates real-time composite health scores and triggers automated remediation runbooks on threshold breach.' },
              { icon: Clock, title: 'SLA Engine', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', desc: 'Tracks delivery SLAs, response timelines, milestone execution rates and uptime guarantees proactively.' },
              { icon: AlertTriangle, title: 'Scope Creep Engine', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', desc: 'Validates every engineer workstream against your legal SOW parameters to prevent undocumented obligations.' },
              { icon: TrendingUp, title: 'Sales Offer Engine', color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20', desc: 'Analyzes telemetry gaps to dynamically calculate targeted upgrade recommendations and monitoring expansions.' },
            ].map(({ icon: Icon, title, color, bg, desc }) => (
              <div key={title} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-3 ${bg}`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="text-sm font-bold text-white mb-1.5">{title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
