import { useState, useEffect } from "react";
import {
  CheckCircle,
  Clock,
  ArrowRight,
  ChevronRight,
  Zap,
  Minus,
  Info,
  Shield,
  TrendingUp,
  Users,
  Lightbulb,
  MapPin,
  BarChart2,
  Star,
  DollarSign,
} from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface ServiceRecord {
  id: number;
  slug: string | null;
  name: string;
  price: string | null;
  hoursPerMonth: string | null;
  deliverables: string[] | null;
  badge: string | null;
  highlighted: boolean;
}

interface PlanConfig {
  slug: string;
  name: string;
  fallbackPrice: string;
  fallbackHours: string;
  description: string;
  features: string[];
  href: string;
  bookHref: string;
  highlight: boolean;
  badge: string | null;
  responseTime: string;
}

const PLAN_CONFIGS: PlanConfig[] = [
  {
    slug: "architect-essentials",
    name: "Architect Essentials",
    fallbackPrice: "$2,500",
    fallbackHours: "10 hours / month",
    description:
      "Async-first access to a senior M365 architect — ideal for stable environments that need expert oversight without a full-time hire.",
    features: [
      "10 hours of consulting per month",
      "Async-first support (email & Teams)",
      "Monthly architecture review",
      "Light proactive tenant monitoring",
      "1-business-day response time",
      "Monthly written summary",
    ],
    href: "/retainers/architect-essentials",
    bookHref: "/crm/portal/onboarding/select?service=architect-essentials",
    highlight: false,
    badge: null,
    responseTime: "1 business day",
  },
  {
    slug: "architect-growth",
    name: "Architect Growth",
    fallbackPrice: "$6,000",
    fallbackHours: "25 hours / month",
    description:
      "For organizations actively modernizing — proactive monitoring, Power Platform and Copilot advisory, and hands-on configuration keep your project moving every week.",
    features: [
      "25 hours of consulting per month",
      "Proactive tenant health monitoring",
      "Power Platform & Copilot advisory",
      "Hands-on configuration up to 8 hrs / month",
      "2-hour response time",
      "Monthly written summary + roadmap",
    ],
    href: "/retainers/architect-growth",
    bookHref: "/crm/portal/onboarding/select?service=architect-growth",
    highlight: true,
    badge: "Most Popular",
    responseTime: "2 hours",
  },
  {
    slug: "architect-enterprise",
    name: "Architect Enterprise",
    fallbackPrice: "$11,000",
    fallbackHours: "50 hours / month",
    description:
      "Full embedded-architect coverage for complex or regulated enterprises — deep delivery, weekly calls, and a dedicated Slack/Teams channel.",
    features: [
      "50 hours of consulting per month",
      "Unlimited async questions",
      "Weekly architecture sessions",
      "Governance & security builds",
      "Quarterly Roadmap Review",
      "Dedicated Slack/Teams channel",
      "Same-day response",
    ],
    href: "/retainers/architect-enterprise",
    bookHref: "/crm/portal/onboarding/select?service=architect-enterprise",
    highlight: false,
    badge: "Most Comprehensive",
    responseTime: "Same day",
  },
];

const FAQS = [
  {
    q: "Can I change plans after I start?",
    a: "Yes. You can upgrade or downgrade with 30 days' notice. Shane will prorate any balance so you're never paying for hours you haven't used.",
  },
  {
    q: "Do unused hours roll over?",
    a: "Hours reset each month — they don't roll over. This keeps Shane's schedule predictable and ensures every client gets focused, uninterrupted attention.",
  },
  {
    q: "What counts as a consulting hour?",
    a: "Everything: strategy calls, async Q&A, document and architecture reviews, hands-on configuration, and written deliverables. Shane tracks time transparently in a shared log you can view at any time.",
  },
  {
    q: "Is there a minimum commitment?",
    a: "No minimum term. Cancel or pause with 30 days' written notice and you're done — no lock-in, no cancellation fees.",
  },
  {
    q: "Do you work with regulated industries?",
    a: "Yes. Shane regularly supports organizations operating under HIPAA, SOC 2, CMMC, ITAR, and federal government contractor requirements. Architecture decisions account for compliance boundaries from day one.",
  },
];

