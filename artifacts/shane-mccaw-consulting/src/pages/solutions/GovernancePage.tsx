import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Shield, GitBranch, Tag, UserCog, Layers, CheckCircle2,
  Users, Fingerprint, Radar, Award,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { PersonalizedContent } from "@/components/PersonalizedContent";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useHealthPillars, useLatestPresentation, usePortalUrl, useQuizOfferData } from "@/hooks/usePersonalizationData";
import { topicMatchesKeywordText } from "@/data/solutionsTopics";
import { trackEvent } from "@/lib/analytics";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

// The 4 real Governance modules — kept verbatim from the underlying catalog coverage
// (data/solutionsTopics.ts governance entry) per task scope: only the intro copy above
// them is new, the modules themselves are not rewritten.
const MODULES = [
  {
    icon: GitBranch,
    title: "Lifecycle Policy",
    description: "Microsoft 365 Group and Teams lifecycle policy enforcement.",
  },
  {
    icon: Tag,
    title: "Naming & Ownership",
    description: "Naming convention and ownership requirement compliance.",
  },
  {
    icon: Layers,
    title: "Baseline Drift",
    description: "Configuration baseline drift since the last approved state.",
  },
  {
    icon: UserCog,
    title: "Admin Role Sprawl",
    description: "Admin role assignment sprawl — who actually has Global Admin, and why.",
  },
];

const WHAT_IT_DOES = [
  {
    icon: GitBranch,
    title: "Lifecycle Enforcement",
    description:
      "Every Microsoft 365 Group and Team is checked against a real lifecycle policy — renewal, archival, and deletion tracked against the rule, not a spreadsheet someone forgot to update.",
  },
  {
    icon: Tag,
    title: "Naming Discipline",
    description:
      "New Teams and Groups are checked against your naming convention rules, so six months from now nobody's guessing what a site prefixed \"proj-\" was actually for.",
  },
  {
    icon: Fingerprint,
    title: "Ownership Clarity",
    description:
      "Every governed object resolves to a real, current accountable owner — not an ex-employee's account still technically holding the keys.",
  },
  {
    icon: Layers,
    title: "Baseline Drift",
    description:
      "Your live tenant configuration is compared against your approved governance baseline on a real scheduled evaluation. This isn't a continuous real-time watch, and it doesn't guarantee every change trips an alert the instant it happens — deviations are flagged as drift the next time your tenant is evaluated, on a real cadence you can see.",
  },
  {
    icon: UserCog,
    title: "Admin Role Sprawl",
    description:
      "Who actually holds Global Admin — and every other privileged role — is enumerated and reviewed, not assumed static since the day your tenant was onboarded.",
  },
];

const WHY_IT_MATTERS = [
  {
    icon: Users,
    title: "Teams Sprawl",
    description:
      "Hundreds of Teams created for a project that ended a year ago, still sitting there with active membership and nobody assigned to close them out.",
  },
  {
    icon: Shield,
    title: "Unowned Groups",
    description:
      "A Microsoft 365 Group with no living owner is a governance dead end — nobody can approve access requests, nobody can retire it, nobody's accountable when something goes wrong inside it.",
  },
  {
    icon: UserCog,
    title: "Admin Chaos",
    description:
      "Global Admin rights handed out ad hoc over years of onboarding and offboarding, until nobody — including the person who granted the last one — can produce a current, accurate list.",
  },
  {
    icon: Layers,
    title: "Configuration Drift",
    description:
      "Every admin change happening ad hoc, with no baseline to compare against and no scheduled check to catch when production configuration quietly diverges from what was actually approved.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Baseline Defined",
    description: "Your approved lifecycle policy, naming convention, and admin role baseline is captured as the real reference state.",
  },
  {
    step: 2,
    title: "Scheduled Graph Evaluation",
    description: "On your package's configured schedule, live tenant state — Teams, Groups, admin role assignments — is pulled via Microsoft Graph.",
  },
  {
    step: 3,
    title: "Baseline Comparison",
    description: "The Drift Engine compares that live state against your approved baseline and evaluates it against your lifecycle and naming rules.",
  },
  {
    step: 4,
    title: "Findings Surfaced",
    description: "Deviations are severity-classified and flagged as governance findings the next time your tenant is evaluated — not guaranteed the instant a change happens.",
  },
  {
    step: 5,
    title: "Remediation, Where Configured",
    description: "Where write-back remediation is enabled for your tenant, qualifying findings can be corrected automatically; otherwise they route to your review queue.",
  },
];

const WHAT_YOU_GET = [
  "A live governance dashboard — lifecycle status, naming compliance rate, drift findings, and your real admin role roster",
  "Scan history across real scheduled checks, not a single point-in-time snapshot",
  "Severity-classified findings, sourced directly from Microsoft Graph telemetry",
  "A configuration baseline you can actually inspect, not a black-box score",
];

