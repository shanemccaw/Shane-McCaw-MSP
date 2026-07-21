import { Link } from "wouter";
import {
  ShieldCheck, Eye, GitBranch, RefreshCw, FlaskConical, ArrowRight,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

/**
 * Platform-level proof-point story — supports every funnel, kept off the Monitoring page so it
 * doesn't get buried in product copy (website-rebuild-reference-v2.md §5). Content below is the
 * "confirmed autonomous proof points" list from §2 — real mechanisms, not aspirational claims.
 * Guardrails (§6) apply: no FedRAMP/GCC/government-contractor claims, no compliance claims beyond
 * what's formally documented.
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

export default function TrustSecurity() {
  return (
    <Layout>
      <SEOMeta
        title="Trust & Security | Shane McCaw Consulting"
        description="How the platform is built to be trusted with real tenant data: enforced tenant isolation, read-only impersonation, explainable scoring, idempotent operations, and isolated simulation."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">
            Trust &amp; Security
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Built to be trusted with <GradientText>real tenant data</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            Every funnel on this site eventually asks for access to a live Microsoft 365 tenant.
            Here's what actually backs that trust — mechanisms that are built and verifiable, not
            marketing language.
          </p>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-6">
          {PROOF_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <GlassPanel key={point.title} className="p-7">
                <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <h2 className="font-display font-semibold text-lg text-text-primary mb-2">
                  {point.title}
                </h2>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {point.description}
                </p>
              </GlassPanel>
            );
          })}
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
            <Link
              href="/contact"
              className="px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
              data-track="cta"
            >
              Contact Shane <ArrowRight className="w-4 h-4" />
            </Link>
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
