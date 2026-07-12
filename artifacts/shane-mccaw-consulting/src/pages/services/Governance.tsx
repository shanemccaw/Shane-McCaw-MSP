import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle, ArrowRight, Shield, Tag, Archive,
  Eye, Key, Users, Building2, Globe,
} from "lucide-react";

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
    desc: "A full Microsoft Purview sensitivity label taxonomy with auto-labeling policies — so data is classified correctly regardless of who created it or where it lives.",
  },
  {
    icon: <Archive className="w-5 h-5" />,
    title: "Retention & Records Management",
    desc: "Retention schedules aligned to your regulatory obligations. Content is kept for exactly as long as required — and disposed of on schedule, with a defensible audit trail.",
  },
  {
    icon: <Eye className="w-5 h-5" />,
    title: "Teams & SharePoint Governance",
    desc: "Site provisioning standards, lifecycle policies, Teams channel governance, and external sharing controls that prevent sprawl before it starts.",
  },
  {
    icon: <Key className="w-5 h-5" />,
    title: "Privileged Access Review",
    desc: "Global admin rationalization, service account audit, and Privileged Identity Management configuration — closing the identity gaps that cause the most breaches.",
  },
  {
    icon: <Users className="w-5 h-5" />,
    title: "Change Management",
    desc: "A governance operating model your IT team can own — with documented processes, escalation paths, and a playbook for handling exceptions without breaking policy.",
  },
];

const INDUSTRIES = [
  { icon: <Building2 className="w-5 h-5 text-[#0078D4]" />, label: "Healthcare & Life Sciences (HIPAA)" },
  { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, label: "Defense & Government Contractors (CMMC, ITAR)" },
  { icon: <Globe className="w-5 h-5 text-[#0078D4]" />, label: "Financial Services (SOX, FIN)" },
  { icon: <Users className="w-5 h-5 text-[#0078D4]" />, label: "Legal & Professional Services" },
  { icon: <Archive className="w-5 h-5 text-[#0078D4]" />, label: "Federal Agencies (FedRAMP, FISMA)" },
  { icon: <Eye className="w-5 h-5 text-[#0078D4]" />, label: "Any organization facing a SOC 2 or HIPAA audit" },
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

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-[172px] pb-20 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Governance & Compliance</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Governance, Compliance & Security
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            Regulated organizations can't run on out-of-the-box defaults. Shane builds the governance framework your compliance obligations require — DLP, sensitivity labels, retention schedules, lifecycle policies, and admin controls that actually hold.
          </p>
          <div className="mt-10">
            <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
          </div>
        </div>
      </section>

      {/* ── THE PROBLEM ──────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Reality</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">Microsoft 365 Defaults Are Not Compliant Defaults</h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Microsoft 365 ships with permissive defaults — external sharing enabled, DLP policies absent, retention unmanaged, and admin accounts over-privileged. For regulated industries, that's not an IT problem. It's a compliance liability.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Most organizations discover this during an audit — not a configuration review. By then, the gap is documented, the finding is in writing, and the remediation timeline is aggressive.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Shane builds governance frameworks before the audit — so your M365 environment reflects your actual compliance posture, not your aspirational one.
              </p>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">What's Included</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">Governance Foundations Package</h2>
              <ul className="space-y-3">
                {PACKAGE_INCLUDES.map((item, i) => (
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

      {/* ── WHAT DELIVERS ────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Deliverables</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Six Governance Capabilities</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              Each capability is implemented, documented, and tested — not just recommended.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {WHAT_DELIVERS.map((item) => (
              <div key={item.title} className="bg-white border border-border rounded-2xl p-6 hover:border-[#0078D4]/30 transition-all">
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center mb-4">
                  {item.icon}
                </div>
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── INDUSTRIES SERVED ────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Regulated Industries</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Who This Is For</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              Shane's governance framework is built for organizations where compliance is an operating requirement, not an aspiration.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {INDUSTRIES.map((item) => (
              <div key={item.label} className="flex items-start gap-3 bg-[#F7F9FC] border border-border rounded-xl p-5">
                {item.icon}
                <span className="text-[#0A2540] text-sm leading-snug">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Credentials</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
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
            ].map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-white transition-all">
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

      {/* ── ASSESSMENT CTA ───────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free Assessment</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 max-w-2xl mx-auto">
            Is Your M365 Tenant Ready for an Audit?
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            Answer a short governance assessment covering DLP, sensitivity labeling, retention, and admin controls. Get a personalised compliance readiness score — no sales call required.
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
