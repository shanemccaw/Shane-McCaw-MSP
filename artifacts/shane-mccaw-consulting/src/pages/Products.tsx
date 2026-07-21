import { useMemo } from "react";
import { Link } from "wouter";
import {
  Loader2,
  AlertCircle,
  ArrowRight,
  ChevronRight,
  CheckCircle2,
  KeyRound,
  UserPlus,
  UserMinus,
  ShieldAlert,
  Package,
  ShieldCheck,
  Search,
  ListChecks,
  Rocket,
  Wrench,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

// The real checkout + execution flow (Checkout.tsx's guest-info -> consent -> payment wizard,
// config-pack-orchestrator.ts's materialize-then-run pipeline): consent unlocks a live Graph
// connection, the exact pack scope is visible on this page before checkout (not a post-consent
// review screen — see below), and execution runs through the same Workflow Engine + verification-
// gate mechanism the platform's Monitoring remediation uses.
const HOW_IT_WORKS = [
  {
    icon: ShieldCheck,
    label: "Grant Consent",
    desc: "You approve a scoped Microsoft 365 admin consent request through the standard Microsoft OAuth flow — no shared credentials, no support ticket.",
  },
  {
    icon: Search,
    label: "We Read Your Tenant",
    desc: "The moment consent lands, we connect through Microsoft Graph and read your tenant's current configuration — the same connection our Monitoring engines run on, not a one-off script.",
  },
  {
    icon: ListChecks,
    label: "See the Exact Scope",
    desc: "Every pack lists its precise baseline actions right on this page, before you ever check out — not a vague statement of work. What you see is what runs.",
  },
  {
    icon: Rocket,
    label: "Execute the Pack",
    desc: "The pack runs as a real Workflow Engine execution, applying each baseline action against Graph in the defined order — with a verification gate pausing on any step that issues new credentials.",
  },
];

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

/**
 * Real, verified deliverables for the packs whose scope is fully known —
 * website-rebuild-reference-v2.md §1/§2, task-verified against the real
 * baseline_action_templates set (BASELINE_TEMPLATES_COMPLETION_SUMMARY.md).
 * Deliberately excludes Security Incident Response / Compromised Account
 * Recovery — those two only have a generic description with no specific
 * actions confirmed yet, so no checklist is fabricated for them; they fall
 * back to whatever the catalog's own deliverables/description already say.
 */
const PACK_DELIVERABLES: Record<string, string[]> = {
  "entra id quick-start pack": [
    "Break-glass emergency access account",
    "PIM eligibility rules",
    "Conditional Access baseline",
    "Security defaults",
    "Tenant branding",
    "Guest access restriction",
    "Group naming policy",
  ],
  "new employee onboarding pack": ["Account creation", "License assignment", "Group membership"],
  "employee offboarding pack": [
    "Disable access",
    "Revoke sessions",
    "Remove license",
    "Convert mailbox",
    "Remove group access",
  ],
};

const PACK_ICONS: Record<string, typeof Package> = {
  "entra id quick-start pack": KeyRound,
  "new employee onboarding pack": UserPlus,
  "employee offboarding pack": UserMinus,
  "security incident response pack": ShieldAlert,
  "compromised account recovery pack": ShieldAlert,
};

function packKey(name: string): string {
  return name.trim().toLowerCase();
}

function PackCard({ pack, index }: { pack: PublicService; index: number }) {
  const key = packKey(pack.name);
  const Icon = PACK_ICONS[key] ?? Package;
  const price = formatPriceDisplay(pack);
  const deliverables = PACK_DELIVERABLES[key] ?? pack.deliverables ?? pack.inclusions ?? [];
  const isHighlighted = pack.highlighted;

  return (
    <div
      className={`flex flex-col rounded-2xl p-6 transition-all duration-200 relative ${
        isHighlighted
          ? "bg-charcoal-1 border-2 border-accent-blue/50 shadow-lg shadow-accent-blue/10"
          : "bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30"
      }`}
      data-testid={`pack-${index}`}
    >
      {isHighlighted && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-wider"
          style={GRADIENT_BG}
        >
          Most Popular
        </span>
      )}

      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 bg-white/[0.06] border border-white/[0.08]">
        <Icon className="w-5 h-5 text-accent-blue" />
      </div>

      <h3 className="font-display text-xl font-bold text-text-primary mb-1">{pack.name}</h3>
      {(pack.tagline ?? pack.description) && (
        <p className="text-sm text-text-secondary mb-6">{pack.tagline ?? pack.description}</p>
      )}

      <div className="pt-2 pb-6 border-b border-white/[0.06] mb-6">
        <span className="font-numeric text-3xl font-medium text-text-primary">{price}</span>
      </div>

      {deliverables.length > 0 && (
        <ul className="space-y-2.5 mb-6 flex-grow">
          {deliverables.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
              <CheckCircle2 className="w-4 h-4 text-accent-blue mt-0.5 shrink-0" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-3">
        <Link
          href={`/checkout/${pack.slug ?? ""}`}
          className={`w-full px-4 py-3 rounded-xl text-sm font-bold text-center transition-all flex items-center justify-center gap-1 ${
            isHighlighted
              ? "text-white hover:opacity-90"
              : "bg-white/[0.06] hover:bg-white/[0.1] text-text-primary border border-white/[0.08]"
          }`}
          style={isHighlighted ? GRADIENT_BG : undefined}
          data-testid={`pack-cta-${index}`}
          data-track="cta"
        >
          <span>Get Started</span>
          <ChevronRight className="w-4 h-4" />
        </Link>
        {pack.pageHref && (
          <div className="text-center">
            <Link href={pack.pageHref} className="text-sm font-medium text-accent-blue hover:underline">
              Learn More →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Quick-Start Packs — proactive "build your tenant" configuration packs, sold standalone,
 * no prerequisite scan (website-rebuild-reference-v2.md §1/§2/§5). Signal-triggered packs
 * generated from real diagnostic findings stay Portal-side (Sales Offer Engine) and are not
 * duplicated here. Filtered to the real config_pack catalog rows (serviceType, matching this
 * codebase's established public-catalog filter convention — see /catalog/assessments) rather
 * than the previous unfiltered useServices() call, which dumped every public service (Monitoring
 * tiers, Assessments, Retainers included) into one grid.
 */
export default function Products() {
  const { services, loading, error } = useServices({ type: "config_pack" });

  const packs = useMemo(() => [...services].sort((a, b) => a.sortOrder - b.sortOrder), [services]);

  return (
    <Layout>
      <SEOMeta
        title="Quick-Start Packs | Shane McCaw Consulting"
        description="Fixed-price, fixed-scope Microsoft 365 configuration packs, applied directly through a real Graph write-back engine — no assessment prerequisite, no drawn-out proposal cycle."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-4">
            Quick-Start Packs
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Fixed scope. Fixed price. <GradientText>We read first, then act.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed mb-10">
            Productized Microsoft 365 configuration packs that build your tenant baseline
            directly, through a real Graph write-back engine — no assessment prerequisite, no
            open-ended proposal, no rate card to negotiate.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <StatPanel label="Scope" value="Fixed at checkout" />
            <StatPanel label="Pricing" value="Fixed, upfront" />
            <StatPanel label="Access" value="Admin consent" />
            <StatPanel label="Delivery" value="Guided & scheduled" />
          </div>
        </div>
      </section>

      {/* WHAT A QUICK-START PACK ACTUALLY IS */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Not a Proposal. <GradientText>A Pack You Can See Before You Buy.</GradientText>
            </h2>
            <p className="text-text-secondary">
              No scoping call, no rate card, no SOW negotiation — just a defined set of Microsoft
              365 configuration changes, priced and listed up front.
            </p>
          </div>
          <GlassPanel className="p-8 sm:p-10">
            <p className="text-text-secondary leading-relaxed mb-4">
              Most Microsoft 365 configuration work starts as an open-ended engagement: a
              discovery call, a scoping document, an hourly or project rate that can move once
              work begins. A Quick-Start Pack is the opposite — a pre-built bundle of baseline
              actions (an Entra ID security baseline, a new-employee onboarding sequence, an
              offboarding sequence) that runs against your tenant through the same real Graph
              write-back engine behind our Monitoring platform's automated remediation.
            </p>
            <p className="text-text-secondary leading-relaxed">
              The scope is fixed before you pay, the price is fixed before you pay, and every
              action the pack takes traces back to a specific, listed deliverable — not an
              estimate that grows once someone starts digging.
            </p>
          </GlassPanel>
        </div>
      </section>

      {/* HOW IT WORKS — real checkout wizard + orchestrator flow, not aspirational */}
      <section className="border-t border-white/[0.06] pb-16 px-4 sm:px-6 lg:px-8 pt-16">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              How a <GradientText>Quick-Start Pack</GradientText> Runs
            </h2>
            <p className="text-text-secondary">
              Consent, connect, confirm scope, execute — the same four steps for every pack.
            </p>
          </div>
          <div className="flex flex-col md:flex-row items-stretch gap-1">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="flex flex-col md:flex-row items-start md:items-stretch flex-1">
                  <div className="flex flex-col flex-1 p-5 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-3">
                      <Icon className="w-4 h-4 text-accent-blue" />
                    </div>
                    <div className="text-[10px] font-bold text-accent-blue uppercase tracking-widest mb-1">Step {i + 1}</div>
                    <div className="text-sm font-bold text-text-primary mb-1.5">{step.label}</div>
                    <p className="text-xs text-text-secondary leading-relaxed">{step.desc}</p>
                  </div>
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="hidden md:flex items-center px-1 text-text-tertiary">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              The Current <GradientText>Pack Catalog</GradientText>
            </h2>
            <p className="text-text-secondary">
              Every deliverable listed below is exactly what runs — nothing added once you're in
              checkout.
            </p>
          </div>
          {loading && (
            <div className="flex justify-center py-20">
              <Loader2 className="size-8 animate-spin text-accent-blue" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <AlertCircle className="size-8 text-accent-violet" />
              <p className="text-text-secondary">
                Could not load the Quick-Start Packs. Please{" "}
                <Link href="/contact" className="text-accent-blue hover:underline">
                  contact us
                </Link>{" "}
                directly.
              </p>
            </div>
          )}

          {!loading && !error && packs.length === 0 && (
            <div className="text-center py-20 text-text-secondary border border-white/[0.08] rounded-2xl bg-charcoal-1">
              No packs are published yet.{" "}
              <Link href="/contact" className="text-accent-blue hover:underline">
                Get in touch
              </Link>{" "}
              and we'll scope one directly.
            </div>
          )}

          {!loading && !error && packs.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
              {packs.map((pack, i) => (
                <PackCard key={pack.slug ?? pack.id} pack={pack} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {!loading && !error && packs.length > 0 && (
        <section className="py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
                What <GradientText>You Get</GradientText>
              </h2>
              <p className="text-text-secondary">
                A configuration change made directly in your tenant — not a report telling you
                what to go build yourself.
              </p>
            </div>
            <GlassPanel className="p-8 sm:p-10">
              <div className="flex flex-col md:flex-row items-start gap-6 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                  <Wrench className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-display text-2xl font-bold text-text-primary mb-2">
                    We Don't Just Tell You What to Build — <GradientText>We Build It.</GradientText>
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    Every pack runs through our real Graph write-back engine — the same
                    remediation mechanism behind our Monitoring platform's automated fixes — to
                    apply the pack's exact deliverables directly to your tenant.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                {[
                  "A working break-glass emergency access account — not just a recommendation to create one",
                  "A Conditional Access baseline actually applied to your tenant, not a checklist to hand your IT team",
                  "New employee onboarding — account, license, group membership — that runs the day someone starts",
                ].map((example) => (
                  <div key={example} className="flex items-start gap-2 text-xs text-text-secondary bg-charcoal-1 border border-white/[0.06] rounded-xl p-3">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-blue" />
                    {example}
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-secondary">
                Delivery is a guided, scheduled process rather than an instant self-service
                toggle — you'll get a confirmed timeline after checkout, not an immediate live
                change.
              </p>
            </GlassPanel>
          </div>
        </section>
      )}

      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-text-secondary mb-6">
            Already have scan findings? Signal-triggered packs are generated from your real
            diagnostic results and checked out from inside the Portal.
          </p>
          <Link
            href="/assessment"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
            data-track="cta"
          >
            Start a Free Assessment <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </Layout>
  );
}
