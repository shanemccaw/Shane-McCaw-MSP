import { useState } from "react";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { CheckCircle, ChevronDown, Zap, FolderOpen, Calendar, ArrowRight } from "lucide-react";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

const faqs = [
  {
    q: "How quickly can an engagement start?",
    a: "Fixed-price micro-offer packages typically begin within 3\u20135 business days of payment. Retainer engagements and project work usually start within 1\u20132 weeks of signing. If you have a time-sensitive situation, mention it on the discovery call \u2014 Shane can often accelerate.",
  },
  {
    q: "Do you work with small businesses or only enterprises?",
    a: "Both. The same Microsoft 365 governance and architecture challenges that affect NASA-scale environments appear at 50-seat organizations \u2014 often with less margin for error, not more. Shane calibrates scope and pricing to your actual size and complexity.",
  },
  {
    q: "Is everything done remotely?",
    a: "Yes, 100% remote. Shane is based in Vero Beach, FL, and serves clients nationally. Microsoft 365 consulting is entirely remote-capable \u2014 screen sharing, Teams calls, and delegated admin access are all that\u2019s needed.",
  },
  {
    q: "How are project-based engagements scoped and priced?",
    a: "After the free discovery call, Shane provides a fixed-fee proposal with defined deliverables, a timeline, and a single project price. No hourly billing, no scope creep without a signed change order. Project pricing typically ranges from $2,500 to $25,000+ depending on complexity.",
  },
  {
    q: "Can I start with a micro-offer and move to a retainer?",
    a: "That\u2019s the most common path. Most clients start with a fixed-price assessment to establish baseline and build confidence, then move into a retainer once they know the working relationship. Any micro-offer investment can be credited toward the first month of a retainer if you decide to continue.",
  },
  {
    q: "What does a retainer actually look like month to month?",
    a: "Retainer hours are used however the engagement requires \u2014 attending architecture reviews, reviewing configurations, answering time-sensitive questions, or designing a new workload. At the end of each month you receive a written summary of work completed and hours used. Hours do not roll over.",
  },
  {
    q: "What M365 licenses are required for Copilot?",
    a: "Microsoft 365 Copilot requires an M365 E3 or E5 base license plus the Copilot add-on ($30/user/month). However, licensing is only the starting point \u2014 data governance, sensitivity labeling, and permissions hygiene must be in place first. The Copilot Readiness Assessment covers all of this.",
  },
];

