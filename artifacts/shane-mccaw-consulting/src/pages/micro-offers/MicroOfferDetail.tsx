import { useState } from "react";
import {
  CheckCircle, ArrowRight, Clock, Users, Building2, Shield,
  Zap, Star, Award, Rocket, DollarSign, AlertTriangle, Target,
  TrendingUp, BadgeCheck,
} from "lucide-react";
import { Link } from "wouter";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ServiceOverviewModal } from "@/components/ServiceOverviewModal";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";
import NotFound from "@/pages/not-found";
import { TestimonialDiscountCallout } from "@/components/TestimonialDiscountCallout";

// ── helpers ───────────────────────────────────────────────────────────────────
function splitLines(text: string | null): string[] {
  if (!text) return [];
  return text.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
}

// ── loading skeleton ──────────────────────────────────────────────────────────
function OfferSkeleton() {
  return (
    <Layout>
      <div className="bg-[#0A2540] pt-[172px] pb-24 animate-pulse">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="h-4 bg-white/10 rounded-full w-32 mb-6" />
          <div className="h-14 bg-white/10 rounded-xl w-3/4 mb-4" />
          <div className="h-6 bg-white/10 rounded-xl w-1/2 mb-8" />
          <div className="flex gap-4">
            <div className="h-12 bg-white/10 rounded-xl w-44" />
            <div className="h-12 bg-white/10 rounded-xl w-44" />
          </div>
        </div>
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="py-20 animate-pulse bg-white border-t border-border">
          <div className="max-w-[1200px] mx-auto px-6 space-y-4">
            <div className="h-6 bg-gray-100 rounded w-1/4" />
            <div className="h-10 bg-gray-100 rounded w-1/2" />
            <div className="h-5 bg-gray-100 rounded w-full" />
            <div className="h-5 bg-gray-100 rounded w-5/6" />
          </div>
        </div>
      ))}
    </Layout>
  );
}

// ── ICP data ─────────────────────────────────────────────────────────────────
const ICP_ATTRIBUTES = [
  {
    icon: Building2,
    label: "Company Size",
    value: "200–2,000 employees",
    sub: "Mid-market organizations with growing M365 footprint",
  },
  {
    icon: Shield,
    label: "Industries",
    value: "Healthcare, Legal, Financial, Gov Contractors, Defense",
    sub: "HIPAA · SOC 2 · CMMC · FedRAMP · ITAR regulated environments",
  },
  {
    icon: Users,
    label: "Decision Makers",
    value: "IT Director, VP of IT, CTO, CISO",
    sub: "Occasionally CFO for budget approval on larger engagements",
  },
  {
    icon: Zap,
    label: "Licensing Profile",
    value: "Microsoft 365 E3 or E5",
    sub: "IT team of 2–15 with no dedicated M365 architect on staff",
  },
  {
    icon: TrendingUp,
    label: "Revenue Band",
    value: "$20M – $500M annually",
    sub: "Organizations with real technology complexity but no enterprise IT budget",
  },
  {
    icon: Target,
    label: "Buying Trigger",
    value: "Audit deadline, failed migration, Copilot deployment, IT gap",
    sub: "Urgency is already present — they just need the right expert",
  },
];

const COMPLIANCE_FRAMEWORKS = ["FedRAMP", "FISMA", "ITAR", "GCC High", "HIPAA", "CMMC"];

const WHY_SHANE_CARDS = [
  {
    icon: Rocket,
    title: "NASA-Scale Architecture",
    desc: "Lead M365 Architect for one of the most security-intensive federal agencies on earth. The same rigor applied to your environment.",
  },
  {
    icon: Award,
    title: "30 Years Microsoft Depth",
    desc: "From Exchange 5.5 to Copilot for M365 — every layer of the stack, every generation of the platform.",
  },
  {
    icon: Shield,
    title: "Regulated-Industry Specialist",
    desc: "Government contractors, healthcare, legal, and financial services clients who operate where misconfiguration has real consequences.",
  },
  {
    icon: BadgeCheck,
    title: "100% Senior Delivery",
    desc: "Every engagement is executed personally by Shane. No account managers, no junior staff, no offshore teams.",
  },
];

// ── page ──────────────────────────────────────────────────────────────────────
interface MicroOfferDetailProps {
  params: { slug: string };
}

