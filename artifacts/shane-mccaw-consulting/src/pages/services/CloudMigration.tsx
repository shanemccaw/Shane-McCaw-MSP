import { useState } from "react";
import { ServiceOverviewModal } from "@/components/ServiceOverviewModal";
import { TestimonialDiscountCallout } from "@/components/TestimonialDiscountCallout";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { RetainerCard } from "@/components/RetainerCard";
import { Server, CheckCircle, Clock, DollarSign, ArrowRight, Users, Shield, Building2 } from "lucide-react";
import { CTAButton } from "@/components/CTAButton";
import { AssessmentCTA } from "@/components/AssessmentCTA";
import { useServices, formatPriceDisplay, useServiceHasPdf } from "@/hooks/useServices";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { useServicePageTriggerKeys } from "@/hooks/useServicePageTriggerKeys";
import FixedPriceOfferCard from "@/components/FixedPriceOfferCard";

const comparisonRows = [
  {
    label: "Best For",
    assessment: "Organizations that need a clear picture before committing to a migration",
    governance: "Tenants with governance debt that must be resolved before workloads move",
    retainer: "Organizations needing continuous senior architect oversight month-to-month",
  },
  {
    label: "Scope",
    assessment: "Discovery, risk analysis, and a validated migration plan — no execution",
    governance: "Full governance framework design and policy enforcement across M365",
    retainer: "Embedded advisory: architecture, execution guidance, escalation support",
  },
  {
    label: "Timeline",
    assessment: "1 week",
    governance: "6 weeks",
    retainer: "Ongoing — month-to-month",
  },
  {
    label: "Price",
    assessment: "$3,500 – $5,000",
    governance: "$12,000 – $18,000",
    retainer: "$2,500 / $6,000 / $11,000 per month",
  },
  {
    label: "Key Deliverables",
    assessment: "Readiness report, risk register, sequenced migration roadmap, go/no-go recommendation",
    governance: "Governance framework, naming conventions, lifecycle rules, security baseline, retention architecture",
    retainer: "Monthly advisory hours, architecture reviews, escalation access, progress reporting",
  },
  {
    label: "Ongoing Support",
    assessment: "One-time engagement — can feed into a retainer or managed migration",
    governance: "One-time engagement — optionally followed by a retainer for ongoing governance",
    retainer: "Continuous — cancel or adjust tier with 30-day notice",
  },
];

const migrationTypes = [
  {
    title: "Exchange → Exchange Online",
    identity: "On-premises Active Directory synced to Azure AD via AAD Connect with MFA enforcement at cutover.",
    permissions: "Full mailbox permissions, shared mailboxes, resource calendars, and distribution group memberships preserved.",
    coexistence: "Hybrid Exchange coexistence configured for phased cutover — no forced big-bang migrations.",
    cutover: "Batched cutover plan with per-department sequencing and rollback triggers at each phase gate.",
    zeroLoss: "Dual-delivery coexistence and mail flow validation before final DNS cutover to guarantee zero message loss.",
  },
  {
    title: "SharePoint → SharePoint Online",
    identity: "Identity and group memberships remapped to Azure AD equivalents before content migration begins.",
    permissions: "Site collection permissions, unique item-level permissions, and inherited permission chains fully preserved.",
    coexistence: "Parallel access maintained during migration — users can access both environments during transition.",
    cutover: "Site-by-site cutover with stakeholder sign-off gates between departments and business units.",
    zeroLoss: "SPMT-based migration with checksum validation and delta sync passes before decommission.",
  },
  {
    title: "Google Workspace → Microsoft 365",
    identity: "Google accounts mapped to Microsoft 365 identities with Azure AD SSO and MFA configured pre-migration.",
    permissions: "Drive sharing permissions translated to SharePoint/OneDrive equivalents; shared drives mapped to team sites.",
    coexistence: "Mail coexistence via MX split routing during transition so no email is lost regardless of which platform receives it.",
    cutover: "App-by-app cutover starting with lower-risk workloads (Calendar, Contacts) before Gmail and Drive.",
    zeroLoss: "Google Takeout + migration tooling with reconciliation reports confirming 100% item count parity post-migration.",
  },
  {
    title: "Tenant → Tenant (Mergers & Acquisitions)",
    identity: "Full identity merge strategy — new UPNs, MFA re-enrollment, and cross-tenant access policies configured first.",
    permissions: "Group memberships, Teams ownership, SharePoint permissions, and mailbox delegates remapped to target tenant.",
    coexistence: "Cross-tenant mail flow and Teams federation enabled so both organizations communicate during transition.",
    cutover: "Business-unit-level cutover sequencing aligned with M&A integration milestones and legal entity timelines.",
    zeroLoss: "Cross-tenant migration tooling with pre/post item count audits and a 30-day reconciliation window post-cutover.",
  },
];



