import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CheckCircle, ArrowRight, Clock, DollarSign, Shield, Users, Building2, Zap } from "lucide-react";
import { Link } from "wouter";
import { CTAButton } from "@/components/CTAButton";

const MICRO_OFFERS = [
  {
    name: "M365 Tenant Health Audit",
    price: "$4,500–$7,500",
    duration: "2 weeks",
    description:
      "A full diagnostic of the Microsoft 365 tenant: identity, access, licensing, security, compliance, Teams/SharePoint architecture, and governance maturity. Includes a 20–30 page report and a prioritized remediation roadmap.",
    icon: <Shield className="w-5 h-5" />,
  },
  {
    name: "Power Platform Quick-Start",
    price: "$6,000–$10,000",
    duration: "4 weeks",
    description:
      "Build one production-ready Power App or Power Automate flow, complete with documentation, governance guidance, and a handoff training session.",
    icon: <Zap className="w-5 h-5" />,
  },
  {
    name: "Governance Foundations Package",
    price: "$12,000–$18,000",
    duration: "6 weeks",
    description:
      "A complete Microsoft 365 governance framework: naming conventions, lifecycle policies, DLP, Teams/SharePoint governance, admin roles, and change management processes.",
    icon: <Building2 className="w-5 h-5" />,
  },
  {
    name: "Migration Readiness Assessment",
    price: "$3,500–$5,000",
    duration: "1 week",
    description:
      "A sprint-format assessment of migration blockers, risks, data classification, and network readiness. Includes a go/no-go recommendation and phased migration plan.",
    icon: <ArrowRight className="w-5 h-5" />,
  },
  {
    name: "Copilot for M365 Readiness Assessment",
    price: "$5,000–$8,000",
    duration: "2 weeks",
    description:
      "Evaluate data governance, sensitivity labels, SharePoint/OneDrive hygiene, identity sprawl, licensing, and change management readiness. Includes a phased rollout plan.",
    icon: <CheckCircle className="w-5 h-5" />,
  },
  {
    name: "Microsoft 365 Training & Enablement",
    price: "$3,000–$7,500",
    duration: "1–5 days",
    description:
      "Live, instructor-led training covering Outlook, Teams, SharePoint, OneDrive, Copilot, and Power Platform fundamentals. Includes recordings and resource packs.",
    icon: <Users className="w-5 h-5" />,
  },
];

const RETAINERS = [
  {
    name: "Architect Essentials",
    price: "$2,500",
    hours: "10 hrs/month",
    description:
      "For advisory, architecture reviews, roadmap validation, and escalation support.",
    highlight: false,
  },
  {
    name: "Architect Growth",
    price: "$6,000",
    hours: "25 hrs/month",
    description:
      "For ongoing roadmap execution, governance implementation, and IT team mentoring.",
    highlight: true,
  },
  {
    name: "Architect Enterprise",
    price: "$11,000",
    hours: "50 hrs/month",
    description:
      "For organizations needing embedded architecture leadership, governance ownership, and executive reporting.",
    highlight: false,
  },
];

const WHO_FOR = [
  { icon: <Building2 className="w-5 h-5 text-[#0078D4]" />, label: "Mid-market companies (200–2,000 employees)" },
  { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, label: "Healthcare, legal, financial services, and government contractors" },
  { icon: <Zap className="w-5 h-5 text-[#0078D4]" />, label: "Fast-growing startups needing enterprise-grade M365 architecture" },
  { icon: <Users className="w-5 h-5 text-[#0078D4]" />, label: "IT leaders who need senior-level expertise without a full-time hire" },
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
    desc: "You get 30 years of Microsoft ecosystem experience on call — without the overhead of a full-time senior hire. Fixed-price packages mean no billing surprises.",
  },
  {
    title: "Practitioner, Not a Generalist",
    desc: "Shane doesn't subcontract or hand your project to a junior team. He does the work himself, with direct accountability for every recommendation and implementation.",
  },
];

