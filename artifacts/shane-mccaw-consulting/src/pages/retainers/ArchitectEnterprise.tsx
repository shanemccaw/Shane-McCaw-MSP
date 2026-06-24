import { CheckCircle, Clock, ArrowRight, ChevronRight, Shield, Building2, ShieldCheck, Users, Rocket, BarChart3, XCircle } from "lucide-react";
import { TestimonialDiscountCallout } from "@/components/TestimonialDiscountCallout";
import { useServices, formatPrice } from "@/hooks/useServices";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";

const FEATURES = [
  "50 hours of senior consulting per month",
  "Same-day response (within business hours)",
  "Weekly architecture leadership sessions (60 min)",
  "Unlimited async support via dedicated Teams/Slack channel",
  "Governance framework builds and policy authoring",
  "Copilot for Microsoft 365 deployment leadership",
  "Power Platform guardrails and Center of Excellence setup",
  "SharePoint and Teams architecture design and oversight",
  "Quarterly Roadmap Review with your leadership team",
  "Dedicated Teams or Slack channel — direct access to Shane",
  "Proactive tenant health monitoring and risk flagging",
  "Monthly written architecture summary and next-steps brief",
];

const HOURS_INCLUDED = [
  "Architecture design sessions and whiteboarding",
  "Governance policy authoring and documentation",
  "Copilot readiness assessments and deployment leadership",
  "SharePoint and Teams topology planning",
  "Power Platform solution review and guardrail design",
  "Security posture reviews and hardening recommendations",
  "Licensing analysis and optimization advisory",
  "Cross-team alignment calls and stakeholder briefings",
  "Tenant health monitoring and incident escalation support",
  "Written deliverables: summaries, roadmaps, architecture briefs",
];

const NOT_INCLUDED = [
  "Project execution or hands-on technical implementation",
  "Unlimited or unscheduled live meetings beyond the weekly session",
  "Junior or delegated staff — all work is Shane, senior-only",
  "MSP-style helpdesk or ticket resolution",
  "Device management, endpoint support, or hardware advisory",
];

const WHO_ITS_FOR = [
  {
    icon: ShieldCheck,
    title: "Regulated industries and complex governance environments",
    body: "Healthcare, finance, federal contractors, and defense primes where M365 misconfiguration is a compliance liability — and where governance documentation must withstand regulatory scrutiny.",
  },
  {
    icon: Building2,
    title: "Organizations with complex multi-workload M365 deployments",
    body: "Enterprises running SharePoint, Teams, Power Platform, Copilot, and Entra ID simultaneously who need coordinated architectural oversight — not siloed advice.",
  },
  {
    icon: Rocket,
    title: "Organizations deploying Copilot for Microsoft 365 at scale",
    body: "IT leadership preparing for or actively rolling out Copilot who need a senior architect to lead readiness assessment, data governance prerequisites, and adoption architecture.",
  },
  {
    icon: BarChart3,
    title: "Organizations undergoing major M365 modernization",
    body: "Companies in mid-stream on a cloud migration, M365 consolidation post-merger, or enterprise-wide SharePoint rebuild who need dedicated senior oversight through the full arc of transformation.",
  },
  {
    icon: Users,
    title: "IT teams that need senior architectural leadership above the team",
    body: "Internal IT teams who manage M365 day-to-day but lack a principal architect — and need one embedded above the team for escalation, direction, governance, and cross-team coordination.",
  },
];


const TYPICAL_MONTH = [
  {
    week: "Week 1",
    activity:
      "Weekly architecture leadership session (60 min). Shane reviews your current-state roadmap, open governance and security items, escalations from the prior month, and agrees on this month's primary and secondary focus areas. No agenda overhead — you show up to a structured, senior-led session.",
  },
  {
    week: "Week 2",
    activity:
      "Deep-dive execution on the month's primary initiative: governance framework build, security hardening review, Copilot deployment architecture, SharePoint topology redesign, Power Platform CoE setup, or cross-workload integration review. Async channel remains active for anything that surfaces.",
  },
  {
    week: "Week 3",
    activity:
      "Cross-team alignment and escalation support. Shane engages your stakeholders, security team, or leadership as needed — attending internal briefings, advising on decisions in progress, and resolving architectural blockers via the dedicated channel.",
  },
  {
    week: "Week 4",
    activity:
      "Deliverables finalized and monthly written summary delivered: what was completed, what was flagged, risks identified, and recommended priorities for next month. Quarterly months include a 90-minute Roadmap Review with your leadership team. Next month's focus is agreed before the month closes.",
  },
];

