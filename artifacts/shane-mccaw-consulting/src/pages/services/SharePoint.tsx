import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Layout as LayoutIcon, CheckCircle, ArrowRight, Building2, Shield, Users } from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { CTAButton } from "@/components/CTAButton";
import { ServiceRetainerCard } from "@/components/ServiceRetainerCard";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";

const comparisonRows = [
  {
    label: "Best For",
    governance: "Organizations building a governed SharePoint foundation before any migration or build-out begins",
    migration: "Organizations migrating from legacy SharePoint, file servers, or Google Workspace",
    retainer: "Organizations needing ongoing SharePoint architecture, governance, and advisory support",
  },
  {
    label: "Scope",
    governance: "Full governance framework — policies, permissions, naming conventions, lifecycle, and DLP",
    migration: "Discovery, risk analysis, and validated migration plan — no execution",
    retainer: "Embedded advisory: architecture guidance, governance reviews, and escalation support",
  },
  {
    label: "Timeline",
    governance: "6 weeks",
    migration: "1 week",
    retainer: "Ongoing — month-to-month",
  },
  {
    label: "Price",
    governance: "$12,000–$18,000",
    migration: "$3,500–$5,000",
    retainer: "$2,500 / $6,000 / $11,000 per month",
  },
  {
    label: "Key Deliverables",
    governance: "Governance playbook, naming conventions, lifecycle policies, DLP configuration, permissions model, training session",
    migration: "Risk register, migration blocker analysis, phased migration plan, tool recommendations, executive summary",
    retainer: "Monthly advisory hours, architecture reviews, governance monitoring, escalation access",
  },
  {
    label: "Ongoing Support",
    governance: "One-time engagement — optionally followed by a retainer for continued governance oversight",
    migration: "One-time engagement — feeds into a governance package or managed migration engagement",
    retainer: "Continuous — cancel or adjust tier with 30-day notice",
  },
];

const RETAINERS = [
  {
    name: "Architect Essentials",
    price: "$2,500",
    hours: "10 hrs/month",
    description: "Advisory, architecture reviews, SharePoint governance oversight, and escalation support.",
    highlight: false,
  },
  {
    name: "Architect Growth",
    price: "$6,000",
    hours: "25 hrs/month",
    description: "Ongoing governance implementation, intranet development, and IT team mentoring.",
    highlight: true,
  },
  {
    name: "Architect Enterprise",
    price: "$11,000",
    hours: "50 hrs/month",
    description: "Embedded SharePoint architecture leadership, governance ownership, and executive reporting.",
    highlight: false,
  },
];

export default function SharePoint() {
  const { services, loading } = useServices();
  const govSvc = services.find((s) => s.slug === "governance-foundations-package");
  const migSvc = services.find((s) => s.slug === "migration-readiness-assessment");
  const skeleton = <span className="inline-block w-28 h-4 bg-gray-200 rounded animate-pulse align-middle" />;
  const livePrice = (svc: typeof services[0] | undefined, fallback: string) =>
    loading ? skeleton : svc ? formatPriceDisplay(svc) : fallback;
  const tablePrices = {
    governance: livePrice(govSvc, "$12,000–$18,000"),
    migration: livePrice(migSvc, "$3,500–$5,000"),
    retainer: "$2,500 / $6,000 / $11,000 per month",
  };
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
                <span className="text-2xl font-extrabold text-[#0A2540]">{livePrice(govSvc, "$12,000–$18,000")}</span>
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
                <span className="text-2xl font-extrabold text-[#0A2540]">{livePrice(migSvc, "$3,500–$5,000")}</span>
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

          </div>

          {/* Track 03: Fractional Architecture Retainers */}
          <div className="mt-12">
            <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-2">Track 03 · Strategic Tier</p>
            <h3 className="text-center text-2xl font-extrabold text-[#0A2540] mb-3">Fractional M365 Architect Retainers</h3>
            <p className="text-center text-muted-foreground text-sm mb-10 max-w-2xl mx-auto">
              Ongoing strategic access to Shane — your senior SharePoint architect on call without the full-time hire. All tiers include architecture reviews, governance oversight, and direct Slack/Teams access.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {RETAINERS.map((r, i) => (
                <ServiceRetainerCard
                  key={r.name}
                  name={r.name}
                  price={r.price}
                  hours={r.hours}
                  description={r.description}
                  highlight={r.highlight}
                  index={i}
                />
              ))}
            </div>
            <p className="text-center text-sm text-muted-foreground mt-6">
              All retainers are month-to-month.{" "}
              <a href="/pricing" className="text-[#0078D4] hover:underline font-medium">See full pricing →</a>
            </p>
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

      {/* Comparison Table */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Quick Comparison</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-3">Which Engagement Is Right for You?</h2>
          <p className="text-muted-foreground mb-10 max-w-2xl leading-relaxed">
            Not sure where to start? This table maps each offer across the dimensions that matter most — so you can self-select before picking up the phone.
          </p>

          <div className="hidden md:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#0A2540] text-white">
                  <th className="text-left px-6 py-5 w-[18%] font-semibold text-white/60 text-xs uppercase tracking-widest"></th>
                  <th className="text-left px-6 py-5 w-[27%]">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Price</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Governance Foundations Package</p>
                  </th>
                  <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowRight className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Price</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Migration Readiness Assessment</p>
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
                  <tr key={row.label} className={i % 2 === 0 ? "bg-white" : "bg-[#F7F9FC]"}>
                    <td className="px-6 py-5 font-semibold text-[#0A2540] text-xs uppercase tracking-widest align-top whitespace-nowrap border-r border-border">
                      {row.label}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.governance}</span> : row.governance}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.migration}</span> : row.migration}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.retainer}</span> : row.retainer}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#0A2540]">
                  <td className="px-6 py-5 border-r border-white/10"></td>
                  <td className="px-6 py-5">
                    <a href="/book" className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline">
                      Book a Call <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </td>
                  <td className="px-6 py-5 border-l border-white/10">
                    <a href="/book" className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline">
                      Book a Call <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </td>
                  <td className="px-6 py-5 border-l border-white/10">
                    <a href="/book" className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline">
                      Book a Call <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-6">
            {[
              { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Price", title: "Governance Foundations Package", key: "governance" as const },
              { icon: <ArrowRight className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Price", title: "Migration Readiness Assessment", key: "migration" as const },
              { icon: <Users className="w-5 h-5 text-[#0078D4]" />, badge: "Ongoing", title: "Fractional M365 Architect Retainer", key: "retainer" as const },
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
