import { CheckCircle, Clock, ArrowRight, ChevronRight, Building2, ShieldCheck, Users, AlertTriangle, Rocket } from "lucide-react";
import { TestimonialDiscountCallout } from "@/components/TestimonialDiscountCallout";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import { useServices, formatPrice } from "@/hooks/useServices";

const FALLBACK_PRICE = "1,500";
const FALLBACK_HOURS = "10";

const FALLBACK_DELIVERABLES = [
  "10 hours of consulting per month",
  "Email and Teams support",
  "Monthly strategy call (60 min)",
  "Standard response within 1 business day",
  "Access to all M365 service areas",
  "Monthly written summary",
];

const WHO_ITS_FOR = [
  {
    icon: Building2,
    title: "Mid-market organizations",
    body: "200–2,000 employees running M365 in a stable state who need a senior architect available on demand — without the cost and overhead of a full-time hire.",
  },
  {
    icon: ShieldCheck,
    title: "Regulated industries and government contractors",
    body: "Healthcare, finance, federal contractors, and state agencies that need ongoing expert oversight to maintain compliance posture and avoid configuration drift.",
  },
  {
    icon: Users,
    title: "IT teams with a senior escalation gap",
    body: "Teams managing M365 day-to-day who hit architectural, governance, or security limits they can't resolve internally — and need a 30-year Microsoft veteran in their corner.",
  },
  {
    icon: AlertTriangle,
    title: "Compliance and governance risk organizations",
    body: "Organizations that have received an audit finding, failed a security review, or know their governance posture is undocumented and need it corrected methodically.",
  },
  {
    icon: Rocket,
    title: "Organizations evaluating Copilot or SharePoint modernization",
    body: "Teams not yet ready for a full project sprint but wanting expert oversight as they assess readiness, document requirements, and build the internal case for investment.",
  },
];

