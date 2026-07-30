import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import { Server, CheckCircle, ArrowRight, ChevronRight, Users, Shield, Building2 } from "lucide-react";
import { useServices } from "@/hooks/useServices";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

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

const CREDENTIALS = [
  "Lead Microsoft 365 Architect at NASA",
  "30+ years in the Microsoft ecosystem",
  "Enterprise-scale migration execution across regulated industries",
  "Proven zero-data-loss methodology on every engagement",
];

const WHAT_SHANE_DELIVERS = [
  "Migration architecture and workload sequencing",
  "Identity and authentication strategy",
  "Permissions mapping and access continuity",
  "Coexistence and cutover planning",
  "Pilot migrations with validation checkpoints",
  "Full production migration oversight",
  "Governance alignment post-migration",
];

const WHO_FOR = [
  { icon: Building2, label: "Mid-market organizations (200–2,000 employees)" },
  { icon: Shield, label: "Regulated industries: healthcare, finance, government, defense" },
  { icon: Users, label: "Complex identity environments (hybrid AD, federated SSO)" },
  { icon: Server, label: "Organizations migrating from legacy on-premises environments" },
  { icon: CheckCircle, label: "Merger & acquisition scenarios requiring tenant consolidation" },
];

const WHY_SHANE = [
  "NASA-scale migration experience across every Microsoft 365 workload",
  "Structured readiness assessment before any workload moves",
  "Zero-data-loss methodology with rollback triggers at every phase gate",
  "Direct accountability — Shane does the work, not a junior team",
  "Post-migration governance to prevent drift back to the old state",
];

export default function CloudMigration() {
  // {{db.assessments.list}}
  const { services } = useServices({ category: "assessment" });
  const assessment = services.find((s) => s.name === "Migration Readiness Assessment");
  const assessmentHref = assessment
    ? `/assessments/${encodeURIComponent(assessment.slug ?? String(assessment.id))}`
    : "/assessments?tab=free";

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
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "IT departments and enterprise organizations migrating to Microsoft 365 from on-premises or competing platforms",
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com",
          },
        }}
      />

      {/* Breadcrumb */}
      <div className="border-b border-white/[0.06] pt-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/services" className="hover:text-accent-blue transition-colors">Services</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">Cloud Migration</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Server className="w-3.5 h-3.5 text-accent-blue" />
            Cloud Migration
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Microsoft 365 Cloud Migration — Zero-Drama, Zero-Data-Loss Execution
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Exchange, SharePoint, Google Workspace, and tenant-to-tenant migrations planned and executed with the discipline of a NASA-level architect. Every mailbox, file, and permission — accounted for.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={assessmentHref}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start Your Free Assessment
            </a>
            <ChatCTA className="inline-flex items-center justify-center gap-2 text-text-secondary hover:text-text-primary font-medium text-base transition-colors">
              Talk to Shane first <ArrowRight className="w-4 h-4" />
            </ChatCTA>
          </div>
        </div>
      </section>

      {/* ── WHY MIGRATIONS FAIL ──────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">Why Cloud Migrations Fail</h2>
            <p className="text-text-secondary leading-relaxed mb-6">
              Most cloud migrations fail not because of technical complexity — but because of poor planning, skipped readiness assessments, and a lack of governance discipline before the first mailbox moves. Organizations rush to lift-and-shift without understanding what they actually have, and they pay for it in data loss, productivity outages, and expensive remediation work after the fact.
            </p>
            <p className="text-text-secondary leading-relaxed">
              A successful migration starts with an honest inventory of your environment — identity, data, permissions, compliance requirements — and a sequenced plan that accounts for every dependency before anyone touches a production system.
            </p>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Shane's Credentials</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">30 Years. NASA Scale. Zero Data Loss.</h2>
            <p className="text-text-secondary leading-relaxed mb-6">
              Shane McCaw has spent 30 years architecting Microsoft ecosystem environments — from early Exchange deployments to complex Microsoft 365 tenant migrations at NASA, one of the most security-sensitive and compliance-heavy IT environments on the planet.
            </p>
            <ul className="space-y-3">
              {CREDENTIALS.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary">
                  <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── SUPPORTED MIGRATION TYPES ────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Supported Migrations</p>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-4">Every Migration Type, Covered</h2>
          <p className="text-text-secondary max-w-2xl mb-12 leading-relaxed">
            Each migration type has its own complexity profile. Shane's approach accounts for all five critical dimensions — identity, permissions, coexistence, cutover, and data integrity — for every workload.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {migrationTypes.map((m, i) => (
              <div key={i} className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Server className="w-5 h-5 text-accent-blue flex-shrink-0" />
                  <h3 className="font-display text-xl font-bold text-text-primary">{m.title}</h3>
                </div>
                <div className="space-y-4">
                  {[
                    { label: "Identity & Authentication", value: m.identity },
                    { label: "Permissions & Metadata", value: m.permissions },
                    { label: "Coexistence Strategy", value: m.coexistence },
                    { label: "Cutover Planning", value: m.cutover },
                    { label: "Zero-Data-Loss Execution", value: m.zeroLoss },
                  ].map((dim) => (
                    <div key={dim.label} className="border-l-2 border-accent-blue/30 pl-4">
                      <p className="text-xs font-semibold text-accent-blue uppercase tracking-wide mb-1">{dim.label}</p>
                      <p className="text-sm text-text-primary leading-relaxed">{dim.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Scope of Work</p>
            <h2 className="font-display text-xl font-bold text-text-primary mb-6">What Shane Delivers</h2>
            <ul className="space-y-3">
              {WHAT_SHANE_DELIVERS.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary text-sm">
                  <CheckCircle className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Ideal Client</p>
            <h2 className="font-display text-xl font-bold text-text-primary mb-6">Who This Is For</h2>
            <ul className="space-y-3">
              {WHO_FOR.map((item, i) => {
                const Icon = item.icon;
                return (
                  <li key={i} className="flex items-start gap-3 text-text-primary text-sm">
                    <Icon className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                    <span>{item.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Why Shane</p>
            <h2 className="font-display text-xl font-bold text-text-primary mb-6">The Differentiator</h2>
            <ul className="space-y-3">
              {WHY_SHANE.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary text-sm">
                  <CheckCircle className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── ASSESSMENT CTA ───────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-4">Free Assessment</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-4">
            Is Your Environment Ready to Migrate to Microsoft 365?
          </h2>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            A short migration readiness assessment covering identity, data inventory, governance maturity, and compliance requirements. Get a personalised readiness score and recommended starting point — no sales call required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={assessmentHref}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-white text-base transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Start Your Free Assessment
            </a>
          </div>
        </div>
      </section>
    </Layout>
  );
}
