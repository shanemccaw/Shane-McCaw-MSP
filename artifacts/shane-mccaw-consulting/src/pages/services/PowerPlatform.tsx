import { useState } from "react";
import { ServiceOverviewModal } from "@/components/ServiceOverviewModal";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { RetainerCard } from "@/components/RetainerCard";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { CheckCircle, ArrowRight, Zap, Building2, Shield, Users } from "lucide-react";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";
import { FollowOnProjects } from "@/components/FollowOnProjects";
import FixedPriceOfferCard from "@/components/FixedPriceOfferCard";

const comparisonRows = [
  {
    label: "Best For",
    quickStart: "Organizations with a specific automation or app use case ready to scope and build",
    governance: "Organizations needing governance structure before scaling Power Platform across the business",
    retainer: "Organizations running ongoing Power Platform programs that need embedded senior architect oversight",
  },
  {
    label: "Scope",
    quickStart: "One fully built, production-ready Power App or Power Automate flow — scoped in week 1",
    governance: "M365 and Power Platform governance framework — DLP, environment strategy, lifecycle policies, naming conventions",
    retainer: "Embedded advisory: roadmap execution, governance monitoring, IT team mentoring, escalation support",
  },
  {
    label: "Timeline",
    quickStart: "4 weeks (30-day delivery)",
    governance: "6 weeks",
    retainer: "Ongoing — month-to-month",
  },
  {
    label: "Price",
    quickStart: "$6,000–$10,000",
    governance: "$12,000–$18,000",
    retainer: "$2,500 / $6,000 / $11,000 per month",
  },
  {
    label: "Key Deliverables",
    quickStart: "Production-ready solution, architecture documentation, error handling, monitoring, training session, governance alignment",
    governance: "Governance playbook, DLP rules, environment strategy, naming conventions, lifecycle policies, change management process",
    retainer: "Monthly advisory hours, architecture reviews, governance monitoring, roadmap execution, executive reporting",
  },
  {
    label: "Ongoing Support",
    quickStart: "One-time engagement — can follow up with a governance package or retainer to scale further",
    governance: "One-time engagement — positions the organization to scale Power Platform safely and sustainably",
    retainer: "Continuous — cancel or adjust tier with 30-day notice",
  },
];

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
  {
    icon: <Building2 className="w-5 h-5 text-[#0078D4]" />,
    label: "Mid-market organizations (200–2,000 employees)",
  },
  {
    icon: <Shield className="w-5 h-5 text-[#0078D4]" />,
    label: "Regulated industries requiring enterprise-grade automation",
  },
  {
    icon: <Zap className="w-5 h-5 text-[#0078D4]" />,
    label: "Companies needing production-ready solutions — not proof-of-concepts",
  },
  {
    icon: <Users className="w-5 h-5 text-[#0078D4]" />,
    label: "IT leaders who need senior-level expertise without a full-time hire",
  },
];

const WHY_SHANE = [
  {
    title: "NASA-Proven Experience",
    desc: "Shane built and governed Power Platform automation at NASA — one of the most complex, compliance-intensive environments in the federal government. That discipline transfers directly to your organization.",
  },
  {
    title: "Enterprise Automation Expertise",
    desc: "30 years in the Microsoft ecosystem means Shane knows where automation initiatives fail. He designs solutions that survive governance audits, scale with your organization, and actually get adopted.",
  },
  {
    title: "Governance Discipline",
    desc: "Every engagement includes governance alignment — DLP policies, environment strategy, and admin controls — so your Power Platform investment doesn't create technical debt or compliance exposure.",
  },
  {
    title: "Production-Ready Delivery",
    desc: "Shane doesn't build demos. Every solution is delivered with error handling, monitoring, documentation, and training — ready for real users on day one.",
  },
];


