import { useState } from "react";
import { useSearch, Link } from "wouter";
import {
  CheckCircle, ArrowRight, Clock, Building2, Shield,
  Zap, Star, Award, Rocket, DollarSign, AlertTriangle, Target,
  TrendingUp, BadgeCheck,
} from "lucide-react";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useCatalog, type AssessmentOffer } from "@/hooks/useCatalog";
import NotFound from "@/pages/not-found";

// ── helpers ───────────────────────────────────────────────────────────────────
function splitLines(text: string | null): string[] {
  if (!text) return [];
  return text.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
}

function formatPrice(val: string | null): string {
  if (!val) return "Contact for pricing";
  const num = parseFloat(val);
  if (isNaN(num)) return "Contact for pricing";
  return "$" + num.toLocaleString("en-US", { maximumFractionDigits: 0 });
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
    icon: UsersIcon,
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
    value: "Mid-market to upper-mid-market",
    sub: "Organizations with technology complexity but no enterprise IT budget",
  },
  {
    icon: Target,
    label: "Buying Trigger",
    value: "Audit deadline, failed migration, Copilot deployment, IT gap",
    sub: "Urgency is already present — they just need the right expert",
  },
];

function UsersIcon(props: React.ComponentProps<typeof Building2>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

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

export default function AssessmentDetail() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const slug = params.get("product") || "";

  const { assessmentOffers, loading, error } = useCatalog();

  if (loading) return <OfferSkeleton />;

  const service = assessmentOffers.find((s) => s.slug === slug);
  if (!service) return <NotFound />;

  // TODO: Support Max price range (service.maxPrice) later when the application is more mature
  const priceDisplay = formatPrice(service.basePrice || service.price);
  const showPrice = !service.isFree && priceDisplay !== "Contact for pricing";
  const onboardingHref = `/checkout?product=${service.slug}`;
  const audience = splitLines(service.targetAudience);
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
          `Fixed-price Microsoft 365 Assessment from Shane McCaw — ${service.name}.`
        }
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Offer",
          name: service.name,
          description: service.description ?? undefined,
          price: service.basePrice ?? service.price ?? "",
          priceCurrency: "USD",
          url: `https://shanemccawconsulting.com/assessment/details?product=${slug}`,
          seller: { "@type": "Person", name: "Shane McCaw", jobTitle: "Lead Microsoft 365 Architect" },
          itemOffered: { "@type": "Service", name: service.name, description: service.description ?? undefined },
        }}
      />

      {/* ── HERO ────────────────────────────────────────────────────────── */}
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
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Link href="/assessment" className="text-white/40 text-xs uppercase tracking-widest font-semibold hover:text-white/70 transition-colors">
              Assessments
            </Link>
            <span className="text-white/20">›</span>
            <span className="text-white/50 text-xs uppercase tracking-widest font-semibold">{service.category || "Consulting"}</span>
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
              {service.name} — executed personally by NASA&apos;s Lead M365 Architect. flat-fee, clear deliverables, no junior staff.
            </p>
            {service.description && (
              <p className="text-white/50 text-base leading-relaxed mb-6 max-w-2xl">
                {service.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mb-8">
            {["Fixed Price", "Defined Scope", "Senior-Only Delivery", "NASA Methodology", "No Sales Pressure"].map((b) => (
              <span key={b} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/8 border border-white/12 text-white/55">
                {b}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-8 mb-10">
            {showPrice && (
              <div>
                <p className="text-white/35 text-xs uppercase tracking-widest font-semibold mb-1">Investment</p>
                <p className="text-white text-3xl font-extrabold">{priceDisplay}</p>
                <p className="text-white/40 text-xs mt-1">Flat-rate. Confirmed baseline assessment fee.</p>
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
            <Link href={onboardingHref}>
              <Button size="lg" className="text-base px-10 py-6 bg-[#0078D4] hover:bg-[#005A9E]">
                {service.isFree ? "Start Free Assessment" : "Buy This Assessment"} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Book a Free Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── WHY THIS MATTERS ────────────────────────────────────────────── */}
      <section className="bg-white py-20 border-b border-border">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
                Why This Matters
              </p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] leading-tight mb-6">
                Understand Your Risks and Stop Configuration Drift
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed mb-5">
                Most Microsoft 365 environments grow organically as features are enabled and teams are created. Over time, this results in serious configuration drift, security gaps, and regulatory exposure that internal IT teams rarely have the specialized tools or time to detect.
              </p>
              <p className="text-muted-foreground text-base leading-relaxed">
                This {service.name} uses the same automated signal scan and assessment methodology Shane developed to audit M365 environments at NASA. We scan your live tenant configurations, map them to best practices, and lay out an actionable, prioritized roadmap of what to remediate.
              </p>
            </div>

            <div className="space-y-4">
              <p className="text-[#0A2540] text-sm font-bold uppercase tracking-[0.1em] mb-2">
                Critical risks uncovered in this audit
              </p>
              {[
                {
                  icon: AlertTriangle,
                  color: "text-red-500",
                  bg: "bg-red-50 border-red-100",
                  title: "Identity and CA policies gaps",
                  desc: "Weak MFA enforcement and unmanaged-device conditional access rules are the #1 entry point for modern business email compromise.",
                },
                {
                  icon: DollarSign,
                  color: "text-amber-600",
                  bg: "bg-amber-50 border-amber-100",
                  title: "Licensing waste and overlap",
                  desc: "Organizations average 15-35% waste on unused or over-provisioned E3/E5 licenses that can be instantly optimized during checkout.",
                },
                {
                  icon: Zap,
                  color: "text-[#0078D4]",
                  bg: "bg-blue-50 border-blue-100",
                  title: "Oversharing & compliance issues",
                  desc: "Stale guest access accounts and permissive SharePoint/Teams sharing settings make rolling out tools like Copilot dangerous without proper classification.",
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

      {/* ── WHAT YOU GET ────────────────────────────────────────────────── */}
      {(allDeliverables.length > 0 || features.length > 0) && (
        <section className="bg-[#F7F9FC] py-20">
          <div className="max-w-[1100px] mx-auto px-6">
            <div className="text-center mb-12">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Deliverables</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">What is Included</h2>
              <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm">
                Every report and briefing is executed personally by Shane to ensure maximum accuracy and relevance.
              </p>
            </div>

            <div className={`grid grid-cols-1 ${
              (allDeliverables.length > 0 && features.length > 0 && deliverables.length > 0)
                ? "lg:grid-cols-2"
                : "max-w-[640px] mx-auto"
            } gap-8`}>
              {allDeliverables.length > 0 && (
                <div className="bg-white rounded-2xl p-8 border border-border">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 rounded-xl bg-[#0078D4] flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-extrabold text-[#0A2540] text-lg">Core Deliverables</h3>
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

              {features.length > 0 && (
                <div className="bg-white rounded-2xl p-8 border border-border">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 rounded-xl bg-[#00B4D8] flex items-center justify-center">
                      <Star className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-extrabold text-[#0A2540] text-lg">Key Features</h3>
                  </div>
                  <ul className="space-y-4">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-[#00B4D8] flex-shrink-0 mt-0.5" />
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

      {/* ── IDEAL CLIENT PROFILE ────────────────────────────────────────── */}
      <section className="bg-white py-20 border-t border-border">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Target Profile</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Who This is Built For</h2>
            <p className="text-muted-foreground mt-3 max-w-2xl mx-auto text-sm leading-relaxed">
              {audience.length > 0
                ? audience[0]
                : "Organizations operating under strict compliance or complex Microsoft 365 footprints who need deep configuration audits."}
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

          <div className="bg-[#F7F9FC] border border-border rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <p className="font-bold text-[#0A2540] text-sm mb-1">Not ready for a paid deep-dive?</p>
              <p className="text-muted-foreground text-sm">Take one of our free lead-generation quizzes to get an instant baseline score report.</p>
            </div>
            <Link
              href="/assessments"
              className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0068BE] text-white font-bold px-6 py-3 rounded-xl transition-colors text-sm whitespace-nowrap flex-shrink-0"
            >
              Take Free Quizzes <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── SHANE MCCAW VALUE CARD ───────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20 border-t border-border">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Why Shane McCaw Consulting?</h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm leading-relaxed">
              We bring enterprise-grade NASA M365 security architecture rules down to the mid-market.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {WHY_SHANE_CARDS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-6 border border-border shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center mb-5">
                  <Icon className="w-5 h-5 text-[#0078D4]" />
                </div>
                <h3 className="font-bold text-[#0A2540] text-sm mb-2">{title}</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
