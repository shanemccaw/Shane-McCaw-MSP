import { CheckCircle, ArrowRight, Clock, Users, Building2, Shield, Zap, Star, Award, Rocket } from "lucide-react";
import { Link } from "wouter";
import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { useServices, formatPriceDisplay } from "@/hooks/useServices";
import NotFound from "@/pages/not-found";

// ── helpers ───────────────────────────────────────────────────────────────────
function tierBadgeClass(tier: string | null): string {
  const t = tier?.toLowerCase() ?? "";
  if (t === "core") return "bg-[#00B4D8]/15 text-[#00B4D8] border-[#00B4D8]/30";
  if (t === "strategic") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-[#0078D4]/15 text-[#0078D4] border-[#0078D4]/30";
}

function splitLines(text: string | null): string[] {
  if (!text) return [];
  return text.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
}

const AUDIENCE_ICONS = [Building2, Users, Shield, Zap, Star];

// ── loading skeleton ──────────────────────────────────────────────────────────
function OfferSkeleton() {
  return (
    <Layout>
      <div className="bg-[#0A2540] pt-32 pb-24 animate-pulse">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="h-4 bg-white/10 rounded-full w-24 mb-6" />
          <div className="h-12 bg-white/10 rounded-xl w-2/3 mb-4" />
          <div className="h-6 bg-white/10 rounded-xl w-1/2 mb-8" />
          <div className="flex gap-4">
            <div className="h-12 bg-white/10 rounded-xl w-44" />
            <div className="h-12 bg-white/10 rounded-xl w-44" />
          </div>
        </div>
      </div>
      <div className="bg-white py-20 animate-pulse">
        <div className="max-w-[1200px] mx-auto px-6 space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-5 bg-gray-100 rounded w-full" />
          ))}
        </div>
      </div>
    </Layout>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
interface MicroOfferDetailProps {
  params: { slug: string };
}

