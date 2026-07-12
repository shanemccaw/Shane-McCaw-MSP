import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, ArrowRight, Zap, Building2, Shield, Users } from "lucide-react";

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
  { icon: <Building2 className="w-5 h-5 text-[#0078D4]" />, label: "Mid-market organizations running repetitive processes in spreadsheets or email chains" },
  { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, label: "Regulated industries needing governed automation with audit trails" },
  { icon: <Zap className="w-5 h-5 text-[#0078D4]" />, label: "IT leaders who want to enable citizen development without losing control" },
  { icon: <Users className="w-5 h-5 text-[#0078D4]" />, label: "Organizations whose Power Platform environment has grown without governance" },
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

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-[172px] pb-20 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <Zap className="w-10 h-10 text-[#0078D4] mb-6" />
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Power Platform</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Power Platform & Automation — Production-Ready in 30 Days
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            Most organizations are running critical processes on spreadsheets and email chains that could be automated. Shane builds governed Power Apps and Power Automate flows that actually make it to production.
          </p>
          <div className="mt-10">
            <CTAButton href="/assessment">Start Your Free Assessment</CTAButton>
          </div>
        </div>
      </section>

      {/* ── WHY POWER PLATFORM IS UNDERUSED ─────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Problem</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">Why Power Platform Projects Stall</h2>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Power Platform licenses are included in most Microsoft 365 plans. Most organizations know they're paying for it. Few are actually using it well — because building a production-ready solution is harder than the marketing suggests.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-5">
                Apps get started in someone's sandbox environment, demo well in a Teams call, and then stall before they make it to production. Governance is missing, error handling wasn't built in, and nobody planned for what happens when the person who built it leaves.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Shane builds solutions that go to production — with architecture documentation, error handling, governance alignment, and a handoff your IT team can maintain.
              </p>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Quick-Start Deliverables</p>
              <h2 className="text-3xl font-extrabold text-[#0A2540] mb-6">What's Included in 30 Days</h2>
              <ul className="space-y-3">
                {QUICK_START_DELIVERABLES.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-foreground">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Scope of Work</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">What Shane Delivers</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {WHAT_SHANE_DELIVERS.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-white border border-border rounded-xl p-5">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] text-sm leading-snug">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR ─────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ideal Clients</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Who This Is For</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {WHO_FOR.map((item) => (
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
            Find Out How Ready Your Organization Is for Power Platform
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            A short assessment covering automation maturity, governance readiness, and the highest-value use cases for your organization. Get personalised recommendations — no sales call required.
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
