import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle, ArrowRight, Shield, Database, Eye,
  Key, Users, Map, Target, BarChart3,
} from "lucide-react";

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
    desc: "Shane served as Subject Matter Expert for Copilot for Microsoft 365 at NASA — one of the most security-sensitive and compliance-intensive federal environments in the US. He's not studying the technology; he's deployed it at scale.",
  },
  {
    title: "Governance-First Methodology",
    desc: "Copilot surfaces whatever your tenant already contains — ungoverned files, overshared data, and over-permissioned accounts become visible and risky. Shane's approach fixes the foundation before the AI sees it.",
  },
  {
    title: "No Pre-Sales Framing",
    desc: "Shane's readiness assessment is designed to give you an honest picture of where you stand — not to sell you the next engagement. If you're not ready, he'll tell you and explain why.",
  },
  {
    title: "Compliance Coverage",
    desc: "Copilot readiness for regulated industries requires mapping AI usage against your existing compliance obligations. Shane has worked under FedRAMP High, FISMA, ITAR, HIPAA, and CMMC requirements.",
  },
];

export default function CopilotAI() {
  return (
    <Layout>
      <SEOMeta
        title="Copilot for Microsoft 365 Readiness & Deployment | Shane McCaw Consulting"
        description="Copilot for Microsoft 365 readiness assessment and deployment planning by Shane McCaw — NASA Copilot SME. Ensure your tenant is safe, compliant, and ready before you enable AI."
        ogImage="/og-image-copilot.png"
        ogUrl="https://shanemccawconsulting.com/services/copilot-ai"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Copilot for Microsoft 365 Readiness & Deployment",
          "description": "Copilot for Microsoft 365 readiness assessment and safe deployment planning — governance-first, compliance-aware, built on NASA-proven methodology.",
          "url": "https://shanemccawconsulting.com/services/copilot-ai",
          "serviceType": "Copilot for Microsoft 365 Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Organizations evaluating or deploying Copilot for Microsoft 365",
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
          style={{ background: "radial-gradient(ellipse 900px 500px at 65% 0%, rgba(0,120,212,0.14) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Copilot for Microsoft 365</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Copilot for Microsoft 365 — Readiness, Deployment & Governance
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            Copilot isn't plug-and-play. It surfaces whatever your tenant already contains. Before you enable AI, your data governance, identity posture, and compliance controls need to be ready.
          </p>
          <div className="mt-10">
            <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
          </div>
        </div>
      </section>

      {/* ── COST OF INACTION ─────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">The Risk</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">
                Copilot Isn't Plug-and-Play — It Amplifies Whatever You Already Have
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Copilot for Microsoft 365 respects your existing permissions — which means it can surface sensitive files that users have implicit access to but weren't aware of. Over-shared SharePoint sites, legacy permission chains, and weak DLP controls become an AI accessibility problem the moment Copilot is enabled.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Organizations that skip the readiness step tend to discover these gaps through an awkward Copilot response that surfaces confidential data — not through a structured remediation process.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The fix isn't to delay Copilot indefinitely. It's to run a structured readiness assessment, identify the gaps that create risk, remediate the high-priority items, and deploy with confidence.
              </p>
            </div>
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                <p className="text-amber-700 text-xs font-bold uppercase tracking-widest mb-2">Common Gap</p>
                <p className="text-amber-900 font-bold mb-1">Over-permissioned SharePoint Sites</p>
                <p className="text-amber-800 text-sm leading-relaxed">Users have implicit read access to dozens of sites they've never visited. Copilot can summarize documents from all of them.</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                <p className="text-amber-700 text-xs font-bold uppercase tracking-widest mb-2">Common Gap</p>
                <p className="text-amber-900 font-bold mb-1">Missing Sensitivity Labels</p>
                <p className="text-amber-800 text-sm leading-relaxed">Without sensitivity classification, Copilot has no way to treat confidential HR documents differently from general company files.</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                <p className="text-amber-700 text-xs font-bold uppercase tracking-widest mb-2">Common Gap</p>
                <p className="text-amber-900 font-bold mb-1">No Change Management Plan</p>
                <p className="text-amber-800 text-sm leading-relaxed">Copilot licenses go unused — or get misused — when there's no adoption plan, training, or governance around expected behaviours.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ASSESSMENT INCLUDES ──────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Assessment Scope</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">
                What a Copilot Readiness Assessment Covers
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Shane's readiness assessment maps your tenant against the eight dimensions that determine whether Copilot is safe to enable — and identifies the specific gaps that need to be closed first.
              </p>
              <ul className="space-y-3">
                {ASSESSMENT_INCLUDES.map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center flex-shrink-0">
                      {item.icon}
                    </div>
                    <span className="text-foreground text-sm">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-3">Compliance Coverage</p>
              <p className="text-white font-bold text-lg mb-5">Built for regulated environments.</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {COMPLIANCE.map((label) => (
                  <div key={label} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                    <span className="text-white text-sm font-semibold">{label}</span>
                  </div>
                ))}
              </div>
              <p className="text-white/50 text-xs leading-relaxed">
                Shane's Copilot readiness methodology was built under FedRAMP High, FISMA, and ITAR requirements at NASA — the same rigor applies to every commercial engagement.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR ─────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Clients</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Who This Is For</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {[
              "Organizations evaluating Copilot for M365 licenses and unsure if their tenant is ready",
              "IT leaders whose Copilot rollout stalled after early pilots surfaced unexpected results",
              "Regulated industries — healthcare, legal, finance, government contractors — where data governance must be airtight before AI is enabled",
              "Organizations that purchased Copilot but haven't enabled it due to concerns about data exposure",
              "MSPs or IT departments managing Copilot readiness across multiple client tenants",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 bg-[#F7F9FC] border border-border rounded-xl p-5">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] text-sm leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Credentials</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
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
            Is Your Tenant Ready for Copilot? Find Out in 5 Minutes.
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            Answer a short assessment covering data governance, identity posture, licensing, and compliance readiness. Get a personalised Copilot readiness score and recommended next steps — no sales call required.
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
