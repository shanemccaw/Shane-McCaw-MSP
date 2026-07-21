import { useLocation } from 'wouter';
import { ShieldCheck, Clock, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { SEOMeta } from '@/components/SEOMeta';
import { GradientText } from '@/components/design-system/GradientText';
import { useServices, type PublicService } from '@/hooks/useServices';

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

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

  const displayedFree = activeTab === 'paid' ? [] : freeAssessments;
  const displayedPaid = activeTab === 'free' ? [] : paidAssessments;

  const handleCheckout = (service: PublicService) => {
    setLocation(`/checkout/${encodeURIComponent(service.slug ?? "")}`);
  };

  // Free stays understated/plain glass; Paid gets the gradient-bordered treatment — same
  // asymmetric split already built on Home.tsx's catalog section (renderAssessmentSplit/
  // renderAssessmentCard), carried here rather than inventing a different visual language
  // for the same free/paid distinction.
  const renderAssessmentCard = (service: PublicService, isPaid: boolean) => {
    const priceDisplay = service.isFreeOffering
      ? 'FREE'
      : service.basePrice
        ? `$${Number(service.basePrice).toLocaleString()}`
        : 'Custom';

    // Same graceful deliverables → inclusions → description fallback AssessmentDetail.tsx
    // already uses, so a row with no checklist content written yet still renders cleanly.
    const deliverables = service.deliverables?.length ? service.deliverables : service.inclusions ?? [];

    const card = (
      <div
        className={`flex flex-col h-full rounded-2xl p-6 transition-all duration-200 ${
          isPaid ? 'bg-charcoal-1' : 'glass-panel hover:border-white/[0.18]'
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
              service.isFreeOffering
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-white/[0.06] text-accent-blue border-white/[0.08]'
            }`}
          >
            {service.isFreeOffering ? 'Free Snapshot' : 'Paid Assessment'}
          </span>
          {service.durationDays && (
            <span className="flex items-center gap-1 text-xs text-text-tertiary">
              <Clock className="w-3.5 h-3.5" />
              {service.durationDays} Day Turnaround
            </span>
          )}
        </div>

        <h3 className="font-display text-xl font-bold text-text-primary mb-3">{service.name}</h3>

        {deliverables.length > 0 ? (
          <ul className="space-y-2 mb-6 flex-grow">
            {deliverables.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-sm text-text-secondary leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary mb-6 flex-grow line-clamp-3">{service.description}</p>
        )}

        <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between mt-auto">
          <div>
            <span className="font-numeric text-2xl font-medium text-text-primary">{priceDisplay}</span>
            {!service.isFreeOffering && service.basePrice && service.billingType === 'one_time' && (
              <span className="text-xs text-text-tertiary ml-1">/ one-time</span>
            )}
          </div>
          <button
            onClick={() => handleCheckout(service)}
            className="px-4 py-2 rounded-lg text-white text-xs font-bold transition-opacity hover:opacity-90 flex items-center gap-1"
            style={GRADIENT_BG}
            data-track="cta"
          >
            <span>{service.isFreeOffering ? 'Request' : 'Purchase'}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );

    if (!isPaid) {
      return <div key={service.slug}>{card}</div>;
    }

    return (
      <div key={service.slug} className="rounded-2xl p-[1.5px]" style={GRADIENT_BG}>
        {card}
      </div>
    );
  };

  return (
    <Layout>
      <SEOMeta
        title="Assessments | Shane McCaw Consulting"
        description="Free and paid Microsoft 365 assessments — a real, consent-gated Graph API scan, not a questionnaire, with the same scan depth as our continuous Monitoring service."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <ShieldCheck className="w-4 h-4" />
            Built by a Former NASA M365 Architect
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-5">
            A Real Scan of Your Tenant.<br />
            <GradientText>Not a Guess.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed max-w-3xl mx-auto mb-8">
            Architected by Shane McCaw — creator of the M365 Copilot governance standard NASA
            distributed agency-wide. Every assessment connects securely to your live Microsoft
            365 tenant and scores your real governance, security, and compliance posture — the
            same depth whether you start free or go paid.
          </p>

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
          <div className="max-w-6xl mx-auto space-y-12">
            {displayedFree.length === 0 && displayedPaid.length === 0 && (
              <div className="text-center py-12 text-text-secondary border border-white/[0.08] rounded-2xl bg-charcoal-1">
                No active offerings found in the database. Please contact support.
              </div>
            )}

            {displayedFree.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">
                  Start here — no cost
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {displayedFree.map((service) => renderAssessmentCard(service, false))}
                </div>
              </div>
            )}

            {displayedPaid.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">
                  Go deeper — paid assessments
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {displayedPaid.map((service) => renderAssessmentCard(service, true))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </Layout>
  );
}
