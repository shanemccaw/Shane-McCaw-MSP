import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import { CheckCircle, ArrowRight, Users, Building2, Zap, Shield, AlertCircle } from "lucide-react";
import { trackMspSignupStarted } from "@/lib/analytics";
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

/**
 * Normalize tierCapabilities regardless of whether the API returns a
 * Record<string, boolean> (current schema) or a legacy string[].
 * Returns only the capability keys whose value is truthy.
 */
function normalizeTierCapabilities(
  raw: string[] | Record<string, boolean> | null | undefined,
): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

function formatPrice(cents: number, billingType: string | null): string {
  const dollars = cents / 100;
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
    icon: <Zap className="w-5 h-5 text-[#0078D4]" />,
    detail: "Access to the partner portal immediately. Setup guide + video walkthrough included.",
  },
  {
    key: "white_glove",
    label: "White-Glove Onboarding",
    desc: "A live onboarding session with Shane, full environment review, and co-configured first tenant handoff. Recommended for first-time MSP partners.",
    icon: <Shield className="w-5 h-5 text-[#0078D4]" />,
    detail: "Includes 2×60-min live sessions, tenant co-configuration, and a 30-day check-in call.",
  },
];

const WHY_PARTNER = [
  {
    icon: <Building2 className="w-5 h-5 text-[#0078D4]" />,
    title: "NASA-Proven Methodology",
    desc: "Offer your clients the same Microsoft 365 architecture discipline Shane built for one of the world's most security-sensitive federal IT environments.",
  },
  {
    icon: <Shield className="w-5 h-5 text-[#0078D4]" />,
    title: "White-Label Ready",
    desc: "Deliver assessments, governance frameworks, and advisory services under your own brand — backed by 30 years of Microsoft ecosystem expertise.",
  },
  {
    icon: <Users className="w-5 h-5 text-[#0078D4]" />,
    title: "Tenant Allowance Scales With You",
    desc: "Each tier includes a set number of managed tenants. Add more as your portfolio grows — overage billing is transparent and predictable.",
  },
  {
    icon: <Zap className="w-5 h-5 text-[#0078D4]" />,
    title: "AI Credits Included",
    desc: "Copilot readiness assessments and AI-assisted governance reviews are bundled into every tier, so you can deliver high-value advisory at scale.",
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
        description="White-label Microsoft 365 architecture and advisory services for MSPs and IT partners. Scalable tiers with tenant allowances, AI credits, and NASA-proven methodology."
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
      <section className="bg-[#0A2540] pt-[172px] pb-20 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 900px 500px at 60% 0%, rgba(0,120,212,0.14) 0%, transparent 70%)" }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">MSP & Partner Programme</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-4xl">
            Deliver Enterprise-Grade M365 Architecture Under Your Own Brand
          </h1>
          <p className="text-white/65 text-xl mt-6 max-w-2xl leading-relaxed">
            White-label Microsoft 365 governance, security hardening, and Copilot readiness services — backed by NASA-proven methodology and 30 years of Microsoft ecosystem experience.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <a
              href="#tiers"
              className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#005fa3] text-white font-bold px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              View Partnership Tiers <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
            >
              Talk to Shane First
            </a>
          </div>
        </div>
      </section>

      {/* ── WHY PARTNER ──────────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Why Partner With Shane</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Built for MSPs Who Want to Differentiate</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed">
              Most MSPs deliver M365 as a commodity. Partners in this programme deliver it as a strategic asset — with governance, security, and Copilot readiness built in.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {WHY_PARTNER.map((item) => (
              <div key={item.title} className="flex gap-4 p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TIERS / ONBOARDING / CONFIRM ─────────────────────────────────── */}
      <section id="tiers" className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">

          {/* ── STEP 1: TIERS ─────────────────────────────────────────────── */}
          {step === "tiers" && (
            <>
              <div className="text-center mb-12">
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Partnership Tiers</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">Choose Your Plan</h2>
                <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
                  All tiers include access to Shane's methodology, white-label deliverables, and the partner portal. Select a plan to continue.
                </p>
              </div>

              {loading && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-2xl border bg-white border-border p-8 animate-pulse">
                      <div className="h-4 w-16 bg-gray-200 rounded mb-4" />
                      <div className="h-8 w-40 bg-gray-200 rounded mb-2" />
                      <div className="h-4 w-24 bg-gray-200 rounded mb-6" />
                      <div className="space-y-2">
                        {[0, 1, 2, 3].map((j) => (
                          <div key={j} className="h-3 bg-gray-100 rounded" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="max-w-xl mx-auto bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
                  <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
                  <p className="text-red-700 font-semibold mb-2">Couldn't load partnership tiers</p>
                  <p className="text-red-600 text-sm leading-relaxed mb-6">{error}</p>
                  <a
                    href="/contact"
                    className="inline-flex items-center gap-2 bg-[#0078D4] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#005fa3] transition-colors text-sm"
                  >
                    Contact Shane Directly <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              )}

              {!loading && !error && tiers.length === 0 && (
                <div className="max-w-xl mx-auto bg-white border border-border rounded-2xl p-8 text-center">
                  <p className="text-[#0A2540] font-semibold mb-2">No tiers available yet</p>
                  <p className="text-muted-foreground text-sm mb-6">
                    Partnership tiers are being configured. Contact Shane directly to discuss your options.
                  </p>
                  <CTAButton href="/contact">Get in Touch</CTAButton>
                </div>
              )}

              {!loading && !error && tiers.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {tiers.map((tier) => (
                    <div
                      key={tier.id}
                      className={`relative rounded-2xl border p-8 flex flex-col transition-all ${
                        tier.highlighted
                          ? "bg-[#0A2540] border-[#0078D4] shadow-xl shadow-[#0078D4]/10"
                          : "bg-white border-border hover:border-[#0078D4]/40 hover:shadow-md"
                      }`}
                    >
                      {tier.badge && (
                        <span className={`absolute -top-3 left-6 text-xs font-bold px-3 py-1 rounded-full ${
                          tier.highlighted ? "bg-[#0078D4] text-white" : "bg-[#0078D4]/10 text-[#0078D4]"
                        }`}>
                          {tier.badge}
                        </span>
                      )}

                      <div className="mb-6">
                        <p className={`text-sm font-semibold uppercase tracking-widest mb-2 ${tier.highlighted ? "text-[#0078D4]" : "text-[#0078D4]"}`}>
                          {tier.name}
                        </p>
                        {tier.tagline && (
                          <p className={`text-sm leading-relaxed ${tier.highlighted ? "text-white/70" : "text-muted-foreground"}`}>
                            {tier.tagline}
                          </p>
                        )}
                      </div>

                      <div className="mb-6">
                        <p className={`text-4xl font-black leading-none ${tier.highlighted ? "text-white" : "text-[#0A2540]"}`}>
                          {formatPrice(tier.price, tier.billingType)}
                        </p>
                        {tier.tenantAllowance !== null && (
                          <p className={`text-sm mt-2 ${tier.highlighted ? "text-white/60" : "text-muted-foreground"}`}>
                            Up to {tier.tenantAllowance} managed tenant{tier.tenantAllowance !== 1 ? "s" : ""}
                          </p>
                        )}
                        {tier.aiCreditAllowance !== null && (
                          <p className={`text-sm ${tier.highlighted ? "text-white/60" : "text-muted-foreground"}`}>
                            {tier.aiCreditAllowance.toLocaleString()} AI credits / month
                          </p>
                        )}
                        {tier.overageRateCents !== null && tier.overageRateCents > 0 && (
                          <p className={`text-xs mt-1 ${tier.highlighted ? "text-white/40" : "text-muted-foreground/70"}`}>
                            Then {formatOverage(tier.overageRateCents)}
                          </p>
                        )}
                      </div>

                      {tier.features.length > 0 && (
                        <ul className="space-y-2.5 mb-8 flex-1">
                          {tier.features.map((f, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${tier.highlighted ? "text-[#0078D4]" : "text-[#0078D4]"}`} />
                              <span className={`text-sm leading-relaxed ${tier.highlighted ? "text-white/85" : "text-foreground"}`}>{f}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {tier.fulfillmentTypeKey ? (
                        <button
                          onClick={() => selectTier(tier)}
                          className={`w-full inline-flex items-center justify-center gap-2 font-bold px-6 py-3.5 rounded-xl transition-colors text-sm ${
                            tier.highlighted
                              ? "bg-[#0078D4] hover:bg-[#005fa3] text-white"
                              : "bg-[#0A2540] hover:bg-[#0d3060] text-white"
                          }`}
                        >
                          Get Started <ArrowRight className="w-4 h-4" />
                        </button>
                      ) : (
                        <div className="w-full text-center">
                          <p className={`text-xs mb-3 ${tier.highlighted ? "text-white/50" : "text-muted-foreground"}`}>
                            Not yet available for self-service signup
                          </p>
                          <a
                            href="/contact"
                            className={`inline-flex items-center gap-2 font-semibold px-6 py-3 rounded-xl border transition-colors text-sm ${
                              tier.highlighted
                                ? "border-white/20 text-white/80 hover:border-white/40 hover:text-white"
                                : "border-border text-[#0078D4] hover:border-[#0078D4]/40"
                            }`}
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
                  className="text-[#0078D4] text-sm font-semibold hover:underline mb-4 inline-flex items-center gap-1"
                >
                  ← Back to tiers
                </button>
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Onboarding Package</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
                  How Would You Like to Get Started?
                </h2>
                <p className="text-muted-foreground mt-4 max-w-lg mx-auto">
                  You've selected <strong className="text-[#0A2540]">{selectedTier.name}</strong>. Choose your onboarding style below.
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-4 mb-10">
                {ONBOARDING_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSelectedOnboarding(opt.key)}
                    className={`w-full text-left p-6 rounded-2xl border-2 transition-all ${
                      selectedOnboarding === opt.key
                        ? "border-[#0078D4] bg-[#0078D4]/5"
                        : "border-border bg-white hover:border-[#0078D4]/40"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                        {opt.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                          <h3 className="font-bold text-[#0A2540]">{opt.label}</h3>
                          {getOnboardingPrice(opt.key) && (
                            <span className="text-xs font-semibold text-[#0078D4] bg-[#0078D4]/10 px-2 py-0.5 rounded-full">
                              {getOnboardingPrice(opt.key)}
                            </span>
                          )}
                          {selectedOnboarding === opt.key && (
                            <span className="text-xs font-bold bg-[#0078D4] text-white px-2 py-0.5 rounded-full">Selected</span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-sm leading-relaxed mb-2">{opt.desc}</p>
                        <p className="text-[#0078D4] text-xs font-semibold">{opt.detail}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="max-w-2xl mx-auto text-center">
                <button
                  onClick={goToConfirm}
                  disabled={!selectedOnboarding}
                  className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#005fa3] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-10 py-4 rounded-xl transition-colors text-base"
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
                  className="text-[#0078D4] text-sm font-semibold hover:underline mb-4 inline-flex items-center gap-1"
                >
                  ← Back
                </button>
                <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">Review & Confirm</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">
                  Almost There
                </h2>
              </div>

              <div className="max-w-2xl mx-auto">
                <div className="bg-white border border-border rounded-2xl p-8 mb-6 space-y-5">
                  <div>
                    <p className="text-xs font-bold text-[#0078D4] uppercase tracking-widest mb-1">Selected Plan</p>
                    <p className="text-[#0A2540] font-bold text-lg">{selectedTier.name}</p>
                    <p className="text-muted-foreground text-sm">{formatPrice(selectedTier.price, selectedTier.billingType)}</p>
                  </div>
                  <div className="border-t border-border pt-5">
                    <p className="text-xs font-bold text-[#0078D4] uppercase tracking-widest mb-1">Onboarding</p>
                    <p className="text-[#0A2540] font-semibold">
                      {ONBOARDING_OPTIONS.find((o) => o.key === selectedOnboarding)?.label}
                    </p>
                  </div>
                  {selectedTier.tenantAllowance !== null && (
                    <div className="border-t border-border pt-5">
                      <p className="text-xs font-bold text-[#0078D4] uppercase tracking-widest mb-1">Tenant Allowance</p>
                      <p className="text-[#0A2540] font-semibold">{selectedTier.tenantAllowance} managed tenant{selectedTier.tenantAllowance !== 1 ? "s" : ""} included</p>
                    </div>
                  )}
                </div>

                <div className="bg-[#0A2540]/5 border border-border rounded-2xl p-6 mb-8">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-1 w-4 h-4 accent-[#0078D4] flex-shrink-0"
                    />
                    <span className="text-sm text-[#0A2540] leading-relaxed">
                      I have read and agree to the{" "}
                      <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-[#0078D4] underline hover:no-underline">
                        MSP Partner Terms of Service
                      </a>{" "}
                      and the{" "}
                      <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-[#0078D4] underline hover:no-underline">
                        Data Processing Agreement
                      </a>
                      . I understand that client tenant data processed through the Shane McCaw Consulting platform is subject to the DPA obligations described therein.
                    </span>
                  </label>
                </div>

                {!selectedTier.fulfillmentTypeKey && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-amber-800 text-sm leading-relaxed">
                      Self-service checkout is not yet available for this tier. Clicking continue will open a contact form so Shane can set you up directly.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-4">
                  {selectedTier.fulfillmentTypeKey ? (
                    <button
                      onClick={handleCheckout}
                      disabled={!agreed}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#005fa3] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-8 py-4 rounded-xl transition-colors text-base"
                    >
                      Proceed to Checkout <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <a
                      href={`/contact?intent=msp-partner&tier=${selectedTier.slug}`}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#005fa3] text-white font-bold px-8 py-4 rounded-xl transition-colors text-base"
                    >
                      Contact Shane to Get Started <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={() => { setStep("tiers"); setSelectedTier(null); setSelectedOnboarding(null); setAgreed(false); }}
                    className="flex-shrink-0 inline-flex items-center justify-center gap-2 text-[#0A2540] font-semibold border border-border px-6 py-4 rounded-xl hover:border-[#0078D4]/40 transition-colors text-sm"
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
        <section className="bg-white py-20">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="text-center mb-12">
              <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-3">What Partners Deliver</p>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540]">The Shane McCaw Methodology — White-Labeled</h2>
              <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
                Every tier gives your team access to the same methodology Shane uses for direct engagements — adapted for MSP delivery at scale.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { title: "M365 Tenant Health Assessments", desc: "Structured 50-point tenant reviews identifying governance gaps, security misconfigurations, and adoption bottlenecks." },
                { title: "Governance Framework Delivery", desc: "DLP policies, sensitivity labeling taxonomy, retention schedules, and Teams/SharePoint governance playbooks." },
                { title: "Copilot Readiness Reviews", desc: "AI-assisted readiness scoring across data governance, identity, and licensing — with a phased rollout roadmap." },
                { title: "Security Hardening Reports", desc: "CIS M365 Benchmark assessments with a prioritized remediation roadmap and executive summary." },
                { title: "Migration Planning", desc: "Exchange, SharePoint, and Google Workspace migration architectures with zero-data-loss sequencing." },
                { title: "Training & Enablement", desc: "Instructor-ready curriculum for Teams, SharePoint, Copilot, and Power Platform — configurable for each client." },
              ].map((item) => (
                <div key={item.title} className="p-6 rounded-2xl border border-border hover:border-[#0078D4]/30 hover:bg-[#F7F9FC] transition-all">
                  <CheckCircle className="w-5 h-5 text-[#0078D4] mb-3" />
                  <h3 className="font-bold text-[#0A2540] mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FINAL CTA ─────────────────────────────────────────────────────── */}
      {step === "tiers" && (
        <section className="bg-[#0A2540] py-20 relative overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse 700px 400px at 50% 100%, rgba(0,120,212,0.15) 0%, transparent 70%)" }}
          />
          <div className="max-w-[1200px] mx-auto px-6 relative text-center">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Ready to Talk?</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 max-w-2xl mx-auto">
              Not Sure Which Tier Is Right? Talk to Shane First.
            </h2>
            <p className="text-white/60 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
              A 30-minute call to understand your client mix, current M365 capability gaps, and the right entry point for your practice.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <CTAButton href="/book">Book a Partner Discovery Call</CTAButton>
              <a
                href="#tiers"
                className="inline-flex items-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-6 py-3 rounded-xl hover:border-white/40"
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
