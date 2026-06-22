import { useState } from "react";
import { ServiceOverviewModal } from "@/components/ServiceOverviewModal";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { AssessmentCTA } from "@/components/AssessmentCTA";
import { RetainerCard } from "@/components/RetainerCard";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, Shield, Tag, Archive,
  Eye, Key, Users, Building2, Globe, Clock, DollarSign
} from "lucide-react";
import { useServices, formatPriceDisplay, useServiceHasPdf } from "@/hooks/useServices";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { useServicePageTriggerKeys } from "@/hooks/useServicePageTriggerKeys";
import FixedPriceOfferCard from "@/components/FixedPriceOfferCard";

const comparisonRows = [
  {
    label: "Best For",
    foundations: "Regulated organizations that need defensible governance before any migration, AI rollout, or platform build-out",
    migration: "Organizations planning a legacy migration after governance remediation is complete",
    retainer: "Organizations needing continuous governance oversight, compliance monitoring, and architecture advisory",
  },
  {
    label: "Scope",
    foundations: "Full M365 governance framework — DLP, sensitivity labels, retention schedules, permissions, lifecycle policies, compliance alignment",
    migration: "Discovery, risk analysis, and validated migration plan — no execution included",
    retainer: "Embedded advisory: governance reviews, compliance monitoring, escalation support, architecture guidance",
  },
  {
    label: "Timeline",
    foundations: "6 weeks",
    migration: "1 week",
    retainer: "Ongoing — month-to-month",
  },
  {
    label: "Price",
    foundations: "$12,000–$18,000",
    migration: "$3,500–$5,000",
    retainer: "$2,500 / $6,000 / $11,000 per month",
  },
  {
    label: "Key Deliverables",
    foundations: "Governance playbook, DLP policies, sensitivity label taxonomy, retention schedules, compliance alignment review, admin documentation",
    migration: "Readiness report, risk register, migration blocker analysis, sequenced migration roadmap, go/no-go recommendation",
    retainer: "Monthly advisory hours, governance reviews, compliance monitoring, architecture guidance, executive reporting",
  },
  {
    label: "Ongoing Support",
    foundations: "One-time engagement — optionally followed by a retainer or Copilot readiness assessment",
    migration: "One-time engagement — feeds into a managed migration or ongoing retainer",
    retainer: "Continuous — cancel or adjust tier with 30-day notice",
  },
];

const PACKAGE_INCLUDES = [
  "Governance maturity assessment across the full M365 tenant",
  "Naming conventions and site/team lifecycle policies",
  "Data Loss Prevention (DLP) policy design and implementation",
  "Microsoft Purview sensitivity labeling taxonomy and auto-labeling",
  "Retention schedules and records management configuration",
  "Teams and SharePoint governance model with permission scoping",
  "Admin roles, privileged access review, and least-privilege remediation",
  "Change management process design and documentation",
  "Compliance alignment review (HIPAA, CMMC, SOX, FIN, ITAR, FedRAMP)",
  "Policy documentation package and governance playbook",
];

const WHAT_DELIVERS = [
  {
    icon: <Shield className="w-5 h-5" />,
    title: "Data Loss Prevention",
    desc: "Configure DLP policies that automatically detect and protect sensitive data — SSNs, financial records, health information, and classified content — before it leaves your environment.",
  },
  {
    icon: <Tag className="w-5 h-5" />,
    title: "Sensitivity Labeling",
    desc: "Deploy Microsoft Purview sensitivity labels with auto-classification, encryption, and visual marking. Build a labeling taxonomy aligned to your compliance requirements.",
  },
  {
    icon: <Archive className="w-5 h-5" />,
    title: "Retention & Records Management",
    desc: "Court-defensible retention schedules built into the platform. Ensure records are retained as long as required and purged when they must not be kept.",
  },
  {
    icon: <Eye className="w-5 h-5" />,
    title: "Microsoft Purview",
    desc: "Deploy the full Purview compliance suite — eDiscovery, communication compliance, information barriers, and audit logging configured for your regulatory obligations.",
  },
  {
    icon: <Key className="w-5 h-5" />,
    title: "Conditional Access & Identity Governance",
    desc: "Identity-based access policies ensuring only the right people, on the right devices, from the right locations can access sensitive systems and data.",
  },
  {
    icon: <Users className="w-5 h-5" />,
    title: "Permissions Audits & Privileged Access",
    desc: "Comprehensive review of who has access to what. Identify and remediate overprivileged accounts, excessive guest access, and admin role sprawl.",
  },
  {
    icon: <Building2 className="w-5 h-5" />,
    title: "Teams & SharePoint Governance",
    desc: "Lifecycle policies, naming conventions, guest access controls, and site provisioning governance that prevent data sprawl and keep your environment manageable at scale.",
  },
  {
    icon: <Globe className="w-5 h-5" />,
    title: "Compliance Framework Alignment",
    desc: "Governance frameworks explicitly mapped to HIPAA, CMMC, SOX, FIN, ITAR, and FedRAMP requirements — not generic checklists, but defensible controls.",
  },
];

