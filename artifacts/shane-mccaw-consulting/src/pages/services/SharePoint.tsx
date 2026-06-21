import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Layout as LayoutIcon, CheckCircle, ArrowRight, Building2, Shield, Users } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { CTAButton } from "@/components/CTAButton";

export default function SharePoint() {
  return (
    <Layout>
      <SEOMeta
        title="SharePoint Architecture & Modern Intranets | Shane McCaw Consulting"
        description="SharePoint architecture and modern intranet design by Shane McCaw. NASA-proven governance, hub site architecture, and migration planning for mid-market and enterprise organizations."
        ogImage="/og-image-sharepoint.png"
        ogUrl="https://shanemccawconsulting.com/services/sharepoint"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "SharePoint Architecture & Modern Intranets",
          "description": "SharePoint architecture and modern intranet design by Shane McCaw. NASA-proven governance, hub site architecture, and migration planning for mid-market and enterprise organizations.",
          "url": "https://shanemccawconsulting.com/services/sharepoint",
          "serviceType": "SharePoint Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States"
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market and enterprise IT teams building or modernizing SharePoint intranets"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          },
          "offers": [
            {
              "@type": "Offer",
              "name": "Governance Foundations Package",
              "priceRange": "$12,000–$18,000",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/services/sharepoint"
            },
            {
              "@type": "Offer",
              "name": "Migration Readiness Assessment",
              "priceRange": "$3,500–$5,000",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/services/sharepoint"
            },
            {
              "@type": "Offer",
              "name": "Fractional M365 Architect Retainer — Essentials",
              "price": "2500",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/services/sharepoint"
            },
            {
              "@type": "Offer",
              "name": "Fractional M365 Architect Retainer — Growth",
              "price": "6000",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/services/sharepoint"
            },
            {
              "@type": "Offer",
              "name": "Fractional M365 Architect Retainer — Enterprise",
              "price": "11000",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/services/sharepoint"
            }
          ]
        }}
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <LayoutIcon className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">SharePoint</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            SharePoint Architecture & Modern Intranets — Built the Right Way
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl">
            NASA-proven architecture. 30 years of Microsoft expertise. Intranets your employees will actually use — and your IT team can govern.
          </p>
          <div className="mt-10">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
          </div>
        </div>
      </section>

      {/* Why intranets fail / Intro */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">Why Most SharePoint Intranets Fail</h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Most SharePoint deployments jump straight to building. No governance plan. No information architecture. No migration strategy. The result looks fine at launch and becomes an ungoverned mess within a year — content no one can find, permissions no one understands, and a platform IT dreads touching.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Shane McCaw has spent 30 years solving exactly this problem — most recently as Lead M365 Architect at NASA, where "good enough" isn't an option. He brings the same architecture-first discipline, governance rigor, and enterprise-scale methodology to mid-market and enterprise clients across every regulated industry.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Every engagement starts with structure: understanding your organization's content, users, and workflows before a single site is created. The result is a SharePoint environment that scales, governs itself, and earns adoption.
              </p>
            </div>
            <div className="space-y-6">
              <div className="bg-[#F7F9FC] rounded-xl border border-border p-6">
                <h3 className="font-bold text-[#0A2540] text-lg mb-3">Architecture Before Execution</h3>
                <p className="text-muted-foreground leading-relaxed text-sm">Shane maps your organization's structure, content types, and user journeys before configuring anything. IA is the foundation — not an afterthought.</p>
              </div>
              <div className="bg-[#F7F9FC] rounded-xl border border-border p-6">
                <h3 className="font-bold text-[#0A2540] text-lg mb-3">Governance That Sustains</h3>
                <p className="text-muted-foreground leading-relaxed text-sm">Permissions, naming conventions, lifecycle policies, and DLP — designed to keep your environment clean and compliant years after launch, without constant IT intervention.</p>
              </div>
              <div className="bg-[#F7F9FC] rounded-xl border border-border p-6">
                <h3 className="font-bold text-[#0A2540] text-lg mb-3">Migrations That Stick</h3>
                <p className="text-muted-foreground leading-relaxed text-sm">Moving from legacy SharePoint, file servers, or Google Workspace? Shane's migration methodology eliminates the chaos — phased planning, risk analysis, and clean data classification from day one.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Three Offers */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Engagements</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Three Ways to Work With Shane</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Offer 1: Governance Foundations */}
            <div className="bg-white rounded-2xl border border-border p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-[#0078D4]" />
                </div>
                <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-wide">Fixed-Price Project</p>
              </div>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Governance Foundations Package</h3>
              <div className="mb-1">
                <span className="text-2xl font-extrabold text-[#0A2540]">$12,000–$18,000</span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">6 weeks · Fixed scope</p>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                For organizations that need a solid governance foundation before building anything else. Covers the full structural layer — from maturity assessment to training.
              </p>
              <ul className="space-y-3 mb-8 flex-1">
                {[
                  "SharePoint maturity assessment",
                  "Governance structure & policy framework",
                  "Naming conventions & site lifecycle policies",
                  "Permissions model design",
                  "Data Loss Prevention (DLP) configuration",
                  "Admin roles & responsibilities definition",
                  "Policy templates & documentation",
                  "Governance training session",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <a
                href="/book"
                className="inline-flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#0066B8] transition-colors text-sm"
              >
                Book a Discovery Call <ArrowRight className="w-4 h-4" />
              </a>
            </div>

            {/* Offer 2: Migration Readiness */}
            <div className="bg-white rounded-2xl border border-border p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-[#00B4D8]/10 flex items-center justify-center flex-shrink-0">
                  <ArrowRight className="w-5 h-5 text-[#00B4D8]" />
                </div>
                <p className="text-[#00B4D8] text-xs font-semibold uppercase tracking-wide">Fixed-Price Project</p>
              </div>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Migration Readiness Assessment</h3>
              <div className="mb-1">
                <span className="text-2xl font-extrabold text-[#0A2540]">$3,500–$5,000</span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">1 week · Fixed scope</p>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                For organizations migrating from legacy SharePoint, on-prem file servers, Google Workspace, or poorly configured M365 tenants. Know exactly what you're getting into before you move a single file.
              </p>
              <ul className="space-y-3 mb-8 flex-1">
                {[
                  "Current environment audit & risk analysis",
                  "Migration blocker identification",
                  "Data classification & prioritization",
                  "Phased migration plan with timeline",
                  "Tool & resource recommendations",
                  "Executive summary & decision brief",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <a
                href="/book"
                className="inline-flex items-center justify-center gap-2 border-2 border-[#0078D4] text-[#0078D4] font-semibold px-5 py-3 rounded-xl hover:bg-[#0078D4]/5 transition-colors text-sm"
              >
                Book a Discovery Call <ArrowRight className="w-4 h-4" />
              </a>
            </div>

            {/* Offer 3: Retainer */}
            <div className="bg-[#0A2540] rounded-2xl p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <p className="text-[#00B4D8] text-xs font-semibold uppercase tracking-wide">Monthly Retainer</p>
              </div>
              <h3 className="text-xl font-extrabold text-white mb-2">Fractional M365 Architect</h3>
              <p className="text-white/60 text-sm leading-relaxed mb-6">
                Ongoing strategic access to Shane — your senior architect on call without the full-time hire.
              </p>
              <div className="space-y-4 mb-8 flex-1">
                {[
                  { tier: "Essentials", price: "$2,500/mo", hours: "10 hrs/month" },
                  { tier: "Growth", price: "$6,000/mo", hours: "25 hrs/month" },
                  { tier: "Enterprise", price: "$11,000/mo", hours: "50 hrs/month" },
                ].map((t) => (
                  <div key={t.tier} className="bg-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white text-sm">{t.tier}</span>
                      <span className="font-extrabold text-white">{t.price}</span>
                    </div>
                    <span className="text-white/50 text-xs">{t.hours}</span>
                  </div>
                ))}
              </div>
              <p className="text-white/40 text-xs mb-4">All retainer tiers include strategic planning, architecture reviews, and direct Slack/Teams access.</p>
              <a
                href="/book"
                className="inline-flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#0066B8] transition-colors text-sm"
              >
                Book a Discovery Call <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* What Shane Delivers */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Deliverables</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">What Shane Delivers</h2>
              <ul className="space-y-4">
                {[
                  "Modern intranet architecture via hub sites & spoke topology",
                  "Information architecture (IA) design & documentation",
                  "Taxonomy & metadata frameworks",
                  "Global and local navigation strategy",
                  "Search configuration & relevance tuning",
                  "Permissions governance model & policy documentation",
                  "Migration planning & phased execution roadmap",
                  "Site templates & content models",
                  "End-user adoption plan & training session",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Who This Is For + Why Shane */}
            <div className="space-y-8">
              <div className="bg-[#F7F9FC] rounded-2xl border border-border p-8">
                <div className="flex items-center gap-3 mb-5">
                  <Building2 className="w-6 h-6 text-[#0078D4]" />
                  <h3 className="font-bold text-[#0A2540] text-lg">Who This Is For</h3>
                </div>
                <ul className="space-y-3">
                  {[
                    "Mid-market organizations (200–2,000 employees) outgrowing ad-hoc SharePoint setups",
                    "Regulated industries requiring audit trails, DLP, and provable governance",
                    "Enterprise IT teams inheriting poorly structured tenants",
                    "Organizations planning migrations from legacy systems or Google Workspace",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-2" />
                      <span className="text-sm text-muted-foreground leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-[#F7F9FC] rounded-2xl border border-border p-8">
                <div className="flex items-center gap-3 mb-5">
                  <Shield className="w-6 h-6 text-[#0078D4]" />
                  <h3 className="font-bold text-[#0A2540] text-lg">Why Work With Shane</h3>
                </div>
                <ul className="space-y-3">
                  {[
                    "Lead M365 Architect at NASA — FedRAMP, FISMA High, ITAR, and GCC High compliance expertise",
                    "30 years in the Microsoft ecosystem, from SharePoint 2003 to Copilot-era M365",
                    "Proven at enterprise scale — architecture that survives thousands of users and years of growth",
                    "Direct engagement — no account managers, no junior staff on your project",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-2" />
                      <span className="text-sm text-muted-foreground leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-[#F7F9FC] py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0A2540] rounded-3xl p-10 md:p-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="flex-1">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-wide mb-3">Ready to Start?</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-3">
                Build a SharePoint environment that actually works.
              </h2>
              <p className="text-white/70 text-base max-w-md">
                Book a free 30-minute discovery call to discuss your environment, your goals, and the right engagement for your organization.
              </p>
            </div>
            <div className="flex flex-col items-start md:items-end gap-4">
              <a
                href="/book"
                className="inline-flex items-center gap-2 bg-[#0078D4] text-white font-semibold px-7 py-3.5 rounded-xl hover:bg-[#0066B8] transition-colors"
              >
                Book a Free Discovery Call <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="/contact"
                className="inline-flex items-center gap-2 text-white/70 hover:text-white font-medium text-sm transition-colors"
              >
                Schedule a Consultation <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
