import { Link } from "wouter";
import {
  ShieldCheck, Eye, GitBranch, RefreshCw, FlaskConical, ArrowRight,
  Lock, Shield, Award, Briefcase, Bot,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { ChatCTA } from "@/components/ChatCTA";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

/**
 * Platform-level proof-point story — supports every funnel, kept off the Monitoring page so it
 * doesn't get buried in product copy (website-rebuild-reference-v2.md §5). Content below is the
 * "confirmed autonomous proof points" list from §2 — real mechanisms, not aspirational claims.
 * Guardrails (§6) apply: no FedRAMP/GCC/government-contractor claims, no compliance claims beyond
 * what's formally documented.
 *
 * This page structures trust around two distinct, explicitly-labeled pillars: mechanism (below)
 * and Shane's personal credential (PERSONAL_STATS) — never blended into one undifferentiated claim.
 * Icons reused from elsewhere on the site rather than invented: Lock/Shield already represent the
 * Security & Governance topic pages (solutionsTopics.ts); Award/Briefcase/Bot already represent
 * Shane's bio credentials (About.tsx).
 */
const PROOF_POINTS = [
  {
    icon: ShieldCheck,
    title: "Tenant isolation, enforced",
    description:
      "Every query and write path is scoped to the requesting tenant at the data layer — isolation is a structural property of the platform, not a claim resting on application-level discipline alone.",
  },
  {
    icon: Eye,
    title: "Read-only impersonation",
    description:
      "When support needs to see what a customer sees, impersonation sessions are read-only and logged — nobody quietly acts on a customer's behalf.",
  },
  {
    icon: GitBranch,
    title: "Explainable scoring lineage",
    description:
      "Every health, risk, and drift score traces back to the specific Graph API signals that produced it. Nothing is a black-box number — the lineage is inspectable end to end.",
  },
  {
    icon: RefreshCw,
    title: "Idempotent operations",
    description:
      "Retries, webhook replays, and duplicate submissions don't double-charge, double-provision, or double-fire. Every write path is built to be safely repeatable.",
  },
  {
    icon: FlaskConical,
    title: "Testbed isolation for all simulation",
    description:
      "Anything that simulates a finding, a workflow run, or a signal fire happens in an isolated testbed path — never mixed into real tenant data or customer-facing metrics.",
  },
];

/**
 * Personal-credential pillar — facts already confirmed and shipped on About.tsx (present tense,
 * personal-only, no platform-level federal claims per website-rebuild-reference-v2.md §6). Nothing
 * new is asserted here; this is the same bio-stat set, surfaced on Trust & Security so the second
 * pillar isn't buried on a separate page.
 */
const PERSONAL_STATS = [
  { icon: Briefcase, label: "Years in Microsoft ecosystem", value: "30+" },
  { icon: Shield, label: "Current role", value: "Lead M365 Architect, NASA" },
  { icon: Bot, label: "AI designation", value: "Copilot for M365 SME" },
  { icon: Award, label: "Microsoft certifications", value: "20+" },
];

export default function TrustSecurity() {
  return (
    <Layout>
      <SEOMeta
        title="Trust & Security | Shane McCaw Consulting"
        description="How the platform is built to be trusted with real tenant data: enforced tenant isolation, read-only impersonation, explainable scoring, idempotent operations, and isolated simulation."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-8">
            <ShieldCheck className="w-3.5 h-3.5" />
            Trust &amp; Security
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Built to be trusted with <GradientText>real tenant data</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            Every funnel on this site eventually asks for access to a live Microsoft 365 tenant.
            Trust here comes from two places: the mechanics the platform enforces, and the person
            who built it — not marketing language standing in for either one.
          </p>
        </div>
      </section>

      {/* Two-pillar orientation — explicit per website-rebuild-reference-v2.md guardrails: platform
          mechanism and personal credential are two distinct claims, never blended into one. */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-6">
          <a
            href="#platform-trust"
            className="group rounded-2xl bg-charcoal-1 border border-accent-blue/20 hover:border-accent-blue/40 transition-all p-7 flex flex-col"
          >
            <div className="w-11 h-11 rounded-xl bg-accent-blue/10 border border-accent-blue/20 flex items-center justify-center text-accent-blue mb-4">
              <Lock className="w-5 h-5" />
            </div>
            <p className="text-accent-blue text-xs font-bold uppercase tracking-wider mb-2">Pillar One</p>
            <h2 className="font-display text-xl font-bold text-text-primary mb-2">Trust Built Into the Platform</h2>
            <p className="text-sm text-text-secondary leading-relaxed flex-grow">
              Enforced tenant isolation, logged impersonation, explainable scoring, idempotent
              writes, isolated simulation — structural properties, not promises.
            </p>
            <span className="inline-flex items-center gap-1.5 text-accent-blue text-sm font-semibold mt-5 group-hover:gap-2.5 transition-all">
              See the mechanisms <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </a>
          <a
            href="#personal-credibility"
            className="group rounded-2xl bg-charcoal-1 border border-accent-violet/20 hover:border-accent-violet/40 transition-all p-7 flex flex-col"
          >
            <div className="w-11 h-11 rounded-xl bg-accent-violet/10 border border-accent-violet/20 flex items-center justify-center text-accent-violet mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <p className="text-accent-violet text-xs font-bold uppercase tracking-wider mb-2">Pillar Two</p>
            <h2 className="font-display text-xl font-bold text-text-primary mb-2">Trust Built Into Shane</h2>
            <p className="text-sm text-text-secondary leading-relaxed flex-grow">
              Current NASA Lead M365 Architect and Copilot SME — the same governance discipline he
              runs at NASA every day, brought to this platform and every engagement.
            </p>
            <span className="inline-flex items-center gap-1.5 text-accent-violet text-sm font-semibold mt-5 group-hover:gap-2.5 transition-all">
              Meet the architect <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </a>
        </div>
      </section>

      {/* Pillar One: Platform */}
      <section id="platform-trust" className="pb-24 px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-xs font-bold uppercase tracking-wider mb-3">Pillar One</p>
            <h2 className="font-display text-3xl font-bold text-text-primary">Trust Built Into the Mechanics</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {PROOF_POINTS.map((point) => {
              const Icon = point.icon;
              return (
                <GlassPanel key={point.title} className="p-7">
                  <div className="w-10 h-10 rounded-xl bg-accent-blue/10 border border-accent-blue/20 flex items-center justify-center text-accent-blue mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-semibold text-lg text-text-primary mb-2">
                    {point.title}
                  </h3>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {point.description}
                  </p>
                </GlassPanel>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pillar Two: Personal — NASA credential framed strictly as personal, never platform
          capability (website-rebuild-reference-v2.md §6). Present tense: current role, not former. */}
      <section id="personal-credibility" className="pb-24 px-4 sm:px-6 lg:px-8 scroll-mt-24 border-t border-white/[0.06] pt-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-violet text-xs font-bold uppercase tracking-wider mb-3">Pillar Two</p>
            <h2 className="font-display text-3xl font-bold text-text-primary mb-4">Trust Built Into Shane</h2>
            <p className="text-text-secondary max-w-2xl mx-auto leading-relaxed">
              Shane McCaw is the current Lead Microsoft 365 Architect and Copilot for Microsoft 365
              Subject Matter Expert at NASA — not a past title, his day job today. He governs
              tenant security, sensitivity labeling, and Copilot rollout for one of the most
              scrutinized Microsoft 365 environments in the federal government, and brings that
              same governance discipline to this platform and every client engagement.
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {PERSONAL_STATS.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="rounded-2xl bg-charcoal-1 border border-white/[0.06] p-5 text-center">
                  <div className="w-10 h-10 rounded-lg bg-accent-violet/10 border border-accent-violet/20 flex items-center justify-center text-accent-violet mx-auto mb-3">
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="text-text-secondary text-xs mb-1">{stat.label}</p>
                  <p className="font-numeric font-semibold text-text-primary text-sm">{stat.value}</p>
                </div>
              );
            })}
          </div>
          <GlassPanel className="p-6 sm:p-7 max-w-3xl mx-auto">
            <p className="text-text-secondary text-sm leading-relaxed">
              This is Shane's personal credential, not a claim about this platform's compliance
              posture: the checks this platform runs are the same class of control he manages in a
              live enterprise tenant, but this platform doesn't provide, claim, or imply coverage of
              any federal compliance program, and isn't built or marketed for government or
              FedRAMP-scoped tenants.
            </p>
          </GlassPanel>
          <div className="text-center mt-8">
            <Link
              href="/about"
              className="inline-flex items-center gap-1.5 text-accent-violet text-sm font-semibold hover:gap-2.5 transition-all"
            >
              Read Shane's full background <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Compliance posture — guardrail: no claims beyond what's formally documented (§6) */}
      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 text-center">
            <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
              Compliance posture
            </p>
            <p className="text-text-secondary leading-relaxed">
              Currently building toward SOC 2 Type I. We don't claim certifications we don't hold,
              and this platform is not built or marketed for government or FedRAMP-scoped tenants.
            </p>
          </GlassPanel>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display text-2xl font-bold text-text-primary mb-4">
            Questions about how this works?
          </h2>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <ChatCTA
              className="px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
              data-track="cta"
            >
              Contact Shane <ArrowRight className="w-4 h-4" />
            </ChatCTA>
            <Link
              href="/about"
              className="px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
              data-track="cta"
            >
              About Shane McCaw
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
