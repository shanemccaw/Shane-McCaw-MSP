import {
  CheckCircle,
  Clock,
  ArrowRight,
  ChevronRight,
  Zap,
  Minus,
  Shield,
  TrendingUp,
  Users,
  Lightbulb,
  MapPin,
  BarChart2,
  Star,
  DollarSign,
  AlertCircle,
  Loader2,
  PhoneCall,
  CheckCircle2,
} from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { useCatalog, type RetainerTier } from "@/hooks/useCatalog";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

function fmtPrice(raw: string | null): string | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function PriceSkeleton() {
  return <span className="inline-block w-20 h-8 bg-white/[0.08] rounded animate-pulse" />;
}

function HoursSkeleton() {
  return <span className="inline-block w-28 h-4 bg-white/[0.06] rounded animate-pulse" />;
}

function isRangePriced(t: RetainerTier): boolean {
  return !!t.basePrice;
}

function isFlatPriced(t: RetainerTier): boolean {
  return !t.basePrice && t.price != null;
}

function ArchitectCard({ tier, loading }: { tier: RetainerTier; loading: boolean }) {
  const price = fmtPrice(tier.price);
  const hours = tier.hoursPerMonth ? `${tier.hoursPerMonth} hours / month` : null;
  const features = tier.features ?? [];
  const hl = tier.highlighted;
  const hasCheckout = !!tier.fulfillmentTypeKey && !!tier.slug;
  const checkoutHref = tier.slug ? `/checkout/${tier.slug}` : null;
  const detailHref = tier.pageHref ?? (tier.slug ? `/retainers/${tier.slug}` : null);

  return (
    <div
      className={`relative flex flex-col rounded-2xl border ${
        hl
          ? "border-accent-blue/50 bg-charcoal-1 shadow-xl shadow-accent-blue/10"
          : "border-white/[0.06] bg-charcoal-1"
      }`}
    >
      {tier.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap" style={GRADIENT_BG}>
            {tier.badge}
          </span>
        </div>
      )}

      <div className="p-8 pb-6 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-accent-violet" />
          {loading ? (
            <HoursSkeleton />
          ) : (
            <span className="text-xs font-bold uppercase tracking-wider text-accent-violet">
              {hours ?? "Hours vary"}
            </span>
          )}
        </div>
        <h2 className="font-display text-xl font-bold text-text-primary mb-1">{tier.name}</h2>
        {loading ? (
          <PriceSkeleton />
        ) : (
          <p className="font-numeric text-4xl font-medium text-text-primary mb-0.5">{price ?? "—"}</p>
        )}
        <p className="text-text-secondary text-sm mb-4">/month · cancel with 30 days' notice</p>
        {(tier.tagline ?? tier.description) && (
          <p className="text-text-secondary text-sm leading-relaxed">{tier.tagline ?? tier.description}</p>
        )}
      </div>

      <div className="p-8 flex-1 flex flex-col">
        {features.length > 0 && (
          <ul className="space-y-3 flex-1">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-sm text-text-secondary">{f}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {!tier.fulfillmentTypeKey ? (
            <button
              disabled
              className="w-full py-2.5 px-4 rounded-lg border border-white/[0.08] text-sm text-text-secondary bg-white/[0.03] cursor-not-allowed"
            >
              Coming soon
            </button>
          ) : (
            <Link
              href={checkoutHref ?? "/contact"}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Get Started
            </Link>
          )}
          {detailHref && (
            <Link
              href={detailHref}
              className="flex items-center justify-center gap-1.5 text-sm text-accent-blue font-medium hover:text-accent-violet transition-colors"
            >
              See full details <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>

        {!hasCheckout && tier.fulfillmentTypeKey === null && tier.slug && (
          <p className="text-xs text-text-secondary text-center mt-2">
            Not yet available for online purchase
          </p>
        )}
      </div>
    </div>
  );
}

function ScopedCard({ tier }: { tier: RetainerTier }) {
  const startingAt = fmtPrice(tier.basePrice);
  const features = tier.features ?? [];
  const hl = tier.highlighted;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-8 h-full ${
        hl
          ? "bg-charcoal-1 border-accent-violet/50 shadow-xl shadow-accent-violet/10"
          : "bg-charcoal-1 border-white/[0.06]"
      }`}
    >
      {tier.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap" style={GRADIENT_BG}>
            {tier.badge}
          </span>
        </div>
      )}

      <h3 className="font-display text-xl font-bold mb-2 text-text-primary">
        {tier.name}
      </h3>

      {startingAt && (
        <p className="font-numeric text-2xl font-medium text-text-primary mb-0.5">
          Starting at {startingAt}
          <span className="text-sm font-normal text-text-secondary">/mo</span>
        </p>
      )}

      {(tier.tagline ?? tier.description) && (
        <p className="text-sm mt-2 mb-5 leading-relaxed text-text-secondary">
          {tier.tagline ?? tier.description}
        </p>
      )}

      {features.length > 0 && (
        <ul className="space-y-2 mb-6 flex-1">
          {features.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-text-secondary"
            >
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-accent-blue" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto">
        <a
          href="/contact"
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
          style={GRADIENT_BG}
          data-track="cta"
        >
          <PhoneCall className="w-4 h-4" /> Request Scoping
        </a>
        <p className="text-xs text-center mt-2 text-text-secondary">
          Scope and pricing finalised in a discovery call
        </p>
      </div>
    </div>
  );
}

/**
 * Build a comparison matrix from catalog features.
 * Rows = union of all feature strings across flat-priced tiers (order preserved).
 */
function buildComparisonRows(tiers: RetainerTier[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const tier of tiers) {
    for (const f of tier.features ?? []) {
      if (!seen.has(f)) {
        seen.add(f);
        order.push(f);
      }
    }
  }
  return order;
}

export default function RetainersOverview() {
  const { retainerTiers, loading, error } = useCatalog();

  const flatTiers = retainerTiers.filter(isFlatPriced).sort((a, b) => a.sortOrder - b.sortOrder);
  const rangeTiers = retainerTiers.filter(isRangePriced).sort((a, b) => a.sortOrder - b.sortOrder);

  const comparisonRows = buildComparisonRows(flatTiers);
  const showComparison = !loading && flatTiers.length >= 2 && comparisonRows.length > 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Microsoft 365 Architect Retainer Plans",
    description:
      "Monthly retainer plans giving you ongoing access to Shane McCaw, NASA's Lead Microsoft 365 Architect.",
    provider: { "@type": "Person", name: "Shane McCaw", jobTitle: "Lead Microsoft 365 Architect" },
  };

  return (
    <Layout>
      <SEOMeta
        title="M365 Architect Retainer Plans | Shane McCaw Consulting"
        description="Monthly Microsoft 365 retainer plans — senior consulting per month. Strategy calls, async support, proactive monitoring, and full-stack M365 expertise from NASA's Lead Architect."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="border-b border-white/[0.06] pt-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/monitoring" className="hover:text-accent-blue transition-colors">
            Pricing
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">Retainer Plans</span>
        </div>
      </div>

      {/* Hero */}
      <section className="pt-12 pb-12 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-bold uppercase tracking-wider mb-6">
            <Zap className="w-3.5 h-3.5" />
            Fractional M365 Architecture
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Fractional M365 Architecture, Delivered by <GradientText>NASA's Lead Architect.</GradientText>
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            For mid-market and regulated organizations that need senior-level clarity, governance,
            and modernization — without hiring full-time.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-text-secondary">
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-accent-blue" /> No minimum term
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-accent-blue" /> Transparent hour tracking
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-accent-blue" /> NASA-level expertise
            </span>
          </div>
        </div>
      </section>

      {/* Why retainers exist */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">
              Why retainers exist
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              Project-based engagements have a fundamental problem: by the time scope is agreed,
              proposals are signed, and work begins, your environment has already drifted.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-5 h-5 text-accent-blue" />
                <h3 className="font-display font-bold text-text-primary">Predictable access</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">A reserved block of senior time every month — no waiting for availability, no proposal delays.</p>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-5 h-5 text-accent-blue" />
                <h3 className="font-display font-bold text-text-primary">Predictable cost</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">One flat monthly fee. No hourly invoices, no scope creep, no surprise overages.</p>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-5 h-5 text-accent-blue" />
                <h3 className="font-display font-bold text-text-primary">Faster modernization</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">Continuous progress each month compounds — you move faster than any project engagement could.</p>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-5 h-5 text-accent-blue" />
                <h3 className="font-display font-bold text-text-primary">Reduced risk</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">Architecture decisions are reviewed before implementation, not audited after a failed rollout.</p>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="flex items-center gap-2 mb-3">
                <Star className="w-5 h-5 text-accent-blue" />
                <h3 className="font-display font-bold text-text-primary">Senior-only delivery</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">Every hour is Shane's. No junior staff, no account managers — just the architect you hired.</p>
            </div>
            <div className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-5 h-5 text-accent-blue" />
                <h3 className="font-display font-bold text-text-primary">No scoping delays</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">Work begins immediately each month. Need something new? Just ask — no SOW required.</p>
            </div>
          </div>
        </div>
      </section>

      {/* What changes when you have an architect */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">
              What changes when you have an architect
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              The difference between managing M365 reactively and having a senior architect guiding
              it proactively is measurable.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><Shield className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">Governance maturity</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">Policies, lifecycle management, and compliance alignment that stick.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><Shield className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">Reduced risk</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">Security gaps and misconfigurations are caught before they become incidents.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">Faster modernization</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">Continuous architectural guidance keeps your tenant moving forward.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><Zap className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">Copilot readiness</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">Data governance, licensing, and permissions configured correctly before you deploy AI.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><Lightbulb className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">Better decisions</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">Leadership gets clear recommendations — not vendor-driven marketing.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><MapPin className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">Clear roadmap</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">A prioritized, written plan for your M365 environment — updated every quarter.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><Users className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">No drift, no chaos</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">Your tenant evolves with intention, not with whoever last opened the admin center.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><DollarSign className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">License optimization</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">Right-size your M365 licensing. Stop paying for seats and SKUs you don't need.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3"><Clock className="w-5 h-5 text-accent-violet" /><h3 className="font-display font-bold text-text-primary">Faster issue resolution</h3></div>
              <p className="text-sm text-text-secondary leading-relaxed">When something breaks, a senior architect knows exactly where to look.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Shane? */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">Why Shane?</h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              There are many M365 consultants. There is one with this combination of credentials.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mx-auto mb-4 text-accent-blue">
                <Star className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-text-primary text-lg mb-3">NASA Lead Architect</h3>
              <p className="text-sm text-text-secondary leading-relaxed">Shane served as the Lead Microsoft 365 Architect at NASA — managing one of the most complex and compliance-intensive M365 deployments in the federal government.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mx-auto mb-4 text-accent-blue">
                <Star className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-text-primary text-lg mb-3">30 years in Microsoft</h3>
              <p className="text-sm text-text-secondary leading-relaxed">Three decades working inside the Microsoft ecosystem means Shane's expertise is deep, not surface-level. He has seen every major platform shift firsthand.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mx-auto mb-4 text-accent-blue">
                <Star className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-text-primary text-lg mb-3">Senior-only, always</h3>
              <p className="text-sm text-text-secondary leading-relaxed">No junior consultants, no account managers, no handoffs. When you hire Shane, every hour of every deliverable is Shane.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Architect tier cards — catalog-driven */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">
              Architect Retainer Plans
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              A reserved block of Shane's time every month — flat-rate, no scoping, no delays.
            </p>
          </div>

          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-accent-blue" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertCircle className="size-8 text-red-400" />
              <p className="text-text-secondary">
                Could not load retainer plans. Please refresh and try again.
              </p>
            </div>
          )}

          {!loading && !error && flatTiers.length === 0 && (
            <p className="text-center text-text-secondary py-12">Retainer plans coming soon.</p>
          )}

          {!loading && !error && flatTiers.length > 0 && (
            <div
              className={`grid grid-cols-1 gap-6 items-stretch ${
                flatTiers.length >= 3
                  ? "md:grid-cols-3"
                  : flatTiers.length === 2
                    ? "md:grid-cols-2"
                    : "max-w-sm mx-auto"
              }`}
            >
              {flatTiers.map((tier) => (
                <ArchitectCard key={tier.id} tier={tier} loading={loading} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Advisory / range-priced tiers — catalog-driven */}
      {(loading || rangeTiers.length > 0) && (
        <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">
                Scoped Advisory Services
              </h2>
              <p className="text-text-secondary max-w-xl mx-auto">
                Engagement scope and pricing are finalised in a discovery call — no guesswork, no surprises.
              </p>
            </div>

            {loading && (
              <div className="flex justify-center py-8">
                <Loader2 className="size-6 animate-spin text-accent-blue" />
              </div>
            )}

            {!loading && rangeTiers.length > 0 && (
              <div
                className={`grid grid-cols-1 gap-6 ${
                  rangeTiers.length >= 2 ? "md:grid-cols-2" : "max-w-sm mx-auto"
                }`}
              >
                {rangeTiers.map((tier) => (
                  <ScopedCard key={tier.id} tier={tier} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Feature comparison table — fully catalog-driven */}
      {showComparison && (
        <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">
                Compare plans at a glance
              </h2>
              <p className="text-text-secondary max-w-xl mx-auto">
                Every feature, side by side — so you can pick the tier that fits without reading each card twice.
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/[0.06]">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="bg-charcoal-1 text-left px-6 py-4 font-semibold text-text-primary border-b border-white/[0.06]">
                      Feature
                    </th>
                    {flatTiers.map((tier) => (
                      <th
                        key={tier.id}
                        className={`text-center px-4 py-4 border-b font-normal ${
                          tier.highlighted
                            ? "bg-accent-blue/[0.06] border-accent-blue/30 pt-8 relative"
                            : "bg-charcoal-1 border-white/[0.06]"
                        }`}
                      >
                        {tier.highlighted && (
                          <span
                            className="absolute top-2 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap"
                            style={GRADIENT_BG}
                          >
                            {tier.badge ?? "Popular"}
                          </span>
                        )}
                        <span
                          className={`block text-xs font-bold uppercase tracking-wider mb-1 ${
                            tier.highlighted ? "text-accent-blue" : "text-text-secondary"
                          }`}
                        >
                          {tier.name}
                        </span>
                        <span className="block text-lg font-numeric font-bold text-text-primary">
                          {fmtPrice(tier.price) ?? "—"}
                          <span className="text-sm font-normal text-text-secondary">/mo</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((feature, i) => (
                    <tr key={feature} className={i % 2 === 0 ? "bg-charcoal-0" : "bg-charcoal-1/50"}>
                      <td className="px-6 py-4 font-medium text-text-primary border-b border-white/[0.05]">
                        {feature}
                      </td>
                      {flatTiers.map((tier) => {
                        const has = (tier.features ?? []).includes(feature);
                        return (
                          <td
                            key={tier.id}
                            className={`px-4 py-4 text-center border-b ${
                              tier.highlighted
                                ? "bg-accent-blue/[0.04] border-accent-blue/15"
                                : "border-white/[0.05]"
                            }`}
                          >
                            {has ? (
                              <CheckCircle2 className="w-5 h-5 text-accent-blue mx-auto" />
                            ) : (
                              <Minus className="w-4 h-4 text-text-tertiary/40 mx-auto" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="bg-charcoal-0">
                    <td className="px-6 py-5 text-text-secondary text-xs italic">
                      All plans: no minimum term · cancel with 30 days' notice
                    </td>
                    {flatTiers.map((tier) => (
                      <td
                        key={tier.id}
                        className={`px-4 py-5 text-center ${tier.highlighted ? "bg-accent-blue/[0.04]" : ""}`}
                      >
                        {tier.slug && tier.fulfillmentTypeKey && (
                          <Link
                            href={`/checkout/${tier.slug}`}
                            className={`inline-flex items-center justify-center gap-1 text-xs font-bold transition-colors ${
                              tier.highlighted
                                ? "text-white px-3 py-1.5 rounded-full"
                                : "text-accent-blue hover:text-accent-violet"
                            }`}
                            style={tier.highlighted ? GRADIENT_BG : undefined}
                          >
                            Get started <ArrowRight className="w-3 h-3" />
                          </Link>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* How we work together */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4">
            How we work together
          </h2>
          <p className="text-text-secondary mb-12 max-w-xl mx-auto">
            A retainer gives you a reserved block of Shane's time each month — no need to scope a project or wait for a proposal.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="w-9 h-9 rounded-full flex items-center justify-center mb-4" style={GRADIENT_BG}>
                <span className="text-white text-sm font-bold">1</span>
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Async-first communication</h3>
              <p className="text-sm text-text-secondary leading-relaxed">Most questions are answered asynchronously — via Teams or email — so you get answers without waiting for a scheduled call.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="w-9 h-9 rounded-full flex items-center justify-center mb-4" style={GRADIENT_BG}>
                <span className="text-white text-sm font-bold">2</span>
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Strategy calls</h3>
              <p className="text-sm text-text-secondary leading-relaxed">Scheduled video sessions to review priorities, roadmap decisions, and architecture questions with your team.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="w-9 h-9 rounded-full flex items-center justify-center mb-4" style={GRADIENT_BG}>
                <span className="text-white text-sm font-bold">3</span>
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Architecture reviews</h3>
              <p className="text-sm text-text-secondary leading-relaxed">Shane reviews proposals, designs, and tenant configurations before you commit — catching risks early.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="w-9 h-9 rounded-full flex items-center justify-center mb-4" style={GRADIENT_BG}>
                <span className="text-white text-sm font-bold">4</span>
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Hands-on configuration</h3>
              <p className="text-sm text-text-secondary leading-relaxed">When guidance isn't enough, Shane directly configures policies, workloads, and governance rules inside your tenant.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="w-9 h-9 rounded-full flex items-center justify-center mb-4" style={GRADIENT_BG}>
                <span className="text-white text-sm font-bold">5</span>
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Transparent hour tracking</h3>
              <p className="text-sm text-text-secondary leading-relaxed">Time is logged in a shared document you can view at any time — no surprises at month-end.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl p-6 border border-white/[0.06]">
              <div className="w-9 h-9 rounded-full flex items-center justify-center mb-4" style={GRADIENT_BG}>
                <span className="text-white text-sm font-bold">6</span>
              </div>
              <h3 className="font-display font-bold text-text-primary mb-2">Monthly written summary</h3>
              <p className="text-sm text-text-secondary leading-relaxed">A concise report of what was accomplished, what was observed, and what Shane recommends for next month.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-10 text-center">
            Frequently asked questions
          </h2>
          <div className="space-y-5">
            <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
              <h3 className="font-display font-bold text-text-primary mb-2">Can I change plans after I start?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">Yes. You can upgrade or downgrade with 30 days' notice. Shane will prorate any balance so you're never paying for hours you haven't used.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
              <h3 className="font-display font-bold text-text-primary mb-2">Do unused hours roll over?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">Hours reset each month — they don't roll over. This keeps Shane's schedule predictable and ensures every client gets focused, uninterrupted attention.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
              <h3 className="font-display font-bold text-text-primary mb-2">What counts as a consulting hour?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">Everything: strategy calls, async Q&amp;A, document and architecture reviews, hands-on configuration, and written deliverables. Shane tracks time transparently in a shared log you can view at any time.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
              <h3 className="font-display font-bold text-text-primary mb-2">Is there a minimum commitment?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">No minimum term. Cancel or pause with 30 days' written notice and you're done — no lock-in, no cancellation fees.</p>
            </div>
            <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
              <h3 className="font-display font-bold text-text-primary mb-2">Do you work with regulated industries?</h3>
              <p className="text-text-secondary text-sm leading-relaxed">Yes. Shane regularly supports organizations operating under HIPAA, SOC 2, and similar compliance frameworks. Architecture decisions account for compliance boundaries from day one.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 text-center border-t border-white/[0.06]">
        <div className="max-w-2xl mx-auto">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl font-bold text-text-primary mb-4">Book a Free Discovery Call</h2>
            <p className="text-text-secondary mb-8 text-lg">
              Speak directly with Shane — no salespeople, no pressure.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/book"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
                style={GRADIENT_BG}
                data-track="cta"
              >
                Book a Free Discovery Call
              </a>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 text-text-secondary hover:text-text-primary font-medium text-base transition-colors"
              >
                Send Shane a message <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
