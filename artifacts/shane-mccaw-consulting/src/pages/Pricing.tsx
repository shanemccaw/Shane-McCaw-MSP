import { Link } from "wouter";
import { ArrowRight, CheckCircle, Loader2, AlertCircle, Sparkles, FileSearch, Briefcase, Repeat } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { ChatCTA } from "@/components/ChatCTA";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { useCatalog } from "@/hooks/useCatalog";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

function fmtPrice(raw: string | null): string | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const FUNNEL_STAGES = [
  {
    icon: Sparkles,
    stage: "1. Quiz",
    price: "Free",
    desc: "A 60-second quiz gives you a directional read and points you to the right assessment.",
  },
  {
    icon: FileSearch,
    stage: "2. Assessment",
    price: "Free or fixed price",
    desc: "A free assessment covers the basics. Paid assessments go deeper on a specific domain, priced per assessment below.",
  },
  {
    icon: Briefcase,
    stage: "3. Project",
    price: "Scoped SOW",
    desc: "When an assessment turns up a real gap, the fix is a scoped, fixed-price project — quoted after Shane understands what's actually needed.",
  },
  {
    icon: Repeat,
    stage: "4. Retainer",
    price: "Monthly",
    desc: "Ongoing organizations retain Shane monthly for continued architecture oversight — priced per tier below.",
  },
];

export default function Pricing() {
  const { assessmentOffers, retainerTiers, loading, error } = useCatalog();

  const paidAssessments = [...assessmentOffers]
    .filter((a) => !a.isFree)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const sortedRetainers = [...retainerTiers].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Layout>
      <SEOMeta
        title="Pricing | Shane McCaw Consulting"
        description="How pricing works: a free quiz, a free or fixed-price assessment, a scoped project SOW, and monthly retainers for ongoing architecture oversight."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">Pricing</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            No hourly guesswork. <GradientText>Fixed prices, real scope.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            Every engagement starts with a free or fixed-price assessment — never a sales call you didn't ask for. Here's exactly how the pricing model works, stage by stage.
          </p>
        </div>
      </section>

      {/* Funnel overview */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FUNNEL_STAGES.map((s) => {
            const Icon = s.icon;
            return (
              <GlassPanel key={s.stage} className="p-6 flex flex-col">
                <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-1">{s.stage}</p>
                <p className="font-numeric font-semibold text-text-primary mb-2">{s.price}</p>
                <p className="text-sm text-text-secondary leading-relaxed">{s.desc}</p>
              </GlassPanel>
            );
          })}
        </div>
      </section>

      {/* Paid assessments — catalog-driven */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Assessments</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">Fixed-Price Assessments</h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              Every paid assessment is a fixed price, agreed before you start. No hourly billing, no surprise invoices.
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
              <p className="text-text-secondary">Could not load assessment pricing. Please refresh and try again.</p>
            </div>
          )}
          {!loading && !error && paidAssessments.length === 0 && (
            <p className="text-center text-text-secondary py-12">Assessment pricing coming soon.</p>
          )}
          {!loading && !error && paidAssessments.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {paidAssessments.map((a) => {
                const price = fmtPrice(a.price) ?? fmtPrice(a.basePrice);
                return (
                  <Link
                    key={a.id}
                    href={a.slug ? `/assessments/${a.slug}` : "/assessments"}
                    className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-6 hover:border-accent-blue/30 transition-all flex flex-col"
                  >
                    <h3 className="font-display font-bold text-text-primary mb-2">{a.name}</h3>
                    {a.tagline && <p className="text-text-secondary text-sm leading-relaxed mb-4 flex-grow">{a.tagline}</p>}
                    <p className="font-numeric text-lg font-semibold text-text-primary">{price ?? "Contact for pricing"}</p>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="text-center mt-8">
            <Link href="/assessments" className="inline-flex items-center gap-1.5 text-accent-blue text-sm font-semibold hover:gap-2.5 transition-all">
              Browse all assessments <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Projects — scoped, no price listed */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Projects</p>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4">Scoped, Fixed-Price SOWs</h2>
          <p className="text-text-secondary max-w-xl mx-auto mb-8 leading-relaxed">
            When an assessment finds a real gap, the fix is a scoped project — quoted as a fixed-price statement of work once Shane understands exactly what your tenant needs. No hourly billing here either.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/projects"
              className="px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Browse Projects <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Retainers — catalog-driven */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Retainers</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-3">Monthly Architect Retainers</h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              For organizations that want ongoing senior oversight — a flat monthly fee, no minimum term.
            </p>
          </div>

          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-accent-blue" />
            </div>
          )}
          {!loading && sortedRetainers.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {sortedRetainers.map((tier) => {
                const price = fmtPrice(tier.basePrice) ?? fmtPrice(tier.price);
                return (
                  <Link
                    key={tier.id}
                    href={tier.pageHref ?? "/platform/retainer"}
                    className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-6 hover:border-accent-blue/30 transition-all flex flex-col"
                  >
                    <h3 className="font-display font-bold text-text-primary mb-2">{tier.name}</h3>
                    {(tier.tagline ?? tier.description) && (
                      <p className="text-text-secondary text-sm leading-relaxed mb-4 flex-grow">{tier.tagline ?? tier.description}</p>
                    )}
                    <p className="font-numeric text-lg font-semibold text-text-primary">
                      {price ? `${price}/mo` : "Contact for pricing"}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="text-center mt-8">
            <Link href="/platform/retainer" className="inline-flex items-center gap-1.5 text-accent-blue text-sm font-semibold hover:gap-2.5 transition-all">
              Compare retainer tiers <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4">Not sure which stage fits?</h2>
          <p className="text-text-secondary mb-8 leading-relaxed">
            Start with the free assessment — it's the fastest way to find out what you actually need.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/assessment"
              className="px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start Your Free Assessment
            </Link>
            <ChatCTA className="px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors inline-flex items-center justify-center gap-2">
              <CheckCircle className="w-4 h-4" /> Ask Shane a question
            </ChatCTA>
          </div>
        </div>
      </section>
    </Layout>
  );
}