const WHY_EXISTS = [
  "Governance maturity cannot be built in sprints — it requires consistent senior oversight applied month after month",
  "Security hardening in complex M365 environments requires architectural authority, not ticket-by-ticket fixes",
  "Copilot for Microsoft 365 deployments at scale fail without architectural prerequisites — data governance, permissions, and tenant hygiene must be designed before rollout",
  "Regulated industries face audit risk from configuration drift that no internal team catches without a dedicated senior architect reviewing the environment monthly",
  "Faster modernization happens when a principal architect removes blockers before they stall the project — not after",
  "Architecture-first clarity eliminates the downstream rework that costs organizations far more than the retainer itself",
  "IT teams with a senior architect above them make better decisions faster — and escalate the right things, not everything",
  "Shane's engagement means one accountable senior architect, not a rotating cast of consultants with inconsistent context",
];

const WHY_SHANE = [
  "Lead Microsoft 365 Architect at NASA — responsible for the governance, security, and architecture of one of the most complex M365 deployments in the US federal space",
  "30 years of continuous Microsoft ecosystem experience — from on-premises roots through every generation of cloud transformation",
  "Senior-only engagement — every hour is Shane. No junior staff, no account managers, no delegated delivery",
  "Federal-grade accountability — the governance standards and architectural discipline built for NASA applied to your environment",
  "Principal architect model — not a generalist consultant, not a managed service provider, but a dedicated senior architect with deep M365 specialization",
  "Direct access, every time — one dedicated channel to Shane. No ticketing, no gatekeeping, no support tiers",
];