export default function PowerPlatform() {
  const { services, loading } = useServices();
  const { services: retainerServices, loading: retainerLoading } = useServices("retainer");
  const quickStartSvc = services.find((s) => s.slug === "power-platform-quickstart");
  const govSvc = services.find((s) => s.slug === "governance-foundations-package");
  const skeleton = <span className="inline-block w-28 h-4 bg-gray-200 rounded animate-pulse align-middle" />;
  const livePrice = (svc: typeof services[0] | undefined, fallback: string) =>
    loading ? skeleton : svc ? formatPriceDisplay(svc) : fallback;
  const tablePrices = {
    quickStart: livePrice(quickStartSvc, "$6,000–$10,000"),
    governance: livePrice(govSvc, "$12,000–$18,000"),
    retainer: "$2,500 / $6,000 / $11,000 per month",
  };
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Layout>
      <SEOMeta
        title="Power Platform & Automation Consulting | Shane McCaw Consulting"
        description="NASA-proven Power Apps and Power Automate consulting for mid-market and regulated organizations. Build production-ready automation solutions in weeks, not months."
        ogImage="/og-image-power-platform.png"
        ogUrl="https://shanemccawconsulting.com/services/power-platform"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "Power Platform & Automation Consulting",
          "description": "NASA-proven Power Apps and Power Automate consulting for mid-market and regulated organizations. Build production-ready automation solutions in weeks, not months.",
          "url": "https://shanemccawconsulting.com/services/power-platform",
          "serviceType": "Power Platform Consulting",
          "areaServed": {
            "@type": "Country",
            "name": "United States",
          },
          "audience": {
            "@type": "Audience",
            "audienceType": "Mid-market and regulated organizations (200–2,000 employees)",
          },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com",
          },
          "offers": [
            {
              "@type": "Offer",
              "name": "Power Platform Quick-Start",
              "priceSpecification": {
                "@type": "PriceSpecification",
                "minPrice": "6000",
                "maxPrice": "10000",
                "priceCurrency": "USD",
              },
              "url": "https://shanemccawconsulting.com/services/power-platform",
            },
          ],
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
            Power Platform Services
          </p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Power Platform & Automation Consulting — Build Real Business Tools in Weeks
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            NASA-proven Power Apps and Power Automate expertise for mid-market and regulated organizations. Production-ready solutions — not proof-of-concepts.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <CTAButton href="/book">Book a Free Discovery Call</CTAButton>
            <a
              href="/crm/portal/onboarding/select?service=power-platform-quickstart"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </a>
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm"
            >
              Download Power Platform Overview <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ── INTRO ────────────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
              Why It Matters
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
              Most Organizations Underuse Power Platform — Here's Why
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Power Apps and Power Automate are among the most powerful tools in the Microsoft 365 ecosystem. Yet most organizations build fragile proof-of-concepts that never reach production, or create automation sprawl without governance — creating new problems faster than they solve old ones.
            </p>
            <p className="text-muted-foreground text-lg leading-relaxed mt-4">
              The gap isn't enthusiasm — it's architecture and governance expertise. Shane brings 30 years of Microsoft ecosystem experience to every engagement, ensuring every solution is built for real-world scale, compliance, and longevity from day one.
            </p>
          </div>
        </div>
      </section>

      {/* ── QUICK-START OFFER ────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Fixed-Price Engagement
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Power Platform Quick&#8209;Start
            </h2>
          </div>
          <FixedPriceOfferCard slug="power-platform-quickstart" ctaLabel="Get Started" />
        </div>
      </section>

      {/* ── OPTIONAL FOLLOW-ONS ──────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Optional Follow-On Engagements
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              Continue the Partnership
            </h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              After your Quick-Start, organizations that want to scale their Power Platform investment can choose from these follow-on options.
            </p>
          </div>

          {/* Governance Foundations */}
          <div className="max-w-3xl mx-auto mb-8">
            <div className="bg-[#F7F9FC] border border-border rounded-2xl p-7">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center text-[#0078D4] flex-shrink-0">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] text-lg mb-2">Governance Foundations Package</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    A comprehensive Microsoft 365 and Power Platform governance framework — covering naming conventions, lifecycle policies, DLP rules, environment strategy, admin roles, and change management processes. Designed for organizations that need to bring order to their existing Power Platform footprint before scaling further.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <FollowOnProjects triggerKeys={["Power Platform Quick\u2011Start"]} />

          {/* Retainer Tiers */}
          <div className="text-center mb-8">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Ongoing Partnership
            </p>
            <h3 className="text-2xl font-extrabold text-[#0A2540]">Fractional M365 Architect Retainers</h3>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm">
              Embedded architecture leadership on a monthly basis — strategy, governance, roadmap execution, and escalation support.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {retainerLoading
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl p-8 border bg-white border-border animate-pulse">
                    <div className="h-5 w-32 bg-gray-200 rounded mb-4" />
                    <div className="h-10 w-24 bg-gray-200 rounded mb-2" />
                    <div className="h-4 w-20 bg-gray-200 rounded mb-4" />
                    <div className="h-16 bg-gray-100 rounded" />
                  </div>
                ))
              : retainerServices.map((tier, i) => (
                  <RetainerCard key={tier.slug ?? tier.name} plan={tier} index={i} />
                ))}
          </div>
        </div>
      </section>

      {/* ── WHAT SHANE DELIVERS ──────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
                Capabilities
              </p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                What Shane Delivers
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Every engagement draws on deep, hands-on experience building production Power Platform solutions — not just advising on them.
              </p>
              <ul className="space-y-4">
                {WHAT_SHANE_DELIVERS.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0A2540] rounded-2xl p-8 space-y-5">
              <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest">
                30-Day Delivery Commitment
              </p>
              <p className="text-white font-bold text-lg">
                A production-ready solution in your hands within 30 days.
              </p>
              <p className="text-white/60 text-sm leading-relaxed">
                Shane's Quick-Start engagement is scoped to deliver one fully functional, production-ready Power App or Power Automate flow within four weeks — including requirements discovery, architecture, build, testing, and handoff. No extended timelines, no scope creep.
              </p>
              <div className="border-t border-white/10 pt-5 space-y-3">
                {["Clear scope defined in week 1", "Build and test in weeks 2–3", "Handoff and training in week 4", "Governance-aligned from day one"].map(
                  (item) => (
                    <div key={item} className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                      <span className="text-white/80 text-sm">{item}</span>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHO THIS IS FOR ──────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Ideal Clients
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who This Is For</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
              Shane works with organizations where automation failure isn't just inconvenient — it's costly.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
            {WHO_FOR.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-4 bg-[#F7F9FC] border border-border rounded-xl p-5"
              >
                <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                  {item.icon}
                </div>
                <span className="text-[#0A2540] font-medium text-sm">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY SHANE ────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Credentials
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Work With Shane</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_SHANE.map((item) => (
              <div
                key={item.title}
                className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-white transition-all"
              >
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

      {/* ── COMPARISON TABLE ────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Quick Comparison</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-3">Which Engagement Is Right for You?</h2>
          <p className="text-muted-foreground mb-10 max-w-2xl leading-relaxed">
            Not sure where to start? This table maps each offer across the dimensions that matter most — so you can self-select before picking up the phone.
          </p>

          <div className="hidden md:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#0A2540] text-white">
                  <th className="text-left px-6 py-5 w-[18%] font-semibold text-white/60 text-xs uppercase tracking-widest"></th>
                  <th className="text-left px-6 py-5 w-[27%]">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Scope</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Power Platform Quick-Start</p>
                  </th>
                  <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Scope</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Governance Foundations Package</p>
                  </th>
                  <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Ongoing</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Fractional M365 Architect Retainer</p>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? "bg-white" : "bg-[#F7F9FC]"}>
                    <td className="px-6 py-5 font-semibold text-[#0A2540] text-xs uppercase tracking-widest align-top whitespace-nowrap border-r border-border">
                      {row.label}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.quickStart}</span> : row.quickStart}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.governance}</span> : row.governance}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{tablePrices.retainer}</span> : row.retainer}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#0A2540]">
                  <td className="px-6 py-5 border-r border-white/10"></td>
                  <td className="px-6 py-5">
                    <a href="/book" className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline">
                      Book a Call <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </td>
                  <td className="px-6 py-5 border-l border-white/10">
                    <a href="/book" className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline">
                      Book a Call <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </td>
                  <td className="px-6 py-5 border-l border-white/10">
                    <a href="/book" className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline">
                      Book a Call <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-6">
            {[
              { icon: <Zap className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Scope", title: "Power Platform Quick-Start", key: "quickStart" as const },
              { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Scope", title: "Governance Foundations Package", key: "governance" as const },
              { icon: <Users className="w-5 h-5 text-[#0078D4]" />, badge: "Ongoing", title: "Fractional M365 Architect Retainer", key: "retainer" as const },
            ].map((col) => (
              <div key={col.key} className="bg-white border border-border rounded-2xl overflow-hidden">
                <div className="bg-[#0A2540] px-5 py-4 flex items-start gap-3">
                  {col.icon}
                  <div>
                    <p className="text-[#00B4D8] text-xs font-semibold uppercase tracking-widest mb-0.5">{col.badge}</p>
                    <p className="text-white font-extrabold leading-snug">{col.title}</p>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {comparisonRows.map((row) => (
                    <div key={row.label} className="px-5 py-4">
                      <p className="text-[#0078D4] text-xs font-semibold uppercase tracking-widest mb-1">{row.label}</p>
                      <p className={`text-sm leading-relaxed ${row.label === "Price" ? "font-bold text-[#0A2540]" : "text-foreground"}`}>
                        {row.label === "Price" ? tablePrices[col.key] : row[col.key]}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 bg-[#F7F9FC] border-t border-border">
                  <a href="/book" className="inline-flex items-center gap-1.5 text-[#0078D4] text-sm font-semibold hover:underline">
                    Book a Call <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
            Ready to Start?
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Let's Build Something Real
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            A free discovery call takes 30 minutes. You'll leave with clarity on what to automate first and what it will take to deliver it in production.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <CTAButton href="/book" className="px-8 py-3.5 text-base">
              Book a Free Discovery Call
            </CTAButton>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-white/80 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              Schedule a Consultation <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      <ConsultationCTA />
      <ServiceOverviewModal
        serviceName="Power Platform"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Layout>
  );
}