export default function CloudMigration() {
  const { services, loading } = useServices();
  const { services: retainerServices, loading: retainerLoading } = useServices("retainer");
  const { projects: engagementProjects, loading: engagementLoading } = useEngagementProjects();
  const { triggerKeys: cloudMigrationTriggerKeys } = useServicePageTriggerKeys("cloud-migration");

  const matchedProjects = engagementProjects.filter(
    (p) => p.isVisible && p.triggeredBy.some((t) => cloudMigrationTriggerKeys.includes(t))
  );

  const migSvc = services.find((s) => s.slug === "migration-readiness-assessment");
  const govSvc = services.find((s) => s.slug === "governance-foundations-package");
  const skeleton = <span className="inline-block w-28 h-4 bg-gray-200 rounded animate-pulse align-middle" />;
  const livePrice = (svc: typeof services[0] | undefined, fallback: string) =>
    loading ? skeleton : svc ? formatPriceDisplay(svc) : fallback;
  const tablePrices = {
    assessment: livePrice(migSvc, "$3,500–$5,000"),
    governance: livePrice(govSvc, "$12,000–$18,000"),
    retainer: "$2,500 / $6,000 / $11,000 per month",
  };
  const [modalOpen, setModalOpen] = useState(false);
  const hasPdf = useServiceHasPdf("/services/cloud-migration");

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Cloud Migration Services | Shane McCaw Consulting"
        description="Microsoft 365 cloud migration consulting by Shane McCaw. Structured, low-risk migrations with zero-surprise timelines and a NASA-proven methodology that protects your data."
        ogImage="/og-image-cloud-migration.png"
        ogUrl="https://shanemccawconsulting.com/services/cloud-migration"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Cloud Migration Services",
          "description": "Microsoft 365 cloud migration consulting by Shane McCaw. Structured, low-risk migrations with zero-surprise timelines and a NASA-proven methodology that protects your data.",
          "url": "https://shanemccawconsulting.com/services/cloud-migration",
          "serviceType": "Cloud Migration Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States"
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "IT departments and enterprise organizations migrating to Microsoft 365 from on-premises or competing platforms"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          }
        }}
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[172px] pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <Server className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Cloud Migration</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Cloud Migration — Zero-Drama, Zero-Data-Loss Execution
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            Exchange, SharePoint, Google Workspace, and tenant-to-tenant migrations planned and executed with the discipline of a NASA-level architect. Every mailbox, file, and permission — accounted for.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <a
              href="/crm/portal/onboarding/select?service=migration-readiness-assessment"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </a>
            {hasPdf && (
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm"
              >
                Download Overview <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Why Migrations Fail */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">Why Cloud Migrations Fail</h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Most cloud migrations fail not because of technical complexity — but because of poor planning, skipped readiness assessments, and a lack of governance discipline before the first mailbox moves. Organizations rush to lift-and-shift without understanding what they actually have, and they pay for it in data loss, productivity outages, and expensive remediation work after the fact.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                A successful migration starts with an honest inventory of your environment — identity, data, permissions, compliance requirements — and a sequenced plan that accounts for every dependency before anyone touches a production system.
              </p>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Shane's Credentials</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">30 Years. NASA Scale. Zero Data Loss.</h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Shane McCaw has spent 30 years architecting Microsoft ecosystem environments — from early Exchange deployments to complex Microsoft 365 tenant migrations at NASA, one of the most security-sensitive and compliance-heavy IT environments on the planet.
              </p>
              <ul className="space-y-3">
                {[
                  "Lead Microsoft 365 Architect at NASA",
                  "30+ years in the Microsoft ecosystem",
                  "Enterprise-scale migration execution across regulated industries",
                  "Proven zero-data-loss methodology on every engagement",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-foreground">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Official Offers */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Services & Pricing</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-12">Fixed-Scope Migration Engagements</h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            <FixedPriceOfferCard
              slug="migration-readiness-assessment"
              variant="compact"
              ctaLabel="Start This Assessment"
              ctaHref="/crm/portal/onboarding/select?service=migration-readiness-assessment"
            />
            <FixedPriceOfferCard
              slug="governance-foundations-package"
              variant="compact"
              ctaLabel="Start This Package"
              ctaHref="/crm/portal/onboarding/select?service=governance-foundations-package"
            />
          </div>

          {(engagementLoading || matchedProjects.length > 0) && (
            <div className="mb-10">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-2">Project Engagements</p>
              <p className="text-muted-foreground text-sm mb-5 max-w-xl">These scoped engagements typically surface during a migration readiness review, covering workloads that need extra lift, remediation, or post-migration optimisation.</p>
              {engagementLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded-xl border bg-white border-border p-8 h-56 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
                  {matchedProjects.map((project, i) => (
                    <EngagementProjectCard key={project.id} project={project} index={i} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fractional Retainers */}
          <div>
            <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-2">Track 03 · Strategic Tier</p>
            <h3 className="text-center text-2xl font-extrabold text-[#0A2540] mb-3">Fractional M365 Architect Retainers</h3>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              For ongoing migration oversight, post-migration governance, and continuous Microsoft 365 architectural advisory. Shane embedded as your senior architect — without the full-time hire.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {retainerLoading
                ? [0, 1, 2].map((i) => (
                    <div key={i} className="rounded-2xl p-8 border bg-white border-border animate-pulse">
                      <div className="h-5 w-32 bg-gray-200 rounded mb-4" />
                      <div className="h-10 w-24 bg-gray-200 rounded mb-2" />
                      <div className="h-4 w-20 bg-gray-200 rounded mb-4" />
                      <div className="h-16 bg-gray-100 rounded" />
                    </div>
                  ))
                : retainerServices.map((tier, i) => (
                    <RetainerCard key={tier.slug ?? tier.name} plan={tier} index={i} />
                  ))}
            </div>
          </div>

          {/* Comparison Table */}
          <div className="mt-16">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Quick Comparison</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540] mb-3">Which Engagement Is Right for You?</h2>
            <p className="text-muted-foreground mb-10 max-w-2xl leading-relaxed">
              Not sure where to start? This table maps each offer across the dimensions that matter most — so you can self-select before picking up the phone.
            </p>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#0A2540] text-white">
                    <th className="text-left px-6 py-5 w-[18%] font-semibold text-white/60 text-xs uppercase tracking-widest"></th>
                    <th className="text-left px-6 py-5 w-[27%]">
                      <div className="flex items-center gap-2 mb-1">
                        <Shield className="w-4 h-4 text-[#00B4D8]" />
                        <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Scope</span>
                      </div>
                      <p className="text-base font-extrabold leading-snug">Migration Readiness Assessment</p>
                    </th>
                    <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                      <div className="flex items-center gap-2 mb-1">
                        <Building2 className="w-4 h-4 text-[#00B4D8]" />
                        <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Scope</span>
                      </div>
                      <p className="text-base font-extrabold leading-snug">Governance Foundations Package</p>
                    </th>
                    <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="w-4 h-4 text-[#00B4D8]" />
                        <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Ongoing</span>
                      </div>
                      <p className="text-base font-extrabold leading-snug">Fractional M365 Architect Retainer</p>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row, i) => (
                    <tr
                      key={row.label}
                      className={i % 2 === 0 ? "bg-white" : "bg-[#F7F9FC]"}
                    >
                      <td className="px-6 py-5 font-semibold text-[#0A2540] text-xs uppercase tracking-widest align-top whitespace-nowrap border-r border-border">
                        {row.label}
                      </td>
                      <td className="px-6 py-5 text-foreground leading-relaxed align-top">
                        {row.label === "Price" ? (
                          <span className="font-bold text-[#0A2540]">{tablePrices.assessment}</span>
                        ) : (
                          row.assessment
                        )}
                      </td>
                      <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                        {row.label === "Price" ? (
                          <span className="font-bold text-[#0A2540]">{tablePrices.governance}</span>
                        ) : (
                          row.governance
                        )}
                      </td>
                      <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                        {row.label === "Price" ? (
                          <span className="font-bold text-[#0A2540]">{tablePrices.retainer}</span>
                        ) : (
                          row.retainer
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#0A2540]">
                    <td className="px-6 py-5 border-r border-white/10"></td>
                    <td className="px-6 py-5">
                      <a
                        href="/book"
                        className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline"
                      >
                        Book a Call <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </td>
                    <td className="px-6 py-5 border-l border-white/10">
                      <a
                        href="/book"
                        className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline"
                      >
                        Book a Call <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </td>
                    <td className="px-6 py-5 border-l border-white/10">
                      <a
                        href="/book"
                        className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline"
                      >
                        Book a Call <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-6">
              {[
                {
                  icon: <Shield className="w-5 h-5 text-[#0078D4]" />,
                  badge: "Fixed-Scope",
                  title: "Migration Readiness Assessment",
                  key: "assessment" as const,
                },
                {
                  icon: <Building2 className="w-5 h-5 text-[#0078D4]" />,
                  badge: "Fixed-Scope",
                  title: "Governance Foundations Package",
                  key: "governance" as const,
                },
                {
                  icon: <Users className="w-5 h-5 text-[#0078D4]" />,
                  badge: "Ongoing",
                  title: "Fractional M365 Architect Retainer",
                  key: "retainer" as const,
                },
              ].map((col) => (
                <div key={col.key} className="bg-white border border-border rounded-2xl overflow-hidden">
                  <div className="bg-[#0A2540] px-5 py-4 flex items-start gap-3">
                    {col.icon}
                    <div>
                      <p className="text-[#00B4D8] text-xs font-semibold uppercase tracking-widest mb-0.5">{col.badge}</p>
                      <p className="text-white font-extrabold leading-snug">{col.title}</p>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {comparisonRows.map((row) => (
                      <div key={row.label} className="px-5 py-4">
                        <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-widest mb-1">{row.label}</p>
                        <p className={`text-sm leading-relaxed ${row.label === "Price" ? "font-bold text-[#0A2540]" : "text-foreground"}`}>
                          {row.label === "Price" ? tablePrices[col.key] : row[col.key]}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-4 bg-[#F7F9FC] border-t border-border">
                    <a href="/book" className="inline-flex items-center gap-1.5 text-[#0078D4] text-sm font-semibold hover:underline">
                      Book a Call <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <AssessmentCTA
        label="Free Migration Readiness Assessment"
        title="Is Your Environment Ready to Migrate to Microsoft 365?<br class='hidden sm:block' /> Find Out in 5 Minutes."
        description="Migration failures are almost always caused by poor planning, not technical complexity. Identity gaps, permission sprawl, and skipped governance work lead to outages and data loss."
        supportingCopy="Answer 10 targeted questions on identity, data inventory, governance maturity, and compliance readiness — and receive a personalised migration readiness score with a recommended starting point."
        quizUrl="/migration-readiness-quiz"
        ctaLabel="Take the Migration Readiness Assessment"
        stats={[
          { label: "10 questions · ~5 minutes" },
          { label: "Personalised report emailed instantly" },
          { label: "No sales follow-up" },
        ]}
      />

      {/* Supported Migration Types */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Supported Migrations</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-4">Every Migration Type, Covered</h2>
          <p className="text-muted-foreground max-w-2xl mb-12 leading-relaxed">
            Each migration type has its own complexity profile. Shane's approach accounts for all five critical dimensions — identity, permissions, coexistence, cutover, and data integrity — for every workload.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {migrationTypes.map((m, i) => (
              <div key={i} className="bg-[#F7F9FC] border border-border rounded-2xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Server className="w-5 h-5 text-[#0078D4] flex-shrink-0" />
                  <h3 className="text-xl font-bold text-[#0A2540]">{m.title}</h3>
                </div>
                <div className="space-y-4">
                  {[
                    { label: "Identity & Authentication", value: m.identity },
                    { label: "Permissions & Metadata", value: m.permissions },
                    { label: "Coexistence Strategy", value: m.coexistence },
                    { label: "Cutover Planning", value: m.cutover },
                    { label: "Zero-Data-Loss Execution", value: m.zeroLoss },
                  ].map((dim) => (
                    <div key={dim.label} className="border-l-2 border-[#0078D4]/30 pl-4">
                      <p className="text-xs font-semibold text-[#0078D4] uppercase tracking-wide mb-1">{dim.label}</p>
                      <p className="text-sm text-foreground leading-relaxed">{dim.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What Shane Delivers */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* What Shane Delivers */}
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Scope of Work</p>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-6">What Shane Delivers</h2>
              <ul className="space-y-3">
                {[
                  "Migration architecture and workload sequencing",
                  "Identity and authentication strategy",
                  "Permissions mapping and access continuity",
                  "Coexistence and cutover planning",
                  "Pilot migrations with validation checkpoints",
                  "Full production migration oversight",
                  "Governance alignment post-migration",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-foreground text-sm">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Who This Is For */}
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Ideal Client</p>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-6">Who This Is For</h2>
              <ul className="space-y-3">
                {[
                  "Mid-market organizations (200–2,000 employees)",
                  "Regulated industries: healthcare, finance, government, defense",
                  "Complex identity environments (hybrid AD, federated SSO)",
                  "Organizations with strict compliance and data retention requirements",
                  "IT teams needing senior-level oversight without a full-time hire",
                  "M&A scenarios requiring tenant consolidation under deadline pressure",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-foreground text-sm">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Why Work With Shane */}
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Differentiators</p>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-6">Why Work With Shane</h2>
              <ul className="space-y-3">
                {[
                  "NASA migration experience — the most security-sensitive environment in the world",
                  "Enterprise-scale execution across hundreds of complex migrations",
                  "Proven zero-data-loss methodology on every engagement",
                  "Direct senior-architect access — no account managers, no junior handoffs",
                  "Governance-first approach that prevents post-migration technical debt",
                  "30 years of deep Microsoft ecosystem expertise, not generalist cloud knowledge",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-foreground text-sm">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      {/* ── ASSESSMENT CTA ───────────────────────────────────────────────── */}
      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#F7F9FC] border border-border rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1">
              <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-widest mb-2">Free · 5 Minutes</p>
              <h3 className="text-2xl font-extrabold text-[#0A2540] mb-3">Migration Readiness Assessment</h3>
              <p className="text-muted-foreground leading-relaxed">
                Get an AI-powered snapshot of your migration readiness across infrastructure, data, security, and project management — with a free PDF report.
              </p>
            </div>
            <a href="/migration-readiness-quiz"
              className="flex-shrink-0 inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white font-bold px-8 py-4 rounded-xl transition-colors text-base">
              Take the Free Assessment
            </a>
          </div>
        </div>
      </section>

      <TestimonialDiscountCallout />
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-widest mb-4">
            Start With a Conversation
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Ready to Plan Your Migration the Right Way?
          </h2>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
            Book a free 30-minute discovery call with Shane. Walk away with a clear picture of what your migration actually involves — and what it will take to do it without drama or data loss.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <CTAButton href="/book" className="px-10 py-4 text-base">
              Book a Free Discovery Call
            </CTAButton>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 border border-white/30 text-white font-semibold px-10 py-4 rounded-xl hover:bg-white/10 transition-colors text-base"
            >
              Schedule a Consultation <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
      <ServiceOverviewModal
        serviceName="Cloud Migration"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Layout>
  );
}
