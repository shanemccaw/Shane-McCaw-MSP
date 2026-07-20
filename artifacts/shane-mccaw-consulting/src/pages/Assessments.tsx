import { useLocation } from 'wouter';
import { ShieldCheck, Clock, ChevronRight, Activity, Lock, AlertTriangle, Layers, TrendingUp } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { SEOMeta } from '@/components/SEOMeta';
import { GlassPanel } from '@/components/design-system/GlassPanel';
import { GradientText } from '@/components/design-system/GradientText';
import { useServices, type PublicService } from '@/hooks/useServices';

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const SIGNAL_BADGES = [
  { icon: Layers, label: 'Drift Engine', color: 'text-accent-blue' },
  { icon: Lock, label: 'Security Engine', color: 'text-red-400' },
  { icon: Activity, label: 'Health Engine', color: 'text-emerald-400' },
  { icon: Clock, label: 'SLA Engine', color: 'text-indigo-400' },
  { icon: AlertTriangle, label: 'Scope Creep Engine', color: 'text-amber-400' },
  { icon: TrendingUp, label: 'Sales Offer Engine', color: 'text-accent-violet' },
];

const SIGNAL_ENGINES = [
  { icon: Layers, title: 'Drift Engine', color: 'text-accent-blue', desc: 'Detects unauthorized configuration deviations from your approved baseline across all M365 workloads.' },
  { icon: Lock, title: 'Security Engine', color: 'text-red-400', desc: 'Identifies anonymous links, stale guest accounts, OAuth app over-privileges, and MFA coverage gaps.' },
  { icon: Activity, title: 'Health Engine', color: 'text-emerald-400', desc: 'Calculates real-time composite health scores and triggers automated remediation runbooks on threshold breach.' },
  { icon: Clock, title: 'SLA Engine', color: 'text-indigo-400', desc: 'Tracks delivery SLAs, response timelines, milestone execution rates and uptime guarantees proactively.' },
  { icon: AlertTriangle, title: 'Scope Creep Engine', color: 'text-amber-400', desc: 'Validates every engineer workstream against your legal SOW parameters to prevent undocumented obligations.' },
  { icon: TrendingUp, title: 'Sales Offer Engine', color: 'text-accent-violet', desc: 'Analyzes telemetry gaps to dynamically calculate targeted upgrade recommendations and monitoring expansions.' },
];

export default function Assessments() {
  const [location, setLocation] = useLocation();

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
    <Layout>
      <SEOMeta
        title="Assessments | Shane McCaw Consulting"
        description="Free and paid Microsoft 365 assessments — a real, consent-gated Graph API scan, not a questionnaire. Powered by the same signal engines that run continuous monitoring."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            Built by a Former NASA M365 Architect
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-5">
            Every Signal Engine.<br />
            <GradientText>One Tenant. Zero Blind Spots.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed max-w-3xl mx-auto mb-8">
            Architected by Shane McCaw — creator of the M365 Copilot governance standard NASA
            distributed agency-wide. Every assessment is powered by the same automated signal
            engines that harvest Microsoft Graph telemetry to surface Drift, Security, Health, SLA,
            Scope Creep, and Sales Offer intelligence.
          </p>

          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {SIGNAL_BADGES.map(({ icon: Icon, label, color }) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.06] text-xs font-semibold ${color}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </span>
            ))}
          </div>

          <div className="inline-flex glass-panel p-1.5 rounded-xl gap-1">
            <button
              onClick={() => setLocation('/assessments/all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'all' ? 'text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
              style={activeTab === 'all' ? GRADIENT_BG : undefined}
            >
              All ({services.length})
            </button>
            <button
              onClick={() => setLocation('/assessments/premium')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'paid' ? 'text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
              style={activeTab === 'paid' ? GRADIENT_BG : undefined}
            >
              Paid Deliverables ({paidAssessments.length})
            </button>
            <button
              onClick={() => setLocation('/assessments/start')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'free' ? 'text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
              style={activeTab === 'free' ? GRADIENT_BG : undefined}
            >
              Free Snapshots ({freeAssessments.length})
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent-blue" />
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-center max-w-xl mx-auto my-8">
            Failed to load assessment catalog. Please refresh or contact support.
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
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
                  className={`flex flex-col rounded-2xl p-6 transition-all duration-200 border ${
                    isFree
                      ? 'bg-charcoal-1 border-white/[0.06] hover:border-white/[0.12]'
                      : 'bg-charcoal-1 border-accent-blue/30 hover:border-accent-blue/60 shadow-lg shadow-accent-blue/5'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                        isFree
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-white/[0.06] text-accent-blue border-white/[0.08]'
                      }`}
                    >
                      {isFree ? 'Free Telemetry Snapshot' : 'Paid Deliverable Assessment'}
                    </span>
                    {service.durationDays && (
                      <span className="flex items-center gap-1 text-xs text-text-tertiary">
                        <Clock className="w-3.5 h-3.5" />
                        {service.durationDays} Day Turnaround
                      </span>
                    )}
                  </div>

                  <h2 className="font-display text-xl font-bold text-text-primary mb-2">{service.name}</h2>
                  <p className="text-sm text-text-secondary mb-4 line-clamp-3">{service.description}</p>

                  <div className="mt-auto pt-4 border-t border-white/[0.06] mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="font-numeric text-3xl font-medium text-text-primary">{priceDisplay}</span>
                      {!isFree && service.billingType === 'one_time' && (
                        <span className="text-xs text-text-tertiary">/ one-time</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleCheckout(service)}
                    className={`w-full py-3 px-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                      isFree
                        ? 'bg-white/[0.06] hover:bg-white/[0.1] text-text-primary border border-white/[0.08]'
                        : 'text-white hover:opacity-90'
                    }`}
                    style={!isFree ? GRADIENT_BG : undefined}
                    data-track="cta"
                  >
                    <span>{isFree ? 'Request Snapshot' : 'Buy Assessment'}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <section className="mt-24 pt-16 border-t border-white/[0.06] max-w-6xl mx-auto">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-text-primary mb-4">
              What the Signal Engines Surface
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              Every assessment is driven by automated engines that connect via secure read-only
              Microsoft Graph API to instantly harvest and score your tenant governance posture.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SIGNAL_ENGINES.map(({ icon: Icon, title, color, desc }) => (
              <GlassPanel key={title} className="p-5">
                <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-3">
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="text-sm font-bold text-text-primary mb-1.5">{title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{desc}</p>
              </GlassPanel>
            ))}
          </div>
        </section>
      </section>
    </Layout>
  );
}
