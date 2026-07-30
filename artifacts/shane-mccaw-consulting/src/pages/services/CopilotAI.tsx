import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import {
  CheckCircle, ArrowRight, ChevronRight, Bot, Database, Shield, Eye,
  Key, Users, Map, Target, BarChart3,
} from "lucide-react";
import { useServices } from "@/hooks/useServices";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const READINESS_AREAS = [
  { icon: Database, text: "Data governance and sensitivity labeling maturity assessment" },
  { icon: Shield, text: "SharePoint & OneDrive hygiene review" },
  { icon: Eye, text: "Identity & permission sprawl analysis" },
  { icon: Key, text: "Licensing readiness validation" },
  { icon: Users, text: "Change management capacity evaluation" },
  { icon: Map, text: "Phased Copilot rollout roadmap" },
  { icon: Target, text: "Pilot group recommendations" },
  { icon: BarChart3, text: "Success metrics and adoption plan" },
];

const WHO_FOR = [
  "Organizations evaluating Copilot readiness before enabling any licenses",
  "Companies that enabled Copilot licenses but adoption never took off",
  "Regulated industries needing a governance-safe rollout, not a rushed one",
  "IT leaders who suspect oversharing or permission sprawl will surface through Copilot",
];

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
  // {{db.assessments.list}}
  const { services } = useServices({ category: "assessment" });
  const assessment = services.find((s) => s.name === "Copilot Readiness Snapshot");
  const assessmentHref = assessment
    ? `/assessments/${encodeURIComponent(assessment.slug ?? String(assessment.id))}`
    : "/assessments?tab=free";

  return (
    <Layout>
      <SEOMeta
        title="Copilot for Microsoft 365 Readiness & Governance | Shane McCaw Consulting"
        description="Copilot for Microsoft 365 readiness and rollout consulting by Shane McCaw — NASA Copilot SME. Fix data oversharing and governance gaps before Copilot surfaces them."
        ogUrl="https://shanemccawconsulting.com/services/copilot-ai"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Copilot for Microsoft 365 Readiness & Governance",
          "description": "Copilot for Microsoft 365 readiness assessment and governance-first rollout planning — data hygiene, permission scoping, and adoption strategy before licenses go live.",
          "url": "https://shanemccawconsulting.com/services/copilot-ai",
          "serviceType": "Copilot for Microsoft 365 Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Organizations evaluating or rolling out Copilot for Microsoft 365",
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
          <span className="text-text-primary font-medium">Copilot &amp; AI</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Bot className="w-3.5 h-3.5 text-accent-blue" />
            Copilot &amp; AI
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Copilot for Microsoft 365 — Ready Before You Roll It Out
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Copilot surfaces whatever your tenant already has access to — including the oversharing and permission sprawl nobody's gotten around to fixing. Shane finds and closes those gaps before licenses go live, not after.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={assessmentHref}
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
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">
              Copilot Doesn't Create Oversharing — It Exposes It
            </h2>
            <p className="text-text-secondary leading-relaxed mb-5">
              Most organizations enable Copilot licenses expecting a productivity boost, and instead surface years of accumulated permission sprawl: files shared broadly with no sensitivity labels, stale group memberships, and content nobody remembers exists. Copilot doesn't cause this — it just makes it visible to every user who asks the right question.
            </p>
            <p className="text-text-secondary leading-relaxed">
              A rushed rollout without a governance-first readiness pass turns Copilot from a productivity win into a compliance incident. Shane runs the readiness assessment first, so the rollout doesn't become the discovery process.
            </p>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">What's Assessed</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">Eight Readiness Dimensions</h2>
            <ul className="space-y-3">
              {READINESS_AREAS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.text} className="flex items-start gap-3 text-text-primary text-sm">
                    <Icon className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                    <span>{item.text}</span>
                  </li>
                );
              })}
            </ul>
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
            {WHO_FOR.map((item) => (
              <div key={item} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-5">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-text-primary text-sm leading-snug">{item}</span>
              </div>
            ))}
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
            Find Out If Your Tenant Is Ready for Copilot
          </h2>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            A short assessment covering data governance, permission sprawl, and licensing readiness. Get a personalised readiness score and rollout roadmap — no sales call required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={assessmentHref}
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
