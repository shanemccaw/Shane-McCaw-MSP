import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, ChevronRight, Shield, Lock, Eye,
  AlertTriangle, Key, Server, Users, BarChart3,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const RISK_AREAS = [
  {
    icon: Lock,
    risk: "Identity & access misconfigurations",
    detail: "Legacy authentication still enabled, over-privileged service accounts, and no Conditional Access policies — the #1 breach vector in cloud environments.",
  },
  {
    icon: Eye,
    risk: "Overshared data and no DLP",
    detail: "Sensitive files accessible company-wide with no Data Loss Prevention policies — one misconfigured sharing link away from a compliance incident.",
  },
  {
    icon: AlertTriangle,
    risk: "Ignored Secure Score",
    detail: "Microsoft's built-in Secure Score surfaces critical gaps most tenants never address. Defaults are not safe defaults.",
  },
  {
    icon: Server,
    risk: "No audit logging or SIEM feed",
    detail: "Without unified audit logging, you cannot detect or reconstruct a breach — and regulators know it.",
  },
];

const DELIVERABLES = [
  { icon: Shield, text: "Full tenant security assessment against CIS M365 Foundations Benchmark" },
  { icon: Key, text: "Conditional Access policy design and implementation review" },
  { icon: Lock, text: "Privileged Identity Management (PIM) configuration and least-privilege audit" },
  { icon: Eye, text: "Data Loss Prevention policy review and gap analysis" },
  { icon: BarChart3, text: "Microsoft Secure Score uplift roadmap with prioritized remediation actions" },
  { icon: Users, text: "Admin role rationalization and break-glass account hardening" },
  { icon: Server, text: "Audit log configuration and unified logging review" },
  { icon: AlertTriangle, text: "Written security hardening report and executive summary" },
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

      {/* Breadcrumb */}
      <div className="border-b border-white/[0.06] pt-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/services" className="hover:text-accent-blue transition-colors">Services</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">Security Hardening</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Shield className="w-3.5 h-3.5 text-red-400" />
            Security Hardening
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Microsoft 365 Security Hardening — Fix the Gaps Before They Become Breaches
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Misconfiguration is the #1 cause of cloud breaches. A structured security assessment finds and prioritizes every exploitable gap in your M365 tenant.
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

      {/* ── COST OF INACTION ─────────────────────────────────────────────── */}
      <section className="py-8 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-8 flex flex-col md:flex-row md:items-center gap-8">
            <div className="flex-1 flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-shrink-0 text-center">
                <p className="font-numeric text-5xl font-black text-red-400 leading-none tracking-tight">4.9M</p>
                <p className="text-sm font-bold text-red-400/80 uppercase tracking-widest mt-1">Avg Breach Cost (USD)</p>
              </div>
              <div className="border-l-0 md:border-l border-red-500/20 md:pl-6">
                <p className="text-xs font-bold text-red-400/80 uppercase tracking-widest mb-1">Cost of Inaction</p>
                <h3 className="font-display text-lg font-extrabold text-text-primary mb-2">
                  The average cost of a breach where misconfiguration was the root cause.
                </h3>
                <p className="text-text-secondary text-sm leading-relaxed">
                  Organizations with unaddressed M365 misconfigurations face an average breach cost of <strong className="text-text-primary">4.9 million USD</strong> — IBM Cost of a Data Breach Report 2024. Conditional Access gaps, over-privileged accounts, and missing DLP policies are not theoretical risks. They are the documented root causes of real incidents.
                </p>
                <p className="text-red-400/60 text-xs mt-2">Source: IBM Cost of a Data Breach Report 2024 — misconfiguration is the #1 breach vector.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── INTRO ────────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-4">The Reality</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">
              Your Defaults Are Not Safe Defaults
            </h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Microsoft 365 ships with powerful defaults, but out-of-the-box configurations are not hardened configurations. Legacy authentication remains enabled. Global admin counts drift upward. Sensitive files accumulate without DLP policies. Conditional Access is configured but riddled with gaps.
            </p>
            <p className="text-text-secondary leading-relaxed mb-4">
              Most tenants don't discover these gaps through an internal audit — they discover them through a breach notification, a compliance audit finding, or a call from their cyber insurer.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Shane McCaw spent years hardening M365 environments at NASA under FedRAMP High, FISMA, and ITAR mandates. He applies the same structured methodology to mid-market tenants — before the incident, not after it.
            </p>
          </div>
          <div className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-8 space-y-5">
            <p className="text-accent-blue text-xs font-bold uppercase tracking-widest">Common Risk Areas</p>
            <div className="space-y-4">
              {RISK_AREAS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.risk} className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-text-primary text-sm">{item.risk}</p>
                      <p className="text-text-secondary text-sm leading-relaxed">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── DELIVERABLES ─────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-4">What's Included</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">
              Every Assessment Covers Eight Control Domains
            </h2>
            <p className="text-text-secondary leading-relaxed mb-8">
              The assessment maps your tenant against the CIS Microsoft 365 Foundations Benchmark and Microsoft's own Secure Score framework — two of the most comprehensive security baselines available for M365 environments.
            </p>
            <ul className="space-y-4">
              {DELIVERABLES.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.text} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] text-accent-blue flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-text-primary text-sm leading-relaxed pt-1.5">{item.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-8 space-y-5">
            <p className="text-accent-blue text-xs font-bold uppercase tracking-widest">Compliance Coverage</p>
            <p className="text-text-primary font-display font-bold text-lg">Built for regulated environments.</p>
            <div className="grid grid-cols-2 gap-3">
              {COMPLIANCE.map((label) => (
                <div key={label} className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-lg px-4 py-2.5">
                  <CheckCircle className="w-4 h-4 text-accent-blue flex-shrink-0" />
                  <span className="text-text-primary text-sm font-semibold">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-text-secondary text-xs leading-relaxed">
              Shane's security methodology was built under FedRAMP High, FISMA, and ITAR requirements at NASA — the same rigor applies to every commercial engagement.
            </p>
            <div className="pt-2 border-t border-white/[0.08]">
              <p className="text-text-secondary text-sm mb-1 font-semibold">Typical Engagement Timeline</p>
              <p className="font-numeric text-text-primary text-2xl font-black">2–3 Weeks</p>
              <p className="text-text-secondary/60 text-xs mt-1">Assessment + report + remediation roadmap delivery</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Clients</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Who This Is For</h2>
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
              <div key={item} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-5">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-text-primary text-sm leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.12em] mb-3">Credentials</p>
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
          <p className="text-red-400 text-sm font-semibold uppercase tracking-[0.12em] mb-4">Don't Wait for an Incident</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-6">
            Find Your Gaps Before an Attacker Does
          </h2>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            A structured M365 security assessment starts with a free readiness check — answer 10 questions on identity, permissions, DLP, and audit logging to see where you stand.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
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