const FOLLOW_ON = [
  {
    name: "Migration Readiness Assessment",
    desc: "For organizations planning a legacy migration following governance remediation.",
    href: "/services/microsoft-365",
    slug: "migration-readiness-assessment",
    fallbackPrice: "$3,500–$5,000",
    duration: "1 week",
  },
  {
    name: "Copilot for M365 Readiness Assessment",
    desc: "Once governance is in place, evaluate readiness to enable Copilot safely.",
    href: "/services/copilot-ai",
    slug: "copilot-for-m365-readiness-assessment",
    fallbackPrice: "$5,000–$8,000",
    duration: "2 weeks",
  },
];


const INDUSTRIES = [
  "Healthcare (HIPAA)",
  "Legal & Professional Services",
  "Financial Services (SOX, FIN)",
  "Defense Contractors (CMMC, ITAR)",
  "Government Contractors (FedRAMP)",
  "Life Sciences (GDPR, CCPA)",
];

const WHY_SHANE = [
  {
    title: "NASA Governance Experience",
    desc: "Shane built and maintained Microsoft 365 governance frameworks at NASA — one of the most compliance-intensive and security-sensitive federal M365 environments in existence. That methodology applies directly to your organization.",
  },
  {
    title: "Compliance-First Architecture",
    desc: "Deep expertise in FedRAMP, FISMA High, ITAR, CMMC, HIPAA, and GCC High. Shane designs governance that satisfies the strictest regulatory frameworks without sacrificing usability or adoption.",
  },
  {
    title: "Enterprise-Grade Frameworks, Not Templates",
    desc: "Shane doesn't hand you a generic policy document. Every governance framework is built for your organization's specific data landscape, regulatory obligations, and operational context.",
  },
  {
    title: "Direct Delivery, Full Accountability",
    desc: "No subcontracting, no junior team. Shane does the work himself — with direct accountability for every recommendation, policy design, and implementation decision.",
  },
];


