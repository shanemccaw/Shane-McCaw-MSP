import React from 'react';
import { useLocation, Link } from 'wouter';
import { useServices, PublicService } from '../hooks/useServices';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { ShieldCheck, Clock, ChevronRight, Activity, Shield, Lock, ActivitySquare } from 'lucide-react';

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
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            NASA M365 Governance Framework Standard
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight mb-4">
            Automated Tenant Intelligence & Paid M365 Governance Assessments
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed">
            Architected by Shane McCaw—creator of NASA's federal Copilot governance standard. Our automated signal engines analyze Drift, Security, Health, SLA compliance, and Scope Creep to deliver actionable tenant insights.
          </p>

          {/* Tab Filter */}
          <div className="flex justify-center gap-2 mt-8">
            <button
              onClick={() => setLocation('/assessments/all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
            >
              All Assessments ({services.length})
            </button>
            <button
              onClick={() => setLocation('/assessments/premium')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'paid'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
            >
              Paid Deliverables ({paidAssessments.length})
            </button>
            <button
              onClick={() => setLocation('/assessments/start')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'free'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
            >
              Free Diagnostic Snapshots ({freeAssessments.length})
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

        {/* Engine Explanation Section */}
        <section className="mt-24 pt-16 border-t border-slate-800/80">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Telemetry-Driven Governance Methodology</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Our proprietary audit engines connect secure read-only Graph API integrations to capture M365 configuration drift, compliance anomalies, and lifecycle security metrics instantly.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-850">
              <Shield className="w-8 h-8 text-blue-400 mb-4" />
              <h3 className="text-base font-bold text-white mb-2">NASA-Grade Compliance</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Assessments align directly to the federal standards configured by Shane McCaw for high-security cloud parameters.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-850">
              <ActivitySquare className="w-8 h-8 text-blue-400 mb-4" />
              <h3 className="text-base font-bold text-white mb-2">Drift Intelligence</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                We benchmark your current production parameters against standard gold templates to identify configuration drift.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-850">
              <Lock className="w-8 h-8 text-blue-400 mb-4" />
              <h3 className="text-base font-bold text-white mb-2">Automated Discovery</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                No manual data gathering. Telemetry collection is fully automated and executes within minutes of connection.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