const TABLE_ROWS = [
  {
    feature: "Hours / month",
    tooltip: "Total consulting hours reserved for your organization each calendar month, used across calls, async Q&A, reviews, and hands-on configuration.",
    essentials: "10 hrs",
    growth: "25 hrs",
    enterprise: "50 hrs",
    type: "text",
  },
  {
    feature: "Response time",
    tooltip: "How quickly Shane acknowledges and begins working on your request during business hours after it is received.",
    essentials: "1 business day",
    growth: "2 hours",
    enterprise: "Same day",
    type: "text",
  },
  {
    feature: "Strategy calls",
    tooltip: "Scheduled video calls where Shane reviews your M365 environment, priorities, and roadmap with your team.",
    essentials: "1 call / month",
    growth: "2 calls / month",
    enterprise: "Weekly",
    type: "text",
  },
  {
    feature: "Proactive tenant monitoring",
    tooltip: "Shane periodically reviews your Microsoft 365 tenant health, security alerts, and service advisories so issues are flagged before they affect users.",
    essentials: false,
    growth: true,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Power Platform & Copilot advisory",
    tooltip: "Guidance on Power Apps, Power Automate, and Microsoft Copilot — from licensing decisions to governed deployment.",
    essentials: false,
    growth: true,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Hands-on configuration",
    tooltip: "Shane directly configures your tenant, policies, or workloads — not just advice, but actual builds.",
    essentials: false,
    growth: true,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Dedicated Slack / Teams channel",
    tooltip: "A private workspace channel for real-time communication with Shane, keeping all project context in one searchable thread.",
    essentials: false,
    growth: false,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Quarterly Roadmap Review",
    tooltip: "A structured session for leadership summarizing M365 progress, risk posture, upcoming changes, and the next-quarter strategic roadmap.",
    essentials: false,
    growth: false,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Monthly written summary",
    tooltip: "A written report delivered at month-end covering completed work, observations, and recommended next steps.",
    essentials: true,
    growth: true,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Full M365 service area access",
    tooltip: "Shane can apply his hours to any Microsoft 365 workload — Teams, SharePoint, Exchange, Copilot, Power Platform, governance, security, and more.",
    essentials: true,
    growth: true,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Governance maturity",
    tooltip: "Structured improvements to your M365 governance posture: policies, naming conventions, lifecycle management, and compliance alignment.",
    essentials: false,
    growth: true,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Copilot readiness",
    tooltip: "Assessment and implementation of the data governance, licensing, and configuration prerequisites for Microsoft 365 Copilot.",
    essentials: false,
    growth: true,
    enterprise: true,
    type: "bool",
  },
  {
    feature: "Architecture clarity",
    tooltip: "Clear documentation and recommendations for your M365 tenant architecture, helping your team make informed decisions.",
    essentials: true,
    growth: true,
    enterprise: true,
    type: "bool",
  },
];

function PriceSkeleton() {
  return (
    <span className="inline-block w-20 h-8 bg-gray-200 rounded animate-pulse" />
  );
}

function HoursSkeleton() {
  return (
    <span className="inline-block w-28 h-4 bg-gray-200/60 rounded animate-pulse" />
  );
}

function TablePriceSkeleton() {
  return (
    <span className="inline-block w-16 h-5 bg-gray-200 rounded animate-pulse" />
  );
}

