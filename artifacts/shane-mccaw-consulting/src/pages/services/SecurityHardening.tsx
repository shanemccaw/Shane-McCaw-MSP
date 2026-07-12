import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, Shield, Lock, Eye,
  AlertTriangle, Key, Server, Users, BarChart3,
} from "lucide-react";

const RISK_AREAS = [
  {
    icon: <Lock className="w-4 h-4" />,
    risk: "Identity & access misconfigurations",
    detail: "Legacy authentication still enabled, over-privileged service accounts, and no Conditional Access policies — the #1 breach vector in cloud environments.",
  },
  {
    icon: <Eye className="w-4 h-4" />,
    risk: "Overshared data and no DLP",
    detail: "Sensitive files accessible company-wide with no Data Loss Prevention policies — one misconfigured sharing link away from a compliance incident.",
  },
  {
    icon: <AlertTriangle className="w-4 h-4" />,
    risk: "Ignored Secure Score",
    detail: "Microsoft's built-in Secure Score surfaces critical gaps most tenants never address. Defaults are not safe defaults.",
  },
  {
    icon: <Server className="w-4 h-4" />,
    risk: "No audit logging or SIEM feed",
    detail: "Without unified audit logging, you cannot detect or reconstruct a breach — and regulators know it.",
  },
];

const DELIVERABLES = [
  { icon: <Shield className="w-4 h-4" />, text: "Full tenant security assessment against CIS M365 Foundations Benchmark" },
  { icon: <Key className="w-4 h-4" />, text: "Conditional Access policy design and implementation review" },
  { icon: <Lock className="w-4 h-4" />, text: "Privileged Identity Management (PIM) configuration and least-privilege audit" },
  { icon: <Eye className="w-4 h-4" />, text: "Data Loss Prevention policy review and gap analysis" },
  { icon: <BarChart3 className="w-4 h-4" />, text: "Microsoft Secure Score uplift roadmap with prioritized remediation actions" },
  { icon: <Users className="w-4 h-4" />, text: "Admin role rationalization and break-glass account hardening" },
  { icon: <Server className="w-4 h-4" />, text: "Audit log configuration and unified logging review" },
  { icon: <AlertTriangle className="w-4 h-4" />, text: "Written security hardening report and executive summary" },
];

const COMPLIANCE = ["HIPAA", "SOC 2", "CMMC", "ITAR", "FedRAMP", "FISMA"];

const WHY_SHANE = [
  {
    title: "NASA Security Architecture Experience",
    desc: "Shane served as Lead M365 Architect at NASA under FedRAMP High, FISMA, and ITAR requirements — some of the most demanding security mandates in any sector. He brings that rigor directly to your tenant.",
  },
  {
    title: "Misconfiguration Is the #1 Breach Vector",
    desc: "IBM's 2024 data confirms it: misconfiguration — not zero-day exploits — causes the majority of cloud breaches. Shane's assessment targets exactly these gaps before they become incidents.",
  },
  {
    title: "Fixed Scope, Clear Deliverables",
    desc: "A defined security hardening engagement with a clear deliverable set — assessment, roadmap, and report. You know what you're getting before you start.",
  },
  {
    title: "Practitioner, Not a Generalist",
    desc: "Shane doesn't subcontract or hand your project to a junior team. Every assessment, recommendation, and deliverable comes from 30 years of hands-on Microsoft ecosystem experience.",
  },
];