export default function GovernancePage() {
  const { tier } = usePersonalizationState();
  const { leadOffer } = useQuizOfferData();
  const { score: overallHealthScore, pillars } = useHealthPillars();
  const { presentation } = useLatestPresentation();
  const { portalUrl } = usePortalUrl();

  // Governance is a single-pillar topic (health-engine.ts HEALTH_PILLARS) — the real
  // per-domain score is this pillar's score, not a fabricated composite.
  const governancePillar = useMemo(() => pillars.find((p) => p.pillar === "governance") ?? null, [pillars]);
  const domainScore = governancePillar?.score ?? null;

  // Cross-topic quiz nudge: only fires when the Lead Offer Engine actually inferred a
  // signal relevant to Governance — falls back to cold content otherwise (website-rebuild-
  // reference-v2.md §3: "do not force an irrelevant nudge onto every page for every quiz taker").
  const relevantQuizSignal = useMemo(
    () => (leadOffer?.inferredSignals ?? []).find((s) => topicMatchesKeywordText("governance", s.signalKey)),
    [leadOffer],
  );

  useEffect(() => {
    if (tier === "assessment" && governancePillar) {
      trackEvent("personalization_shown", { tier: "assessment", surface: "topic_page", topic: "governance" });
    } else if (tier === "quiz" && relevantQuizSignal) {
      trackEvent("personalization_shown", { tier: "quiz", surface: "topic_page", topic: "governance" });
    }
  }, [tier, governancePillar, relevantQuizSignal]);

  const coldHeadline = (
    <>
      Every Team, Group, and Admin Role — <GradientText>Held to a Baseline, Not a Memory.</GradientText>
    </>
  );

  return (
    <Layout>
      <SEOMeta
        title="Governance | Shane McCaw Consulting"
        description="Lifecycle enforcement, naming discipline, ownership clarity, and admin role accountability for Microsoft 365 — checked against a real approved baseline on a real schedule."
      />

      {/* 1. PRODUCT HERO */}
      <section className="relative pt-32 sm:pt-40 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Shield className="w-4 h-4" />
            Governance
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            <PersonalizedContent
              cold={coldHeadline}
              quiz={
                relevantQuizSignal ? (
                  <>
                    Your Governance Readiness — <GradientText>tailored to what you told us</GradientText>
                  </>
                ) : (
                  coldHeadline
                )
              }
              assessment={
                domainScore !== null ? (
                  <>
                    Your real Governance score: <GradientText>{Math.round(domainScore)}</GradientText>
                  </>
                ) : (
                  coldHeadline
                )
              }
            />
          </h1>

          <p className="text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed mb-10">
            Lifecycle policy, naming discipline, and admin role assignments enforced against a real
            approved baseline — checked on a real schedule, not assumed compliant because nobody
            complained.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-14">
            <Link
              href="/assessment"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
              style={GRADIENT_BG}
              data-track="cta"
            >
              <span>Start a Free Assessment</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/governance-quiz"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors text-center"
              data-track="cta"
            >
              Take the Governance Quiz
            </Link>
          </div>

          {/* Personalization slot — cold visitors see the generic stat panels; a quiz-tier
              visitor with a relevant inferred signal sees a softened "based on what you told
              us" nudge; an Assessment-verified visitor sees their real Governance pillar
              score, stated as fact. */}
          <PersonalizedContent
            cold={
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                <StatPanel label="Governance pillar" value="Scored" />
                <StatPanel label="Lifecycle policy" value="Verified" />
                <StatPanel label="Baseline drift" value="Tracked" />
              </div>
            }
            quiz={
              relevantQuizSignal ? (
                <div className="max-w-2xl mx-auto">
                  <GlassPanel className="p-6 text-left">
                    <p className="text-text-secondary leading-relaxed">
                      Your quiz answers point to a real gap in governance. A free Assessment scans
                      your actual tenant against the real Graph API to confirm it.
                    </p>
                  </GlassPanel>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                  <StatPanel label="Governance pillar" value="Scored" />
                  <StatPanel label="Lifecycle policy" value="Verified" />
                  <StatPanel label="Baseline drift" value="Tracked" />
                </div>
              )
            }
            assessment={
              domainScore !== null ? (
                <div className="max-w-2xl mx-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-md mx-auto">
                    <StatPanel label="Governance" value={Math.round(domainScore)} />
                    {overallHealthScore !== null && (
                      <StatPanel label="Overall tenant health" value={Math.round(overallHealthScore)} />
                    )}
                  </div>
                  {presentation && portalUrl && (
                    <a
                      href={`${portalUrl}/customer-sow/${presentation.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                      style={GRADIENT_BG}
                      data-track="cta"
                      onClick={() =>
                        trackEvent("personalization_nudge_click", {
                          tier: "assessment",
                          surface: "topic_page",
                          topic: "governance",
                          destination: "presentation",
                        })
                      }
                    >
                      View your priced project plan <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                  <StatPanel label="Governance pillar" value="Scored" />
                  <StatPanel label="Lifecycle policy" value="Verified" />
                  <StatPanel label="Baseline drift" value="Tracked" />
                </div>
              )
            }
          />
        </div>
      </section>

      {/* 2. WHAT THIS PRODUCT ACTUALLY DOES */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              What This Product <GradientText>Actually Does</GradientText>
            </h2>
            <p className="text-text-secondary">
              No dashboards for their own sake — five real, engineered controls running against your
              live tenant.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHAT_IT_DOES.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-start gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-text-primary mb-1.5">{item.title}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. BUILT BY THE MICROSOFT 365 ARCHITECT FOR NASA — personal credibility only,
          present tense, never platform/federal-compliance framing (website-rebuild-reference-v2.md §6). */}
      <section className="py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <GlassPanel className="p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 text-accent-blue">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-lg text-text-primary">
                  Built by the Microsoft 365 Architect at NASA
                </h3>
                <p className="text-sm text-text-secondary mt-1">
                  Shane McCaw is the Microsoft 365 Architect at NASA, where he wrote the agency's
                  M365 Copilot governance framework. This Governance system runs on that same
                  engineering discipline.
                </p>
              </div>
            </div>
            <div className="text-sm text-text-secondary max-w-md md:text-right">
              Every rule here traces back to a decision Shane has had to defend in a real
              enterprise tenant — not copied from a vendor best-practices whitepaper.
            </div>
          </GlassPanel>
        </div>
      </section>

      {/* 4. WHY GOVERNANCE MATTERS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Why <GradientText>Governance Matters</GradientText>
            </h2>
            <p className="text-text-secondary">
              None of this is theoretical — it's the same handful of problems that show up in
              nearly every ungoverned Microsoft 365 tenant, commercial or otherwise.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_IT_MATTERS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-start gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-accent-violet/20 flex items-center justify-center shrink-0 text-accent-violet">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-text-primary mb-1.5">{item.title}</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. HOW GOVERNANCE WORKS */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl font-bold text-text-primary mb-4">How Governance Works</h2>
            <p className="text-text-secondary">
              From your approved baseline to a findings feed you can actually inspect — five real
              steps, no manual audit spreadsheet.
            </p>
          </div>
          <div className="flex flex-col md:flex-row items-stretch gap-1">
            {HOW_IT_WORKS.map((item, i) => (
              <div key={item.step} className="flex flex-col md:flex-row items-start md:items-stretch flex-1">
                <div className="flex flex-col flex-1 p-5 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                  <div className="text-[10px] font-bold text-accent-blue uppercase tracking-widest mb-1">Step {item.step}</div>
                  <div className="text-sm font-bold text-text-primary mb-1.5">{item.title}</div>
                  <p className="text-xs text-text-secondary leading-relaxed">{item.description}</p>
                </div>
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden md:flex items-center px-1 text-text-tertiary">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. WHAT YOU GET */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="font-display text-3xl font-bold text-text-primary mb-4">
              What You Get — <GradientText>Real Telemetry, Not Questionnaires</GradientText>
            </h2>
            <p className="text-text-secondary">
              Every finding here traces to a live Microsoft Graph query against your tenant. No
              self-reported checklist, no annual audit binder.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {WHAT_YOU_GET.map((item) => (
              <div key={item} className="flex items-start gap-3 p-5 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                <CheckCircle2 className="w-5 h-5 text-accent-blue shrink-0 mt-0.5" />
                <span className="text-sm text-text-secondary leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. PRODUCT MODULES / FEATURES — intro rewritten; the 4 modules below are kept
          verbatim from the real catalog coverage, not rewritten, per task scope. */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Four Real Modules. <GradientText>One Real Schedule.</GradientText>
            </h2>
            <p className="text-text-secondary">
              Every module below runs against your live tenant, on a real cadence — not a checklist
              you fill out once and forget.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {MODULES.map((mod) => {
              const Icon = mod.icon;
              return (
                <div key={mod.title} className="flex flex-col p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-white/[0.12] transition-all duration-200">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-accent-blue/20 flex items-center justify-center mb-4 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-text-primary mb-2">{mod.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{mod.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 8. BEGIN MISSION READINESS — final CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto text-center">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Begin Mission Readiness
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto mb-8">
              A free assessment scans your governance posture against the real Graph API — not a
              questionnaire. See exactly where lifecycle policy, naming, and admin role assignments
              stand today.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link
                href="/assessment"
                className="px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
                style={GRADIENT_BG}
                data-track="cta"
              >
                <Radar className="w-4 h-4" />
                Start a Free Assessment
              </Link>
              <Link
                href="/monitoring"
                className="px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
                data-track="cta"
              >
                See Monitoring Pricing
              </Link>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
