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
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

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
        description="Fixed-price, fixed-scope Microsoft 365 configuration packs — we scan your tenant first, then build your baseline, without a drawn-out proposal cycle."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">
            Quick-Start Packs
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Fixed scope. Fixed price. <GradientText>We scan first, then act.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            Productized configuration packs that build your tenant baseline directly — no
            assessment prerequisite, no open-ended proposal.
          </p>
        </div>
      </section>

      <section className="pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
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
        <section className="pb-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <GlassPanel className="p-6 sm:p-8 text-center">
              <p className="text-sm text-text-secondary leading-relaxed">
                Provisioning runs through our Graph API write-back engine — the automation is
                built, and delivery is a guided, scheduled process rather than an instant
                self-service toggle. You'll get a confirmed timeline after checkout, not an
                immediate live change.
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
