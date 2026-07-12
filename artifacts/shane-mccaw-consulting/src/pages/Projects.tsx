import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle, ArrowRight, Shield, Database, Settings, Users,
  BarChart2, Zap, GitBranch,
} from "lucide-react";

const caseStudies = [
  {
    icon: Shield,
    color: "#0078D4",
    tag: "Compliance & Security",
    title: "Tenant Hardening Before a SOC 2 Audit",
    context:
      "A financial services firm preparing for its first SOC 2 Type II audit discovered its Microsoft 365 environment had accumulated years of ungoverned configuration — guest access was unconstrained, Conditional Access policies were inconsistently applied, and sensitive data lived in unclassified SharePoint sites.",
    approach: [
      "Automated tenant health audit to baseline every misconfiguration",
      "Conditional Access policy redesign using Named Locations and Compliant Device enforcement",
      "Microsoft Purview sensitivity label rollout across SharePoint, Teams, and Exchange",
      "External sharing policy tightening with staged enforcement to avoid disruption",
      "Audit log retention configuration and alerting for high-risk events",
    ],
    outcome:
      "The organization entered its audit with a fully documented, policy-enforced Microsoft 365 environment. The auditor noted it as one of the best-prepared M365 tenants they had reviewed.",
  },
  {
    icon: Database,
    color: "#00B4D8",
    tag: "Migration & Architecture",
    title: "Cross-Forest Migration with Zero Email Downtime",
    context:
      "A regional professional services firm needed to consolidate two Microsoft 365 tenants following an acquisition — while keeping email, Teams channels, and SharePoint intact and ensuring no disruption to client-facing operations during the cutover window.",
    approach: [
      "Pre-migration tenant comparison and object-level conflict analysis",
      "Staged migration sequencing to move non-critical workloads first",
      "Coexistence configuration for mail routing during the transition period",
      "SharePoint site structure reconciliation before content migration",
      "Teams channel membership and ownership mapping and transfer",
    ],
    outcome:
      "The cutover completed over a single weekend. Email downtime was under four minutes. All Teams channels, SharePoint sites, and mailbox content migrated cleanly with no data loss.",
  },
  {
    icon: Zap,
    color: "#0078D4",
    tag: "Copilot AI Readiness",
    title: "Copilot Readiness Gap Analysis and Remediation",
    context:
      "An organization that had purchased Microsoft 365 Copilot licenses for a pilot cohort found that their tenant's data governance posture made deployment a liability — overprivileged SharePoint permissions meant Copilot could surface sensitive documents to users who should not have seen them.",
    approach: [
      "Automated scan of SharePoint permissions, oversharing patterns, and sensitivity label coverage",
      "Identification of high-risk sites with broad access that predated any governance framework",
      "Microsoft Purview data classification rollout to label and protect sensitive content",
      "SharePoint permission inheritance audit and remediation at site, library, and item level",
      "Copilot interaction policy definition and DLP policy configuration",
    ],
    outcome:
      "The organization relaunched its Copilot pilot six weeks later with confidence that the AI was operating within appropriate data boundaries. Adoption improved significantly once users understood the guardrails.",
  },
  {
    icon: Settings,
    color: "#00B4D8",
    tag: "Governance Architecture",
    title: "Governance Framework for a Rapid-Growth Organization",
    context:
      "A technology company that had grown from 40 to 300 employees in two years had Microsoft 365 administered informally — Teams were created ad hoc, guest access was open by default, and there was no naming convention, lifecycle policy, or ownership model in place.",
    approach: [
      "Current-state audit to quantify the scope of ungoverned Teams, Groups, and SharePoint sites",
      "Governance framework design covering naming, provisioning, ownership, and lifecycle",
      "Microsoft 365 Groups expiration policy and Teams lifecycle enforcement",
      "Automated provisioning templates to replace ad-hoc creation",
      "Admin documentation and IT team knowledge transfer",
    ],
    outcome:
      "Within 90 days the organization had reduced ungoverned Teams by 60%, eliminated anonymous guest access, and established a repeatable provisioning process their internal team could operate independently.",
  },
  {
    icon: Users,
    color: "#0078D4",
    tag: "Identity & Access Management",
    title: "Identity Architecture Redesign for a Regulated Employer",
    context:
      "A healthcare-adjacent organization was managing contractor and vendor access through a combination of guest accounts, shared mailboxes, and manual provisioning — a model that created audit trail gaps and violated their access control obligations.",
    approach: [
      "Identity lifecycle review covering employees, contractors, vendors, and service accounts",
      "Azure AD B2B governance policy for external identities with automated expiry",
      "Privileged Identity Management rollout for admin role activation",
      "Entitlement Management package design for structured access request and approval",
      "Access review cadence design and implementation for sensitive group memberships",
    ],
    outcome:
      "The organization closed its access control gap, reduced standing privileged access to zero for most admin roles, and established a documented, auditable model for every identity type in the tenant.",
  },
  {
    icon: BarChart2,
    color: "#00B4D8",
    tag: "Power Platform Governance",
    title: "Power Platform Governance After Ungoverned Growth",
    context:
      "An organization whose Power Platform environment had grown organically for three years found itself with hundreds of unmanaged flows, dozens of custom connectors, and no visibility into which apps were business-critical and which were personal productivity experiments.",
    approach: [
      "Power Platform tenant inventory — apps, flows, connectors, and environment structure",
      "Business criticality classification in collaboration with department leads",
      "DLP policy redesign to enforce connector boundaries by environment type",
      "Environment strategy redesign separating production, development, and personal use",
      "Center of Excellence toolkit deployment for ongoing governance visibility",
    ],
    outcome:
      "The organization gained full visibility into its Power Platform estate and a governance model that enabled innovation without exposing the organization to data loss or compliance risk.",
  },
];