export default function ArchitectEnterprise() {
  const { services, loading: tiersLoading } = useServices("retainer");

  const enterpriseSvc = services.find((s) => s.slug === "architect-enterprise");
  const displayPrice = formatPrice(enterpriseSvc?.price ?? null) ?? "$11,000";

  const tiers = [...services]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      name: s.name,
      price: formatPrice(s.price) ?? "—",
      hours: s.hoursPerMonth ? `${s.hoursPerMonth.replace(/[^0-9]/g, "")} hrs/mo` : "—",
      href: s.pageHref ?? "#",
      current: s.pageHref === "/retainers/architect-enterprise",
    }));

  const livePrice = enterpriseSvc?.price ?? "11000.00";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: "Architect Enterprise Retainer — Shane McCaw Consulting",
    description:
      "Enterprise-grade Microsoft 365 architecture from NASA's Lead M365 Architect. 50 hours/month of senior-only consulting — weekly leadership sessions, same-day response, governance builds, Copilot deployment leadership, and a monthly written architecture summary.",
    price: livePrice,
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: livePrice,
      priceCurrency: "USD",
      unitText: "MONTH",
    },
    seller: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
      description: "30-year Microsoft ecosystem veteran and NASA's Lead M365 Architect.",
    },
    url: "https://shanemccaw.com/retainers/architect-enterprise",
  };

  return (
    <Layout>
      <SEOMeta
        title="Architect Enterprise Retainer — $11,000/mo | Shane McCaw Consulting"
        description="Enterprise-grade M365 architecture from NASA's Lead Architect. 50 hours/month of senior-only consulting — weekly sessions, same-day response, governance builds, and Copilot deployment leadership for regulated and complex organizations."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/pricing#retainers" className="hover:text-[#0078D4] transition-colors">Retainer Plans</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#0A2540] font-medium">Architect Enterprise</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[130px] pb-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5 text-[#00B4D8]" />
              50 hours / month
            </div>
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Shield className="w-3.5 h-3.5 text-[#00B4D8]" />
              Same-day response
            </div>
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              Current NASA Lead M365 Architect
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
            Enterprise-Grade M365 Architecture,<br className="hidden md:block" /> Delivered by NASA's Lead Architect
          </h1>

          <p className="text-white/60 text-sm uppercase tracking-widest font-bold mb-6">
            Architect Enterprise Retainer
          </p>

          <p className="text-[#00B4D8] text-5xl font-extrabold mb-2">{displayPrice}</p>
          <p className="text-white/50 mb-8 text-lg">/month · cancel anytime</p>

          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-4">
            For regulated, complex, and high-risk organizations where M365 is not just infrastructure — it's the operational backbone your compliance posture, security model, and enterprise productivity depend on.
          </p>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Architect Enterprise gives you 50 hours per month of senior-only M365 consulting from the architect who designed governance, security, and architecture at NASA. Weekly leadership sessions, same-day response, governance builds, Copilot deployment leadership, and a written architecture summary every month. One architect. Full accountability. No delegation.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/crm/portal/onboarding/select?service=architect-enterprise" className="px-8 py-4 text-base">
              Get Started
            </CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/80 hover:text-white font-medium text-base transition-colors"
            >
              Talk to Shane first <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Plan comparison strip */}
      <section className="bg-white border-b border-border py-8 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">Compare all retainer tiers</p>
          <div className="grid grid-cols-3 gap-3">
            {tiersLoading
              ? [0, 1, 2].map((i) => (
                  <div key={i} className="rounded-xl border p-4 text-center bg-[#F7F9FC] animate-pulse">
                    <div className="h-3 bg-gray-200 rounded mb-2 mx-auto w-16" />
                    <div className="h-5 bg-gray-300 rounded mb-1 mx-auto w-28" />
                    <div className="h-4 bg-gray-200 rounded mx-auto w-20" />
                  </div>
                ))
              : tiers.map((tier) => (
                  <Link
                    key={tier.href}
                    href={tier.href}
                    className={`rounded-xl border p-4 text-center transition-all ${
                      tier.current
                        ? "bg-[#0078D4] border-[#0078D4] text-white shadow-md"
                        : "bg-[#F7F9FC] border-border text-[#0A2540] hover:border-[#0078D4]/50 hover:shadow-sm"
                    }`}
                  >
                    <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${tier.current ? "text-white/70" : "text-muted-foreground"}`}>{tier.hours}</p>
                    <p className={`font-extrabold text-lg mb-0.5 ${tier.current ? "text-white" : "text-[#0A2540]"}`}>{tier.name}</p>
                    <p className={`text-sm font-semibold ${tier.current ? "text-white/80" : "text-[#0078D4]"}`}>{tier.price}/mo</p>
                  </Link>
                ))}
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">What's Included</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">What you get every month</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Every Architect Enterprise engagement includes the following, applied consistently across every calendar month.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-3 bg-[#F7F9FC] rounded-xl p-5 border border-border">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] font-medium">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's Included in the Hours */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">Hour Categories</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">What's included in the 50 hours</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Your 50 hours per month are applied across the following work categories — prioritized each month based on your current architectural needs.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {HOURS_INCLUDED.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-border">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What Is NOT Included */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="bg-[#0A2540] rounded-2xl p-8 md:p-10">
            <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-wider mb-3">Scope Boundaries</p>
            <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-4">What is NOT included</h2>
            <p className="text-white/60 mb-8 max-w-xl leading-relaxed">
              Architect Enterprise is a senior architectural advisory engagement. The following are explicitly out of scope — not because they aren't valuable, but because clarity on boundaries protects both sides.
            </p>
            <ul className="space-y-4">
              {NOT_INCLUDED.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="text-white/80 font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">Ideal Fit</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">Who this plan is for</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Architect Enterprise is the right engagement if any of these describe your organization:
          </p>
          <ul className="space-y-4">
            {WHO_ITS_FOR.map((item, i) => {
              const Icon = item.icon;
              return (
                <li key={i} className="flex items-start gap-4 bg-white rounded-xl p-5 border border-border shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <div>
                    <p className="font-bold text-[#0A2540] mb-1">{item.title}</p>
                    <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Typical month */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">Monthly Structure</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">What a typical month looks like</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Here's exactly how Shane structures your 50 hours across a calendar month — from day one.
          </p>
          <div className="relative pl-6 border-l-2 border-[#0078D4]/20 space-y-8">
            {TYPICAL_MONTH.map((item, i) => (
              <div key={i} className="relative">
                <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-[#0078D4] border-2 border-white shadow" />
                <p className="text-[#0078D4] text-xs font-bold uppercase tracking-wider mb-1">{item.week}</p>
                <p className="text-foreground leading-relaxed">{item.activity}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why This Plan Exists */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">The Case for Enterprise</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">Why this plan exists</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-2xl mx-auto">
            Architect Enterprise was built for organizations where the cost of architectural failure — a compliance breach, a failed Copilot rollout, uncontrolled configuration drift — dwarfs the cost of the engagement itself.
          </p>
          <ul className="space-y-3">
            {WHY_EXISTS.map((item, i) => (
              <li key={i} className="flex items-start gap-4 bg-white rounded-xl p-5 border border-border">
                <div className="w-8 h-8 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[#0078D4] text-sm font-bold">{i + 1}</span>
                </div>
                <p className="text-foreground leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why Shane */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">The Architect</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">Why Shane</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-2xl mx-auto">
            There's no shortage of M365 consultants. There is a shortage of principal architects with federal-grade accountability, 30 years of depth, and no delegation.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WHY_SHANE.map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-[#F7F9FC] rounded-xl p-5 border border-border">
                <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] font-medium leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tier nudge */}
      <section className="bg-[#F7F9FC] py-14 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="bg-white rounded-2xl border border-border p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">Smaller scope?</p>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Architect Growth — $3,000/mo</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                25 hours/month with priority 4-hour response, two strategy calls, and proactive tenant health monitoring. Most popular for organizations actively modernizing who aren't yet at enterprise scale.
              </p>
            </div>
            <Link
              href="/retainers/architect-growth"
              className="inline-flex items-center gap-2 text-[#0078D4] font-semibold whitespace-nowrap hover:text-[#005A9E] transition-colors flex-shrink-0"
            >
              See Architect Growth <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Not sure? CTA */}
      <section className="bg-[#F7F9FC] py-12 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="bg-white border border-[#0078D4]/20 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">Not sure which plan is right?</p>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Find your best-fit retainer in 2 minutes</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                Answer 10 questions about your M365 environment and support needs — get an instant recommendation for Essentials, Growth, or Enterprise.
              </p>
            </div>
            <Link
              href="/retainer-quiz"
              className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0066B8] text-white font-semibold px-6 py-3 rounded-xl transition-colors whitespace-nowrap flex-shrink-0 text-sm"
            >
              Take the Retainer Quiz <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <TestimonialDiscountCallout />
      {/* Bottom CTA */}
      <section className="bg-[#0A2540] py-20 px-6 text-center">
        <div className="max-w-[700px] mx-auto">
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-4">Ready to get started?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Enterprise M365 architecture. Senior-only. Federal-grade accountability.
          </h2>
          <p className="text-white/60 mb-2 text-lg leading-relaxed">
            Speak directly with Shane. No salespeople. No pressure.
          </p>
          <p className="text-white/60 mb-8 text-lg leading-relaxed">
            Shane will review your environment, agree on the first month's priorities, and have your dedicated channel active within 24 hours of engagement start.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/book?plan=architect-enterprise" className="px-8 py-4 text-base">
              Start Architect Enterprise — $11,000/month
            </CTAButton>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 text-white/70 hover:text-white font-medium text-base transition-colors"
            >
              Talk to Shane first <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