export default function MicroOfferDetail({ params }: MicroOfferDetailProps) {
  const slug = params?.slug ?? "";
  const { services, loading } = useServices("micro_offer");
  const [modalOpen, setModalOpen] = useState(false);

  if (loading) return <OfferSkeleton />;

  const service = services.find((s) => s.pageSlug === slug);
  if (!service) return <NotFound />;

  const priceDisplay = formatPriceDisplay(service);
  const showPrice = priceDisplay && priceDisplay !== "Contact for pricing";
  const onboardingHref = `/crm/portal/onboarding/select?service=${service.slug}`;
  const audience = splitLines(service.targetAudience);
  const steps = [...(service.workflowTasks ?? [])].sort((a, b) => a.order - b.order);
  const deliverables = service.deliverables ?? [];
  const features = service.features ?? [];
  const inclusions = service.inclusions ?? [];
  const allDeliverables = deliverables.length > 0 ? deliverables : inclusions;

  return (
    <Layout>
      <SEOMeta
        title={`${service.name} | Shane McCaw Consulting`}
        description={
          service.tagline ??
          service.description ??
          `Fixed-price Microsoft 365 consulting from Shane McCaw — ${service.name}.`
        }
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Offer",
          name: service.name,
          description: service.description ?? undefined,
          ...(service.basePrice && service.maxPrice
            ? { priceRange: priceDisplay }
            : service.basePrice
            ? { price: service.basePrice, priceCurrency: "USD" }
            : {}),
          url: `https://shanemccawconsulting.com/micro-offers/${slug}`,
          seller: { "@type": "Person", name: "Shane McCaw", jobTitle: "Lead Microsoft 365 Architect" },
          itemOffered: { "@type": "Service", name: service.name, description: service.description ?? undefined },
        }}
      />

      {/* ══ SECTION 1 — HERO ════════════════════════════════════════════════ */}
      <section className="bg-[#0A2540] pt-[172px] pb-28 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,120,212,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(0,120,212,0.8) 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 900px 600px at 65% 0%, rgba(0,120,212,0.15) 0%, transparent 70%)",
          }}
        />

        <div className="max-w-[1200px] mx-auto px-6 relative">
          {/* breadcrumb + badges */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Link href="/micro-offers" className="text-white/40 text-xs uppercase tracking-widest font-semibold hover:text-white/70 transition-colors">
              Quick Wins
            </Link>
            <span className="text-white/20">›</span>
            <span className="text-white/50 text-xs uppercase tracking-widest font-semibold">{service.category}</span>
            {service.badge && (
              <>
                <span className="text-white/20">·</span>
                <span className="inline-flex items-center gap-1.5 bg-[#0078D4]/20 border border-[#0078D4]/40 text-[#00B4D8] text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  <Star className="w-3 h-3" />
                  {service.badge}
                </span>
              </>
            )}
          </div>

          <div className="max-w-4xl">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-[1.08] mb-5">
              {service.tagline ?? service.name}
            </h1>
            <p className="text-white/60 text-lg md:text-xl leading-relaxed mb-3 max-w-3xl">
              {service.name} — delivered by NASA&apos;s Lead M365 Architect. Senior-level expertise, fixed price, defined timeline. No surprises.
            </p>
            {service.description && (
              <p className="text-white/50 text-base leading-relaxed mb-6 max-w-2xl">
                {service.description}
              </p>
            )}
          </div>

          {/* friction-reducer trust row */}
          <div className="flex flex-wrap gap-2 mb-8">
            {["Fixed Price", "No Hourly Surprises", "Senior-Only Delivery", "NASA Methodology", "No Junior Staff"].map((b) => (
              <span key={b} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/8 border border-white/12 text-white/55">
                {b}
              </span>
            ))}
          </div>

          {/* price + turnaround row */}
          <div className="flex flex-wrap items-center gap-8 mb-10">
            {showPrice && (
              <div>
                <p className="text-white/35 text-xs uppercase tracking-widest font-semibold mb-1">Investment</p>
                <p className="text-white text-3xl font-extrabold">{priceDisplay}</p>
                <p className="text-white/40 text-xs mt-1">Fixed-price. Scope confirmed before payment.</p>
              </div>
            )}
            {service.turnaround && (
              <div className="flex items-center gap-3 bg-white/8 border border-white/12 rounded-xl px-5 py-3">
                <Clock className="w-5 h-5 text-[#00B4D8] flex-shrink-0" />
                <div>
                  <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Delivery</p>
                  <p className="text-white font-bold">{service.turnaround}</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            <CTAButton href={onboardingHref} className="text-base px-10 py-4">
              Start This Engagement
            </CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Book a Free Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
            {service.hasPdf && (
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-sm"
              >
                Download Service Overview <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ══ SECTION 2 — WHY THIS MATTERS ════════════════════════════════════ */}
      <section className="bg-white py-20 border-b border-border">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
                Why This Matters
              </p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] leading-tight mb-6">
                The Problem Most Organizations Don&apos;t Know They Have
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed mb-5">
                Most mid-market Microsoft 365 tenants grow organically — licenses added, features turned on, teams and sites created without a governance framework. Years of organic growth create configuration drift, security gaps, and compliance exposure that internal IT teams rarely have the bandwidth or specialization to address.
              </p>
              <p className="text-muted-foreground text-base leading-relaxed">
                The {service.name} is designed to cut through that noise with a structured, senior-led engagement. The same rigorous methodology Shane applied as Lead M365 Architect at NASA — delivered to your organization at a fraction of the cost of a full-time hire.
              </p>
            </div>

            <div className="space-y-4">
              <p className="text-[#0A2540] text-sm font-bold uppercase tracking-[0.1em] mb-2">
                What happens when organizations delay
              </p>
              {[
                {
                  icon: AlertTriangle,
                  color: "text-red-500",
                  bg: "bg-red-50 border-red-100",
                  title: "Compliance exposure compounds",
                  desc: "Ungoverned M365 environments fail audits. HIPAA, SOC 2, CMMC, and FedRAMP reviewers find misconfiguration that internal teams overlooked for years.",
                },
                {
                  icon: DollarSign,
                  color: "text-amber-600",
                  bg: "bg-amber-50 border-amber-100",
                  title: "Remediation costs escalate",
                  desc: "The longer configuration drift continues, the more expensive and disruptive it becomes to fix. A $5,000 assessment today prevents a $50,000 emergency remediation later.",
                },
                {
                  icon: Zap,
                  color: "text-[#0078D4]",
                  bg: "bg-blue-50 border-blue-100",
                  title: "Copilot and AI rollouts stall",
                  desc: "Microsoft Copilot deployed on a poorly governed tenant exposes sensitive data to the wrong users. Most organizations aren't ready — and don't know it until deployment fails.",
                },
              ].map(({ icon: Icon, color, bg, title, desc }) => (
                <div key={title} className={`flex gap-4 p-5 rounded-xl border ${bg}`}>
                  <div className="flex-shrink-0 mt-0.5">
                    <Icon className={`w-5 h-5 ${color}`} />
                  </div>
                  <div>
                    <p className="font-bold text-[#0A2540] text-sm mb-1">{title}</p>
                    <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ SECTION 3 — WHAT YOU GET ═════════════════════════════════════════ */}
      {(allDeliverables.length > 0 || inclusions.length > 0 || features.length > 0) && (
        <section className="bg-[#F7F9FC] py-20">
          <div className="max-w-[1100px] mx-auto px-6">
            <div className="text-center mb-12">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Deliverables</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">What You Get</h2>
              <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm">
                Every deliverable is produced by Shane personally — not delegated to a junior consultant or offshore team.
              </p>
            </div>

            <div className={`grid grid-cols-1 ${
              (allDeliverables.length > 0 && inclusions.length > 0 && deliverables.length > 0) ||
              (features.length > 0 && inclusions.length > 0)
                ? "lg:grid-cols-2"
                : "max-w-[640px] mx-auto"
            } gap-8`}>
              {allDeliverables.length > 0 && (
                <div className="bg-white rounded-2xl p-8 border border-border">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 rounded-xl bg-[#0078D4] flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-extrabold text-[#0A2540] text-lg">Deliverables</h3>
                  </div>
                  <ul className="space-y-4">
                    {allDeliverables.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                        <span className="text-[#0A2540] text-sm leading-relaxed font-medium">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {inclusions.length > 0 && deliverables.length > 0 && (
                <div className="bg-white rounded-2xl p-8 border border-border">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 rounded-xl bg-[#00B4D8] flex items-center justify-center">
                      <BadgeCheck className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-extrabold text-[#0A2540] text-lg">What&apos;s Included</h3>
                  </div>
                  <ul className="space-y-4">
                    {inclusions.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                        <span className="text-[#0A2540] text-sm leading-relaxed font-medium">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {features.length > 0 && inclusions.length === 0 && deliverables.length === 0 && (
                <div className="bg-white rounded-2xl p-8 border border-border">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 rounded-xl bg-[#0078D4] flex items-center justify-center">
                      <Star className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-extrabold text-[#0A2540] text-lg">Key Features</h3>
                  </div>
                  <ul className="space-y-4">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                        <span className="text-[#0A2540] text-sm leading-relaxed font-medium">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ══ SECTION 4 — IDEAL CLIENT PROFILE ════════════════════════════════ */}
      <section className="bg-white py-20 border-t border-border">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Ideal Client Profile</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who This Is Built For</h2>
            <p className="text-muted-foreground mt-3 max-w-2xl mx-auto text-sm leading-relaxed">
              {audience.length > 0
                ? audience[0]
                : "Organizations with real Microsoft 365 complexity and the ambition to get it right — without the cost and timeline of hiring a full-time architect."}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
            {ICP_ATTRIBUTES.map(({ icon: Icon, label, value, sub }) => (
              <div key={label} className="bg-[#F7F9FC] rounded-xl border border-border p-6">
                <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4">
                  <Icon className="w-4.5 h-4.5 text-[#0078D4]" />
                </div>
                <p className="text-[#0078D4] text-xs font-bold uppercase tracking-wider mb-1">{label}</p>
                <p className="font-extrabold text-[#0A2540] text-sm mb-1">{value}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">{sub}</p>
              </div>
            ))}
          </div>

          {/* "Not you?" callout */}
          <div className="bg-[#F7F9FC] border border-border rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <p className="font-bold text-[#0A2540] text-sm mb-1">Not sure if this is the right fit?</p>
              <p className="text-muted-foreground text-sm">Take a 5-minute quiz and get a personalized recommendation for your M365 environment.</p>
            </div>
            <Link
              href="/quick-win-quiz"
              className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0068BE] text-white font-bold px-6 py-3 rounded-xl transition-colors text-sm whitespace-nowrap flex-shrink-0"
            >
              Take the Quick Win Quiz <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ══ SECTION 5 — PRICING & ANCHOR PSYCHOLOGY ══════════════════════════ */}
      {showPrice && (
        <section className="bg-[#0A2540] py-20">
          <div className="max-w-[1100px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Investment</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-3">
                  {priceDisplay}
                </h2>
                {service.turnaround && (
                  <div className="flex items-center gap-2 text-white/60 mb-6">
                    <Clock className="w-4 h-4 text-[#00B4D8]" />
                    <span className="text-sm font-medium">{service.turnaround} delivery · Fixed price</span>
                  </div>
                )}
                <p className="text-white/60 text-base leading-relaxed mb-8">
                  Fixed-price engagement. The exact scope and deliverables are confirmed before any payment is collected. No hourly billing, no scope creep, no surprises.
                </p>
                <CTAButton href={onboardingHref} className="text-base px-10 py-4">
                  Start This Engagement
                </CTAButton>
              </div>

              {/* Anchor psychology panel */}
              <div className="space-y-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-7">
                  <p className="text-white/50 text-xs font-bold uppercase tracking-wider mb-5">The Alternative: Full-Time Hire</p>
                  <div className="space-y-3 mb-5">
                    {[
                      { label: "Senior M365 Architect Salary", value: "$150,000–$220,000/yr" },
                      { label: "Benefits & Overhead", value: "+30–40%" },
                      { label: "Recruiting Timeline", value: "3–6 months" },
                      { label: "Risk if Wrong Hire", value: "100% sunk cost" },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between py-2 border-b border-white/8">
                        <span className="text-white/55 text-sm">{label}</span>
                        <span className="text-white/70 font-bold text-sm">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-xl p-4">
                    <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-wider mb-1">This Engagement</p>
                    <p className="text-white font-extrabold text-xl">{priceDisplay}</p>
                    <p className="text-white/55 text-xs mt-1">Senior expertise, fixed scope, zero recruiting overhead.</p>
                  </div>
                </div>
                <p className="text-white/40 text-xs text-center">
                  Low-risk entry engagement — designed to build trust before any larger commitment.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ══ SECTION 6 — WHY SHANE ════════════════════════════════════════════ */}
      <section className="bg-white py-20 border-t border-border">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Why Shane</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] leading-tight mb-5">
                NASA-Scale Expertise.<br />No Hand-Offs.
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed mb-5">
                Shane McCaw is a Microsoft 365 architect with 30 years in the Microsoft ecosystem. As Lead M365 Architect at NASA, he designed and governed enterprise cloud environments under some of the world&apos;s most stringent compliance requirements — FedRAMP, FISMA, ITAR, and GCC High.
              </p>
              <p className="text-muted-foreground text-base leading-relaxed mb-8">
                That experience doesn&apos;t live in a resume line item. It shows up in how he structures assessments, identifies risk, builds governance frameworks, and communicates findings to non-technical executives. Every engagement is executed personally.
              </p>

              {/* compliance badges */}
              <div>
                <p className="text-[#0A2540] text-xs font-bold uppercase tracking-widest mb-3">Compliance Frameworks</p>
                <div className="flex flex-wrap gap-2">
                  {COMPLIANCE_FRAMEWORKS.map((fw) => (
                    <span
                      key={fw}
                      className="inline-flex items-center gap-1.5 bg-[#0A2540] text-white text-xs font-bold px-4 py-2 rounded-lg"
                    >
                      <Shield className="w-3 h-3 text-[#00B4D8] flex-shrink-0" />
                      {fw}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {WHY_SHANE_CARDS.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex flex-col gap-3 bg-[#F7F9FC] rounded-xl p-5 border border-border">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-[#0078D4]" />
                  </div>
                  <div>
                    <p className="font-bold text-[#0A2540] text-sm mb-1">{title}</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ SECTION 7 — HOW IT WORKS (WORKFLOW) ═════════════════════════════ */}
      {steps.length > 0 && (
        <section className="bg-[#F7F9FC] py-20 border-t border-border">
          <div className="max-w-[1100px] mx-auto px-6">
            <div className="text-center mb-14">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">The Process</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">How It Works</h2>
              <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm">
                A structured, repeatable process honed at NASA scale — predictable from day one.
              </p>
            </div>

            {/* Vertical timeline */}
            <div className="max-w-2xl mx-auto">
              {steps.map((step, i) => {
                const isLast = i === steps.length - 1;
                const isFirst = i === 0;
                const badgeBg = isFirst
                  ? "#0078D4"
                  : isLast
                  ? "#0A2540"
                  : `hsl(${200 + i * 8}, 80%, ${42 - i * 2}%)`;
                return (
                  <div key={i} className="flex gap-0">
                    {/* ── Left rail: circle + connector ── */}
                    <div className="flex flex-col items-center flex-shrink-0 w-16">
                      {/* numbered badge */}
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center text-white font-extrabold text-sm shadow-md ring-4 ring-[#F7F9FC] relative z-10 flex-shrink-0"
                        style={{ background: badgeBg }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      {/* vertical connector below badge */}
                      {!isLast && (
                        <div className="flex flex-col items-center flex-1 py-1">
                          <div className="w-px flex-1 bg-gradient-to-b from-[#0078D4] to-[#00B4D8] opacity-30" />
                          {/* downward chevron */}
                          <svg
                            className="w-3.5 h-3.5 flex-shrink-0 my-1"
                            viewBox="0 0 14 14"
                            fill="none"
                          >
                            <path
                              d="M3 5l4 4 4-4"
                              stroke="#0078D4"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              opacity="0.5"
                            />
                          </svg>
                          <div className="w-px flex-1 bg-gradient-to-b from-[#00B4D8] to-[#0078D4] opacity-20" />
                        </div>
                      )}
                    </div>

                    {/* ── Right: step card ── */}
                    <div className={`flex-1 pb-6 ${isLast ? "" : ""}`}>
                      <div className="bg-white rounded-2xl border border-border shadow-sm p-5 ml-3 hover:border-[#0078D4]/30 hover:shadow-md transition-all">
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              Step {i + 1}
                            </span>
                          </div>
                          {isLast ? (
                            <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">
                              <CheckCircle className="w-3 h-3" /> Delivered
                            </span>
                          ) : isFirst ? (
                            <span className="inline-flex items-center gap-1 bg-[#0078D4]/8 text-[#0078D4] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0">
                              Starts here
                            </span>
                          ) : null}
                        </div>
                        <h3 className="font-extrabold text-[#0A2540] text-base leading-snug">{step.title}</h3>
                        {step.description && (
                          <p className="text-muted-foreground text-sm leading-relaxed mt-2">{step.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ══ SECTION 8 — FINAL CTA ════════════════════════════════════════════ */}
      <section className="relative bg-[#0A2540] py-28 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,0.18) 0%, transparent 75%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative max-w-[800px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-widest mb-4">
            Ready to Get Started?
          </p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-5">
            Your {service.name} Starts Here.
          </h2>
          <p className="text-white/65 text-lg leading-relaxed mb-3 max-w-2xl mx-auto">
            Work directly with NASA&apos;s Lead M365 Architect — no account managers, no junior staff, no offshore teams. Fixed price, defined scope, senior-level delivery from day one.
          </p>
          <p className="text-white/40 text-sm mb-10">
            Not ready to commit yet? Book a free 30-minute discovery call — no pitch, no obligation.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href={onboardingHref} className="text-base px-12 py-4">
              Start Your {service.name}
            </CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Book a Free Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
          <p className="mt-8 text-white/30 text-sm">
            Or{" "}
            <Link href="/micro-offers" className="text-white/50 hover:text-white underline underline-offset-2">
              view all Quick Win packages →
            </Link>
          </p>
        </div>
      </section>

      <TestimonialDiscountCallout />
      <ServiceOverviewModal
        serviceName={service.name}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Layout>
  );
}
