import { useState, useEffect } from "react";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { Link } from "wouter";
import {
  CheckCircle, ChevronDown, Zap, FolderOpen, Calendar, ArrowRight,
  Shield, Users, AlertTriangle, DollarSign, Layers, Lightbulb,
} from "lucide-react";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

interface EngagementProject {
  id: number;
  title: string;
  priceRange: string;
  description: string | null;
  triggeredBy: string[];
  sowItems: string[];
  sortOrder: number;
  isVisible: boolean;
}

function useEngagementProjects() {
  const [projects, setProjects] = useState<EngagementProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/public/engagement-projects")
      .then(r => r.ok ? r.json() as Promise<EngagementProject[]> : Promise.resolve([]))
      .then(data => setProjects(data))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  return { projects, loading };
}

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
    a: "After the free discovery call, Shane provides a fixed-fee proposal with defined deliverables, a timeline, and a single project price. No hourly billing, no scope creep without a signed change order. Project pricing typically ranges from $7,500 to $35,000+ depending on complexity.",
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

function EngagementProjectCard({ project, index }: { project: EngagementProject; index: number }) {
  return (
    <div
      className="bg-white rounded-xl border border-border p-6 flex flex-col hover:border-[#0078D4]/30 hover:shadow-sm transition-all duration-200"
      data-testid={`project-type-${index}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-extrabold text-[#0A2540] text-base leading-snug">{project.title}</h3>
        <span className="text-[#0078D4] font-extrabold text-sm flex-shrink-0 whitespace-nowrap">{project.priceRange}</span>
      </div>
      {project.description && (
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">{project.description}</p>
      )}
      {project.triggeredBy.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-2">Triggered by</p>
          <ul className="space-y-1">
            {project.triggeredBy.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {project.sowItems.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-2">Typical SOW includes</p>
          <ul className="space-y-1">
            {project.sowItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-auto pt-4 border-t border-border">
        <a
          href="/book"
          className="text-[#0078D4] text-sm font-semibold hover:underline flex items-center gap-1"
        >
          Book a free scoping call <ArrowRight className="w-3.5 h-3.5" />
        </a>
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
  const { projects: engagementProjects, loading: projectsLoading } = useEngagementProjects();
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

      {/* NASA-Scale Positioning */}
      <section className="bg-white py-14 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Built on NASA-Scale Architecture Standards</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 leading-snug">
                The Architect Behind Every Engagement
              </h2>
              <p className="text-foreground leading-relaxed mb-3">
                Shane McCaw is NASA's Lead Microsoft 365 Architect and Copilot SME — responsible for M365 governance and architecture in a FISMA High, FedRAMP-authorized environment operating under ITAR and GCC/GCC High requirements. His 30-year Microsoft ecosystem career spans production architecture at every scale, from small business to federal agency.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                For mid-market organizations and regulated industries — healthcare, financial services, government contractors, and defense — this matters because the same architecture principles that work under federal compliance requirements are exactly what your organization needs to build on. Every engagement is delivered directly by Shane, drawing from what he's solving in production today.
              </p>
            </div>
            <div className="flex flex-wrap lg:flex-col gap-3 lg:w-52 flex-shrink-0">
              {["FedRAMP Authorized", "FISMA High", "ITAR Compliance", "GCC / GCC High", "30 Years Microsoft", "NASA Lead Architect"].map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-2 bg-[#0078D4]/8 border border-[#0078D4]/20 text-[#0078D4] text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap">
                  <Shield className="w-3 h-3 flex-shrink-0" />{tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Fixed Pricing — elevated summary */}
      <section className="bg-[#F7F9FC] py-10 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                heading: "You budget for an outcome, not a clock.",
                body: "Fixed pricing forces accurate scoping and efficient delivery. No hourly billing, no misaligned incentives.",
              },
              {
                heading: "No scope creep without a conversation.",
                body: "Changes become change order discussions — not line-item surprises on an invoice. You're never in the dark.",
              },
              {
                heading: "Enterprise value at a fraction of the cost.",
                body: "A full-time senior M365 architect costs $150k–$220k/year. A fractional retainer delivers the same expertise at 10–20% of that.",
              },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-white rounded-xl border border-border p-5">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#0A2540] text-sm mb-1">{item.heading}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Engagement model overview — Entry / Core / Strategic */}
      <section className="bg-white py-20 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">How Engagements Work</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Three Ways to Engage</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              Most organizations move through the tiers over time — starting with a fast, low-risk Entry package to get clarity, then a Core project to fix what's broken, then Strategic fractional architecture for ongoing governance and growth.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                label: "Track 01",
                tier: "Entry",
                title: "Fixed-Price Micro-Offers",
                range: "$3,000 \u2013 $18,000",
                desc: "Scoped deliverables with a defined price, a defined output, and a defined turnaround. No discovery call required to start \u2014 pick the package that matches your need and get in the queue.",
                bestFor: "Mid-market organizations (200–2,000 employees), regulated industries, and government contractors that need a fast, low-risk diagnostic before committing to a larger engagement.",
                anchor: "#micro-offers",
              },
              {
                icon: FolderOpen,
                label: "Track 02",
                tier: "Core",
                title: "Project-Based Engagements",
                range: "$7,500 \u2013 $35,000+",
                desc: "For larger, multi-phase work \u2014 tenant migrations, full governance overhauls, Copilot deployment programs, intranet builds. Priced as a fixed project after a free scoping call.",
                bestFor: "Organizations with a defined initiative — preparing for Copilot, remediating governance gaps, or executing a migration — that need structured delivery and committed outcomes.",
                anchor: "#project-based",
              },
              {
                icon: Calendar,
                label: "Track 03",
                tier: "Strategic",
                title: "Monthly Fractional Retainer",
                range: "$1,500 \u2013 $5,500/mo",
                desc: "Consistent, predictable access to Shane\u2019s expertise every month \u2014 for architecture reviews, ongoing governance, strategic planning, or Copilot rollout support. Cancel with 30 days\u2019 notice.",
                bestFor: "Organizations in regulated industries, government contractors, or startups scaling into compliance that need a senior M365 architect available on a sustained basis — without full-time overhead.",
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
                    <div>
                      <span className="text-[#0078D4]/50 text-xs font-bold uppercase tracking-wider block">{track.label}</span>
                      <span className="text-[#0A2540] text-xs font-bold uppercase tracking-wider">{track.tier} Tier</span>
                    </div>
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

      {/* NASA-Grade Methodology Callout */}
      <section className="bg-[#0A2540] py-10">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex items-start gap-5">
            <div className="w-10 h-10 rounded-lg bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Shield className="w-5 h-5 text-[#00B4D8]" />
            </div>
            <div>
              <p className="text-white font-semibold mb-1">NASA-Grade Methodology, Adapted for Your Environment</p>
              <p className="text-white/60 text-sm leading-relaxed max-w-3xl">
                All assessments, governance frameworks, and deliverables are built using the same architecture principles Shane applies at NASA — adapted for mid-market and regulated-industry environments. The rigor is real; the scope is calibrated to what you actually need.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Win CTA Callout */}
      <section className="bg-white py-8 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0078D4]/8 border border-[#0078D4]/25 rounded-xl p-6 flex items-start gap-4">
            <div className="w-9 h-9 rounded-lg bg-[#0078D4]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Lightbulb className="w-4 h-4 text-[#0078D4]" />
            </div>
            <div>
              <p className="font-semibold text-[#0A2540] mb-1">Not sure where to start?</p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Most clients begin with the <Link href="/micro-offers" className="text-[#0078D4] font-medium hover:underline">M365 Tenant Health Audit</Link> or the <Link href="/micro-offers" className="text-[#0078D4] font-medium hover:underline">Migration Readiness Assessment</Link> — fast, low-risk engagements that surface the real issues and give you the clarity to decide what comes next.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Track 01 — Micro-Offers */}
      <section id="micro-offers" className="bg-[#F7F9FC] py-20 scroll-mt-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-[#0078D4]" />
              </div>
              <span className="text-[#0078D4] text-xs font-bold uppercase tracking-wider">Track 01 — Entry Tier</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-3">Fixed-Price Micro-Offers</h2>
            <p className="text-muted-foreground max-w-2xl leading-relaxed mb-4">
              Each package has a fixed price, a specific deliverable, and a committed turnaround time. No discovery call required — the scope is defined in advance so you know what you're getting.
            </p>
            <p className="text-muted-foreground max-w-2xl leading-relaxed text-sm bg-[#F7F9FC] border border-border rounded-lg px-4 py-3">
              <span className="font-semibold text-[#0A2540]">Two tiers within Track 01:</span> The lower-priced packages ($3,000–$5,000) are tactical quick wins — fast-turnaround deliverables scoped around a single, well-defined need. The higher-priced packages ($8,000–$18,000) are strategic assessments — deeper engagements that produce a comprehensive diagnostic, prioritized remediation roadmap, and executive briefing. Both serve different purposes and different moments in an organization's M365 journey.
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

      {/* Track 02 — Project-Based */}
      <section id="project-based" className="bg-white py-20 scroll-mt-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                <FolderOpen className="w-4 h-4 text-[#0078D4]" />
              </div>
              <span className="text-[#0078D4] text-xs font-bold uppercase tracking-wider">Track 02 — Core Tier</span>
            </div>
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              <div className="max-w-2xl">
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4 leading-tight">
                  Project-Based Engagements
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  For complex, multi-phase work that goes beyond a packaged deliverable. Every project is priced as a fixed fee with defined deliverables and a committed timeline — not an hourly estimate.
                </p>
                <p className="text-muted-foreground leading-relaxed text-sm">
                  You'll receive a detailed proposal before any commitment. Scope changes require a signed change order.
                </p>
              </div>
              <div className="flex-shrink-0">
                <div className="bg-[#F7F9FC] rounded-xl border border-border p-5 mb-4 text-center lg:text-right">
                  <p className="text-xs font-bold text-[#0A2540] uppercase tracking-wider mb-1">Typical project range</p>
                  <p className="text-2xl font-extrabold text-[#0078D4]">$7,500 – $35,000+</p>
                  <p className="text-muted-foreground text-xs mt-1">Scoped after a free discovery call.</p>
                </div>
                <CTAButton href="/book" className="text-sm w-full justify-center" data-testid="project-cta">
                  Book a Free Scoping Call
                </CTAButton>
              </div>
            </div>
          </div>
          {projectsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(5)].map((_, i) => <div key={i} className="h-72 rounded-xl border border-border bg-gray-100 animate-pulse" />)}
            </div>
          ) : engagementProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No project types configured yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {engagementProjects.map((project, i) => (
                <EngagementProjectCard key={project.id} project={project} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Track 03 — Retainers */}
      <section id="retainers" className="bg-[#F7F9FC] py-20 scroll-mt-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-3 justify-center mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-[#0078D4]" />
              </div>
              <span className="text-[#0078D4] text-xs font-bold uppercase tracking-wider">Track 03 — Strategic Tier</span>
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

      {/* Why Fractional Beats Full-Time */}
      <section className="bg-white py-20 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Business Case</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6 leading-tight">Why Fractional Beats Full-Time</h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Most mid-market organizations can't justify a $150k–$220k full-time architect salary — but they absolutely need that level of expertise for the decisions they're making. Fractional architecture resolves that tension.
              </p>
              <div className="space-y-4">
                {[
                  { label: "Full-time senior M365 architect", value: "$150k–$220k salary + benefits + recruiting overhead", dark: false },
                  { label: "Fractional retainer with Shane", value: "10–20% of full-time cost. No benefits. No recruiting. Immediate start.", dark: true },
                ].map((item, i) => (
                  <div key={i} className={`flex items-start gap-4 rounded-xl border p-5 ${item.dark ? "bg-[#0A2540] border-[#0078D4]/40" : "bg-[#F7F9FC] border-border"}`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${item.dark ? "bg-white/10" : "bg-[#0078D4]/10"}`}>
                      <DollarSign className={`w-4 h-4 ${item.dark ? "text-[#00B4D8]" : "text-[#0078D4]"}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold mb-0.5 ${item.dark ? "text-white" : "text-[#0A2540]"}`}>{item.label}</p>
                      <p className={`text-sm ${item.dark ? "text-[#00B4D8]" : "text-muted-foreground"}`}>{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-6">What you get instead</p>
              <ul className="space-y-5">
                {[
                  { label: "Immediate start", desc: "No recruiting cycle, no onboarding delay. Engagements typically begin within one to two weeks of signing." },
                  { label: "No long-term commitment", desc: "Month-to-month with 30 days' notice. Scale up, scale down, or stop — on your timeline." },
                  { label: "No juniors, no handoffs", desc: "Shane does the work. Every deliverable, every review, every recommendation. No team he manages in the background." },
                  { label: "Direct access to Shane", desc: "Direct access via email and Teams throughout. No account managers between you and the architect." },
                  { label: "Current production knowledge", desc: "Every recommendation comes from what Shane is solving at NASA today — not from a playbook written two years ago." },
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3" data-testid={`fractional-benefit-${i}`}>
                    <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[#0A2540] text-sm mb-0.5">{item.label}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Why IT Leaders Bring Me In */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Engagement Triggers</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why IT Leaders Bring Me In</h2>
            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
              There's almost always a specific moment — a trigger — when the cost of not having a senior architect is higher than the cost of bringing one in.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
            {[
              { icon: AlertTriangle, title: "Audit or compliance deadline", desc: "An upcoming FedRAMP assessment, CMMC review, HIPAA audit, or SOC 2 certification — and the M365 environment isn't in the right shape." },
              { icon: Shield, title: "Copilot readiness concerns", desc: "The organization has or is evaluating M365 Copilot licenses and needs to know whether the tenant is safe and ready to deploy into." },
              { icon: AlertTriangle, title: "Failed or stalled migration", desc: "An on-premises to M365 migration, or an M365 reconfiguration project, that has stalled or gone wrong and needs a senior architect to restart." },
              { icon: Shield, title: "Security incident or near-miss", desc: "An oversharing exposure, sensitivity labeling failure, or Conditional Access misconfiguration — caught before or after it became a real problem." },
              { icon: Users, title: "Departed IT leader / leadership gap", desc: "The senior M365 person left, and no one remaining has the architecture depth to make the decisions in the queue." },
              { icon: Layers, title: "Teams and SharePoint chaos", desc: "Permissions sprawl, abandoned sites, no governance model, users working around the system — and no clear path to remediation." },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-white rounded-xl border border-border p-6 hover:border-[#0078D4]/30 hover:shadow-sm transition-all" data-testid={`trigger-card-${i}`}>
                  <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4">
                    <Icon className="w-4 h-4 text-[#0078D4]" />
                  </div>
                  <h3 className="font-bold text-[#0A2540] mb-2 text-sm">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
          <div className="bg-[#0A2540] rounded-xl border border-[#0078D4]/30 p-7 max-w-3xl mx-auto text-center">
            <p className="text-white font-semibold mb-2">If any of these sound familiar</p>
            <p className="text-white/70 text-sm leading-relaxed mb-5">
              Book a free discovery call. 30 minutes — no pitch, no obligation. Shane will tell you exactly what the situation needs and whether it's something he can help with.
            </p>
            <CTAButton href="/book" className="text-sm mx-auto" data-testid="trigger-cta">
              Book a Free Call <ArrowRight className="ml-1 w-4 h-4" />
            </CTAButton>
          </div>
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