const differentiators = [
  {
    icon: GitBranch,
    title: "Assessment-First",
    body: "Every project starts with automated, structured data from your tenant — not a questionnaire. Shane reads your actual configuration before scoping a single hour of work.",
  },
  {
    icon: Shield,
    title: "Compliance-Native",
    body: "FedRAMP, FISMA, ITAR, and GCC High are not reference materials to Shane — they are the environment he governed at NASA. Regulated organizations get architecture built for their actual constraints.",
  },
  {
    icon: CheckCircle,
    title: "Fixed Scope, Fixed Price",
    body: "Every engagement is defined before it starts. No open-ended retainer hours, no scope-creep surprises, no end-of-month invoice anxiety.",
  },
  {
    icon: Users,
    title: "Senior Delivery Only",
    body: "Shane does the work. Not a project manager. Not a junior consultant. The person you spoke with is the person who configures your tenant.",
  },
];

export default function Projects() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Project Work | Shane McCaw Consulting"
        description="Real-world Microsoft 365 project outcomes — tenant hardening, migrations, Copilot readiness, governance architecture, and identity management. Senior delivery, fixed scope, defined results."
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-[130px] pb-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-4">
            Project Work
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6 max-w-3xl mx-auto">
            What Getting Your Microsoft 365 Environment Right Actually Looks Like
          </h1>
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            These are the types of engagements Shane delivers — defined outcomes, real results, no named clients. Every project starts with an assessment so the scope reflects your actual environment, not a template.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/assessment" className="text-base px-10 py-4">
              Start with an Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-white/70 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-3.5 rounded-xl hover:border-white/40"
            >
              See How Monitoring Works <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── CASE STUDIES ─────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="case-studies">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              Engagement Examples
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              The Problems Shane Solves
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Each engagement below represents a real category of Microsoft 365 challenge. Client names are not disclosed. Outcomes are accurate.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {caseStudies.map((study, i) => {
              const Icon = study.icon;
              return (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-border p-8 flex flex-col"
                  data-testid={`case-study-${i}`}
                >
                  <div className="flex items-center gap-3 mb-5">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${study.color}15` }}
                    >
                      <Icon className="w-5 h-5" style={{ color: study.color }} />
                    </div>
                    <span
                      className="text-xs font-bold uppercase tracking-widest"
                      style={{ color: study.color }}
                    >
                      {study.tag}
                    </span>
                  </div>

                  <h3 className="text-xl font-extrabold text-[#0A2540] mb-3 leading-snug">
                    {study.title}
                  </h3>

                  <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                    {study.context}
                  </p>

                  <div className="mb-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#0A2540] mb-3">
                      Approach
                    </p>
                    <ul className="space-y-2">
                      {study.approach.map((item, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-[#0A2540]">
                          <CheckCircle
                            className="w-4 h-4 flex-shrink-0 mt-0.5"
                            style={{ color: study.color }}
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-[#F7F9FC] rounded-xl border border-border p-4 mt-auto">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">
                      Outcome
                    </p>
                    <p className="text-sm text-[#0A2540] leading-relaxed">{study.outcome}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── DIFFERENTIATORS ──────────────────────────────────────────────── */}
      <section className="bg-white py-20" data-testid="differentiators">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              What Makes This Different
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Not a Consulting Firm. One Senior Architect.
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Shane works directly with a small number of clients at any given time. That constraint is intentional — it is what makes senior, personal delivery possible.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {differentiators.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="flex gap-5 bg-[#F7F9FC] rounded-xl border border-border p-6"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-[#0A2540] mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CLOSING CTA ──────────────────────────────────────────────────── */}
      <section className="relative bg-[#0A2540] py-24 overflow-hidden" data-testid="projects-cta">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-widest mb-4">
            Ready to Start?
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Every Project Starts With Understanding Your Environment.
          </h2>
          <p className="text-white/70 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            The fastest path to a scoped, fixed-price engagement is an assessment — automated, non-disruptive, and completed before your first conversation with Shane.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/assessment" className="text-lg px-12 py-5">
              Start with an Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-white/70 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Start Monitoring <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="mt-5 text-white/40 text-sm">
            No call required to get started. No obligation until you sign.
          </p>
        </div>
      </section>
    </Layout>
  );
}
