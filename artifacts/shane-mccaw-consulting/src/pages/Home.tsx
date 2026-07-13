import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle,
  ArrowRight,
  Shield,
  Search,
  Activity,
  Zap,
  Building2,
  Briefcase,
  Rocket,
  Star,
} from "lucide-react";

const trustPoints = [
  "Assessment engine built from NASA’s Microsoft 365 architecture standards",
  "Continuous monitoring detects configuration drift and governance erosion",
  "Signal-based findings mapped to fixed-price remediation projects",
  "Designed for MSP resale and multi-tenant oversight",
  "Delivered by the architect who secured NASA’s Copilot rollout",
];

const audienceSegments = [
  {
    icon: Building2,
    title: "Mid-Market Organizations",
    subtitle: "200–2,000 Employees",
    description:
      "You don’t need a full-time architect — you need clarity. Automated assessments and continuous monitoring keep your tenant governed without adding headcount.",
    color: "#0078D4",
  },
  {
    icon: Shield,
    title: "Regulated Industries",
    subtitle: "Healthcare · Legal · Financial · Federal Contractors",
    description:
      "Compliance frameworks demand continuous oversight. Monitoring ensures your Microsoft 365 environment stays aligned with governance and regulatory requirements.",
    color: "#00B4D8",
  },
  {
    icon: Rocket,
    title: "Startups & Scale-Ups",
    subtitle: "Rapid Growth · First-Time Architecture",
    description:
      "Scale safely without building a governance team. Automated assessments and monitoring provide guardrails as your tenant grows.",
    color: "#0A2540",
  },
];

