import { useState } from "react";
import { ServiceOverviewModal } from "@/components/ServiceOverviewModal";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CopilotQuizCTA } from "@/components/CopilotQuizCTA";
import { RetainerCard } from "@/components/RetainerCard";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, Shield, Database, Eye,
  Key, Users, Map, Target, BarChart3, Clock, DollarSign
} from "lucide-react";
import { useServices, formatPriceDisplay, useServiceHasPdf } from "@/hooks/useServices";
import { FollowOnProjects } from "@/components/FollowOnProjects";
import FixedPriceOfferCard from "@/components/FixedPriceOfferCard";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { TestimonialDiscountCallout } from "@/components/TestimonialDiscountCallout";
import { AfterPurchaseSection } from "@/components/AfterPurchaseSection";

const comparisonRows = [
  {
    label: "Best For",
    assessment: "Organizations evaluating Copilot readiness before enabling any licenses",
    governance: "Organizations needing governance remediation before a safe Copilot rollout can proceed",
    retainer: "Organizations that have deployed Copilot and need ongoing oversight and adoption support",
  },
  {
    label: "Scope",
    assessment: "Readiness audit across data governance, identity, sensitivity labeling, licensing, and change management",
    governance: "Full M365 governance framework — DLP, sensitivity labels, lifecycle policies, permissions, compliance alignment",
    retainer: "Embedded advisory: Copilot governance, adoption monitoring, architecture guidance, escalation support",
  },
  {
    label: "Timeline",
    assessment: "2 weeks",
    governance: "6 weeks",
    retainer: "Ongoing — month-to-month",
  },
  {
    label: "Price",
    assessment: "$5,000–$8,000",
    governance: "$12,000–$18,000",
    retainer: "$2,500 / $6,000 / $11,000 per month",
  },
  {
    label: "Key Deliverables",
    assessment: "Readiness report, rollout roadmap, pilot group recommendations, quick-win remediation actions",
    governance: "Governance playbook, DLP policies, sensitivity label taxonomy, lifecycle rules, compliance alignment documentation",
    retainer: "Monthly advisory hours, adoption reviews, architecture guidance, governance monitoring, executive reporting",
  },
  {
    label: "Ongoing Support",
    assessment: "One-time engagement — can feed directly into a governance package or deployment retainer",
    governance: "One-time engagement — optionally followed by a Copilot deployment retainer",
    retainer: "Continuous — cancel or adjust tier with 30-day notice",
  },
];

const ASSESSMENT_INCLUDES = [
  { icon: <Database className="w-4 h-4" />,    text: "Assessment of data governance and sensitivity labeling maturity" },
  { icon: <Shield className="w-4 h-4" />,      text: "SharePoint & OneDrive hygiene review" },
  { icon: <Eye className="w-4 h-4" />,         text: "Identity & permission sprawl analysis" },
  { icon: <Key className="w-4 h-4" />,         text: "Licensing readiness validation" },
  { icon: <Users className="w-4 h-4" />,       text: "Change management capacity evaluation" },
  { icon: <Map className="w-4 h-4" />,         text: "Phased Copilot rollout roadmap" },
  { icon: <Target className="w-4 h-4" />,      text: "Pilot group recommendations" },
  { icon: <BarChart3 className="w-4 h-4" />,   text: "Success metrics and adoption plan" },
];

const COMPLIANCE = ["HIPAA", "SOC 2", "FIN", "CMMC", "ITAR", "FedRAMP"];


const WHY_SHANE = [
  {
    title: "NASA Copilot SME",
    desc: "Shane served as Subject Matter Expert for Copilot for Microsoft 365 at NASA — one of the most security-sensitive and compliance-intensive federal environments in the US. He's not studying the technology, he's deployed it at scale.",
  },
  {
    title: "Governance-First Methodology",
    desc: "Shane's approach starts with data hygiene, labeling maturity, and permission scoping before a single Copilot license is enabled. That's how you prevent AI from surfacing sensitive data to the wrong people.",
  },
  {
    title: "30 Years of Microsoft Ecosystem Experience",
    desc: "Deep expertise across identity, compliance, SharePoint, Teams, and Power Platform — the full stack Copilot depends on. Nothing is evaluated in isolation.",
  },
  {
    title: "Enterprise Deployment, Not Vendor Sales",
    desc: "Shane has no incentive to push licenses or rush your rollout. His goal is a deployment that works safely, sustainably, and earns real adoption from your users.",
  },
];