export default function Governance() {
  const { services, loading } = useServices();
  const { services: retainerServices, loading: retainerLoading } = useServices("retainer");
  const { projects: engagementProjects, loading: engagementLoading } = useEngagementProjects();
  const { triggerKeys: governanceTriggerKeys } = useServicePageTriggerKeys("governance");

  const matchedProjects = engagementProjects.filter(
    (p) => p.isVisible && p.triggeredBy.some((t) => governanceTriggerKeys.includes(t))
  );

  const govSvc = services.find((s) => s.slug === "governance-foundations-package");
  const migSvc = services.find((s) => s.slug === "migration-readiness-assessment");
  const copilotSvc = services.find((s) => s.slug === "copilot-for-m365-readiness-assessment");
  const skeleton = <span className="inline-block w-28 h-4 bg-gray-200 rounded animate-pulse align-middle" />;
  const livePrice = (svc: typeof services[0] | undefined, fallback: string) =>
    loading ? skeleton : svc ? formatPriceDisplay(svc) : fallback;
  const tablePrices = {
    foundations: livePrice(govSvc, "$12,000–$18,000"),
    migration: livePrice(migSvc, "$3,500–$5,000"),
    retainer: "$2,500 / $6,000 / $11,000 per month",
  };
  const [modalOpen, setModalOpen] = useState(false);
  const hasPdf = useServiceHasPdf("/services/governance");

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Governance, Compliance & Security | Shane McCaw Consulting"
        description="NASA-proven Microsoft 365 governance frameworks for regulated organizations. Fixed-price Governance Foundations Package and fractional architect retainers from Lead M365 Architect Shane McCaw."
        ogUrl="https://shanemccawconsulting.com/services/governance"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Governance, Compliance & Security",
          "description": "NASA-proven governance frameworks for organizations that cannot afford to get this wrong.",
          "url": "https://shanemccawconsulting.com/services/governance",
          "serviceType": "Microsoft 365 Governance Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Regulated industries: healthcare, legal, financial, defense contractors, government contractors",
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com",
          },
          "offers": [
            {
              "@type": "Offer",
              "name": "Governance Foundations Package",
              "priceRange": "$12,000–$18,000",
              "priceCurrency": "USD",
              "url": "https://shanemccawconsulting.com/services/governance",
            },
          ],
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Governance & Compliance</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Governance, Compliance & Security — Built for Regulated Organizations
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            NASA-proven governance frameworks for organizations that cannot afford to get this wrong.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <a
              href="/crm/portal/onboarding/select?service=governance-foundations-package"
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
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">The Stakes</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
              Regulated Organizations Cannot Run on Default Settings
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-4">
              Microsoft 365's default configuration is designed for ease of adoption, not regulatory compliance. For organizations operating under HIPAA, CMMC, FedRAMP, SOX, or ITAR, the gap between default settings and defensible governance is where breaches, audit failures, and accreditation loss live.
            </p>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Shane McCaw served as Lead M365 Architect at NASA, where governance wasn't optional — it was a legal and mission-critical requirement. He brings that discipline to your organization through a structured, deliverable-driven engagement that produces real governance frameworks, not templates.
            </p>
          </div>
        </div>
      </section>

      {/* ── GOVERNANCE FOUNDATIONS PACKAGE ──────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Fixed-Price Engagement</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Governance Foundations Package</h2>
          </div>
          <FixedPriceOfferCard slug="governance-foundations-package" ctaLabel="Get Started" />
        </div>
      </section>

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Capabilities</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">What Shane Delivers</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {WHAT_DELIVERS.map((item) => (
              <div
                key={item.title}
                className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center text-[#0078D4] flex-shrink-0">
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-1.5">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOLLOW-ON ENGAGEMENTS ────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Optional Next Steps</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Follow-On Engagements</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Governance is the foundation. Once it's in place, Shane can lead migration planning, Copilot deployment, or ongoing architecture through a monthly retainer.
            </p>
          </div>

          <div className="max-w-4xl mx-auto space-y-4 mb-12">
            {FOLLOW_ON.map((item) => (
              <div key={item.name} className="bg-white border border-border rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="flex-1">
                  <p className="font-bold text-[#0A2540] mb-1">{item.name}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-[#0A2540] font-bold text-sm">{livePrice(services.find((s) => s.slug === item.slug), item.fallbackPrice)}</p>
                    <p className="text-muted-foreground text-xs flex items-center gap-1 justify-end mt-0.5">
                      <Clock className="w-3 h-3" /> {item.duration}
                    </p>
                  </div>
                  <Link href={item.href} className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold hover:underline text-sm whitespace-nowrap">
                    Details <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {(engagementLoading || matchedProjects.length > 0) && (
            <div className="mb-12">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-2">Project Engagements</p>
              <p className="text-muted-foreground text-sm mb-5 max-w-xl">These scoped engagements typically emerge after a governance assessment uncovers gaps in policy enforcement, compliance posture, or information architecture.</p>
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

          <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-6">Fractional M365 Architect Retainers</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
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
          <p className="text-center text-sm text-muted-foreground mt-5">
            All retainers are month-to-month.{" "}
            <Link href="/pricing" className="text-[#0078D4] hover:underline font-medium">See full pricing →</Link>
          </p>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ideal Clients</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">Who This Is For</h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Shane's governance engagements are designed for organizations where compliance gaps carry real consequences — audit failures, accreditation loss, regulatory fines, or breach liability.
              </p>
              <ul className="space-y-3">
                {INDUSTRIES.map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0" />
                    <span className="text-[#0A2540] text-sm font-medium">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">Compliance Frameworks Covered</p>
              <p className="text-white font-bold text-lg">Built under the strictest requirements in existence.</p>
              <div className="grid grid-cols-2 gap-3">
                {["HIPAA", "CMMC", "SOX", "FIN", "GDPR / CCPA", "FedRAMP", "ITAR", "FISMA High"].map((label) => (
                  <div key={label} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                    <span className="text-white text-sm font-semibold">{label}</span>
                  </div>
                ))}
              </div>
              <p className="text-white/50 text-xs leading-relaxed">
                Shane's governance methodology was forged under NASA's FedRAMP, FISMA High, and ITAR requirements — the same rigor scales to your organization.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Credentials</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border bg-white hover:border-[#0078D4]/30 transition-all">
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

      <AssessmentCTA
        label="Free Governance Maturity Assessment"
        title="How Mature Is Your M365 Governance?<br class='hidden sm:block' /> Find Out in 5 Minutes."
        description="Most organizations don't discover their governance gaps until Copilot exposes overshared files, an audit flags compliance issues, or a departing employee takes data with them."
        supportingCopy="Answer 10 targeted questions across naming, lifecycle, DLP, access controls, and admin roles — and receive a maturity score with a tailored governance roadmap."
        quizUrl="/governance-maturity-quiz"
        ctaLabel="Take the Governance Maturity Assessment"
        stats={[
          { label: "10 questions · ~5 minutes" },
          { label: "Personalised report emailed instantly" },
          { label: "No sales follow-up" },
        ]}
      />

      {/* ── COMPARISON TABLE ────────────────────────────────────────────── */}
      <section className="bg-white py-20">
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
                      <Shield className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Scope</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Governance Foundations Package</p>
                  </th>
                  <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowRight className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Scope</span>
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
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.foundations}</span> : row.foundations}
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
              { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Scope", title: "Governance Foundations Package", key: "foundations" as const },
              { icon: <ArrowRight className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Scope", title: "Migration Readiness Assessment", key: "migration" as const },
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

      {/* ── ASSESSMENT CTAS ──────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-16">
        <div className="max-w-[1200px] mx-auto px-6 space-y-4">
          <div className="bg-white border border-border rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1">
              <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-widest mb-2">Free · 5 Minutes</p>
              <h3 className="text-2xl font-extrabold text-[#0A2540] mb-3">Governance Maturity Assessment</h3>
              <p className="text-muted-foreground leading-relaxed">
                Benchmark your M365 governance posture across DLP, sensitivity labels, retention, access governance, and compliance framework readiness — get a free PDF report instantly.
              </p>
            </div>
            <a href="/governance-maturity-quiz"
              className="flex-shrink-0 inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white font-bold px-8 py-4 rounded-xl transition-colors text-base">
              Take the Free Assessment
            </a>
          </div>
          <div className="bg-white border border-border rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1">
              <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-widest mb-2">Free · 5 Minutes</p>
              <h3 className="text-2xl font-extrabold text-[#0A2540] mb-3">Security & Compliance Maturity Assessment</h3>
              <p className="text-muted-foreground leading-relaxed">
                Evaluate your identity & access controls, data protection, Insider Risk posture, audit & eDiscovery readiness, and regulatory framework alignment.
              </p>
            </div>
            <a href="/security-compliance-quiz"
              className="flex-shrink-0 inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white font-bold px-8 py-4 rounded-xl transition-colors text-base">
              Take the Free Assessment
            </a>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ready to Start?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Build a Governance Foundation You Can Defend
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            A free 30-minute discovery call to assess your current governance posture and identify the highest-risk gaps.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/book" className="px-8 py-3.5 text-base">
              Book a Free Discovery Call
            </CTAButton>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-white/80 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              Schedule a Consultation <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
      <ServiceOverviewModal
        serviceName="M365 Governance"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Layout>
  );
}
