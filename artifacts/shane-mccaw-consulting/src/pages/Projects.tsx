import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle,
  ArrowRight,
  Shield,
  Database,
  Settings,
  Users,
  BarChart2,
  Zap,
  GitBranch,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*                               CASE STUDIES                                 */
/* -------------------------------------------------------------------------- */

const caseStudies = [
  {
    icon: Shield,
    color: "#3B82F6",
    tag: "Compliance & Security",
    title: "Tenant Hardening Ahead of a SOC 2 Audit",
    context:
      "A financial services firm preparing for its first SOC 2 Type II audit discovered years of ungoverned configuration drift — unconstrained guest access, inconsistent Conditional Access, and sensitive data stored in unclassified SharePoint sites.",
    approach: [
      "Automated tenant health baseline across identity, access, and data protection",
      "Conditional Access redesign using Named Locations and compliant device enforcement",
      "Microsoft Purview sensitivity label rollout across SharePoint, Teams, and Exchange",
      "External sharing policy tightening with staged enforcement",
      "Audit log retention and alerting for privileged and high‑risk events",
    ],
    outcome:
      "The auditor described the tenant as one of the most prepared environments they had reviewed — fully documented, policy‑enforced, and governance‑aligned.",
  },
  {
    icon: Database,
    color: "#0EA5E9",
    tag: "Migration & Architecture",
    title: "Cross‑Tenant Consolidation with Near‑Zero Downtime",
    context:
      "A regional professional services firm needed to consolidate two Microsoft 365 tenants after an acquisition — preserving email, Teams, and SharePoint while maintaining uninterrupted client operations.",
    approach: [
      "Pre‑migration tenant comparison and conflict analysis",
      "Sequenced migration plan prioritizing non‑critical workloads",
      "Mail coexistence and routing strategy for the transition period",
      "SharePoint information architecture reconciliation",
      "Teams channel membership and ownership mapping",
    ],
    outcome:
      "Cutover completed over a single weekend with under four minutes of email downtime. All Teams channels, SharePoint sites, and mailbox content migrated cleanly.",
  },
  {
    icon: Zap,
    color: "#3B82F6",
    tag: "Copilot AI Readiness",
    title: "Copilot Readiness & Data Boundary Remediation",
    context:
      "An organization piloting Microsoft 365 Copilot discovered that legacy oversharing patterns allowed AI to surface sensitive documents to users who should not have seen them.",
    approach: [
      "Automated scan of SharePoint permissions and oversharing patterns",
      "Identification of high‑risk legacy sites with broad access",
      "Microsoft Purview data classification rollout",
      "SharePoint inheritance and permission remediation",
      "Copilot usage guardrails and DLP policies",
    ],
    outcome:
      "The organization relaunched its Copilot pilot with clear data boundaries. Adoption increased once users understood the guardrails.",
  },
  {
    icon: Settings,
    color: "#0EA5E9",
    tag: "Governance Architecture",
    title: "Governance Framework for a Hyper‑Growth Tenant",
    context:
      "A technology company that grew from 40 to 300 employees in two years had no naming conventions, lifecycle policies, or ownership models — resulting in ungoverned Teams and inconsistent provisioning.",
    approach: [
      "Current‑state inventory of ungoverned Teams, Groups, and SharePoint sites",
      "Governance framework covering naming, provisioning, ownership, and lifecycle",
      "Group expiration and Teams lifecycle policies",
      "Automated provisioning templates",
      "Admin documentation and knowledge transfer",
    ],
    outcome:
      "Within 90 days, ungoverned Teams were reduced by 60%, anonymous guest access was eliminated, and a repeatable provisioning process was established.",
  },
  {
    icon: Users,
    color: "#3B82F6",
    tag: "Identity & Access Management",
    title: "Identity Architecture for a Regulated Workforce",
    context:
      "A healthcare‑adjacent organization relied on guest accounts, shared mailboxes, and manual provisioning — creating audit gaps and violating access control standards.",
    approach: [
      "Identity lifecycle review across employees, contractors, vendors, and service accounts",
      "Azure AD B2B governance with automated expiry",
      "Privileged Identity Management rollout",
      "Entitlement Management packages for structured access",
      "Access review cadence for sensitive groups",
    ],
    outcome:
      "Standing privileged access was reduced to near zero, and every identity type gained a documented, auditable lifecycle.",
  },
  {
    icon: BarChart2,
    color: "#0EA5E9",
    tag: "Power Platform Governance",
    title: "Power Platform Governance After Organic Growth",
    context:
      "Three years of organic Power Platform growth resulted in hundreds of unmanaged flows, dozens of custom connectors, and no visibility into business‑critical apps.",
    approach: [
      "Tenant‑wide inventory of apps, flows, connectors, and environments",
      "Business criticality classification with department leaders",
      "DLP policy redesign enforcing connector boundaries",
      "Environment strategy separating production, development, and personal use",
      "Center of Excellence toolkit deployment",
    ],
    outcome:
      "The organization gained full visibility into its Power Platform estate and a governance model that enabled innovation without exposing the business to risk.",
  },
];

/* -------------------------------------------------------------------------- */
/*                               DIFFERENTIATORS                              */
/* -------------------------------------------------------------------------- */

