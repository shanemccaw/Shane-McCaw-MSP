import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import { 
  CheckCircle, 
  ArrowRight, 
  Users, 
  Building2, 
  Zap, 
  Shield, 
  AlertCircle,
  Layers,
  Lock,
  Activity,
  Clock,
  Sparkles
} from "lucide-react";
import { trackMspSignupStarted, trackPricingInteraction } from "@/lib/analytics";
import { useServices } from "@/hooks/useServices";

interface MspTier {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  price: number;
  billingType: string | null;
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: string[] | Record<string, boolean> | null;
  features: string[];
  inclusions: string[];
  badge: string | null;
  highlighted: boolean;
  fulfillmentTypeKey: string | null;
}

function normalizeTierCapabilities(
  raw: string[] | Record<string, boolean> | null | undefined,
): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

function formatPrice(dollars: number, billingType: string | null): string {
  const formatted = dollars % 1 === 0
    ? `$${dollars.toLocaleString()}`
    : `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!billingType || billingType === "monthly") return `${formatted}/mo`;
  if (billingType === "annual") return `${formatted}/yr`;
  return formatted;
}

function formatOverage(cents: number): string {
  if (cents < 100) return `${cents}¢ / extra tenant`;
  const dollars = cents / 100;
  return `$${dollars.toLocaleString()}/extra tenant`;
}

const ONBOARDING_OPTIONS = [
  {
    key: "self_service",
    label: "Self-Service Setup",
    desc: "Guided onboarding documentation and a recorded walkthrough. Ideal for technically confident partners who want to configure the platform independently.",
    icon: <Zap className="w-5 h-5 text-blue-400" />,
    detail: "Access to the partner portal immediately. Setup guide + video walkthrough included.",
  },
  {
    key: "white_glove",
    label: "White-Glove Onboarding",
    desc: "A live onboarding session with Shane, full environment review, and co-configured first tenant handoff. Recommended for first-time MSP partners.",
    icon: <Shield className="w-5 h-5 text-blue-400" />,
    detail: "Includes 2×60-min live sessions, tenant co-configuration, and a 30-day check-in call.",
  },
];

const WHY_PARTNER = [
  {
    icon: <Building2 className="w-5 h-5 text-blue-400" />,
    title: "Governance Standards From 30 Years in the Field",
    desc: "Offer your clients the same Microsoft 365 security and Copilot governance architecture Shane McCaw has spent three decades refining — including his current work as a Lead M365 Architect.",
  },
  {
    icon: <Shield className="w-5 h-5 text-blue-400" />,
    title: "100% White-Label Platform",
    desc: "Deliver assessments, real-time dashboards, and tenant hardening reports branded under your MSP logo — backed behind the scenes by Shane's 30+ year platform authority.",
  },
  {
    icon: <Users className="w-5 h-5 text-blue-400" />,
    title: "Scalable Portfolio Management",
    desc: "Every partnership plan includes a direct tenant allowance. Add client tenants seamlessly as your business grows, with predictable, flat-rate overage margins.",
  },
  {
    icon: <Zap className="w-5 h-5 text-blue-400" />,
    title: "Dynamic AI-Assisted Advisory",
    desc: "Leverage bundled AI credits for Copilot diagnostics and active baseline audits. Empower your account managers to deliver high-margin governance advice in minutes.",
  },
];

type Step = "tiers" | "onboarding" | "confirm";

export default function Msp() {
  const [tiers, setTiers] = useState<MspTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("tiers");
  const [selectedTier, setSelectedTier] = useState<MspTier | null>(null);
  const [selectedOnboarding, setSelectedOnboarding] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const { services: onboardingServices } = useServices("msp_onboarding");

  function getOnboardingPrice(key: string): string | null {
    const svc = onboardingServices.find(
      (s) => s.serviceType === key || s.slug === `msp-onboarding-${key.replace("_", "-")}`
    );
    if (!svc || !svc.price) return null;
    const num = parseFloat(svc.price);
    if (isNaN(num)) return null;
    return num === 0 ? "Included" : `+$${num.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  useEffect(() => {
    fetch("/api/msp/signup/tiers")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ tiers: MspTier[] } | MspTier[]>;
      })
      .then((data) => {
        const tiersData = Array.isArray(data)
          ? data
          : (data as { tiers?: MspTier[] }).tiers ?? [];
        setTiers(tiersData);
        setLoading(false);
      })
      .catch(() => {
        setError("Unable to load partnership tiers. Please try again or contact us directly.");
        setLoading(false);
      });
  }, []);

  function selectTier(tier: MspTier) {
    setSelectedTier(tier);
    trackPricingInteraction("plan_select", { label: tier.name, metadata: { tierSlug: tier.slug } });
    trackMspSignupStarted({ tier_slug: tier.slug, tier_name: tier.name });
    setStep("onboarding");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToConfirm() {
    if (!selectedOnboarding) return;
    setStep("confirm");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCheckout() {
    if (!selectedTier || !agreed) return;
    if (!selectedTier.fulfillmentTypeKey) return;
    const params = new URLSearchParams({
      product: selectedTier.slug,
      onboarding: selectedOnboarding ?? "self_service",
    });
    window.location.href = `/checkout?${params.toString()}`;
  }

  return (
    <Layout>
      <SEOMeta
        title="MSP & Partner Programme | Shane McCaw Consulting"
        description="White-label Microsoft 365 architecture and advisory services for MSPs and IT partners. Scalable tiers with tenant allowances, AI credits, and Shane McCaw's 30-year methodology."
        ogUrl="https://shanemccawconsulting.com/msp"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          "name": "MSP Partner Programme — Shane McCaw Consulting",
          "description": "White-label Microsoft 365 architecture and governance advisory for managed service providers. Scalable tiers with tenant allowances and AI credits.",
          "url": "https://shanemccawconsulting.com/msp",
          "serviceType": "MSP Partner Programme",
          "areaServed": { "@type": "Country", "name": "United States" },
          "provider": {
            "@type": "Person",
            "name": "Shane McCaw",
            "jobTitle": "Lead Microsoft 365 Architect",
            "url": "https://shanemccawconsulting.com",
          },
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-slate-950 pt-[172px] pb-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20 pointer-events-none"></div>
        
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.12em] mb-4">MSP & Partner Programme</p>
          <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight max-w-4xl tracking-tight">
            Deliver Senior-Architect-Grade M365 Governance Under Your Brand
          </h1>
          <p className="text-slate-405 text-lg sm:text-xl mt-6 max-w-3xl leading-relaxed">
            Provide your clients with automated tenant intelligence, security baseline compliance audits, and Microsoft Copilot governance blueprints. Fully white-labeled to establish your team as the premier security authority.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <a
              href="#tiers"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-4 rounded-xl transition-all text-base shadow-lg shadow-blue-600/10 hover:shadow-blue-600/20"
            >
              <span>View Partnership Tiers</span>
              <ArrowRight className="w-5 h-5" />
            </a>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-slate-350 font-semibold hover:text-white transition-colors text-sm border border-slate-800 px-6 py-3.5 rounded-xl hover:border-slate-700"
            >
              Talk to Shane First
            </a>
          </div>
        </div>
      </section>

      {/* ── WHY PARTNER ──────────────────────────────────────────────────── */}
      <section className="bg-slate-950 border-y border-slate-900 py-24">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <p className="text-blue-400 text-xs font-semibold uppercase tracking-[0.12em] mb-3">Differentiate Your Practice</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white">Why MSPs Choose Shane McCaw's Platform</h2>
            <p className="text-slate-400 mt-4 leading-relaxed text-sm sm:text-base">
              M365 administration is typically delivered as a low-margin commodity. Our partners package M365 as a premium compliance service — enabling automated billing protection, drift control, and tenant alignment.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {WHY_PARTNER.map((item, idx) => (
              <div key={idx} className="flex gap-4 p-6 rounded-2xl border border-slate-850 bg-slate-900/30 hover:border-blue-500/20 transition-all">
                <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-bold text-white mb-2 text-base">{item.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ENGINES EXPLANATION (COMPELLING VALUE) ─────────────────────────── */}
      <section className="bg-slate-950 py-24 border-b border-slate-900">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <span className="text-[10px] uppercase font-bold tracking-widest text-blue-400">Automated Signal Technology</span>
            <h2 className="text-3xl font-extrabold text-white mt-2">Powered by the 6 Core Auditing Engines</h2>
            <p className="text-sm text-slate-400 mt-3 leading-relaxed">
              Shane McCaw's platform doesn't rely on manual checks or surface-level audits. We deploy continuous background engines directly into client tenants using secure read-only adapters.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-850">
              <Layers className="w-8 h-8 text-blue-400 mb-4" />
              <h3 className="text-base font-bold text-white mb-2">Drift & Security Isolation</h3>
              <p className="text-xs text-slate-405 leading-relaxed">
                The Drift Engine locks in default client baselines, while the Security Engine isolates anonymous guest links, overly permissive OAuth keys, and legacy protocol exposure.
              </p>
            </div>
            
            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-850">
              <Activity className="w-8 h-8 text-blue-400 mb-4" />
              <h3 className="text-base font-bold text-white mb-2">Health & SLA Assurances</h3>
              <p className="text-xs text-slate-405 leading-relaxed">
                The Health Engine monitors system state coefficients to score tenant health, and the SLA Engine aggregates ticket response metrics to guarantee execution times.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-850">
              <Lock className="w-8 h-8 text-blue-400 mb-4" />
              <h3 className="text-base font-bold text-white mb-2">SOW Protection & Offers</h3>
              <p className="text-xs text-slate-405 leading-relaxed">
                The Scope Creep Engine audits actual engineer workloads against client contract boundaries, while the Sales Offer Engine automatically spots upgrade opportunities to scale your ARR.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── TIERS / ONBOARDING / CONFIRM ─────────────────────────────────── */}
      <section id="tiers" className="bg-slate-950 py-24">
        <div className="max-w-[1200px] mx-auto px-6">

          {/* ── STEP 1: TIERS ─────────────────────────────────────────────── */}
          {step === "tiers" && (
            <>
              <div className="text-center mb-16">
                <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.12em] mb-3">Partnership Tiers</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-white">Choose Your Partnership Plan</h2>
                <p className="text-slate-400 mt-4 max-w-xl mx-auto leading-relaxed">
                  All tiers grant white-label deliverable licenses, Shane's governance baseline profiles, and automated partner portal management access.
                </p>
              </div>

              {loading && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-3xl border bg-slate-900/40 border-slate-850 p-8 animate-pulse">
                      <div className="h-4 w-16 bg-slate-800 rounded mb-4" />
                      <div className="h-8 w-40 bg-slate-800 rounded mb-2" />
                      <div className="h-4 w-24 bg-slate-800 rounded mb-6" />
                      <div className="space-y-2">
                        {[0, 1, 2, 3].map((j) => (
                          <div key={j} className="h-3 bg-slate-805 rounded" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="max-w-xl mx-auto bg-slate-900 border border-slate-850 rounded-3xl p-8 text-center">
                  <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
                  <p className="text-white font-semibold mb-2">Couldn't load partnership tiers</p>
                  <p className="text-slate-400 text-sm leading-relaxed mb-6">{error}</p>
                  <a
                    href="/contact"
                    className="inline-flex items-center gap-2 bg-blue-600 text-white font-semibold px-6 py-3.5 rounded-xl hover:bg-blue-500 transition-colors text-sm"
                  >
                    Contact Shane Directly <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              )}

              {!loading && !error && tiers.length === 0 && (
                <div className="max-w-xl mx-auto bg-slate-900 border border-slate-850 rounded-3xl p-8 text-center">
                  <p className="text-white font-semibold mb-2">No tiers available yet</p>
                  <p className="text-slate-400 text-sm mb-6">
                    Partnership tiers are being configured. Contact Shane directly to discuss your options.
                  </p>
                  <CTAButton href="/contact">Get in Touch</CTAButton>
                </div>
              )}

              {!loading && !error && tiers.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {tiers.map((tier) => (
                    <div
                      key={tier.id}
                      className={`relative rounded-3xl border p-8 flex flex-col transition-all group ${
                        tier.highlighted
                          ? "bg-slate-900 border-blue-500 shadow-2xl shadow-blue-600/10 hover:-translate-y-1"
                          : "bg-slate-900/40 border-slate-850 hover:border-slate-800 hover:-translate-y-1"
                      }`}
                    >
                      {tier.badge && (
                        <span className="absolute -top-3.5 left-8 text-[10px] uppercase tracking-wider font-extrabold px-3 py-1 rounded-full bg-blue-600 text-white shadow-md">
                          {tier.badge}
                        </span>
                      )}

                      <div className="mb-6">
                        <p className="text-xs font-extrabold uppercase tracking-widest mb-2 text-blue-400">
                          {tier.name}
                        </p>
                        {tier.tagline && (
                          <p className="text-sm text-slate-400 leading-relaxed">
                            {tier.tagline}
                          </p>
                        )}
                      </div>

                      <div className="mb-6">
                        <p className="text-4xl font-black tracking-tight text-white">
                          {formatPrice(tier.price, tier.billingType)}
                        </p>
                        {tier.tenantAllowance !== null && (
                          <p className="text-sm mt-2.5 text-slate-350">
                            Up to {tier.tenantAllowance} managed tenant{tier.tenantAllowance !== 1 ? "s" : ""}
                          </p>
                        )}
                        {tier.aiCreditAllowance !== null && (
                          <p className="text-xs text-slate-400 mt-1">
                            {tier.aiCreditAllowance.toLocaleString()} AI credits / month
                          </p>
                        )}
                        {tier.overageRateCents !== null && tier.overageRateCents > 0 && (
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1.5 font-bold">
                             Overage: {formatOverage(tier.overageRateCents)}
                          </p>
                        )}
                      </div>

                      {tier.features.length > 0 && (
                        <ul className="space-y-3 mb-8 pt-6 border-t border-slate-850 flex-1">
                          {tier.features.map((f, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs text-slate-300">
                              <CheckCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                              <span className="leading-relaxed">{f}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {tier.fulfillmentTypeKey ? (
                        <button
                          onClick={() => selectTier(tier)}
                          className="w-full inline-flex items-center justify-center gap-2 font-bold px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-all text-xs"
                        >
                          Get Started <ArrowRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <div className="w-full text-center">
                          <p className="text-xs mb-3 text-slate-500 font-semibold">
                            Not yet available for self-service signup
                          </p>
                          <a
                            href="/contact"
                            className="inline-flex items-center gap-2 font-semibold px-6 py-3 rounded-xl border border-slate-800 text-slate-350 hover:border-slate-700 hover:text-white transition-colors text-xs"
                          >
                            Contact Shane <ArrowRight className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── STEP 2: ONBOARDING ────────────────────────────────────────── */}
          {step === "onboarding" && selectedTier && (
            <>
              <div className="text-center mb-10">
                <button
                  onClick={() => setStep("tiers")}
                  className="text-blue-400 text-sm font-semibold hover:underline mb-4 inline-flex items-center gap-1"
                >
                  ← Back to tiers
                </button>
                <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.12em] mb-3">Onboarding Package</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-white">
                  How Would You Like to Get Started?
                </h2>
                <p className="text-slate-400 mt-4 max-w-lg mx-auto">
                  You've selected <strong className="text-white">{selectedTier.name}</strong>. Choose your onboarding style below.
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-4 mb-10">
                {ONBOARDING_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSelectedOnboarding(opt.key)}
                    className={`w-full text-left p-6 rounded-2xl border-2 transition-all ${
                      selectedOnboarding === opt.key
                        ? "border-blue-500 bg-slate-900/60"
                        : "border-slate-850 bg-slate-900/20 hover:border-slate-800"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                        {opt.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                          <h3 className="font-bold text-white">{opt.label}</h3>
                          {getOnboardingPrice(opt.key) && (
                            <span className="text-xs font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                              {getOnboardingPrice(opt.key)}
                            </span>
                          )}
                          {selectedOnboarding === opt.key && (
                            <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">Selected</span>
                          )}
                        </div>
                        <p className="text-slate-400 text-sm leading-relaxed mb-2">{opt.desc}</p>
                        <p className="text-blue-400 text-xs font-semibold">{opt.detail}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="max-w-2xl mx-auto text-center">
                <button
                  onClick={goToConfirm}
                  disabled={!selectedOnboarding}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-10 py-4 rounded-xl transition-all text-base"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* ── STEP 3: CONFIRM + CLICKWRAP ───────────────────────────────── */}
          {step === "confirm" && selectedTier && selectedOnboarding && (
            <>
              <div className="text-center mb-10">
                <button
                  onClick={() => setStep("onboarding")}
                  className="text-blue-400 text-sm font-semibold hover:underline mb-4 inline-flex items-center gap-1"
                >
                  ← Back
                </button>
                <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.12em] mb-3">Review & Confirm</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-white">
                  Almost There
                </h2>
              </div>

              <div className="max-w-2xl mx-auto">
                <div className="bg-slate-900 border border-slate-850 rounded-3xl p-8 mb-6 space-y-5">
                  <div>
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1">Selected Plan</p>
                    <p className="text-white font-bold text-lg">{selectedTier.name}</p>
                    <p className="text-slate-400 text-sm">{formatPrice(selectedTier.price, selectedTier.billingType)}</p>
                  </div>
                  <div className="border-t border-slate-850 pt-5">
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1">Onboarding</p>
                    <p className="text-white font-semibold">
                      {ONBOARDING_OPTIONS.find((o) => o.key === selectedOnboarding)?.label}
                    </p>
                  </div>
                  {selectedTier.tenantAllowance !== null && (
                    <div className="border-t border-slate-850 pt-5">
                      <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1">Tenant Allowance</p>
                      <p className="text-white font-semibold">{selectedTier.tenantAllowance} managed tenant{selectedTier.tenantAllowance !== 1 ? "s" : ""} included</p>
                    </div>
                  )}
                </div>

                <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-6 mb-8">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-1 w-4 h-4 accent-blue-600 flex-shrink-0"
                    />
                    <span className="text-sm text-slate-350 leading-relaxed">
                      I have read and agree to the{" "}
                      <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:no-underline font-semibold">
                        MSP Partner Terms of Service
                      </a>{" "}
                      and the{" "}
                      <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:no-underline font-semibold">
                        Data Processing Agreement
                      </a>
                      . I understand that client tenant data processed through the Shane McCaw Consulting platform is subject to the DPA obligations described therein.
                    </span>
                  </label>
                </div>

                {!selectedTier.fulfillmentTypeKey && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-amber-400 text-sm leading-relaxed">
                      Self-service checkout is not yet available for this tier. Clicking continue will open a contact form so Shane can set you up directly.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-4">
                  {selectedTier.fulfillmentTypeKey ? (
                    <button
                      onClick={handleCheckout}
                      disabled={!agreed}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-8 py-4 rounded-xl transition-all text-base"
                    >
                      Proceed to Checkout <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <a
                      href={`/contact?intent=msp-partner&tier=${selectedTier.slug}`}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-4 rounded-xl transition-all text-base text-center"
                    >
                      Contact Shane to Get Started <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={() => { setAgreed(false); setStep("tiers"); setSelectedTier(null); setSelectedOnboarding(null); }}
                    className="flex-shrink-0 inline-flex items-center justify-center gap-2 text-slate-350 font-semibold border border-slate-800 px-6 py-4 rounded-xl hover:border-slate-700 transition-colors text-sm"
                  >
                    Start Over
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── CAPABILITIES ─────────────────────────────────────────────────── */}
      {step === "tiers" && (
        <section className="bg-slate-950 border-t border-slate-900 py-24">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="text-center mb-16 max-w-3xl mx-auto">
              <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.12em] mb-3">What Partners Deliver</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white">The Shane McCaw Methodology — White-Labeled</h2>
              <p className="text-slate-400 mt-4 leading-relaxed text-sm sm:text-base">
                Every tier gives your team access to the same methodology Shane uses for direct engagements — adapted for MSP delivery at scale.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                { title: "M365 Tenant Health Assessments", desc: "Structured 50-point tenant reviews identifying governance gaps, security misconfigurations, and adoption bottlenecks." },
                { title: "Governance Framework Delivery", desc: "DLP policies, sensitivity labeling taxonomy, retention schedules, and Teams/SharePoint governance playbooks." },
                { title: "Copilot Readiness Reviews", desc: "AI-assisted readiness scoring across data governance, identity, and licensing — with a phased rollout roadmap." },
                { title: "Security Hardening Reports", desc: "CIS M365 Benchmark assessments with a prioritized remediation roadmap and executive summary." },
                { title: "Migration Planning", desc: "Exchange, SharePoint, and Google Workspace migration architectures with zero-data-loss sequencing." },
                { title: "Training & Enablement", desc: "Instructor-ready curriculum for Teams, SharePoint, Copilot, and Power Platform — configurable for each client." },
              ].map((item) => (
                <div key={item.title} className="p-6 rounded-2xl border border-slate-850 bg-slate-900/20 hover:border-blue-500/20 transition-all">
                  <CheckCircle className="w-5 h-5 text-blue-400 mb-3" />
                  <h3 className="font-bold text-white mb-2 text-base">{item.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FINAL CTA ─────────────────────────────────────────────────────── */}
      {step === "tiers" && (
        <section className="bg-slate-950 border-t border-slate-900 py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_100%,#000_70%,transparent_100%)] opacity-20 pointer-events-none"></div>
          
          <div className="max-w-[1200px] mx-auto px-6 relative text-center">
            <p className="text-blue-400 text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ready to Talk?</p>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4 max-w-3xl mx-auto tracking-tight">
              Not Sure Which Tier Is Right? Talk to Shane First.
            </h2>
            <p className="text-slate-400 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
              A 30-minute call to understand your client mix, current M365 capability gaps, and the right entry point for your practice.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <CTAButton href="/book">Book a Partner Discovery Call</CTAButton>
              <a
                href="#tiers"
                className="inline-flex items-center gap-2 text-slate-350 font-semibold hover:text-white transition-colors text-sm border border-slate-850 px-6 py-3.5 rounded-xl hover:border-slate-800"
              >
                View Tiers <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