export default function CopilotAI() {
  const { services, loading } = useServices();
  const { services: retainerServices, loading: retainerLoading } = useServices("retainer");
  const assessmentSvc = services.find((s) => s.slug === "copilot-for-m365-readiness-assessment");
  const govSvc = services.find((s) => s.slug === "governance-foundations-package");
  const skeleton = <span className="inline-block w-28 h-4 bg-gray-200 rounded animate-pulse align-middle" />;
  const livePrice = (svc: typeof services[0] | undefined, fallback: string) =>
    loading ? skeleton : svc ? formatPriceDisplay(svc) : fallback;
  const tablePrices = {
    assessment: livePrice(assessmentSvc, "$5,000–$8,000"),
    governance: livePrice(govSvc, "$12,000–$18,000"),
    retainer: "$2,500 / $6,000 / $11,000 per month",
  };
  const { projects: engagementProjects, loading: engagementLoading } = useEngagementProjects();
  const matchedProjects = engagementProjects.filter((p) =>
    p.isVisible && p.pages.includes("copilot-ai")
  );
  const [modalOpen, setModalOpen] = useState(false);
  const hasPdf = useServiceHasPdf("/services/copilot-ai");

  return (
    <Layout>
      <SEOMeta
        title="Copilot for Microsoft 365 Readiness & Deployment | Shane McCaw Consulting"
        description="Secure, governed, enterprise-grade Copilot for Microsoft 365 deployments built on real NASA methodology. Fixed-price readiness assessment from Lead M365 Architect Shane McCaw."
        ogUrl="https://shanemccawconsulting.com/services/copilot-ai"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Copilot for Microsoft 365 Readiness & Deployment",
          "description": "Governance-first Copilot readiness assessments and deployment planning for mid-market and regulated organizations.",
          "url": "https://shanemccawconsulting.com/services/copilot-ai",
          "serviceType": "Copilot for Microsoft 365 Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market and regulated organizations with compliance obligations"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          },
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-[172px] pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 65% 0%, rgba(0,120,212,0.13) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Copilot for Microsoft 365</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Copilot for Microsoft 365 Readiness & Deployment —<br className="hidden lg:block" /> NASA-Proven Expertise
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            Secure, governed, enterprise-grade Copilot deployments built on real NASA methodology.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <a
              href="/crm/portal/onboarding/select?service=copilot-for-m365-readiness-assessment"
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

      {/* ── INTRO ────────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">The Reality</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                Copilot Is Not Plug-and-Play
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Microsoft Copilot for M365 is the most powerful productivity tool Microsoft has ever released — and the most dangerous to deploy without preparation. It surfaces information from across your entire tenant, respecting your existing permissions model. If your data governance is weak, Copilot will expose it.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Before enabling Copilot, organizations need governance maturity, data hygiene, sensitivity labeling, and a structured rollout plan. Enabling Copilot into an unprepared tenant can create real compliance and data exposure risks.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Shane McCaw served as NASA's Copilot for Microsoft 365 Subject Matter Expert — leading readiness assessment, governance design, and phased deployment for one of the most compliance-sensitive federal environments in the US. He brings that methodology directly to your organization.
              </p>
            </div>
            <div className="bg-[#F7F9FC] border border-border rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">Why Preparation Matters</p>
              <div className="space-y-4">
                {[
                  { risk: "Data exposure", detail: "Copilot surfaces content your permissions model allows — overshared files become instantly discoverable." },
                  { risk: "Compliance violations", detail: "Sensitive data retrieved in Copilot outputs can breach HIPAA, ITAR, or CMMC requirements." },
                  { risk: "Poor adoption", detail: "Without governance and change management, Copilot licenses go unused and ROI evaporates." },
                ].map((item) => (
                  <div key={item.risk} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#0078D4] flex-shrink-0 mt-2" />
                    <div>
                      <p className="font-bold text-[#0A2540] text-sm">{item.risk}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── OFFICIAL OFFER ───────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Fixed-Price Engagement</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Copilot for M365 Readiness Assessment</h2>
          </div>
          <FixedPriceOfferCard slug="copilot-for-m365-readiness-assessment" ctaLabel="Get Started" />
        </div>
      </section>

      {/* ── PROJECT ENGAGEMENTS ──────────────────────────────────────────── */}
      {(engagementLoading || matchedProjects.length > 0) && (
        <section className="bg-white py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="text-center mb-12">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Project Engagements</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Common Project Engagements</h2>
              <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
                Most Copilot readiness assessments surface deeper work. Shane can lead that work through a scoped project engagement.
              </p>
            </div>
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
        </section>
      )}

      {/* ── FOLLOW-ON ENGAGEMENTS ────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Optional Next Steps</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Follow-On Engagements</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Most assessments surface remediation work. Shane can lead that work too, either through a targeted package or an ongoing retainer.
            </p>
          </div>

          {/* Governance package callout */}
          <div className="max-w-4xl mx-auto mb-8">
            <div className="bg-[#F7F9FC] border border-border rounded-2xl p-7 flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-1">
                <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-2">Remediation Package</p>
                <h3 className="text-xl font-bold text-[#0A2540] mb-2">Governance Foundations Package</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  For organizations needing governance remediation before their Copilot rollout can proceed — covering naming conventions, lifecycle policies, DLP, Teams/SharePoint governance, and admin roles.
                </p>
              </div>
              <Link
                href="/services/governance"
                className="flex-shrink-0 inline-flex items-center gap-2 text-[#0078D4] font-semibold hover:underline whitespace-nowrap text-sm"
              >
                View Package Details <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          <div className="max-w-4xl mx-auto mb-2">
            <FollowOnProjects pageSlug="copilot-ai" />
          </div>

          {/* Retainers */}
          <div className="max-w-4xl mx-auto">
            <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-6">Fractional M365 Architect Retainers</p>
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
                    <RetainerCard
                      key={tier.slug ?? tier.name}
                      plan={tier}
                      index={i}
                    />
                  ))}
            </div>
            <p className="text-center text-sm text-muted-foreground mt-5">
              All retainers are month-to-month.{" "}
              <Link href="/pricing" className="text-[#0078D4] hover:underline font-medium">See full pricing →</Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ideal Clients</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">Who This Is For</h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Shane's Copilot engagements are designed for organizations where the stakes of a misconfigured AI deployment are real — data exposure, regulatory breach, or failed adoption.
              </p>
              <ul className="space-y-3">
                {[
                  "Mid-market organizations (200–2,000 employees) evaluating or rolling out Copilot",
                  "Regulated industries with compliance obligations that must survive AI adoption",
                  "IT leaders who have purchased Copilot licenses but haven't enabled them yet",
                  "Organizations whose previous Copilot rollout stalled or produced poor adoption",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-[#0A2540] text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">Compliance Coverage</p>
              <p className="text-white font-bold text-lg">Built for regulated environments.</p>
              <div className="grid grid-cols-2 gap-3">
                {COMPLIANCE.map((label) => (
                  <div key={label} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                    <span className="text-white text-sm font-semibold">{label}</span>
                  </div>
                ))}
              </div>
              <p className="text-white/50 text-xs leading-relaxed">
                Shane's governance methodology was built under FedRAMP, FISMA High, and ITAR requirements at NASA — the same rigor applies to every engagement.
              </p>
            </div>
          </div>
        </div>
      </section>

      <CopilotQuizCTA />

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Credentials</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARISON TABLE ────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Quick Comparison</p>
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
                      <Target className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Scope</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Copilot Readiness Assessment</p>
                  </th>
                  <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-[#00B4D8]" />
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
                  <tr key={row.label} className={i % 2 === 0 ? "bg-white" : "bg-[#F7F9FC]"}>
                    <td className="px-6 py-5 font-semibold text-[#0A2540] text-xs uppercase tracking-widest align-top whitespace-nowrap border-r border-border">
                      {row.label}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.assessment}</span> : row.assessment}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.governance}</span> : row.governance}
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
              { icon: <Target className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Scope", title: "Copilot Readiness Assessment", key: "assessment" as const },
              { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Scope", title: "Governance Foundations Package", key: "governance" as const },
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

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <AfterPurchaseSection serviceName="Copilot for M365" />
      <TestimonialDiscountCallout />
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ready to Start?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Know If Your Organization Is Copilot-Ready
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            A two-week engagement that answers the question every IT leader needs answered before enabling Copilot.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/book" className="px-8 py-3.5 text-base">
              Book a Copilot Readiness Assessment
            </CTAButton>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-white/80 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              Schedule a Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
      <ServiceOverviewModal
        serviceName="Copilot for M365"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Layout>
  );
}