export default function MicroOfferDetail({ params }: MicroOfferDetailProps) {
  const slug = params?.slug ?? "";
  const { services, loading } = useServices("micro_offer");

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

  return (
    <Layout>
      <SEOMeta
        title={`${service.name} | Shane McCaw Consulting`}
        description={
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
          seller: {
            "@type": "Person",
            name: "Shane McCaw",
            jobTitle: "Lead Microsoft 365 Architect",
          },
          itemOffered: {
            "@type": "Service",
            name: service.name,
            description: service.description ?? undefined,
          },
        }}
      />

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-24 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.12) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {service.tier && (
              <span
                className={`inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border ${tierBadgeClass(service.tier)}`}
              >
                {service.tier}
              </span>
            )}
            <span className="text-white/40 text-xs uppercase tracking-widest font-semibold">
              Fixed-Price Quick Win
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            {service.name}
          </h1>
          {service.tagline && (
            <p className="text-white/70 text-xl mt-5 max-w-2xl leading-relaxed">
              {service.tagline}
            </p>
          )}

          {/* NASA authority line */}
          <p className="mt-4 text-white/50 text-sm">
            Delivered by NASA&apos;s Lead M365 Architect — the same methodology used at
            one of the world&apos;s most security-conscious organizations.
          </p>

          {/* Friction-reducer badges */}
          <div className="mt-5 flex flex-wrap gap-2">
            {["Fixed Price", "No Hourly Surprises", "Senior-Only Delivery", "NASA Methodology"].map(
              (badge) => (
                <span
                  key={badge}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-white/60"
                >
                  {badge}
                </span>
              )
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-6">
            {showPrice && (
              <div>
                <p className="text-white/40 text-xs uppercase tracking-widest font-semibold mb-1">
                  Investment
                </p>
                <p className="text-white text-2xl font-extrabold">{priceDisplay}</p>
              </div>
            )}
            {service.turnaround && (
              <div className="flex items-center gap-2 text-white/60">
                <Clock className="w-4 h-4 text-[#00B4D8]" />
                <span className="text-sm font-medium">{service.turnaround} delivery</span>
              </div>
            )}
          </div>

          <div className="mt-10 flex flex-wrap gap-4">
            <CTAButton href={onboardingHref}>Start This Engagement</CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Book a Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── WHY THIS OFFER EXISTS ─────────────────────────────────────────── */}
      {service.description && (
        <section className="bg-white py-16 border-b border-border">
          <div className="max-w-[760px] mx-auto px-6">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
              Why this offer exists
            </p>
            <p className="text-[#0A2540] text-lg leading-relaxed">{service.description}</p>
            <p className="text-muted-foreground mt-4 leading-relaxed text-base">
              Most mid-market Microsoft 365 tenants accumulate configuration drift, governance gaps,
              and technical debt faster than IT teams can address it. This offer is designed to cut
              through that noise with a structured, senior-led engagement — the same rigorous
              methodology Shane applied during his tenure as Lead M365 Architect at NASA.
            </p>
          </div>
        </section>
      )}

      {/* ── WHAT YOU GET + IDEAL FOR ──────────────────────────────────────── */}
      {(deliverables.length > 0 || audience.length > 0) && (
        <section className="bg-white py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              {deliverables.length > 0 && (
                <div>
                  <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
                    Deliverables
                  </p>
                  <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-6">
                    What You Get
                  </h2>
                  <p className="text-muted-foreground leading-relaxed mb-6 text-sm">
                    Every deliverable is produced by Shane — not delegated to a junior consultant or
                    offshore team.
                  </p>
                  <ul className="space-y-3.5">
                    {deliverables.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                        <span className="text-[#0A2540] text-sm leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {audience.length > 0 && (
                <div className="bg-[#F7F9FC] rounded-2xl p-8">
                  <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-4">
                    Ideal For
                  </p>
                  <h3 className="text-xl font-extrabold text-[#0A2540] mb-6">
                    Who This Is For
                  </h3>
                  <ul className="space-y-4">
                    {audience.map((item, i) => {
                      const Icon = AUDIENCE_ICONS[i % AUDIENCE_ICONS.length];
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Icon className="w-4 h-4 text-[#0078D4]" />
                          </div>
                          <span className="text-[#0A2540] text-sm leading-relaxed">{item}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── HOW IT WORKS ──────────────────────────────────────────────────── */}
      {steps.length > 0 && (
        <section className="bg-[#F7F9FC] py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="text-center mb-14">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
                Process
              </p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
                How It Works
              </h2>
            </div>
            <div
              className={`grid grid-cols-1 md:grid-cols-2 ${
                steps.length <= 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"
              } gap-6`}
            >
              {steps.map((step, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl p-6 border border-border relative"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#0A2540] text-white flex items-center justify-center text-sm font-extrabold mb-4">
                    {i + 1}
                  </div>
                  <h3 className="font-bold text-[#0A2540] mb-2 text-base">{step.title}</h3>
                  {step.description && (
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {step.description}
                    </p>
                  )}
                  {i < steps.length - 1 && (
                    <div className="hidden lg:block absolute top-10 -right-3 z-10">
                      <ArrowRight className="w-5 h-5 text-[#0078D4]/40" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FEATURES & INCLUSIONS ─────────────────────────────────────────── */}
      {(features.length > 0 || inclusions.length > 0) && (
        <section className="bg-white py-20 border-t border-border">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              {features.length > 0 && (
                <div>
                  <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-4">
                    Features
                  </p>
                  <ul className="space-y-3">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-3">
                        <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                        <span className="text-[#0A2540] text-sm leading-relaxed">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {inclusions.length > 0 && (
                <div>
                  <p className="text-[#0078D4] text-xs font-bold uppercase tracking-widest mb-4">
                    What&apos;s Included
                  </p>
                  <ul className="space-y-3">
                    {inclusions.map((inc) => (
                      <li key={inc} className="flex items-start gap-3">
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <span className="text-[#0A2540] text-sm leading-relaxed">{inc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── PRICING & TIMELINE ────────────────────────────────────────────── */}
      {showPrice && (
        <section className="bg-white py-20 border-t border-border">
          <div className="max-w-[760px] mx-auto px-6 text-center">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">
              Investment
            </p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-3">
              {priceDisplay}
            </h2>
            <div className="flex flex-wrap justify-center gap-6 mt-4 mb-4">
              {service.turnaround && (
                <div className="text-center">
                  <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1">
                    Turnaround
                  </p>
                  <p className="text-[#0A2540] font-bold">{service.turnaround}</p>
                </div>
              )}
              {service.durationDays != null && (
                <div className="text-center">
                  <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1">
                    Duration
                  </p>
                  <p className="text-[#0A2540] font-bold">
                    {service.durationDays % 7 === 0
                      ? `${service.durationDays / 7} ${service.durationDays / 7 === 1 ? "week" : "weeks"}`
                      : service.durationDays === 1
                      ? "1 day"
                      : `${service.durationDays} days`}
                  </p>
                </div>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Fixed price — no hourly surprises. Exact scope confirmed before any payment.
            </p>
          </div>
        </section>
      )}

      {/* ── WHY SHANE ─────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20 border-t border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="max-w-[760px]">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">
              Why Shane
            </p>
            <h2 className="text-3xl font-extrabold text-[#0A2540] mb-8">
              Senior expertise. No hand-offs.
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[
                {
                  icon: Rocket,
                  title: "NASA-Scale Experience",
                  desc: "Lead M365 Architect for one of the world's most security-conscious organizations.",
                },
                {
                  icon: Award,
                  title: "30 Years in the Microsoft Ecosystem",
                  desc: "From Exchange 5.5 to Copilot for M365 — no one has seen more of the stack.",
                },
                {
                  icon: Shield,
                  title: "Regulated-Industry Specialist",
                  desc: "Government, healthcare, and finance clients who can't afford misconfiguration.",
                },
                {
                  icon: Users,
                  title: "Architecture-First Approach",
                  desc: "Every engagement starts with a deep understanding of your business, not a product pitch.",
                },
              ].map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="flex items-start gap-4 bg-white rounded-xl p-5 border border-border"
                >
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

      {/* ── CTA STRIP ─────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">
            Start Your {service.name}
          </h2>
          <p className="text-white/70 max-w-xl mx-auto mb-8 leading-relaxed">
            Start the engagement online — or book a free 30-minute call to confirm this is the right
            fit before committing.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href={onboardingHref} className="px-10 py-4 text-base">
              Start Your {service.name}
            </CTAButton>
            <a
              href="/book"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Book a Free Discovery Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
          <p className="mt-8 text-white/40 text-sm">
            Or{" "}
            <Link
              href="/micro-offers"
              className="text-white/60 hover:text-white underline underline-offset-2"
            >
              view all Quick Win packages →
            </Link>
          </p>
        </div>
      </section>
    </Layout>
  );
}