const TYPICAL_MONTH = [
  {
    week: "Week 1",
    activity:
      "60-minute strategy call. Shane reviews your tenant health, open risks from the previous month, and agrees on this month's one or two priorities. No agenda-building overhead — you arrive, you focus.",
  },
  {
    week: "Week 2",
    activity:
      "Async delivery on the agreed priority: an architecture review finding, a governance policy draft, a Teams topology recommendation, a Copilot readiness checklist, or a licensing optimization analysis.",
  },
  {
    week: "Week 3",
    activity:
      "Ongoing async support via email and Teams for anything that surfaces mid-month — a security alert, a configuration question, a licence change, a Teams issue your team can't resolve without escalating.",
  },
  {
    week: "Week 4",
    activity:
      "Monthly written summary delivered: what was completed, what was flagged, what is recommended for next month. A documented record of everything Shane touched in your environment.",
  },
];

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-white/10 rounded ${className ?? ""}`} />;
}

export default function ArchitectEssentials() {
  const { services, loading } = useServices("retainer");
  const service = services.find((s) => s.slug === "architect-essentials") ?? null;

  const numericPrice = (() => {
    const raw = service?.price ?? service?.basePrice ?? null;
    if (raw === null || raw === undefined) return null;
    const n = parseFloat(String(raw));
    return isNaN(n) ? null : n;
  })();

  const displayPrice = numericPrice != null
    ? numericPrice.toLocaleString()
    : FALLBACK_PRICE;

  const displayHours = service?.hoursPerMonth
    ? service.hoursPerMonth.replace(/[^0-9]/g, "")
    : FALLBACK_HOURS;

  const pickNonEmpty = (...arrays: (string[] | null | undefined)[]): string[] | null =>
    arrays.find((a) => Array.isArray(a) && a.length > 0) ?? null;

  const displayDeliverables: string[] =
    pickNonEmpty(service?.features, service?.inclusions, service?.deliverables) ??
    FALLBACK_DELIVERABLES;

  const tiers = [...services]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      name: s.name,
      price: formatPrice(s.price) ?? "—",
      hours: s.hoursPerMonth ? `${s.hoursPerMonth.replace(/[^0-9]/g, "")} hrs/mo` : "—",
      href: s.pageHref ?? "#",
      current: s.pageHref === "/retainers/architect-essentials",
    }));

  const jsonLdPrice = numericPrice != null ? numericPrice.toFixed(2) : "1500.00";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: "Architect Essentials Retainer — Shane McCaw Consulting",
    description:
      "Fractional senior Microsoft 365 architecture for mid-market and regulated organizations. 10 hours/month of predictable expert access — strategy calls, async support, and a monthly written summary — from NASA's Lead M365 Architect.",
    price: jsonLdPrice,
    priceCurrency: "USD",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: jsonLdPrice,
      priceCurrency: "USD",
      unitText: "MONTH",
    },
    seller: {
      "@type": "Person",
      name: "Shane McCaw",
      jobTitle: "Lead Microsoft 365 Architect",
      description: "30-year Microsoft ecosystem veteran and NASA's Lead M365 Architect.",
    },
    url: "https://shanemccaw.com/retainers/architect-essentials",
  };

  return (
    <Layout>
      <SEOMeta
        title="Architect Essentials — Fractional M365 Architecture from $1,500/mo | Shane McCaw Consulting"
        description="Senior Microsoft 365 oversight for mid-market and regulated organizations. 10 hours/month of predictable expert access from NASA's Lead M365 Architect — no proposals, no retainer lock-in."
        jsonLd={jsonLd}
      />

      {/* Breadcrumb */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/retainers" className="hover:text-[#0078D4] transition-colors">Retainer Plans</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[#0A2540] font-medium">Architect Essentials</span>
        </div>
      </div>

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[130px] pb-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5 text-[#00B4D8]" />
              {loading ? <SkeletonBlock className="w-20 h-3" /> : <span>{displayHours} hours / month</span>}
            </div>
            <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              <ShieldCheck className="w-3.5 h-3.5 text-[#00B4D8]" />
              Current NASA Lead M365 Architect
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
            Fractional M365 Architecture<br className="hidden md:block" /> for Mid-Market and Regulated Organizations
          </h1>

          <p className="text-white/60 text-sm uppercase tracking-widest font-bold mb-6">
            Architect Essentials Retainer
          </p>

          {loading ? (
            <div className="flex justify-center mb-2"><SkeletonBlock className="w-36 h-14" /></div>
          ) : (
            <p className="text-[#00B4D8] text-5xl font-extrabold mb-2">${displayPrice}</p>
          )}
          <p className="text-white/50 mb-8 text-lg">/month · cancel with 30 days' notice</p>

          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-4">
            Most organizations don't need a full-time M365 architect. They need one available — consistently, predictably, without a scoping call, without a proposal, without a retainer lock-in.
          </p>
          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Architect Essentials delivers {displayHours} hours of senior Microsoft 365 expertise every month: a strategy call to set direction, async support when questions surface, and a written summary of everything accomplished. The same architect. Every month. No surprises.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/checkout?product=architect-essentials" className="px-8 py-4 text-base">
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
            {loading
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

      {/* Why Essentials Exists */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">Why This Plan Exists</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            Predictable access. No proposals. No scoping delays.
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            Most consulting arrangements start with a discovery call, a proposal, a statement of work, and a signed contract — before a single question gets answered. Architect Essentials eliminates that entirely.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: "Available when you need it",
                body: "Your retained hours are there every month. No scheduling a discovery call before Shane can advise. No waiting for a proposal to get approval. You email or message, and the work begins.",
              },
              {
                title: "No scoping, no proposals",
                body: "Essentials clients don't commission projects — they retain expertise. There's no back-and-forth on scope, no engagement letters for each question, no billing surprises. One monthly fee. Clear scope.",
              },
              {
                title: "Documented, consistent outcomes",
                body: "Every month ends with a written summary: what was done, what was flagged, what is recommended next. A permanent record of expert input applied to your environment — not a conversation that disappears.",
              },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-2xl border border-border p-6">
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center mb-4">
                  <CheckCircle className="w-5 h-5 text-[#0078D4]" />
                </div>
                <h3 className="font-extrabold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value Proposition */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-3">The Value Shift</p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">
            What changes when a senior M365 architect is in your corner
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            Shane spent 30 years in the Microsoft ecosystem and was Lead M365 Architect at NASA — responsible for the governance, security, and architecture of one of the most complex Microsoft 365 deployments in the US federal space. That expertise, applied to your environment every month.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                before: "Configuration drift goes undetected until an audit or incident surfaces it",
                after: "Monthly architecture reviews catch drift before it becomes a finding or a breach",
              },
              {
                before: "Governance decisions are made ad hoc, inconsistently, and without documentation",
                after: "A documented governance posture built incrementally — defensible when auditors ask",
              },
              {
                before: "Copilot or SharePoint modernization stalls because internal teams lack the architectural confidence to proceed",
                after: "Expert readiness assessments and architecture guidance move projects from \"evaluating\" to \"executing\"",
              },
              {
                before: "IT leadership escalates questions to Microsoft support or community forums — and waits days for an answer",
                after: "A 30-year Microsoft veteran is one message away — answers in hours, not days",
              },
            ].map((item, i) => (
              <div key={i} className="rounded-2xl border border-border overflow-hidden">
                <div className="bg-red-50 px-5 py-4 border-b border-border">
                  <p className="text-xs font-bold uppercase tracking-wide text-red-500 mb-1">Without Essentials</p>
                  <p className="text-sm text-[#0A2540] leading-relaxed">{item.before}</p>
                </div>
                <div className="bg-[#F0FFF8] px-5 py-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 mb-1">With Essentials</p>
                  <p className="text-sm text-[#0A2540] leading-relaxed">{item.after}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">What you get every month</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Every Architect Essentials engagement includes the following, applied consistently across every calendar month.
          </p>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-border">
                  <div className="animate-pulse bg-[#0078D4]/20 rounded-full w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="animate-pulse bg-[#0A2540]/10 rounded h-4 w-3/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayDeliverables.map((item, i) => (
                <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-5 border border-border">
                  <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                  <span className="text-[#0A2540] font-medium">{item}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Who It's For */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">Who this plan is for</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Architect Essentials is the right entry point for any of these organizations:
          </p>
          <ul className="space-y-4">
            {WHO_ITS_FOR.map((item, i) => {
              const Icon = item.icon;
              return (
                <li key={i} className="flex items-start gap-4 bg-[#F7F9FC] rounded-xl p-5 border border-border">
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

      {/* Typical Month */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[900px] mx-auto">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4 text-center">What a typical month looks like</h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Here's exactly how Shane structures your {displayHours} hours across a calendar month — from day one.
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

      {/* Tier Nudge */}
      <section className="bg-white py-14 px-6">
        <div className="max-w-[900px] mx-auto">
          <div className="bg-[#F7F9FC] rounded-2xl border border-border p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#0078D4] mb-1">Actively modernizing?</p>
              <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">Architect Growth — $3,000/mo</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                25 hours/month with priority 4-hour response, two strategy calls per month, and proactive tenant health monitoring. Built for organizations mid-stream on a Copilot rollout, SharePoint migration, or governance overhaul who need more hands-on delivery hours every week.
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
            Senior M365 expertise. In your corner. Every month.
          </h2>
          <p className="text-white/60 mb-8 text-lg leading-relaxed">
            Start your onboarding. Shane will confirm your environment, agree on the first month's priorities, and have your first strategy call on the calendar within five business days.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <CTAButton href="/checkout?product=architect-essentials" className="px-8 py-4 text-base">
              Get Started — ${displayPrice}/mo
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
