import { useEffect, useRef, useState } from "react";
import { useParams, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, ArrowRight, Loader2, Shield, Zap } from "lucide-react";

interface LinkedService {
  id: number;
  slug: string | null;
  name: string;
  visibility: string;
  billingType: string;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  turnaround: string | null;
}

interface LandingPageData {
  id: number;
  slug: string;
  title: string;
  headline?: string | null;
  subheadline?: string | null;
  valuePropBlocks: Array<{ icon?: string; heading: string; body: string }>;
  cta: { buttonText: string; href: string; subtext?: string } | null;
  published: boolean;
  _preview?: boolean;
  linkedService?: LinkedService | null;
}

const TRUST_BADGES = [
  "Lead M365 Architect at NASA",
  "30 Years Microsoft Experience",
  "Fixed-Price Engagements",
  "Senior-Level Delivery",
];

const ENGAGEMENT_STEPS = [
  {
    step: "01",
    title: "Discovery Call",
    description:
      "A free 30-minute call to understand your environment, key pain points, and what success looks like for your organization.",
    note: "No pitch. No obligation.",
    color: "#0078D4",
  },
  {
    step: "02",
    title: "Scoped Engagement",
    description:
      "Fixed-price, clearly scoped deliverables. No open-ended consulting fees, no billing surprises, no scope creep.",
    note: "Fixed price. Delivered personally by Shane.",
    color: "#00B4D8",
  },
  {
    step: "03",
    title: "Actionable Results",
    description:
      "A documented, immediately executable output ready to act on. Every engagement delivered personally — no handoffs to junior staff.",
    note: "No handoffs. No junior staff.",
    color: "#0A2540",
  },
];

