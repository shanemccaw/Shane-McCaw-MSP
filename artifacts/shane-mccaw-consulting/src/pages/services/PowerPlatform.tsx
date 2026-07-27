import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";
import { CheckCircle, ArrowRight, ChevronRight, Zap, Building2, Shield, Users } from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const QUICK_START_DELIVERABLES = [
  "Requirements discovery workshop",
  "Solution architecture & data model",
  "One production-ready Power App or Power Automate flow",
  "Dataverse or SharePoint data structure",
  "Error handling & monitoring",
  "Documentation & handoff",
  "Governance alignment",
  "Live training session",
];

const WHAT_SHANE_DELIVERS = [
  "Power Apps for replacing spreadsheets and manual processes",
  "Power Automate workflows for approvals, notifications, and system integration",
  "Dataverse data modeling",
  "Integration with M365, Dynamics, Salesforce, ServiceNow",
  "Governance, DLP, and environment strategy",
  "Automation roadmap development",
  "Training & enablement",
];

const WHO_FOR = [
  { icon: Building2, label: "Mid-market organizations running repetitive processes in spreadsheets or email chains" },
  { icon: Shield, label: "Regulated industries needing governed automation with audit trails" },
  { icon: Zap, label: "IT leaders who want to enable citizen development without losing control" },
  { icon: Users, label: "Organizations whose Power Platform environment has grown without governance" },
];

const WHY_SHANE = [
  {
    title: "Governance Built In, Not Bolted On",
    desc: "Shane designs every Power Platform solution with DLP policies, environment strategy, and governance controls as part of the architecture — not as an afterthought.",
  },
  {
    title: "30-Day Delivery on Quick-Start Engagements",
    desc: "A scoped, production-ready Power App or Power Automate flow in 30 days. Week 1: requirements and architecture. Weeks 2–4: build, test, and handoff.",
  },
  {
    title: "NASA-Grade Automation Experience",
    desc: "Shane has built and governed Power Platform environments at NASA — where automation reliability wasn't optional and governance was enforced at the policy level.",
  },
  {
    title: "Enterprise Integrations",
    desc: "Dataverse, SharePoint, Dynamics 365, Salesforce, ServiceNow — Shane has built integrations across the full Microsoft and third-party ecosystem.",
  },
];

export default function PowerPlatform() {
  return (
    <Layout>
      <SEOMeta
        title="Power Platform & Automation Consulting | Shane McCaw Consulting"
        description="Power Platform consulting by Shane McCaw — Power Apps, Power Automate, Dataverse, and governance. Build production-ready automation with NASA-proven methodology."
        ogImage="/og-image-power-platform.png"
        ogUrl="https://shanemccawconsulting.com/services/power-platform"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Power Platform & Automation Consulting",
          "description": "Power Apps, Power Automate, and Dataverse consulting — governed automation built with NASA-proven methodology and a 30-day delivery model.",
          "url": "https://shanemccawconsulting.com/services/power-platform",
          "serviceType": "Power Platform Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Organizations looking to automate business processes using Microsoft Power Platform",
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
          <span className="text-text-primary font-medium">Power Platform</span>
        </div>
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 glass-panel text-text-primary text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Zap className="w-3.5 h-3.5 text-accent-blue" />
            Power Platform
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-text-primary mb-6 leading-tight">
            Power Platform & Automation — Production-Ready in 30 Days
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Most organizations are running critical processes on spreadsheets and email chains that could be automated. Shane builds governed Power Apps and Power Automate flows that actually make it to production.
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

      {/* ── WHY POWER PLATFORM IS UNDERUSED ─────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">Why Power Platform Projects Stall</h2>
            <p className="text-text-secondary leading-relaxed mb-5">
              Power Platform licenses are included in most Microsoft 365 plans. Most organizations know they're paying for it. Few are actually using it well — because building a production-ready solution is harder than the marketing suggests.
            </p>
            <p className="text-text-secondary leading-relaxed mb-5">
              Apps get started in someone's sandbox environment, demo well in a Teams call, and then stall before they make it to production. Governance is missing, error handling wasn't built in, and nobody planned for what happens when the person who built it leaves.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Shane builds solutions that go to production — with architecture documentation, error handling, governance alignment, and a handoff your IT team can maintain.
            </p>
          </div>
          <div>
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Quick-Start Deliverables</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary mb-6">What's Included in 30 Days</h2>
            <ul className="space-y-3">
              {QUICK_START_DELIVERABLES.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-text-primary">
                  <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Scope of Work</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-text-primary">What Shane Delivers</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {WHAT_SHANE_DELIVERS.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-charcoal-1 border border-white/[0.06] rounded-xl p-5">
                <CheckCircle className="w-5 h-5 text-accent-blue flex-shrink-0 mt-0.5" />
                <span className="text-text-primary text-sm leading-snug">{item}</span>
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
            Find Out How Ready Your Organization Is for Power Platform
          </h2>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            A short assessment covering automation maturity, governance readiness, and the highest-value use cases for your organization. Get personalised recommendations — no sales call required.
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
