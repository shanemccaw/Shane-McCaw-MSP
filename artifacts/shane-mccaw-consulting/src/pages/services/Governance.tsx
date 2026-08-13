import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, ChevronRight, Shield, Tag, Archive,
  Eye, Key, Users, Building2, Globe,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

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
    icon: Shield,
    title: "Data Loss Prevention",
    desc: "Configure DLP policies that automatically detect and protect sensitive data — SSNs, financial records, health information, and classified content — before it leaves your environment.",
  },
  {
    icon: Tag,
    title: "Sensitivity Labeling",
    desc: "A full Microsoft Purview sensitivity label taxonomy with auto-labeling policies — so data is classified correctly regardless of who created it or where it lives.",
  },
  {
    icon: Archive,
    title: "Retention & Records Management",
    desc: "Retention schedules aligned to your regulatory obligations. Content is kept for exactly as long as required — and disposed of on schedule, with a defensible audit trail.",
  },
  {
    icon: Eye,
    title: "Teams & SharePoint Governance",
    desc: "Site provisioning standards, lifecycle policies, Teams channel governance, and external sharing controls that prevent sprawl before it starts.",
  },
  {
    icon: Key,
    title: "Privileged Access Review",
    desc: "Global admin rationalization, service account audit, and Privileged Identity Management configuration — closing the identity gaps that cause the most breaches.",
  },
  {
    icon: Users,
    title: "Change Management",
    desc: "A governance operating model your IT team can own — with documented processes, escalation paths, and a playbook for handling exceptions without breaking policy.",
  },
];

const INDUSTRIES = [
  { icon: Building2, label: "Healthcare & Life Sciences (HIPAA)" },
  { icon: Shield, label: "Defense & Government Contractors (CMMC, ITAR)" },
  { icon: Globe, label: "Financial Services (SOX, FIN)" },
  { icon: Users, label: "Legal & Professional Services" },
  { icon: Archive, label: "Federal Agencies (FedRAMP, FISMA)" },
  { icon: Eye, label: "Any organization facing a SOC 2 or HIPAA audit" },
];

const WHY_SHANE = [
  {
    title: "Built Under the Strictest Mandates",
    desc: "Shane designed and enforced Microsoft 365 governance at NASA under FedRAMP High, FISMA, and ITAR requirements — some of the most demanding regulatory environments in any sector. He brings that discipline to commercial engagements.",
  },
  {
    title: "Compliance Is in the Design, Not a Layer On Top",
    desc: "Shane builds governance frameworks where DLP, retention, and sensitivity labeling are designed into the architecture from day one — not retrofitted after deployment.",
  },
  {
    title: "Governance That Sticks",
    desc: "Documentation and a playbook that your IT team can actually own. Shane designs the change management model alongside the technical controls — so governance doesn't erode as soon as the engagement ends.",
  },
  {
    title: "30 Years of Microsoft Ecosystem Experience",
    desc: "From early Exchange and SharePoint deployments to Copilot governance in regulated environments — Shane has operated in the Microsoft ecosystem across every era of its evolution.",
  },
];

export default function Governance() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Governance, Compliance & Security | Shane McCaw Consulting"
        description="Microsoft 365 governance consulting by Shane McCaw — DLP policies, sensitivity labeling, retention schedules, and a compliance-ready governance framework for regulated organizations."
        ogImage="/og-image-governance.png"
        ogUrl="https://shanemccawconsulting.com/services/governance"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Governance, Compliance & Security",
          "description": "Full M365 governance framework — DLP, sensitivity labels, retention schedules, lifecycle policies, and compliance alignment for HIPAA, CMMC, SOX, ITAR, and FedRAMP.",
          "url": "https://shanemccawconsulting.com/services/governance",
          "serviceType": "Microsoft 365 Governance Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Regulated organizations needing defensible Microsoft 365 governance",
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
          <span className="text-text-primary font-medium">Governance & Compliance</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Shield className="w-3.5 h-3.5 text-accent-blue" />
            Governance & Compliance
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Microsoft 365 Governance, Compliance & Security
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Regulated organizations can't run on out-of-the-box defaults. Shane builds the governance framework your compliance obligations require — DLP, sensitivity labels, retention schedules, lifecycle policies, and admin controls that actually hold.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/assessments?tab=free"
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

      {/* ── THE PROBLEM ──────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Reality</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">Microsoft 365 Defaults Are Not Compliant Defaults</h2>
            <p className="text-text-secondary leading-relaxed mb-5">
              Microsoft 365 ships with permissive defaults — external sharing enabled, DLP policies absent, retention unmanaged, and admin accounts over-privileged. For regulated industries, that's not an IT problem. It's a compliance liability.
            </p>
            <p className="text-text-secondary leading-relaxed mb-5">
              Most organizations discover this during an audit — not a configuration review. By then, the gap is documented, the finding is in writing, and the remediation timeline is aggressive.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Shane builds governance frameworks before the audit — so your M365 environment reflects your actual compliance posture, not your aspirational one.
            </p>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">What's Included</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">Governance Foundations Package</h2>
            <ul className="space-y-3">
              {PACKAGE_INCLUDES.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary text-sm">
                  <CheckCircle className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── WHAT DELIVERS ────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Deliverables</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Six Governance Capabilities</h2>
            <p className="text-text-secondary mt-4 max-w-xl mx-auto leading-relaxed">
              Each capability is implemented, documented, and tested — not just recommended.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHAT_DELIVERS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-6 hover:border-accent-blue/30 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] text-accent-blue flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── INDUSTRIES SERVED ────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Regulated Industries</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Who This Is For</h2>
            <p className="text-text-secondary mt-4 max-w-xl mx-auto leading-relaxed">
              Shane's governance framework is built for organizations where compliance is an operating requirement, not an aspiration.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {INDUSTRIES.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-5">
                  <Icon className="w-5 h-5 text-accent-blue flex-shrink-0" />
                  <span className="text-text-primary text-sm leading-snug">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Credentials</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] hover:border-accent-blue/30 transition-all">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                  <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ASSESSMENT CTA ───────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-4">Free Assessment</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-4">
            Is Your M365 Tenant Ready for an Audit?
          </h2>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            Answer a short governance assessment covering DLP, sensitivity labeling, retention, and admin controls. Get a personalised compliance readiness score — no sales call required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/assessments?tab=free"
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