export default function LandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const [page, setPage] = useState<LandingPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fetchingToken, setFetchingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const isLpOnly = page?.linkedService?.visibility === "landing_page_only";
  const ctaClickedRef = useRef(false);

  useEffect(() => {
    if (!slug) return;
    const params = new URLSearchParams(search);
    const previewToken = params.get("preview");
    const url = previewToken
      ? `/api/landing-pages/${encodeURIComponent(slug)}?preview=${encodeURIComponent(previewToken)}`
      : `/api/landing-pages/${encodeURIComponent(slug)}`;
    fetch(url)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json() as Promise<LandingPageData>;
      })
      .then(d => { if (d) setPage(d); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug, search]);

  async function handleLpCtaClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!page || !slug || ctaClickedRef.current) return;
    ctaClickedRef.current = true;
    setFetchingToken(true);
    setTokenError(null);
    try {
      const res = await fetch(`/api/landing-pages/${encodeURIComponent(slug)}/token`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Unable to generate access token");
      }
      const { token, serviceId } = await res.json() as { token: string; serviceId: number; exp: number };
      sessionStorage.setItem("onboardingLpToken", token);
      if (page.linkedService) {
        sessionStorage.setItem("onboardingLpService", JSON.stringify(page.linkedService));
      }
      window.location.href = `/crm/onboarding/select?serviceId=${serviceId}`;
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Unable to continue. Please try again.");
      ctaClickedRef.current = false;
    } finally {
      setFetchingToken(false);
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (notFound || !page) {
    return (
      <Layout>
        <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 py-20">
          <h1 className="text-3xl font-bold text-[#0A2540] mb-4">Page Not Found</h1>
          <p className="text-gray-600 mb-8">This landing page doesn't exist or is no longer available.</p>
          <CTAButton href="/">Go Home</CTAButton>
        </div>
      </Layout>
    );
  }

  const ctaHref = page.cta?.href ?? "/contact";
  const ctaText = page.cta?.buttonText ?? "Get Started";

  function ctaProps(extraClassName?: string) {
    if (isLpOnly) {
      return {
        onClick: handleLpCtaClick as React.MouseEventHandler,
        disabled: fetchingToken,
        className: extraClassName,
        children: fetchingToken ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading…</span> : ctaText,
      } as const;
    }
    return { href: ctaHref, className: extraClassName, children: ctaText } as const;
  }

  return (
    <Layout>
      {page._preview && (
        <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 text-sm font-semibold text-center py-2 px-4 flex items-center justify-center gap-2 shadow-md">
          <span>🔍 Preview Mode</span>
          <span className="font-normal opacity-75">— this page is a draft and not visible to the public</span>
        </div>
      )}

      {/* ── HERO ── */}
      <section className="relative min-h-[85vh] flex items-center justify-center bg-[#0A2540] overflow-hidden">
        {/* Subtle grid */}
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
        {/* Radial glow */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)",
          }}
        />

        <div className="relative z-10 max-w-[1100px] mx-auto px-6 py-32 pt-44 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">
              Specialist Engagement — Shane McCaw Consulting
            </p>
          </div>

          {page.headline && (
            <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold text-white leading-[1.1] mb-5 max-w-4xl mx-auto">
              {page.headline}
            </h1>
          )}
          {page.subheadline && (
            <p className="text-xl text-[#00B4D8] font-semibold max-w-2xl mx-auto mb-4">
              {page.subheadline}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8 mb-10">
            <CTAButton {...ctaProps("text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30")} />
            {tokenError && <p className="text-red-300 text-sm text-center">{tokenError}</p>}
            <a
              href="/micro-offers"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors border border-white/20 px-8 py-3.5 rounded-xl hover:border-white/40"
            >
              See All Packages <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Trust footer */}
          <div className="pt-8 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
            {TRUST_BADGES.map((badge, i) => (
              <span key={i} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>

      {/* ── WHAT YOU GET ── */}
      {page.valuePropBlocks.length > 0 && (
        <section className="bg-[#F7F9FC] py-20 px-6">
          <div className="max-w-[1100px] mx-auto">
            <div className="text-center mb-14">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">What's Included</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
                What You Get
              </h2>
              <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
                Every deliverable is scoped upfront. No open-ended consulting fees. No scope creep.
                Senior-level delivery by Shane — personally.
              </p>
            </div>

            <div
              className={`grid grid-cols-1 gap-6 ${
                page.valuePropBlocks.length === 1
                  ? "max-w-xl mx-auto"
                  : page.valuePropBlocks.length === 2
                  ? "md:grid-cols-2 max-w-3xl mx-auto"
                  : "md:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {page.valuePropBlocks.map((block, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-border p-8 flex flex-col hover:border-[#0078D4]/30 hover:shadow-sm transition-all"
                >
                  {block.icon ? (
                    <div className="text-3xl mb-4">{block.icon}</div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center mb-4 flex-shrink-0">
                      <Zap className="w-5 h-5 text-[#0078D4]" />
                    </div>
                  )}
                  <h3 className="text-lg font-extrabold text-[#0A2540] mb-3">{block.heading}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{block.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── WHY SHANE ── */}
      <section className="bg-[#0A2540] py-20 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Your Consultant</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
              Built at NASA Scale. Available to You.
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto leading-relaxed">
              Shane McCaw is NASA's Lead Microsoft 365 Architect with over 30 years inside the Microsoft
              ecosystem. The same discipline built for mission-critical, compliance-intensive environments
              is what you're getting — delivered personally, not delegated to junior staff.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
            {["FedRAMP", "FISMA", "ITAR", "GCC High", "HIPAA"].map((badge, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-lg px-5 py-2.5 text-white font-bold text-sm"
              >
                <Shield className="w-4 h-4 text-[#00B4D8] flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[860px] mx-auto">
            {[
              { stat: "30+", label: "Years in the Microsoft Ecosystem" },
              { stat: "NASA", label: "Current Lead M365 Architect" },
              { stat: "100%", label: "Senior Delivery — No Junior Staff" },
            ].map((item, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
                <div className="text-3xl font-extrabold text-[#00B4D8] mb-2">{item.stat}</div>
                <div className="text-white/60 text-sm font-medium">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-14">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">The Process</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
              How It Works
            </h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              Every engagement follows the same three-step discipline — no surprises, no open-ended scope.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-10 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-0.5 bg-gradient-to-r from-[#0078D4] via-[#00B4D8] to-[#0A2540] opacity-20" />
            {ENGAGEMENT_STEPS.map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6 text-white text-2xl font-extrabold"
                  style={{ backgroundColor: step.color }}
                >
                  {step.step}
                </div>
                <h3 className="text-xl font-extrabold text-[#0A2540] mb-3">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">{step.description}</p>
                <p className="text-xs font-semibold text-[#0078D4] italic">{step.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="bg-[#0078D4] py-20 px-6 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-blue-200 text-sm font-semibold uppercase tracking-[0.1em] mb-3">Ready to Get Started?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">{page.title}</h2>
          <p className="text-blue-100 mb-8 leading-relaxed">
            Fixed price. Senior-level delivery. No surprises. Ready when you are.
          </p>
          <CTAButton {...ctaProps("bg-white text-[#0078D4] hover:bg-gray-100 text-lg px-10 py-4 shadow-lg")} />
          {page.cta?.subtext && (
            <p className="mt-4 text-sm text-blue-200">{page.cta.subtext}</p>
          )}
          <div className="mt-10 pt-8 border-t border-white/20 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/70 text-sm font-medium">
            {TRUST_BADGES.map((badge, i) => (
              <span key={i} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-white/50 flex-shrink-0" />
                {badge}
              </span>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