export default function Home() {
  return (
    <Layout>
      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center bg-[#0A2540] overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(#0078D4 1px, transparent 1px),
              linear-gradient(90deg, #0078D4 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)",
          }}
        />

        <div className="relative z-10 max-w-[1200px] mx-auto px-6 py-32 pt-44 text-center">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              NASA-Grade Microsoft 365 Oversight
            </p>
          </div>

          {/* Headline */}
          <h1 className="text-4xl md:text-5xl lg:text-[3.75rem] font-extrabold text-white leading-[1.1] mb-5 max-w-5xl mx-auto">
            Automated Microsoft 365 assessments and continuous monitoring —
            built from NASA’s architecture standards.
          </h1>

          <p className="text-lg md:text-xl text-white/70 max-w-3xl mx-auto mb-12 leading-relaxed">
            Know exactly what’s happening inside your Microsoft 365 tenant.
            Assess it automatically. Monitor it continuously. Remediate issues
            with fixed-price clarity.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton
              href="/assessment"
              className="text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30"
              data-testid="hero-cta-primary"
            >
              Run Your Free Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-3.5 rounded-xl hover:border-white/40"
            >
              Explore Monitoring <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <p className="text-sm text-white/50 mt-3 text-center">
            No sales call. No commitment. Just clarity.
          </p>

          {/* Mini trust badges */}
          <div className="mt-14 pt-10 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
            {[
              "Automated Tenant Assessment",
              "Continuous Monitoring",
              "Signal-Based Findings",
              "Fixed-Price Remediation",
              "NASA Architecture Standards",
            ].map((badge, i) => (
              <span
                key={i}
                className="flex items-center gap-2"
                dangerouslySetInnerHTML={{
                  __html: `<svg class="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> ${badge}`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>
      {/* ── FUNNEL ───────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="funnel-strip">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              How It Works
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Assess. Monitor. Remediate.
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              A NASA-informed engine evaluates your tenant, monitors it
              continuously, and maps every finding to a fixed-price remediation
              project.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-[3.25rem] left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-0.5 bg-gradient-to-r from-[#0078D4] via-[#00B4D8] to-[#0A2540] opacity-20" />

            {[
              {
                step: "01",
                icon: Search,
                title: "Assess",
                color: "#0078D4",
                body: "Connect your tenant and receive a NASA-informed assessment covering governance, security, compliance, and Copilot readiness.",
                cta: { label: "Run Free Assessment", href: "/assessment" },
              },
              {
                step: "02",
                icon: Activity,
                title: "Monitor",
                color: "#00B4D8",
                body: "Continuous monitoring detects configuration drift, policy violations, licensing changes, and governance erosion.",
                cta: { label: "Explore Monitoring", href: "/monitoring" },
              },
              {
                step: "03",
                icon: Zap,
                title: "Remediate",
                color: "#0A2540",
                body: "Every finding maps to a fixed-price remediation project — delivered personally, with no retainers and no open-ended consulting.",
                cta: { label: "View Remediation Work", href: "/projects" },
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="flex flex-col items-center text-center"
                  data-testid={`funnel-step-${i}`}
                >
                  <div
                    className="w-24 h-24 rounded-2xl flex flex-col items-center justify-center mb-6 shadow-lg"
                    style={{ backgroundColor: item.color }}
                  >
                    <span className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-1">
                      {item.step}
                    </span>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-[#0A2540] mb-3">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-5 max-w-xs">
                    {item.body}
                  </p>
                  <Link
                    href={item.cta.href}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline underline-offset-2"
                  >
                    {item.cta.label} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {/* ── TRUST STRIP ─────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20" data-testid="trust-strip">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-[860px] mx-auto text-center mb-12">
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              Why This Engine
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6">
              Built From NASA’s Microsoft 365 Architecture Standards
            </h2>
            <p className="text-white/70 text-lg leading-relaxed mb-4">
              The assessment and monitoring engine is shaped by the same
              architectural discipline used to secure NASA’s Copilot rollout —
              now available to mid‑market organizations and MSPs.
            </p>
            <p className="text-white/70 text-lg leading-relaxed">
              Every signal, every finding, every remediation path is informed by
              real mission‑critical experience.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-1 gap-4 max-w-[860px] mx-auto mb-12">
            {trustPoints.map((point, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl px-6 py-4"
              >
                <CheckCircle className="w-5 h-5 text-[#00B4D8] mt-0.5" />
                <p className="text-white/80 text-sm leading-relaxed">{point}</p>
              </div>
            ))}
          </div>

          {/* Compliance badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
            {[
              "NASA Architecture Experience",
              "Copilot Safety & Governance",
              "Zero-Trust Alignment",
              "Secure-by-Design Principles",
            ].map((badge, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-5 py-2.5 text-white font-bold text-sm"
              >
                <Shield className="w-4 h-4 text-[#00B4D8]" />
                {badge}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[860px] mx-auto">
            {[
              { stat: "NASA", label: "Architecture Standard Source" },
              { stat: "24/7", label: "Continuous Monitoring" },
              { stat: "Fixed", label: "Price Remediation Projects" },
            ].map((item, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-xl p-6 text-center"
              >
                <div className="text-3xl font-extrabold text-[#00B4D8] mb-2">
                  {item.stat}
                </div>
                <div className="text-white/60 text-sm font-medium">
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* ── AUDIENCE FORK ─────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20" data-testid="audience-fork">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">
              Who This Is For
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Clarity for Every Microsoft 365 Tenant
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Automated assessments and continuous monitoring give every
              organization — mid‑market, regulated, or scaling — the oversight
              they’ve been missing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {audienceSegments.map((segment, i) => {
              const Icon = segment.icon;
              return (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-border p-8 flex flex-col hover:border-[#0078D4]/30 transition-colors"
                  data-testid={`audience-segment-${i}`}
                >
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center mb-5"
                    style={{ backgroundColor: `${segment.color}18` }}
                  >
                    <Icon
                      className="w-6 h-6"
                      style={{ color: segment.color }}
                    />
                  </div>
                  <h3 className="text-xl font-extrabold text-[#0A2540] mb-1">
                    {segment.title}
                  </h3>
                  <p
                    className="text-xs font-semibold uppercase tracking-widest mb-4"
                    style={{ color: segment.color }}
                  >
                    {segment.subtitle}
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed flex-1">
                    {segment.description}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-4 mt-6">
            <CTAButton href="/assessment" className="text-base px-10 py-4">
              Run Your Free Assessment
            </CTAButton>

            <p className="text-muted-foreground text-sm">
              Are you an MSP or Microsoft partner?{" "}
              <Link
                href="/msp"
                className="text-[#0078D4] font-semibold hover:underline underline-offset-2"
              >
                See our MSP program →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ─────────────────────────────────────── */}
      <section className="bg-white py-16" data-testid="social-proof">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-1 mb-4">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className="w-5 h-5 text-yellow-400 fill-yellow-400"
              />
            ))}
          </div>
          <blockquote className="text-xl md:text-2xl font-semibold text-[#0A2540] leading-snug mb-4">
            "The assessment showed risks we didn’t know existed — and the
            monitoring keeps us ahead of them."
          </blockquote>
          <p className="text-muted-foreground text-sm font-medium">
            — Director of IT, Mid‑Market Healthcare Organization
          </p>
        </div>
      </section>

      {/* ── FINAL CTA ───────────────────────────────────────── */}
      <section
        className="relative bg-[#0A2540] py-28 overflow-hidden"
        data-testid="final-cta-section"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative max-w-[860px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-widest mb-4">
            Free Tenant Assessment
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            See Your Microsoft 365 Risks — Before They Become Problems.
          </h2>
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Run a NASA-informed assessment, activate continuous monitoring, and
            get fixed‑price remediation when issues surface. No retainers. No
            ambiguity.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton
              href="/assessment"
              className="text-lg px-12 py-5"
              data-testid="final-cta-button"
            >
              Run Your Free Assessment
            </CTAButton>
            <Link
              href="/monitoring"
              className="inline-flex items-center gap-2 text-white/70 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Explore Monitoring <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <p className="mt-5 text-white/40 text-sm tracking-wide">
            No pitch. No obligation. Just clarity.
          </p>
        </div>
      </section>
    </Layout>
  );
}