export default function Microsoft365() {
  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Architecture, Governance & Optimization | Shane McCaw Consulting"
        description="NASA-proven Microsoft 365 expertise for mid-market and regulated organizations. Fixed-price micro-offers and fractional architecture retainers from Lead M365 Architect Shane McCaw."
        ogUrl="https://shanemccawconsulting.com/services/microsoft-365"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Microsoft 365 Architecture, Governance & Optimization",
          "description": "Senior-level Microsoft 365 architecture, governance, and modernization services through fixed-price micro-offers and fractional retainers.",
          "url": "https://shanemccawconsulting.com/services/microsoft-365",
          "serviceType": "Microsoft 365 Consulting",
          "areaServed": { "@type": "Country", "name": "United States" },
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market and regulated organizations (200–2,000 employees)"
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com"
          },
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)"
        }} />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Microsoft 365 Services</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Microsoft 365 Architecture,<br className="hidden md:block" /> Governance &amp; Optimization
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            NASA-proven Microsoft 365 expertise for mid-market and regulated organizations.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Download M365 Services Overview <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Why It Matters</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
              Your Most Critical Business Platform Deserves Senior-Level Architecture
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Microsoft 365 is the operating system of the modern organization — email, identity, collaboration, compliance, and automation all run through it. Yet most deployments are under-configured, under-governed, and under-utilized.
            </p>
            <p className="text-muted-foreground text-lg leading-relaxed mt-4">
              Shane provides senior-level architecture, governance, and modernization services through fixed-price micro-offers and fractional architecture retainers — so you get NASA-grade expertise without the cost of a full-time hire.
            </p>
          </div>
        </div>
      </section>

      {/* ── MICRO-OFFER SUITE ────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Fixed-Price Engagements</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Micro-Offer Suite</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Scoped, delivered, and priced upfront. No retainer required to get started.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {MICRO_OFFERS.map((offer) => (
              <div
                key={offer.name}
                className="bg-white border border-border rounded-2xl p-6 flex flex-col gap-4 hover:border-[#0078D4]/40 hover:shadow-md transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center text-[#0078D4]">
                  {offer.icon}
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] text-base mb-1">{offer.name}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{offer.description}</p>
                </div>
                <div className="mt-auto pt-4 border-t border-border flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[#0A2540] font-bold text-sm">
                    <DollarSign className="w-3.5 h-3.5 text-[#0078D4]" />
                    {offer.price}
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    {offer.duration}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link
              href="/micro-offers"
              className="inline-flex items-center gap-2 text-[#0078D4] font-semibold hover:underline"
            >
              View all micro-offer packages <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── RETAINERS ────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ongoing Partnership</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Fractional M365 Architect Retainers</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Embedded architecture leadership on a monthly basis — strategy, governance, roadmap execution, and escalation support.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {RETAINERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl p-7 flex flex-col gap-5 border ${
                  tier.highlight
                    ? "bg-[#0A2540] border-[#0078D4]/40 shadow-xl"
                    : "bg-[#F7F9FC] border-border"
                }`}
              >
                {tier.highlight && (
                  <span className="self-start text-[10px] font-bold uppercase tracking-widest bg-[#0078D4] text-white px-2.5 py-1 rounded-full">
                    Most Popular
                  </span>
                )}
                <div>
                  <p className={`text-sm font-semibold mb-1 ${tier.highlight ? "text-white/60" : "text-muted-foreground"}`}>
                    {tier.name}
                  </p>
                  <div className="flex items-end gap-1">
                    <span className={`text-4xl font-extrabold ${tier.highlight ? "text-white" : "text-[#0A2540]"}`}>
                      {tier.price}
                    </span>
                    <span className={`text-base mb-1 ${tier.highlight ? "text-white/50" : "text-muted-foreground"}`}>/mo</span>
                  </div>
                  <p className={`text-sm font-semibold mt-1 ${tier.highlight ? "text-[#0078D4]" : "text-[#0078D4]"}`}>
                    {tier.hours}
                  </p>
                </div>
                <p className={`text-sm leading-relaxed flex-1 ${tier.highlight ? "text-white/70" : "text-muted-foreground"}`}>
                  {tier.description}
                </p>
                <CTAButton href="/book" className={`w-full justify-center text-sm py-2.5 ${!tier.highlight ? "bg-[#0A2540] hover:bg-[#0A2540]/90" : ""}`}>
                  Get Started
                </CTAButton>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-6">
            All retainers are month-to-month. Cancel anytime.{" "}
            <Link href="/pricing" className="text-[#0078D4] hover:underline font-medium">
              See full pricing →
            </Link>
          </p>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ideal Clients</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">Who This Is For</h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Shane works with organizations where Microsoft 365 is mission-critical and the cost of misconfiguration — a breach, a compliance gap, a failed migration — is unacceptable.
              </p>
              <ul className="space-y-4">
                {WHO_FOR.map((item) => (
                  <li key={item.label} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      {item.icon}
                    </div>
                    <span className="text-[#0A2540] font-medium text-sm">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">Compliance Coverage</p>
              <p className="text-white font-bold text-lg">Regulated industry? Shane's built for it.</p>
              <div className="grid grid-cols-2 gap-3">
                {["FedRAMP", "FISMA High", "ITAR", "GCC High", "HIPAA", "CMMC"].map((label) => (
                  <div key={label} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                    <span className="text-white text-sm font-semibold">{label}</span>
                  </div>
                ))}
              </div>
              <p className="text-white/50 text-xs leading-relaxed">
                Shane designed and maintained Microsoft 365 environments at NASA, one of the most compliance-intensive deployments in the U.S. federal government.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Credentials</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
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

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)"
        }} />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ready to Start?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Let's Talk About Your Microsoft 365 Environment
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            A free discovery call takes 30 minutes. You'll leave with clarity on where your tenant stands and what to do next.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/book" className="px-8 py-3.5 text-base">
              Book a Free Discovery Call
            </CTAButton>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-white/80 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              Download M365 Services Overview <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
    </Layout>
  );
}