export default function SecurityHardening() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Security Hardening | Shane McCaw Consulting"
        description="Tenant security assessment and hardening for Microsoft 365 — built on NASA-proven methodology. Fix misconfigurations before they become breaches."
        ogUrl="https://shanemccawconsulting.com/services/security-hardening"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Security Hardening",
          "description": "Tenant security assessment targeting the misconfiguration gaps most responsible for cloud breaches — Conditional Access, PIM, DLP, Secure Score, and audit logging.",
          "url": "https://shanemccawconsulting.com/services/security-hardening",
          "serviceType": "Microsoft 365 Security Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market and regulated organizations with Microsoft 365 tenants",
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
      <section className="bg-[#0A2540] pt-[172px] pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 65% 0%, rgba(220,38,38,0.10) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-red-400 text-sm font-semibold uppercase tracking-[0.12em] mb-4">Security Hardening</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Security Hardening —<br className="hidden lg:block" /> Fix the Gaps Before They Become Breaches
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            Misconfiguration is the #1 cause of cloud breaches. A structured security assessment finds and prioritizes every exploitable gap in your M365 tenant.
          </p>
          <div className="mt-10">
            <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
          </div>
        </div>
      </section>

      {/* ── COST OF INACTION ─────────────────────────────────────────────── */}
      <section className="bg-white py-12">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="rounded-2xl bg-red-50 border border-red-200 p-8 flex flex-col md:flex-row md:items-center gap-8">
            <div className="flex-1 flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-shrink-0 text-center">
                <p className="text-5xl font-black text-red-600 leading-none tracking-tight">4.9M</p>
                <p className="text-sm font-bold text-red-500 uppercase tracking-widest mt-1">Avg Breach Cost (USD)</p>
              </div>
              <div className="border-l-0 md:border-l border-red-200 md:pl-6">
                <p className="text-xs font-bold text-red-500 uppercase tracking-widest mb-1">Cost of Inaction</p>
                <h3 className="text-lg font-extrabold text-red-900 mb-2">
                  The average cost of a breach where misconfiguration was the root cause.
                </h3>
                <p className="text-red-700 text-sm leading-relaxed">
                  Organizations with unaddressed M365 misconfigurations face an average breach cost of <strong>4.9 million USD</strong> — IBM Cost of a Data Breach Report 2024. Conditional Access gaps, over-privileged accounts, and missing DLP policies are not theoretical risks. They are the documented root causes of real incidents.
                </p>
                <p className="text-red-400 text-xs mt-2">Source: IBM Cost of a Data Breach Report 2024 — misconfiguration is the #1 breach vector.</p>
              </div>
            </div>
            <div className="flex-shrink-0">
              <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
            </div>
          </div>
        </div>
      </section>

      {/* ── INTRO ────────────────────────────────────────────────────────── */}
      <section className="bg-white pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">The Reality</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                Your Defaults Are Not Safe Defaults
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Microsoft 365 ships with powerful defaults, but out-of-the-box configurations are not hardened configurations. Legacy authentication remains enabled. Global admin counts drift upward. Sensitive files accumulate without DLP policies. Conditional Access is configured but riddled with gaps.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Most tenants don't discover these gaps through an internal audit — they discover them through a breach notification, a compliance audit finding, or a call from their cyber insurer.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Shane McCaw spent years hardening M365 environments at NASA under FedRAMP High, FISMA, and ITAR mandates. He applies the same structured methodology to mid-market tenants — before the incident, not after it.
              </p>
            </div>
            <div className="bg-[#F7F9FC] border border-border rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">Common Risk Areas</p>
              <div className="space-y-4">
                {RISK_AREAS.map((item) => (
                  <div key={item.risk} className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
                      {item.icon}
                    </div>
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

      {/* ── DELIVERABLES ─────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">What's Included</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                Every Assessment Covers Eight Control Domains
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                The assessment maps your tenant against the CIS Microsoft 365 Foundations Benchmark and Microsoft's own Secure Score framework — two of the most comprehensive security baselines available for M365 environments.
              </p>
              <ul className="space-y-4">
                {DELIVERABLES.map((item) => (
                  <li key={item.text} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center flex-shrink-0">
                      {item.icon}
                    </div>
                    <span className="text-[#0A2540] text-sm leading-relaxed pt-1.5">{item.text}</span>
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
                Shane's security methodology was built under FedRAMP High, FISMA, and ITAR requirements at NASA — the same rigor applies to every commercial engagement.
              </p>
              <div className="pt-2 border-t border-white/10">
                <p className="text-white/70 text-sm mb-1 font-semibold">Typical Engagement Timeline</p>
                <p className="text-white text-2xl font-black">2–3 Weeks</p>
                <p className="text-white/40 text-xs mt-1">Assessment + report + remediation roadmap delivery</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Clients</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who This Is For</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {[
              "Mid-market organizations (200–2,000 employees) on Microsoft 365",
              "Regulated industries — healthcare, legal, financial services, government contractors",
              "Organizations preparing for a SOC 2, HIPAA, or CMMC audit",
              "IT leaders who know their Secure Score is low but don't know where to start",
              "Companies enabling Copilot for M365 and needing a secure baseline first",
              "Organizations that have experienced a security incident and need a post-incident hardening review",
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
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
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
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-red-400 text-sm font-semibold uppercase tracking-[0.12em] mb-4">Don't Wait for an Incident</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6 max-w-2xl mx-auto">
            Find Your Gaps Before an Attacker Does
          </h2>
          <p className="text-white/60 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            A structured M365 security assessment starts with a free readiness check — answer 10 questions on identity, permissions, DLP, and audit logging to see where you stand.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
          </div>
        </div>
      </section>
    </Layout>
  );
}
