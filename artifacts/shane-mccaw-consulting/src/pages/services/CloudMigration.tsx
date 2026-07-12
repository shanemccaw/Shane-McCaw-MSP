import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Server, CheckCircle, ArrowRight, Users, Shield, Building2 } from "lucide-react";
import { CTAButton } from "@/components/CTAButton";

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

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
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
          <div className="mt-10">
            <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
          </div>
        </div>
      </section>

      {/* ── WHY MIGRATIONS FAIL ──────────────────────────────────────────── */}
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

      {/* ── SUPPORTED MIGRATION TYPES ────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Supported Migrations</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-4">Every Migration Type, Covered</h2>
          <p className="text-muted-foreground max-w-2xl mb-12 leading-relaxed">
            Each migration type has its own complexity profile. Shane's approach accounts for all five critical dimensions — identity, permissions, coexistence, cutover, and data integrity — for every workload.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {migrationTypes.map((m, i) => (
              <div key={i} className="bg-white border border-border rounded-2xl p-8">
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

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
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
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Ideal Client</p>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-6">Who This Is For</h2>
              <ul className="space-y-3">
                {[
                  { icon: <Building2 className="w-4 h-4 text-[#0078D4]" />, label: "Mid-market organizations (200–2,000 employees)" },
                  { icon: <Shield className="w-4 h-4 text-[#0078D4]" />, label: "Regulated industries: healthcare, finance, government, defense" },
                  { icon: <Users className="w-4 h-4 text-[#0078D4]" />, label: "Complex identity environments (hybrid AD, federated SSO)" },
                  { icon: <Server className="w-4 h-4 text-[#0078D4]" />, label: "Organizations migrating from legacy on-premises environments" },
                  { icon: <CheckCircle className="w-4 h-4 text-[#0078D4]" />, label: "Merger & acquisition scenarios requiring tenant consolidation" },
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-foreground text-sm">
                    <span className="flex-shrink-0 mt-0.5">{item.icon}</span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Why Shane</p>
              <h2 className="text-2xl font-extrabold text-[#0A2540] mb-6">The Differentiator</h2>
              <ul className="space-y-3">
                {[
                  "NASA-scale migration experience across every Microsoft 365 workload",
                  "Structured readiness assessment before any workload moves",
                  "Zero-data-loss methodology with rollback triggers at every phase gate",
                  "Direct accountability — Shane does the work, not a junior team",
                  "Post-migration governance to prevent drift back to the old state",
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

      {/* ── ASSESSMENT CTA ───────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 max-w-2xl mx-auto">
            Is Your Environment Ready to Migrate to Microsoft 365?
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            A short migration readiness assessment covering identity, data inventory, governance maturity, and compliance requirements. Get a personalised readiness score and recommended starting point — no sales call required.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/assessment" className="px-8 py-3.5 text-base">
              Start Your Free Assessment
            </CTAButton>
          </div>
        </div>
      </section>
    </Layout>
  );
}
