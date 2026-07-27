import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, ChevronRight, Shield, Users, Building2, Zap,
} from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const WHO_FOR = [
  { icon: Building2, label: "Mid-market companies (200–2,000 employees)" },
  { icon: Shield, label: "Healthcare, legal, financial services, and government contractors" },
  { icon: Zap, label: "Fast-growing startups needing enterprise-grade M365 architecture" },
  { icon: Users, label: "IT leaders who need senior-level expertise without a full-time hire" },
];

const WHY_SHANE = [
  {
    title: "NASA-Scale Experience",
    desc: "Shane served as Lead Microsoft 365 Architect at NASA — one of the most complex, security-sensitive M365 environments in the world. That discipline applies directly to your organization.",
  },
  {
    title: "Compliance-First Architecture",
    desc: "Deep expertise in FedRAMP, FISMA High, ITAR, and GCC High requirements. Shane designs environments that satisfy the strictest regulatory frameworks without sacrificing usability.",
  },
  {
    title: "Senior-Level Delivery, Fractional Cost",
    desc: "You get 30 years of Microsoft ecosystem experience on call — without the overhead of a full-time senior hire.",
  },
  {
    title: "Practitioner, Not a Generalist",
    desc: "Shane doesn't subcontract or hand your project to a junior team. He does the work himself, with direct accountability for every recommendation and implementation.",
  },
];

const PROBLEMS = [
  "Teams and SharePoint sprawl — hundreds of ungoverned sites and teams",
  "Overshared content with no sensitivity labels or DLP policies",
  "Excessive global admins and over-privileged service accounts",
  "Legacy authentication still enabled, bypassing Conditional Access",
  "No retention or deletion policies — rising compliance exposure",
  "No lifecycle governance — expired groups persist indefinitely",
  "No provisioning standards — every team is configured differently",
  "No security baselines — Secure Score ignored, defaults left in place",
];

const WHAT_YOU_GET = [
  "A governed tenant with documented policies and enforced standards",
  "A secure identity plane — MFA, Conditional Access, PIM in place",
  "A compliant data estate — sensitivity labels, DLP, and retention active",
  "A rationalized Teams and SharePoint architecture with a provisioning model",
  "A modernized security posture aligned to your regulatory requirements",
  "A prioritized remediation roadmap you can hand to your IT team",
  "A clear operating model so governance doesn't drift again",
];

const SCOPE_OF_WORK = [
  { title: "Identity & Access Architecture", desc: "Azure AD, MFA, Conditional Access, Privileged Identity Management — the identity plane that everything else depends on." },
  { title: "Data Governance & DLP", desc: "Sensitivity labels, Data Loss Prevention policies, retention schedules, and Microsoft Purview configuration." },
  { title: "Teams & SharePoint Governance", desc: "Provisioning standards, lifecycle policies, naming conventions, permissions scoping, and external sharing controls." },
  { title: "Security Baseline & Secure Score", desc: "CIS M365 Benchmark alignment, Secure Score uplift roadmap, and admin role rationalization." },
  { title: "Compliance Alignment", desc: "HIPAA, CMMC, SOX, FIN, ITAR, and FedRAMP mapping — for regulated industries that need defensible configurations." },
  { title: "Roadmap & Documentation", desc: "A prioritized remediation roadmap and governance playbook your IT team can own and maintain long after the engagement ends." },
];

export default function Microsoft365() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Architecture & Governance | Shane McCaw Consulting"
        description="Microsoft 365 architecture, governance, and security consulting by Shane McCaw — Lead M365 Architect at NASA. Fix tenant sprawl, oversharing, and compliance gaps."
        ogImage="/og-image-m365.png"
        ogUrl="https://shanemccawconsulting.com/services/microsoft-365"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Architecture & Governance",
          "description": "Microsoft 365 architecture, governance, and security consulting — fixing tenant sprawl, identity gaps, and compliance risk for regulated organizations.",
          "url": "https://shanemccawconsulting.com/services/microsoft-365",
          "serviceType": "Microsoft 365 Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market and regulated organizations on Microsoft 365",
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
          <span className="text-text-primary font-medium">Microsoft 365 Architecture</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Shield className="w-3.5 h-3.5 text-accent-blue" />
            Microsoft 365 Architecture
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Microsoft 365 Architecture, Governance & Optimization
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            NASA-grade discipline applied to your Microsoft 365 tenant. Fix sprawl, close compliance gaps, and build an architecture that scales — delivered by a 30-year Microsoft ecosystem veteran.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/assessment"
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
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">What Happens Without Architecture</h2>
            <p className="text-text-secondary leading-relaxed mb-6">
              Most Microsoft 365 tenants were deployed quickly and never architected properly. Years later, the sprawl is real: ungoverned Teams, over-shared files, excessive admin accounts, and compliance policies that exist on paper but aren't enforced in the tenant.
            </p>
            <p className="text-text-secondary leading-relaxed mb-8">
              IT leaders know the risks but lack the time, depth, or regulatory expertise to fix it. That's where Shane comes in.
            </p>
            <ul className="space-y-2.5">
              {PROBLEMS.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary text-sm">
                  <span className="w-4 h-4 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold">!</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Outcome</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">What a Governed Tenant Looks Like</h2>
            <ul className="space-y-3">
              {WHAT_YOU_GET.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary">
                  <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── SCOPE OF WORK ────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Scope of Work</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">What Shane Covers</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {SCOPE_OF_WORK.map((item) => (
              <div key={item.title} className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-6 hover:border-accent-blue/30 transition-all">
                <h3 className="font-display font-bold text-text-primary mb-2">{item.title}</h3>
                <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR ─────────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ideal Clients</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">Who This Is For</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {WHO_FOR.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-5">
                  <Icon className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
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
            Find Out Where Your M365 Tenant Stands — in 5 Minutes
          </h2>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            Answer a short assessment covering identity, data governance, security posture, and compliance readiness. You'll receive a personalised score and recommended next steps — no sales call required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/assessment"
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