export default function RetainersOverview() {
  const [apiPlans, setApiPlans] = useState<ServiceRecord[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/services")
      .then((r) => r.json())
      .then((data: ServiceRecord[]) => {
        const retainerSlugs = ["architect-essentials", "architect-growth", "architect-enterprise"];
        const filtered = data.filter((s) => s.slug && retainerSlugs.includes(s.slug));
        setApiPlans(filtered);
      })
      .catch(() => {
        setApiPlans([]);
      })
      .finally(() => setLoading(false));
  }, []);

  function getPlanData(config: PlanConfig) {
    const api = apiPlans?.find((s) => s.slug === config.slug);
    const rawPrice = api?.price;
    const price = rawPrice
      ? `$${Number(rawPrice).toLocaleString()}`
      : config.fallbackPrice;
    const hoursRaw = api?.hoursPerMonth;
    const hours = hoursRaw ? `${hoursRaw} hours / month` : config.fallbackHours;
    return { price, hours };
  }

  function getTablePrice(slug: string, fallback: string) {
    if (loading) return null;
    const api = apiPlans?.find((s) => s.slug === slug);
    if (!api?.price) return fallback;
    return `$${Number(api.price).toLocaleString()}`;
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Microsoft 365 Architect Retainer Plans",
    description:
      "Monthly retainer plans giving you ongoing access to Shane McCaw, NASA's Lead Microsoft 365 Architect — from 10 to 50 hours per month.",
    provider: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Retainer Plans",
      itemListElement: PLAN_CONFIGS.map((p, i) => ({
        "@type": "Offer",
        position: i + 1,
        name: p.name,
        price: p.fallbackPrice.replace("$", "").replace(",", ""),
        priceCurrency: "USD",
        url: `https://shanemccaw.com${p.href}`,
      })),
    },
  };

  return (
    <Layout>
      <SEOMeta
        title="M365 Architect Retainer Plans | Shane McCaw Consulting"
        description="Monthly Microsoft 365 retainer plans — 10, 25, or 50 hours of senior consulting per month. Strategy calls, async support, proactive monitoring, and full-stack M365 expertise from NASA's Lead Architect."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/pricing" className="hover:text-[#0078D4] transition-colors">Pricing</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#0A2540] font-medium">Retainer Plans</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-[#0A2540] pt-16 pb-20 px-6 text-center">
        <div className="max-w-[860px] mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Zap className="w-3.5 h-3.5 text-[#00B4D8]" />
            Fractional M365 Architecture
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
            Fractional M365 Architecture, Delivered by NASA's Lead Architect.
          </h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            For mid-market and regulated organizations that need senior-level clarity, governance, and modernization — without hiring full-time.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-white/50">
            <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-[#00B4D8]" /> No minimum term</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-[#00B4D8]" /> Transparent hour tracking</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-[#00B4D8]" /> NASA-level expertise</span>
          </div>
        </div>
      </section>

      {/* Plan comparison cards */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {PLAN_CONFIGS.map((config) => {
              const { price, hours } = getPlanData(config);
              return (
                <div
                  key={config.slug}
                  className={`relative flex flex-col rounded-2xl border ${
                    config.highlight
                      ? "border-[#0078D4] bg-white shadow-xl ring-2 ring-[#0078D4]/20"
                      : "border-border bg-white shadow-sm"
                  }`}
                >
                  {config.badge && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <span className="bg-[#0078D4] text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap">
                        {config.badge}
                      </span>
                    </div>
                  )}

                  <div className="p-8 pb-6 border-b border-border">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="w-4 h-4 text-[#00B4D8]" />
                      {loading
                        ? <HoursSkeleton />
                        : <span className="text-xs font-bold uppercase tracking-wider text-[#00B4D8]">{hours}</span>
                      }
                    </div>
                    <h2 className="text-xl font-extrabold text-[#0A2540] mb-1">{config.name}</h2>
                    {loading
                      ? <PriceSkeleton />
                      : <p className="text-[#0078D4] text-4xl font-extrabold mb-0.5">{price}</p>
                    }
                    <p className="text-muted-foreground text-sm mb-4">/month · cancel with 30 days' notice</p>
                    <p className="text-foreground/70 text-sm leading-relaxed">{config.description}</p>
                  </div>

                  <div className="p-8 flex-1 flex flex-col">
                    <ul className="space-y-3 flex-1">
                      {config.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                          <span className="text-sm text-foreground">{f}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="mt-8 flex flex-col gap-3">
                      <CTAButton
                        href={config.bookHref}
                        className={`w-full justify-center ${config.highlight ? "" : "bg-[#0A2540] hover:bg-[#0A2540]/90"}`}
                      >
                        Get Started
                      </CTAButton>
                      <Link
                        href={config.href}
                        className="flex items-center justify-center gap-1.5 text-sm text-[#0078D4] font-medium hover:text-[#005A9E] transition-colors"
                      >
                        See full details <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Why Retainers Exist */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[960px] mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">Why retainers exist</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Project-based engagements have a fundamental problem: by the time scope is agreed, proposals are signed, and work begins, your environment has already drifted.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <Clock className="w-5 h-5 text-[#0078D4]" />,
                title: "Predictable access",
                body: "A reserved block of senior time every month — no waiting for availability, no proposal delays.",
              },
              {
                icon: <BarChart2 className="w-5 h-5 text-[#0078D4]" />,
                title: "Predictable cost",
                body: "One flat monthly fee. No hourly invoices, no scope creep, no surprise overages.",
              },
              {
                icon: <Zap className="w-5 h-5 text-[#0078D4]" />,
                title: "Faster modernization",
                body: "Continuous progress each month compounds — you move faster than any project engagement could.",
              },
              {
                icon: <Shield className="w-5 h-5 text-[#0078D4]" />,
                title: "Reduced risk",
                body: "Architecture decisions are reviewed before implementation, not audited after a failed rollout.",
              },
              {
                icon: <Star className="w-5 h-5 text-[#0078D4]" />,
                title: "Senior-only delivery",
                body: "Every hour is Shane's. No junior staff, no account managers — just the architect you hired.",
              },
              {
                icon: <TrendingUp className="w-5 h-5 text-[#0078D4]" />,
                title: "No scoping delays",
                body: "Work begins immediately each month. Need something new? Just ask — no SOW required.",
              },
            ].map((item) => (
              <div key={item.title} className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  {item.icon}
                  <h3 className="font-bold text-[#0A2540]">{item.title}</h3>
                </div>
                <p className="text-sm text-foreground/70 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What Changes When You Have an Architect */}
      <section className="bg-[#0A2540] py-20 px-6">
        <div className="max-w-[960px] mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-3">What changes when you have an architect</h2>
            <p className="text-white/60 max-w-xl mx-auto">
              The difference between managing M365 reactively and having a senior architect guiding it proactively is measurable — in risk, speed, and outcome.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: <Shield className="w-5 h-5 text-[#00B4D8]" />, title: "Governance maturity", body: "Policies, lifecycle management, and compliance alignment that stick." },
              { icon: <Shield className="w-5 h-5 text-[#00B4D8]" />, title: "Reduced risk", body: "Security gaps and misconfigurations are caught before they become incidents." },
              { icon: <TrendingUp className="w-5 h-5 text-[#00B4D8]" />, title: "Faster modernization", body: "Continuous architectural guidance keeps your tenant moving forward." },
              { icon: <Zap className="w-5 h-5 text-[#00B4D8]" />, title: "Copilot readiness", body: "Data governance, licensing, and permissions configured correctly before you deploy AI." },
              { icon: <Lightbulb className="w-5 h-5 text-[#00B4D8]" />, title: "Better decisions", body: "Leadership gets clear recommendations — not vendor-driven marketing." },
              { icon: <MapPin className="w-5 h-5 text-[#00B4D8]" />, title: "Clear roadmap", body: "A prioritized, written plan for your M365 environment — updated every quarter." },
              { icon: <Users className="w-5 h-5 text-[#00B4D8]" />, title: "No drift, no chaos", body: "Your tenant evolves with intention, not with whoever last opened the admin center." },
              { icon: <DollarSign className="w-5 h-5 text-[#00B4D8]" />, title: "License optimization", body: "Right-size your M365 licensing. Stop paying for seats and SKUs you don't need." },
              { icon: <Clock className="w-5 h-5 text-[#00B4D8]" />, title: "Faster issue resolution", body: "When something breaks, a senior architect knows exactly where to look — no ticket queue, no guessing." },
            ].map((item) => (
              <div key={item.title} className="bg-white/5 rounded-xl p-6 border border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  {item.icon}
                  <h3 className="font-bold text-white">{item.title}</h3>
                </div>
                <p className="text-sm text-white/60 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Shane? */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">Why Shane?</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              There are many M365 consultants. There is one with this combination of credentials.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                label: "NASA Lead Architect",
                body: "Shane served as the Lead Microsoft 365 Architect at NASA — managing one of the most complex and compliance-intensive M365 deployments in the federal government.",
              },
              {
                label: "30 years in Microsoft",
                body: "Three decades working inside the Microsoft ecosystem means Shane's expertise is deep, not surface-level. He has seen every major platform shift firsthand.",
              },
              {
                label: "Senior-only, always",
                body: "No junior consultants, no account managers, no handoffs. When you hire Shane, every hour of every deliverable is Shane.",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-border bg-[#F7F9FC] p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
                  <Star className="w-5 h-5 text-[#0078D4]" />
                </div>
                <h3 className="font-extrabold text-[#0A2540] text-lg mb-3">{item.label}</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[1000px] mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">Compare plans at a glance</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">Every feature, side by side — so you can pick the tier that fits without reading each card twice.</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="bg-[#F7F9FC] text-left px-6 py-4 font-semibold text-[#0A2540] w-[38%] border-b border-border">Feature</th>
                  <th className="bg-[#F7F9FC] text-center px-4 py-4 border-b border-border w-[20%]">
                    <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Essentials</span>
                    {loading
                      ? <TablePriceSkeleton />
                      : <span className="block text-xl font-extrabold text-[#0A2540]">{getTablePrice("architect-essentials", "$2,500")}<span className="text-sm font-normal text-muted-foreground">/mo</span></span>
                    }
                  </th>
                  <th className="bg-[#0078D4]/5 text-center px-4 py-4 border-b border-[#0078D4]/30 w-[20%] relative">
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#0078D4] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap">Most Popular</span>
                    <span className="block text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">Growth</span>
                    {loading
                      ? <TablePriceSkeleton />
                      : <span className="block text-xl font-extrabold text-[#0A2540]">{getTablePrice("architect-growth", "$6,000")}<span className="text-sm font-normal text-muted-foreground">/mo</span></span>
                    }
                  </th>
                  <th className="bg-[#F7F9FC] text-center px-4 py-4 border-b border-border w-[22%]">
                    <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Enterprise</span>
                    {loading
                      ? <TablePriceSkeleton />
                      : <span className="block text-xl font-extrabold text-[#0A2540]">{getTablePrice("architect-enterprise", "$11,000")}<span className="text-sm font-normal text-muted-foreground">/mo</span></span>
                    }
                  </th>
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 0 ? "bg-white" : "bg-[#F7F9FC]/50"}>
                    <td className="px-6 py-4 font-medium text-[#0A2540] border-b border-border/60">
                      <span className="flex items-center gap-1.5">
                        {row.feature}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="text-muted-foreground/50 hover:text-[#0078D4] transition-colors focus:outline-none" aria-label={`About ${row.feature}`}>
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[220px] text-center leading-relaxed">
                            {row.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center border-b border-border/60">
                      {row.type === "bool"
                        ? row.essentials
                          ? <CheckCircle className="w-5 h-5 text-[#0078D4] mx-auto" />
                          : <Minus className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                        : <span className="text-foreground/80 text-xs font-medium">{row.essentials as string}</span>}
                    </td>
                    <td className="px-4 py-4 text-center bg-[#0078D4]/5 border-b border-[#0078D4]/15">
                      {row.type === "bool"
                        ? row.growth
                          ? <CheckCircle className="w-5 h-5 text-[#0078D4] mx-auto" />
                          : <Minus className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                        : <span className="text-[#0078D4] text-xs font-bold">{row.growth as string}</span>}
                    </td>
                    <td className="px-4 py-4 text-center border-b border-border/60">
                      {row.type === "bool"
                        ? row.enterprise
                          ? <CheckCircle className="w-5 h-5 text-[#0078D4] mx-auto" />
                          : <Minus className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                        : <span className="text-foreground/80 text-xs font-medium">{row.enterprise as string}</span>}
                    </td>
                  </tr>
                ))}
                {/* CTA row */}
                <tr className="bg-white">
                  <td className="px-6 py-5 text-muted-foreground text-xs italic">All plans: no minimum term · cancel with 30 days' notice</td>
                  <td className="px-4 py-5 text-center">
                    <Link href="/crm/portal/onboarding/select?service=architect-essentials" className="inline-flex items-center justify-center gap-1 text-xs font-bold text-[#0078D4] hover:text-[#005A9E] transition-colors">
                      Get started <ArrowRight className="w-3 h-3" />
                    </Link>
                  </td>
                  <td className="px-4 py-5 text-center bg-[#0078D4]/5">
                    <Link href="/crm/portal/onboarding/select?service=architect-growth" className="inline-flex items-center justify-center gap-1 text-xs font-bold text-white bg-[#0078D4] hover:bg-[#005A9E] transition-colors px-3 py-1.5 rounded-full">
                      Get started <ArrowRight className="w-3 h-3" />
                    </Link>
                  </td>
                  <td className="px-4 py-5 text-center">
                    <Link href="/crm/portal/onboarding/select?service=architect-enterprise" className="inline-flex items-center justify-center gap-1 text-xs font-bold text-[#0078D4] hover:text-[#005A9E] transition-colors">
                      Get started <ArrowRight className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* How We Work Together */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">How we work together</h2>
          <p className="text-muted-foreground mb-12 max-w-xl mx-auto">
            A retainer gives you a reserved block of Shane's time each month — no need to scope a project or wait for a proposal. Here's what working together actually looks like.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
            {[
              {
                step: "1",
                title: "Async-first communication",
                body: "Most questions are answered asynchronously — via Teams or email — so you get answers without waiting for a scheduled call.",
              },
              {
                step: "2",
                title: "Strategy calls",
                body: "Scheduled video sessions to review priorities, roadmap decisions, and architecture questions with your team.",
              },
              {
                step: "3",
                title: "Architecture reviews",
                body: "Shane reviews proposals, designs, and tenant configurations before you commit — catching risks early.",
              },
              {
                step: "4",
                title: "Hands-on configuration",
                body: "When guidance isn't enough, Shane directly configures policies, workloads, and governance rules inside your tenant.",
              },
              {
                step: "5",
                title: "Transparent hour tracking",
                body: "Time is logged in a shared document you can view at any time — no surprises at month-end.",
              },
              {
                step: "6",
                title: "Monthly written summary",
                body: "A concise report of what was accomplished, what was observed, and what Shane recommends for next month.",
              },
            ].map((item) => (
              <div key={item.step} className="bg-[#F7F9FC] rounded-xl p-6 border border-border">
                <div className="w-9 h-9 rounded-full bg-[#0078D4] flex items-center justify-center mb-4">
                  <span className="text-white text-sm font-bold">{item.step}</span>
                </div>
                <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[800px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-10 text-center">Frequently asked questions</h2>
          <div className="space-y-5">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-6 shadow-sm">
                <h3 className="font-bold text-[#0A2540] mb-2">{faq.q}</h3>
                <p className="text-foreground/70 text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-[700px] mx-auto">
          <h2 className="text-3xl font-extrabold text-white mb-4">Book a Free Discovery Call</h2>
          <p className="text-white/60 mb-8 text-lg">
            Speak directly with Shane — no salespeople, no pressure.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book" className="px-8 py-4 text-base">Book a Free Discovery Call</CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/70 hover:text-white font-medium text-base transition-colors"
            >
              Send Shane a message <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
