import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import {
  CheckCircle, ArrowRight, Shield, Users, Building2, Zap, AlertCircle,
  DollarSign, Clock,
} from "lucide-react";

const comparisonRows = [
  {
    label: "Best For",
    fixedPrice: "Organizations with a specific, scoped problem to solve — audit, assessment, or configuration",
    essentials: "Organizations needing regular advisory, architecture reviews, and escalation support",
    growth: "Organizations running active M365 programs that need embedded senior architect capacity",
  },
  {
    label: "Scope",
    fixedPrice: "Discrete deliverable defined upfront — one scoped project, one clear output",
    essentials: "10 hrs/mo advisory, architecture reviews, roadmap validation, and escalation support",
    growth: "25–50 hrs/mo roadmap execution, governance implementation, and IT team mentoring",
  },
  {
    label: "Timeline",
    fixedPrice: "1–4 weeks (project-specific)",
    essentials: "Ongoing — month-to-month",
    growth: "Ongoing — month-to-month",
  },
  {
    label: "Price",
    fixedPrice: "Varies by micro-offer — see the pricing page",
    essentials: "$2,500/mo",
    growth: "$6,000–$11,000/mo",
  },
  {
    label: "Key Deliverables",
    fixedPrice: "Defined deliverable per offer: readiness report, governance playbook, or configured environment",
    essentials: "Advisory hours, architecture reviews, escalation access, monthly progress check-in",
    growth: "Roadmap execution, governance implementation, IT team mentoring, executive reporting",
  },
  {
    label: "Ongoing Support",
    fixedPrice: "One-time engagement — can roll directly into a retainer for continued partnership",
    essentials: "Continuous — cancel or adjust with 30-day notice",
    growth: "Continuous — cancel or adjust with 30-day notice",
  },
];
import { Link } from "wouter";
import { CTAButton } from "@/components/CTAButton";
import { OfferCard } from "@/components/OfferCard";
import { ServiceRetainerCard } from "@/components/ServiceRetainerCard";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";


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
  const { services, loading, error } = useServices("micro_offer");
  const { services: retainerServices, loading: retainerLoading } = useServices("retainer");

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

      {/* ── FIXED-PRICE ENGAGEMENT ───────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Fixed-Price Engagement</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">M365 Tenant Architecture & Governance Assessment</h2>
          </div>

          <div className="max-w-4xl mx-auto bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-[#0A2540] px-8 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-white font-bold text-xl">M365 Tenant Architecture & Governance Assessment</p>
                <p className="text-white/50 text-sm mt-1">A comprehensive, fixed-scope engagement covering your entire Microsoft 365 environment — from identity and security to governance, compliance, and collaboration architecture.</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="flex items-center gap-1.5 justify-end">
                  <DollarSign className="w-4 h-4 text-[#0078D4]" />
                  <span className="text-white font-extrabold text-2xl">$6,000–$12,000</span>
                </div>
                <div className="flex items-center gap-1.5 justify-end mt-1">
                  <Clock className="w-3.5 h-3.5 text-white/40" />
                  <span className="text-white/50 text-sm">2–4 weeks</span>
                </div>
              </div>
            </div>

            <div className="px-8 py-8 border-b border-border">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-5">What's Included</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  "Full tenant health audit — identity, licensing, and configuration review",
                  "Security baseline assessment against Microsoft Secure Score best practices",
                  "Exchange Online, Teams, and SharePoint architecture review",
                  "Conditional Access and Zero Trust readiness evaluation",
                  "Governance framework gap analysis with policy recommendations",
                  "Compliance posture review (DLP, retention, sensitivity labels)",
                  "Prioritized remediation roadmap with effort and risk scoring",
                  "Executive briefing and written Architecture Assessment Report",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <span className="text-[#0A2540] text-sm leading-snug">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-8 py-7 bg-[#0078D4]/5 flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-2">Deliverable</p>
                <p className="text-[#0A2540] font-semibold leading-relaxed">
                  A detailed Microsoft 365 Architecture Assessment Report — covering security posture, governance gaps, and a prioritized remediation roadmap — plus an executive readout session your team can act on immediately.
                </p>
              </div>
              <CTAButton href="/book" className="flex-shrink-0 whitespace-nowrap">
                Book This Engagement
              </CTAButton>
            </div>
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

          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white border border-border rounded-2xl p-6 flex flex-col gap-4 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10" />
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-full" />
                    <div className="h-3 bg-muted rounded w-5/6" />
                  </div>
                  <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                    <div className="h-4 bg-muted rounded w-24" />
                    <div className="h-3 bg-muted rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
              <AlertCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0" />
              <span className="text-sm">Unable to load offers right now. Please try refreshing the page.</span>
            </div>
          )}

          {!loading && !error && services.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((offer, i) => (
                <OfferCard key={offer.slug ?? offer.id} offer={offer} index={i} />
              ))}
            </div>
          )}

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
                  <ServiceRetainerCard
                    key={tier.slug ?? tier.name}
                    name={tier.name}
                    price={formatPriceDisplay(tier)}
                    hours={tier.hoursPerMonth ?? ""}
                    description={tier.description ?? ""}
                    highlight={tier.highlighted}
                    index={i}
                  />
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

      {/* ── COMPARISON TABLE ────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Quick Comparison</p>
          <h2 className="text-3xl font-extrabold text-[#0A2540] mb-3">Which Engagement Is Right for You?</h2>
          <p className="text-muted-foreground mb-10 max-w-2xl leading-relaxed">
            Not sure whether to start with a fixed-price project or a retainer? This table maps both engagement models across the dimensions that matter most — so you can self-select before picking up the phone.
          </p>

          <div className="hidden md:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#0A2540] text-white">
                  <th className="text-left px-6 py-5 w-[18%] font-semibold text-white/60 text-xs uppercase tracking-widest"></th>
                  <th className="text-left px-6 py-5 w-[27%]">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Fixed-Price</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Micro-Offer (Project)</p>
                  </th>
                  <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Retainer</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Architect Essentials — $2,500/mo</p>
                  </th>
                  <th className="text-left px-6 py-5 w-[27%] border-l border-white/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-[#00B4D8]" />
                      <span className="text-xs font-semibold text-[#00B4D8] uppercase tracking-widest">Retainer</span>
                    </div>
                    <p className="text-base font-extrabold leading-snug">Architect Growth & Enterprise</p>
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
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{row.fixedPrice}</span> : row.fixedPrice}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{row.essentials}</span> : row.essentials}
                    </td>
                    <td className="px-6 py-5 text-foreground leading-relaxed align-top border-l border-border">
                      {row.label === "Price" ? <span className="font-bold text-[#0A2540]">{row.growth}</span> : row.growth}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#0A2540]">
                  <td className="px-6 py-5 border-r border-white/10"></td>
                  <td className="px-6 py-5">
                    <a href="/micro-offers" className="inline-flex items-center gap-1.5 text-[#00B4D8] text-sm font-semibold hover:underline">
                      View Micro-Offers <ArrowRight className="w-3.5 h-3.5" />
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
              { icon: <Zap className="w-5 h-5 text-[#0078D4]" />, badge: "Fixed-Price", title: "Micro-Offer (Project)", key: "fixedPrice" as const },
              { icon: <Shield className="w-5 h-5 text-[#0078D4]" />, badge: "Retainer", title: "Architect Essentials — $2,500/mo", key: "essentials" as const },
              { icon: <Users className="w-5 h-5 text-[#0078D4]" />, badge: "Retainer", title: "Architect Growth & Enterprise", key: "growth" as const },
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
                        {row[col.key]}
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
