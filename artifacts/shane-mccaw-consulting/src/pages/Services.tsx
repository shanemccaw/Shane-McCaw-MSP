import { SEOMeta } from "@/components/SEOMeta";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import {
  Cloud, Bot, Layout as LayoutIcon, Zap, Shield, Server, Users, ArrowRight,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award, Sparkles,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock, AlertTriangle,
  DollarSign, Layers, Lightbulb, type LucideIcon
} from "lucide-react";
import { ConsultationCTA } from "@/components/ConsultationCTA";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Layout: LayoutIcon, Zap, Shield, Server, Users, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock,
};

function resolveIcon(name: string | null, fallback: LucideIcon = Cloud): LucideIcon {
  if (!name) return fallback;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? fallback;
}

const BADGE_COLORS: Record<string, string> = {
  Popular: "bg-[#0078D4]/10 text-[#0078D4]",
  "Most Popular": "bg-[#0078D4] text-white",
  New: "bg-emerald-100 text-emerald-700",
  "Best Value": "bg-amber-100 text-amber-700",
  Featured: "bg-purple-100 text-purple-700",
};

function badgeClass(badge: string): string {
  return BADGE_COLORS[badge] ?? "bg-[#0078D4]/10 text-[#0078D4]";
}

function ServiceDetailCard({ s, index }: { s: PublicService; index: number }) {
  const Icon = resolveIcon(s.iconName);
  const inclusions = s.inclusions ?? [];
  const features = s.features ?? [];
  const priceDisplay = formatPriceDisplay(s);
  const deliverableLines = s.deliverables
    ? s.deliverables.split("\n").filter(l => l.trim())
    : [];
  const isHighlighted = s.highlighted ?? false;

  return (
    <div
      className={`relative rounded-xl border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 ${isHighlighted ? "bg-[#0A2540] border-[#0078D4]/60" : "bg-white border-border"}`}
      data-testid={`service-card-${index}`}
    >
      {isHighlighted && s.badge && (
        <div className="absolute -top-4 left-0 right-0 flex justify-center">
          <span className="bg-[#0078D4] text-white text-xs font-bold uppercase tracking-wider px-4 py-1.5 rounded-full">
            {s.badge}
          </span>
        </div>
      )}

      {/* Header: icon + badge */}
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${isHighlighted ? "bg-white/10" : "bg-[#0078D4]/10"}`}>
          <Icon className={`w-5 h-5 ${isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`} />
        </div>
        {s.badge && !isHighlighted && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badgeClass(s.badge)}`}>
            {s.badge}
          </span>
        )}
      </div>

      {/* Category */}
      {s.category && (
        <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${isHighlighted ? "text-white/50" : "text-muted-foreground"}`}>{s.category}</p>
      )}

      {/* Price */}
      {priceDisplay !== "Contact for pricing" && (
        <p className="text-[#0078D4] text-2xl font-extrabold mb-2">{priceDisplay}</p>
      )}

      {/* Name */}
      <h3 className={`text-xl font-bold leading-snug mb-2 ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>{s.name}</h3>

      {/* Tagline */}
      {s.tagline && (
        <p className={`text-sm italic mb-3 ${isHighlighted ? "text-white/60" : "text-muted-foreground"}`}>{s.tagline}</p>
      )}

      {/* Description */}
      {s.description && (
        <p className={`text-sm leading-relaxed mb-4 ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>{s.description}</p>
      )}

      {/* Meta chips */}
      {(s.turnaround || s.billingType || s.hoursPerMonth) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {s.hoursPerMonth && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${isHighlighted ? "bg-white/10 border border-white/20 text-[#00B4D8]" : "bg-[#F7F9FC] border border-border text-muted-foreground"}`}>
              {s.hoursPerMonth}/mo
            </span>
          )}
          <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${isHighlighted ? "bg-white/10 border border-white/20 text-white/70" : "bg-[#F7F9FC] border border-border text-muted-foreground"}`}>
            {s.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time"}
          </span>
        </div>
      )}

      {/* Target audience */}
      {s.targetAudience && (
        <p className={`text-sm mb-4 ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>
          <span className={`font-semibold ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>Best for:</span> {s.targetAudience}
        </p>
      )}

      {/* Inclusions */}
      {inclusions.length > 0 && (
        <div className={`border-t pt-4 mb-4 ${isHighlighted ? "border-white/10" : "border-border"}`}>
          <p className={`text-sm font-semibold mb-3 ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>What's Included:</p>
          <ul className="space-y-2">
            {inclusions.map((item, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${isHighlighted ? "text-white/80" : "text-muted-foreground"}`}>
                <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isHighlighted ? "text-[#00B4D8]" : "text-[#0078D4]"}`} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Features */}
      {features.length > 0 && (
        <div className="mb-4">
          <ul className="space-y-1">
            {features.map((f, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${isHighlighted ? "bg-[#00B4D8]" : "bg-[#00B4D8]"}`} />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deliverables */}
      {deliverableLines.length > 0 && (
        <div className="mb-4">
          <p className={`text-sm font-semibold mb-1.5 ${isHighlighted ? "text-white" : "text-[#0A2540]"}`}>Deliverables:</p>
          <ul className="space-y-1">
            {deliverableLines.map((line, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${isHighlighted ? "text-white/70" : "text-muted-foreground"}`}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                {line.trim()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA */}
      <div className="mt-auto pt-4">
        <CTAButton
          href="/crm/portal/onboarding/select"
          className="w-full justify-center text-sm"
          data-testid={`service-cta-${index}`}
        >
          Get Started
        </CTAButton>
      </div>
    </div>
  );
}

export default function Services() {
  const { services, loading } = useServices("retainer");

  return (
    <Layout>
      <SEOMeta
        title="Fractional M365 Architect Retainer | Shane McCaw Consulting"
        description="Ongoing senior Microsoft 365 architecture support from NASA's Lead M365 Architect. Monthly retainer engagements — direct access to Shane, no juniors, no handoffs."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ProfessionalService",
          "name": "Shane McCaw Consulting",
          "url": "https://shanemccaw.com/services",
          "description": "Fractional M365 architect retainer services by Shane McCaw, NASA Lead M365 Architect.",
          "founder": { "@type": "Person", "name": "Shane McCaw" },
          "areaServed": "US",
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Fractional Architect Retainer Plans",
            "itemListElement": services.map((s) => ({
              "@type": "Offer",
              "itemOffered": { "@type": "Service", "name": s.name }
            }))
          }
        }}
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Fractional Architecture</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            The Complete Microsoft Ecosystem Practice
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            Senior-level M365 architecture on a monthly retainer — handled personally by Shane McCaw, NASA's Lead M365 Architect. No project managers. No junior staff. No handoffs.
          </p>
        </div>
      </section>

      {/* NASA Positioning */}
      <section className="bg-white py-14 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Why It Matters</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 leading-snug">
                The Architect Who Built at NASA Scale — Available to You.
              </h2>
              <p className="text-foreground leading-relaxed mb-3">
                Shane McCaw has spent 30 years inside the Microsoft ecosystem — writing production code, building enterprise architecture, and for the past six years serving as Lead Microsoft 365 Architect and Copilot SME at NASA. His day job involves managing M365 governance and compliance in a FISMA High, FedRAMP-authorized environment that also operates under ITAR and GCC/GCC High requirements — one of the most constrained Microsoft 365 deployments in the federal government.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                For mid-market organizations, regulated industries, and government contractors, this translates directly: every retainer engagement draws from what Shane is solving in production today, under real federal compliance accountability. You're not getting theoretical best practices — you're getting tested judgment from the highest-stakes M365 environment in existence.
              </p>
            </div>
            <div className="flex flex-wrap lg:flex-col gap-3 lg:w-56 flex-shrink-0">
              {[
                { label: "FedRAMP Authorized" },
                { label: "FISMA High" },
                { label: "ITAR Compliance" },
                { label: "GCC / GCC High" },
                { label: "30 Years Microsoft" },
                { label: "NASA Lead Architect" },
              ].map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-2 bg-[#0078D4]/8 border border-[#0078D4]/20 text-[#0078D4] text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap">
                  <Shield className="w-3 h-3 flex-shrink-0" />{tag.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tiered Engagement Model */}
      <section className="bg-[#F7F9FC] py-14 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-10">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Engagement Model</p>
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540]">Where Fractional Architecture Fits Into Your M365 Strategy</h2>
            <p className="text-muted-foreground mt-3 max-w-2xl mx-auto leading-relaxed">
              Most organizations begin with a targeted quick win to surface the real issues, then move into ongoing architecture support as the scope becomes clear.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                tier: "Entry",
                color: "bg-emerald-50 border-emerald-200",
                labelColor: "text-emerald-700 bg-emerald-100",
                title: "Quick-Win Packages",
                desc: "Fast, fixed-price engagements that surface what's broken and give you a prioritized roadmap.",
                offers: ["M365 Tenant Health Audit", "Migration Readiness Assessment"],
                href: "/micro-offers",
                cta: "View Packages",
              },
              {
                tier: "Core",
                color: "bg-blue-50 border-blue-200",
                labelColor: "text-[#0078D4] bg-[#0078D4]/10",
                title: "Governance & Readiness",
                desc: "Deeper engagements that fix the architectural debt and prepare the environment for Copilot and scale.",
                offers: ["Governance Foundations Package", "Power Platform Quick-Start", "Copilot Readiness Assessment"],
                href: "/micro-offers",
                cta: "View Packages",
              },
              {
                tier: "Strategic",
                color: "bg-[#0A2540] border-[#0078D4]/40",
                labelColor: "text-[#00B4D8] bg-white/10",
                title: "Fractional Architecture",
                desc: "Ongoing senior M365 architecture on retainer — embedded in your operations monthly, without full-time overhead.",
                offers: ["Architect Essentials", "Architect Growth", "Architect Enterprise"],
                href: "/services",
                cta: "You're here",
                current: true,
              },
            ].map((tier, i) => (
              <div key={i} className={`rounded-xl border p-6 flex flex-col ${tier.color}`}>
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full ${tier.labelColor}`}>{tier.tier} Tier</span>
                  {tier.current && <span className="text-xs text-[#00B4D8] font-semibold">← This page</span>}
                </div>
                <h3 className={`font-extrabold text-base mb-2 ${tier.current ? "text-white" : "text-[#0A2540]"}`}>{tier.title}</h3>
                <p className={`text-sm leading-relaxed mb-4 flex-grow ${tier.current ? "text-white/70" : "text-muted-foreground"}`}>{tier.desc}</p>
                <ul className="space-y-1 mb-5">
                  {tier.offers.map((o, j) => (
                    <li key={j} className={`text-xs flex items-center gap-2 ${tier.current ? "text-white/60" : "text-muted-foreground"}`}>
                      <span className={`w-1 h-1 rounded-full flex-shrink-0 ${tier.current ? "bg-[#00B4D8]" : "bg-[#0078D4]"}`} />
                      {o}
                    </li>
                  ))}
                </ul>
                {!tier.current && (
                  <Link href={tier.href} className="text-[#0078D4] text-sm font-semibold inline-flex items-center gap-1 hover:gap-2 transition-all">
                    {tier.cta} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            ))}
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
                Most clients begin with the <Link href="/micro-offers" className="text-[#0078D4] font-medium hover:underline">M365 Tenant Health Audit</Link> or the <Link href="/micro-offers" className="text-[#0078D4] font-medium hover:underline">Migration Readiness Assessment</Link> — fast, low-risk engagements that surface the real issues and give you the clarity to decide whether ongoing architecture support makes sense.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Retainer Cards */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Retainer Plans</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Choose Your Engagement Level</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              All plans include direct access to Shane — no project managers, no junior consultants. Cancel or adjust with 30 days' notice.
            </p>
          </div>
          {loading && services.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-border p-8 h-96 animate-pulse" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-12">No retainer plans published yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
              {services.map((s, i) => (
                <ServiceDetailCard key={s.slug ?? i} s={s} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Why Fractional Architecture */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">The Business Case</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6 leading-tight">Why Fractional Architecture?</h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Most organizations that need senior M365 architecture expertise face a difficult choice: hire a full-time architect at significant cost, or go without. Fractional architecture is a third option — and for most mid-market organizations, it's the right one.
              </p>
              <div className="space-y-5">
                {[
                  { icon: DollarSign, label: "Full-time senior M365 architect", value: "$160k–$220k salary + benefits + equity", highlight: false },
                  { icon: DollarSign, label: "Fractional retainer with Shane", value: "10–20% of full-time cost, no overhead", highlight: true },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div key={i} className={`flex items-start gap-4 rounded-xl border p-5 ${item.highlight ? "bg-[#0A2540] border-[#0078D4]/40" : "bg-[#F7F9FC] border-border"}`}>
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${item.highlight ? "bg-white/10" : "bg-[#0078D4]/10"}`}>
                        <Icon className={`w-4 h-4 ${item.highlight ? "text-[#00B4D8]" : "text-[#0078D4]"}`} />
                      </div>
                      <div>
                        <p className={`text-sm font-semibold mb-0.5 ${item.highlight ? "text-white" : "text-[#0A2540]"}`}>{item.label}</p>
                        <p className={`text-sm ${item.highlight ? "text-[#00B4D8]" : "text-muted-foreground"}`}>{item.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-6">What You Get</p>
              <ul className="space-y-4">
                {[
                  { label: "Immediate start", desc: "No recruiting, no onboarding cycle. Engagements typically begin within one to two weeks." },
                  { label: "No long-term commitment", desc: "Month-to-month with 30 days' notice. Scale up or down as your needs change." },
                  { label: "No juniors, no handoffs", desc: "Shane does the work. Not a team he manages — Shane, personally, on every engagement." },
                  { label: "Direct access", desc: "Direct access to Shane via email and Teams throughout the engagement. No account managers between you and the architect." },
                  { label: "Current production knowledge", desc: "Every recommendation draws from what Shane is solving at NASA today — not from a playbook written two years ago." },
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
              There's almost always a specific trigger — a moment when the stakes are clear enough that the cost of not having a senior architect is higher than the cost of bringing one in.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
            {[
              { icon: AlertTriangle, title: "Audit or compliance deadline", desc: "An upcoming audit, FedRAMP assessment, CMMC review, or HIPAA requirement — and the M365 environment isn't ready." },
              { icon: Shield, title: "Copilot readiness concerns", desc: "The organization has or is evaluating Microsoft 365 Copilot licenses and needs to know whether the tenant is safe to deploy into." },
              { icon: AlertTriangle, title: "Failed or stalled migration", desc: "An on-premises to M365 migration, or an M365 reconfiguration project, that has stalled or gone wrong and needs a senior architect to diagnose and restart." },
              { icon: Shield, title: "Security incident or near-miss", desc: "An oversharing exposure, a sensitivity labeling failure, or a Conditional Access misconfiguration — caught before or after it became a real problem." },
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
            <p className="text-white font-semibold mb-2">The common thread</p>
            <p className="text-white/70 text-sm leading-relaxed">
              In every one of these situations, someone needs to make high-stakes decisions about a complex Microsoft 365 environment — quickly, confidently, and without a months-long ramp-up. Shane reduces risk because he has already solved these problems at NASA scale, under federal compliance accountability. He doesn't theorize. He applies what he tested last week in production.
            </p>
          </div>
        </div>
      </section>

      {/* Discovery Call CTA */}
      <section className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-8 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
            <div>
              <h3 className="text-xl font-bold text-[#0A2540] mb-2">Book a Free Discovery Call</h3>
              <p className="text-foreground mb-1">No pitch. No obligation. Just clarity.</p>
              <p className="text-muted-foreground text-sm">Work directly with Shane — no account managers, no junior staff. 30 minutes to understand your environment and what it needs.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
              <CTAButton href="/book" className="text-sm whitespace-nowrap" data-testid="services-book-link">
                Book Free Call <ArrowRight className="ml-1 w-4 h-4" />
              </CTAButton>
              <Link href="/micro-offers" className="inline-flex items-center justify-center border border-[#0078D4] text-[#0078D4] font-semibold px-5 py-2.5 rounded hover:bg-[#0078D4] hover:text-white transition-colors text-sm whitespace-nowrap" data-testid="services-micro-offers-link">
                View Quick Wins
              </Link>
              <CTAButton href="/crm/portal/onboarding/select" className="text-sm whitespace-nowrap" data-testid="services-get-started-link">
                Get Started
              </CTAButton>
            </div>
          </div>
        </div>
      </section>

      <ConsultationCTA />
    </Layout>
  );
}