const differentiators = [
  {
    icon: GitBranch,
    title: "Assessment‑First, Not Guesswork",
    body: "Every engagement begins with automated tenant telemetry — not a questionnaire. Scope is built from how your environment actually behaves.",
  },
  {
    icon: Shield,
    title: "Built for Regulated Environments",
    body: "FedRAMP, FISMA, ITAR, and GCC High are not theoretical acronyms — they are the constraints Shane governed at NASA.",
  },
  {
    icon: CheckCircle,
    title: "Fixed Scope. Fixed Price.",
    body: "No retainers. No scope creep. No surprise invoices. Every engagement is defined before it begins.",
  },
  {
    icon: Users,
    title: "Senior Delivery Only",
    body: "There is no junior bench. The architect you speak with is the architect who configures your tenant.",
  },
];

/* -------------------------------------------------------------------------- */
/*                               PAGE COMPONENT                               */
/* -------------------------------------------------------------------------- */

export default function Projects() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Project Work | Shane McCaw Consulting"
        description="Real Microsoft 365 project outcomes — tenant hardening, migrations, Copilot readiness, governance architecture, identity, and Power Platform remediation."
      />

      {/* ------------------------------------------------------------------ */}
      {/* HERO WITH FULL SVG GRID OVERLAY                                   */}
      {/* ------------------------------------------------------------------ */}

      <section className="relative bg-slate-950 pt-[130px] pb-20 overflow-hidden">
        {/* Full‑page SVG grid overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <svg
            className="w-full h-full opacity-[0.06]"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <pattern
                id="grid"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.5"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Radial glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[180px]" />
        </div>

        <div className="relative max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.1em] mb-4">
            Project Work
          </p>

          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6 max-w-3xl mx-auto">
            What Correct Microsoft 365 Governance Actually Looks Like
          </h1>

          <p className="text-slate-300 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            These engagements represent real categories of Microsoft 365
            challenges — tenant hardening, migrations, Copilot readiness,
            governance architecture, identity, and Power Platform remediation.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/assessment" className="text-base px-10 py-4">
              Start with an Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-slate-300 font-semibold text-base hover:text-white transition-colors border border-slate-700 px-8 py-3.5 rounded-xl hover:border-slate-500"
            >
              See How Monitoring Works <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CASE STUDIES                                                      */}
      {/* ------------------------------------------------------------------ */}

      <section className="bg-slate-950 py-20 border-t border-slate-800/80">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              Engagement Examples
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white">
              The Problems Shane Solves
            </h2>
            <p className="text-slate-400 mt-4 max-w-2xl mx-auto leading-relaxed">
              Each engagement below represents a real Microsoft 365 challenge.
              Client names are not disclosed. Outcomes are accurate.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {caseStudies.map((study, i) => {
              const Icon = study.icon;
              return (
                <div
                  key={i}
                  className="bg-slate-900/40 rounded-2xl border border-slate-800/80 p-8 flex flex-col"
                >
                  <div className="flex items-center gap-3 mb-5">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-700"
                      style={{ backgroundColor: `${study.color}15` }}
                    >
                      <Icon
                        className="w-5 h-5"
                        style={{ color: study.color }}
                      />
                    </div>
                    <span
                      className="text-xs font-bold uppercase tracking-widest"
                      style={{ color: study.color }}
                    >
                      {study.tag}
                    </span>
                  </div>

                  <h3 className="text-xl font-extrabold text-white mb-3 leading-snug">
                    {study.title}
                  </h3>

                  <p className="text-slate-400 text-sm leading-relaxed mb-5">
                    {study.context}
                  </p>

                  <div className="mb-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-white mb-3">
                      Approach
                    </p>
                    <ul className="space-y-2">
                      {study.approach.map((item, j) => (
                        <li
                          key={j}
                          className="flex items-start gap-2 text-sm text-slate-300"
                        >
                          <CheckCircle
                            className="w-4 h-4 flex-shrink-0 mt-0.5"
                            style={{ color: study.color }}
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-slate-900/60 rounded-xl border border-slate-800/80 p-4 mt-auto">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-1">
                      Outcome
                    </p>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {study.outcome}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* DIFFERENTIATORS                                                   */}
      {/* ------------------------------------------------------------------ */}

      <section className="bg-slate-950 py-20 border-t border-slate-800/80">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              What Makes This Different
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white">
              Not a Consulting Firm. A Single Senior Architect.
            </h2>
            <p className="text-slate-400 mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane works directly with a small number of clients at any given
              time. That constraint is deliberate — it is what makes senior,
              accountable delivery possible.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {differentiators.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="flex gap-5 bg-slate-900/40 rounded-xl border border-slate-800/80 p-6"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-white mb-1">
                      {item.title}
                    </h3>
                    <p className="text-slate-400 text-sm leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CLOSING CTA                                                       */}
      {/* ------------------------------------------------------------------ */}

      <section className="relative bg-slate-950 py-24 overflow-hidden border-t border-slate-800/80">
        {/* Radial glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[180px]" />
        </div>

        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-widest mb-4">
            Ready to Start?
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Every Project Starts with Understanding Your Tenant.
          </h2>
          <p className="text-slate-300 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            The fastest path to a scoped, fixed‑price engagement is an
            assessment — automated, low‑friction, and completed before your
            first working session with Shane.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/assessment" className="text-lg px-12 py-5">
              Start with an Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-slate-300 font-semibold text-base hover:text-white transition-colors border border-slate-700 px-8 py-4 rounded-xl hover:border-slate-500"
            >
              Start Monitoring <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="mt-5 text-slate-500 text-sm">
            No introductory call required to begin. No obligation until you sign
            a defined scope.
          </p>
        </div>
      </section>
    </Layout>
  );
}