function MicroOfferCard({ offer, index }: { offer: PublicService; index: number }) {
  const price = formatPriceDisplay(offer);
  return (
    <div
      className="bg-white rounded-xl border border-border p-6 flex flex-col hover:border-[#0078D4]/30 hover:shadow-sm transition-all duration-200 relative"
      data-testid={`micro-offer-${index}`}
    >
      {offer.badge && (
        <span className="absolute -top-3 left-5 bg-[#0078D4] text-white text-xs font-bold px-3 py-1 rounded-full">
          {offer.badge}
        </span>
      )}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-extrabold text-[#0A2540] text-base leading-snug">{offer.name}</h3>
        <span className="text-[#0078D4] font-extrabold text-lg flex-shrink-0">{price}</span>
      </div>
      {offer.tagline && (
        <p className="text-[#0078D4] text-xs font-semibold mb-1">{offer.tagline}</p>
      )}
      <p className="text-muted-foreground text-sm leading-relaxed mb-4">{offer.description}</p>
      {offer.targetAudience && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-1">Who it&apos;s for</p>
          <p className="text-xs text-muted-foreground">{offer.targetAudience}</p>
        </div>
      )}
      {offer.inclusions && offer.inclusions.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-1">What&apos;s included</p>
          <ul className="space-y-1">
            {offer.inclusions.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {offer.features && offer.features.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-1">Features</p>
          <ul className="space-y-1">
            {offer.features.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-border pt-4 space-y-2 mt-auto">
        {offer.deliverables && (
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" />
            <span className="text-foreground font-medium">{offer.deliverables}</span>
          </div>
        )}
        {offer.turnaround && (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-3.5 h-3.5 flex-shrink-0 text-center text-muted-foreground">{"\u23f1"}</span>
            <span className="text-muted-foreground">Turnaround: {offer.turnaround}</span>
          </div>
        )}
      </div>
      <a
        href={`/crm/portal/onboarding/select?service=${offer.slug ?? ""}`}
        className="mt-4 text-[#0078D4] text-sm font-semibold hover:underline flex items-center gap-1"
        data-testid={`micro-offer-cta-${index}`}
      >
        Get started <ArrowRight className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

function RetainerCard({ plan, index }: { plan: PublicService; index: number }) {
  const price = formatPriceDisplay(plan);
  const features = plan.features ?? [];
  const hl = plan.highlighted;
  return (
    <div
      className={`rounded-2xl p-8 border flex flex-col relative ${hl ? "bg-[#0A2540] border-[#0078D4]/60" : "bg-white border-border"}`}
      data-testid={`retainer-${index}`}
    >
      {hl && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#0078D4] text-white text-xs font-bold px-5 py-1.5 rounded-full uppercase tracking-wide whitespace-nowrap">
          Most Popular
        </div>
      )}
      <div className="mb-2">
        <h3 className={`text-lg font-extrabold mb-4 ${hl ? "text-white" : "text-[#0A2540]"}`}>{plan.name}</h3>
        <div className="flex items-baseline gap-1 mb-1">
          <span className="text-4xl font-extrabold text-[#0078D4]">{price}</span>
          <span className={`text-sm ${hl ? "text-white/50" : "text-muted-foreground"}`}>/month</span>
        </div>
        {plan.hoursPerMonth && (
          <p className={`text-sm mb-4 ${hl ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{plan.hoursPerMonth}/month</p>
        )}
        <p className={`text-xs leading-relaxed mb-6 ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.tagline ?? plan.description}</p>
      </div>
      <ul className="space-y-3 mb-6">
        {features.map((f, j) => (
          <li key={j} className="flex items-start gap-2.5" data-testid={`retainer-${index}-feature-${j}`}>
            <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
            <span className={`text-sm ${hl ? "text-white/80" : "text-foreground"}`}>{f}</span>
          </li>
        ))}
      </ul>
      {plan.targetAudience && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Who it&apos;s for</p>
          <p className={`text-xs ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.targetAudience}</p>
        </div>
      )}
      {plan.inclusions && plan.inclusions.length > 0 && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Also included</p>
          <ul className="space-y-1.5">
            {plan.inclusions.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className={hl ? "text-white/70" : "text-muted-foreground"}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.deliverables && (
        <div className="mb-3">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Deliverable</p>
          <p className={`text-xs ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.deliverables}</p>
        </div>
      )}
      {plan.turnaround && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Turnaround</p>
          <p className={`text-xs ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.turnaround}</p>
        </div>
      )}
      <div className="mt-auto">
        <CTAButton href="/book" className="w-full justify-center text-sm" data-testid={`retainer-cta-${index}`}>
          Start a Retainer
        </CTAButton>
      </div>
    </div>
  );
}

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden" data-testid={`faq-item-${index}`}>
      <button
        className="w-full text-left px-6 py-5 flex items-center justify-between font-semibold text-[#0A2540] hover:bg-[#F7F9FC] transition-colors gap-4"
        onClick={() => setOpen(!open)}
        data-testid={`faq-toggle-${index}`}
      >
        <span>{q}</span>
        <ChevronDown className={`w-5 h-5 text-[#0078D4] flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-6 pb-6 text-muted-foreground leading-relaxed border-t border-border pt-5 text-sm">
          {a}
        </div>
      )}
    </div>
  );
}

export default function Pricing() {
  const { services: allServices, loading } = useServices();
  const microOffers = allServices.filter((s) => s.serviceType === "micro_offer");
  const retainers = allServices.filter((s) => s.serviceType === "retainer");
  const offersLoading = loading;
  const retainersLoading = loading;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": "Microsoft 365 Consulting Pricing",
      "description": "Transparent pricing for Shane McCaw's Microsoft 365 consulting retainers and fixed-price packages.",
      "url": "https://shanemccaw.com/pricing",
      "itemListElement": [
        ...retainers.map((r, i) => ({
          "@type": "ListItem",
          "position": i + 1,
          "item": {
            "@type": "Offer",
            "name": r.name,
            "description": r.tagline ?? r.description ?? "",
            "price": r.price ?? "",
            "priceCurrency": "USD",
            "priceSpecification": {
              "@type": "UnitPriceSpecification",
              "price": r.price ?? "",
              "priceCurrency": "USD",
              "unitText": "month",
            },
            "seller": { "@type": "Person", "name": "Shane McCaw" },
          },
        })),
        ...microOffers.map((o, i) => ({
          "@type": "ListItem",
          "position": retainers.length + i + 1,
          "item": {
            "@type": "Offer",
            "name": o.name,
            "description": o.description ?? "",
            "price": o.price ?? "",
            "priceCurrency": "USD",
            "priceSpecification": { "@type": "PriceSpecification", "price": o.price ?? "", "priceCurrency": "USD" },
            ...(o.turnaround ? { "deliveryLeadTime": { "@type": "QuantitativeValue", "description": o.turnaround } } : {}),
            "seller": { "@type": "Person", "name": "Shane McCaw" },
          },
        })),
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map(({ q, a }) => ({
        "@type": "Question",
        "name": q,
        "acceptedAnswer": { "@type": "Answer", "text": a },
      })),
    },
  ];

  return (
    <Layout>
      <SEOMeta
        title="Pricing — Transparent Microsoft 365 Consulting | Shane McCaw Consulting"
        description="Transparent Microsoft 365 consulting pricing by Shane McCaw. Fixed-price micro-offer packages and retainer options — know your investment before you commit."
        jsonLd={jsonLd}
      />
      {/* Hero */}
      <section className="relative bg-[#0A2540] pt-32 pb-24 overflow-hidden">
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
          className="absolute inset-0 opacity-10"
          style={{ background: "radial-gradient(ellipse 70% 60% at 80% 40%, #0078D4, transparent)" }}
        />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8]" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">Pricing</p>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-[3.25rem] font-extrabold text-white leading-[1.1] max-w-3xl mb-6">
            Transparent Pricing. Predictable Investment. No Hourly Surprises.
          </h1>
          <p className="text-lg text-white/70 leading-relaxed max-w-2xl">
            Every Shane McCaw Consulting engagement is scoped and priced upfront. You know exactly what you're investing before any work begins — and exactly what you'll receive in return.
          </p>
        </div>
      </section>

      {/* Engagement model overview */}
      <section className="bg-white py-20 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">How Engagements Work</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Three Ways to Engage</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              The right engagement structure depends on what you need — a specific deliverable, a defined project, or ongoing architectural leadership. All three options are structured around fixed, predictable pricing.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                label: "Track 01",
                title: "Fixed-Price Micro-Offers",
                range: "$397 \u2013 $997",
                desc: "Scoped deliverables with a defined price, a defined output, and a defined turnaround. No discovery call required to start \u2014 pick the package that matches your need and get in the queue.",
                bestFor: "Organizations that know what they need and want to move quickly.",
                anchor: "#micro-offers",
              },
              {
                icon: FolderOpen,
                label: "Track 02",
                title: "Project-Based Engagements",
                range: "$2,500 \u2013 $25,000+",
                desc: "For larger, multi-phase work \u2014 tenant migrations, full governance overhauls, Copilot deployment programs, intranet builds. Priced as a fixed project after a free scoping call.",
                bestFor: "Organizations with a defined initiative that needs a structured plan and committed delivery.",
                anchor: "#project-based",
              },
              {
                icon: Calendar,
                label: "Track 03",
                title: "Monthly Fractional Retainer",
                range: "$1,500 \u2013 $5,500/mo",
                desc: "Consistent, predictable access to Shane\u2019s expertise every month \u2014 for architecture reviews, ongoing governance, strategic planning, or Copilot rollout support. Cancel with 30 days\u2019 notice.",
                bestFor: "Organizations that need a senior M365 architect available on a sustained basis.",
                anchor: "#retainers",
              },
            ].map((track, i) => {
              const Icon = track.icon;
              return (
                <a
                  key={i}
                  href={track.anchor}
                  className="group bg-[#F7F9FC] rounded-2xl border border-border p-8 flex flex-col hover:border-[#0078D4]/40 hover:shadow-md transition-all duration-300 cursor-pointer"
                  data-testid={`engagement-track-${i}`}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-11 h-11 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-[#0078D4]" />
                    </div>
                    <span className="text-[#0078D4]/50 text-xs font-bold uppercase tracking-wider">{track.label}</span>
                  </div>
                  <h3 className="text-lg font-extrabold text-[#0A2540] mb-1">{track.title}</h3>
                  <p className="text-2xl font-extrabold text-[#0078D4] mb-4">{track.range}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed flex-grow mb-5">{track.desc}</p>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-1">Best for</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">{track.bestFor}</p>
                  </div>
                  <span className="mt-4 text-[#0078D4] text-sm font-semibold flex items-center gap-1.5 group-hover:gap-2.5 transition-all">
                    See details <ArrowRight className="w-4 h-4" />
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* Micro-Offers */}
      <section id="micro-offers" className="bg-[#F7F9FC] py-20 scroll-mt-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-[#0078D4]" />
              </div>
              <span className="text-[#0078D4] text-xs font-bold uppercase tracking-wider">Track 01</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-3">Fixed-Price Micro-Offers</h2>
            <p className="text-muted-foreground max-w-2xl leading-relaxed">
              Each package has a fixed price, a specific deliverable, and a committed turnaround time. No discovery call required — the scope is defined in advance so you know what you're getting.
            </p>
          </div>
          {offersLoading && microOffers.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => <div key={i} className="h-52 rounded-xl border border-border bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {microOffers.map((offer, i) => (
                <MicroOfferCard key={offer.slug} offer={offer} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Project-Based */}
      <section id="project-based" className="bg-white py-20 scroll-mt-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 items-start">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                  <FolderOpen className="w-4 h-4 text-[#0078D4]" />
                </div>
                <span className="text-[#0078D4] text-xs font-bold uppercase tracking-wider">Track 02</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4 leading-tight">
                Project-Based Engagements
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                For complex, multi-phase work that goes beyond a packaged deliverable — full tenant migrations, governance overhauls, Copilot deployment programs, or SharePoint intranet builds. Every project is priced as a fixed fee with defined deliverables and a committed timeline.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-8">
                You'll receive a detailed proposal before any commitment. The proposal includes the exact scope of work, every deliverable, the project timeline, and a single fixed price — not an hourly estimate. Scope changes require a signed change order.
              </p>
              <div className="bg-[#F7F9FC] rounded-xl border border-border p-6 mb-6">
                <p className="text-xs font-bold text-[#0A2540] uppercase tracking-wider mb-3">Typical project range</p>
                <p className="text-3xl font-extrabold text-[#0078D4] mb-1">$2,500 – $25,000+</p>
                <p className="text-muted-foreground text-sm">Scoped after a free discovery call. No commitment required to get a proposal.</p>
              </div>
              <CTAButton href="/book" className="text-sm" data-testid="project-cta">
                Book a Free Scoping Call
              </CTAButton>
            </div>
            <div className="space-y-4">
              <p className="text-sm font-bold text-[#0A2540] uppercase tracking-wider mb-4">Common project engagements</p>
              {[
                { name: "M365 Tenant Migration", range: "$5,000 – $15,000", desc: "Full tenant-to-tenant migration including data migration, governance setup, and user transition." },
                { name: "Copilot Deployment Program", range: "$7,500 – $20,000", desc: "End-to-end six-pillar Copilot deployment: governance, labeling, rollout, pilot, and adoption." },
                { name: "SharePoint Intranet Build", range: "$4,000 – $12,000", desc: "Full intranet design and build — IA, governance, content migration, and launch support." },
                { name: "Governance Overhaul", range: "$3,500 – $10,000", desc: "Comprehensive M365 governance: DLP, retention, sensitivity labels, permissions remediation." },
                { name: "Power Platform Implementation", range: "$2,500 – $8,000", desc: "Power Apps or Power Automate solution design, build, testing, and documentation." },
              ].map((project, i) => (
                <div key={i} className="bg-[#F7F9FC] rounded-xl border border-border p-5" data-testid={`project-type-${i}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-[#0A2540] text-sm mb-1">{project.name}</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">{project.desc}</p>
                    </div>
                    <span className="text-[#0078D4] font-bold text-xs text-right flex-shrink-0 whitespace-nowrap">{project.range}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Retainers */}
      <section id="retainers" className="bg-[#F7F9FC] py-20 scroll-mt-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-3 justify-center mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-[#0078D4]" />
              </div>
              <span className="text-[#0078D4] text-xs font-bold uppercase tracking-wider">Track 03</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">Monthly Fractional Architect Retainer</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Consistent, predictable access to a NASA-caliber M365 architect every month — without the cost of a full-time hire. Cancel with 30 days' notice. No long-term commitment required.
            </p>
          </div>
          {retainersLoading && retainers.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => <div key={i} className="h-96 rounded-2xl border border-border bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {retainers.map((plan, i) => (
                <RetainerCard key={plan.slug} plan={plan} index={i} />
              ))}
            </div>
          )}
          <p className="text-center text-muted-foreground text-sm mt-8">
            All retainer tiers include access to all service areas. Hours are used as the engagement requires and do not roll over.
          </p>
        </div>
      </section>

      {/* Why this pricing model */}
      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0A2540] rounded-2xl p-10 grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-10 items-center">
            <div>
              <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Philosophy</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
                Why Fixed Pricing — and Why It Matters to You
              </h2>
            </div>
            <div className="space-y-5">
              {[
                {
                  heading: "You budget for an outcome, not a clock.",
                  body: "Hourly billing creates misaligned incentives. It rewards time spent, not results delivered. Fixed pricing forces Shane to scope the work accurately and deliver it efficiently.",
                },
                {
                  heading: "No scope creep without a conversation.",
                  body: "If a project changes materially, that becomes a change order discussion — not a surprise on your invoice. You're never in the dark about what you've committed to.",
                },
                {
                  heading: "Enterprise value at a fraction of enterprise cost.",
                  body: "A full-time senior M365 architect costs $150,000–$200,000/year in salary alone. A fractional retainer delivers the same expertise — applied directly to your highest-priority problems — at a fraction of that cost.",
                },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3" data-testid={`philosophy-point-${i}`}>
                  <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-semibold text-sm mb-1">{item.heading}</p>
                    <p className="text-white/60 text-sm leading-relaxed">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">FAQ</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540]">Common Questions</h2>
          </div>
          <div className="max-w-3xl mx-auto space-y-3">
            {faqs.map((item, i) => (
              <FAQItem key={i} q={item.q} a={item.a} index={i} />
            ))}
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
