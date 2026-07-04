import { useState, useEffect } from "react";
import type { OfferState } from "./PayTodayBanner";

function useIsOfferLive(expiresAt: string | null | undefined): boolean {
  const [live, setLive] = useState<boolean>(() => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() > Date.now();
  });
  useEffect(() => {
    if (!expiresAt) { setLive(false); return; }
    const check = () => setLive(new Date(expiresAt).getTime() > Date.now());
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  return live;
}

interface SowPhaseForPayment {
  id: string;
  title: string;
  price: number;
  deliveryDate?: string | null;
}

interface PriceLineItem {
  title: string;
  price: number;
}

interface PaymentOptionsPanelProps {
  totalPrice: number;
  /** Provide to trigger Stripe checkout (checkout step). Omit for plan-select-only mode. */
  onCheckout?: (plan: "full" | "phased", applyPayToday: boolean) => Promise<void>;
  /** Called when the user picks a plan in select-only mode (payment step). */
  onPlanSelected?: (plan: "full" | "phased") => void;
  /** Pre-selects a plan (used on the checkout step to show the previously chosen plan). */
  initialPlan?: "full" | "phased" | null;
  onClaimFree?: () => Promise<void>;
  loading: boolean;
  alreadyPaid?: boolean;
  onContinue?: () => void;
  offer?: OfferState | null;
  freeClaimError?: string | null;
  onDismissFreeClaimError?: () => void;
  /** Selected SOW phases — shown as a milestone breakdown inside the phased card. */
  sowPhases?: SowPhaseForPayment[];
  /** Scope line items shown in the Pay in Full card (phase name + price). */
  selectedPhases?: PriceLineItem[];
  /** Adjustment lines (discounts/fees) shown below scope lines in the Pay in Full card, struck through. */
  adjustmentLines?: PriceLineItem[];
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function PaymentOptionsPanel({
  totalPrice,
  onCheckout,
  onPlanSelected,
  initialPlan = null,
  onClaimFree,
  loading,
  alreadyPaid = false,
  onContinue,
  offer = null,
  freeClaimError = null,
  onDismissFreeClaimError,
  sowPhases,
  selectedPhases = [],
  adjustmentLines = [],
}: PaymentOptionsPanelProps) {
  const [selectedPlan, setSelectedPlan] = useState<"full" | "phased" | null>(initialPlan ?? null);

  const upfrontAmount = Math.round(totalPrice * 0.2 * 100) / 100;
  const remainingAmount = totalPrice - upfrontAmount;

  const isOfferLive = useIsOfferLive(offer?.active ? offer.expiresAt : null);
  const offerActive = offer?.active === true && isOfferLive;
  const discountedFullPrice = offerActive ? offer!.discountedTotal : null;

  if (alreadyPaid) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-12">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-[#0A2540]">Payment Confirmed!</h2>
          <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
            Your payment has been processed. Shane will be in touch shortly to kick off your engagement.
          </p>
        </div>
        {onContinue && (
          <button
            onClick={onContinue}
            className="px-8 py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 shadow-lg shadow-[#0078D4]/20 transition-all flex items-center gap-2"
          >
            Continue to Agreement
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  if (totalPrice === 0 && onClaimFree) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-12">
        <div className="w-20 h-20 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
          <svg className="w-10 h-10 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-[#0A2540]">This Engagement Is Complimentary</h2>
          <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
            No payment is required. Claim your complimentary engagement to proceed.
          </p>
        </div>
        {freeClaimError && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 max-w-sm text-left">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-red-700 flex-1">{freeClaimError}</p>
            {onDismissFreeClaimError && (
              <button onClick={onDismissFreeClaimError} className="text-red-400 hover:text-red-600 flex-shrink-0" aria-label="Dismiss">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
        <button
          onClick={() => void onClaimFree()}
          disabled={loading}
          className="px-8 py-3.5 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 active:scale-[0.99] disabled:opacity-50 transition-all shadow-lg shadow-[#0078D4]/20"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing…
            </span>
          ) : (
            "Claim Complimentary Engagement"
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-6 flex-shrink-0">
        <h2 className="text-xl font-extrabold text-[#0A2540]">Choose Your Payment Plan</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select how you'd like to handle payment for your{" "}
          <strong className="text-[#0A2540]">{formatCurrency(totalPrice)}</strong> engagement.
        </p>
      </div>

      {/* Payment option cards */}
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Pay in full */}
        <button
          onClick={() => { setSelectedPlan("full"); onPlanSelected?.("full"); }}
          className={`relative flex flex-col items-start p-5 rounded-2xl border-2 text-left transition-all ${
            selectedPlan === "full"
              ? "border-[#0078D4] bg-[#0078D4]/5 shadow-md"
              : "border-border bg-white hover:border-[#0078D4]/50"
          }`}
        >
          {selectedPlan === "full" && (
            <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#0078D4] flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {offerActive && (
            <div className="absolute top-3 left-3">
              <span className="text-[10px] font-bold uppercase tracking-widest bg-amber-500 text-white px-2 py-0.5 rounded-full">
                Best Deal
              </span>
            </div>
          )}
          <div className={`w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center mb-3 ${offerActive ? "mt-5" : ""}`}>
            <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-extrabold text-[#0A2540] mb-1">Pay in Full</h3>
          {offerActive && discountedFullPrice !== null ? (
            <div className="mb-2">
              <p className="text-2xl font-extrabold text-amber-600">{formatCurrency(discountedFullPrice)}</p>
              <p className="text-sm text-muted-foreground line-through">{formatCurrency(totalPrice)}</p>
              <p className="text-xs font-semibold text-amber-600 mt-0.5">
                Save {formatCurrency(totalPrice - discountedFullPrice)} today
              </p>
            </div>
          ) : (
            <p className="text-2xl font-extrabold text-[#0078D4] mb-2">{formatCurrency(totalPrice)}</p>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">
            Single payment today. Best value — no additional billing steps. Work begins immediately upon payment confirmation.
          </p>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Simplest option
          </div>
          {(selectedPhases.length > 0 || adjustmentLines.length > 0) && (
            <div className="w-full mt-3 pt-3 border-t border-border/60">
              <div className={`flex flex-col gap-1 ${selectedPhases.length + adjustmentLines.length >= 5 ? "max-h-[140px] overflow-y-auto pr-1" : ""}`}>
                {selectedPhases.map((phase, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-[#0A2540] truncate">{phase.title}</span>
                    <span className="text-xs font-semibold text-[#0078D4] flex-shrink-0">{formatCurrency(phase.price)}</span>
                  </div>
                ))}
                {selectedPhases.length > 0 && adjustmentLines.length > 0 && (
                  <div className="border-t border-border/40 my-1" />
                )}
                {adjustmentLines.map((adj, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-muted-foreground truncate">{adj.title}</span>
                    <span className="text-xs text-muted-foreground line-through flex-shrink-0">{formatCurrency(adj.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </button>

        {/* 20% upfront + milestone billing */}
        <button
          onClick={() => { setSelectedPlan("phased"); onPlanSelected?.("phased"); }}
          className={`relative flex flex-col items-start p-5 rounded-2xl border-2 text-left transition-all ${
            selectedPlan === "phased"
              ? "border-[#0078D4] bg-[#0078D4]/5 shadow-md"
              : "border-border bg-white hover:border-[#0078D4]/50"
          }`}
        >
          {selectedPlan === "phased" && (
            <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#0078D4] flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          <div className="absolute top-3 left-3">
            <span className="text-[10px] font-bold uppercase tracking-widest bg-[#0078D4] text-white px-2 py-0.5 rounded-full">
              Popular
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center mb-3 mt-5">
            <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h3 className="text-sm font-extrabold text-[#0A2540] mb-1">20% Upfront + Per Phase</h3>
          <p className="text-2xl font-extrabold text-purple-600 mb-0.5">{formatCurrency(upfrontAmount)} <span className="text-base font-bold text-muted-foreground">today</span></p>

          {sowPhases && sowPhases.length > 0 ? (
            <div className="w-full mt-2 mb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Due at completion</p>
              <div className={`flex flex-col gap-1 ${sowPhases.length >= 5 ? "max-h-[140px] overflow-y-auto pr-1" : ""}`}>
                {sowPhases.map((phase) => (
                  <div key={phase.id} className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-4 h-4 mt-0.5 rounded-full bg-purple-100 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343M6.343 7.343A8 8 0 0117.657 18.657" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-xs font-semibold text-[#0A2540] truncate">{phase.title}</span>
                        <span className="text-xs font-bold text-purple-600 flex-shrink-0">{formatCurrency(phase.price)}</span>
                      </div>
                      {phase.deliveryDate && (
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          Est. completion: {new Date(phase.deliveryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-2">{formatCurrency(remainingAmount)} billed per completed phase</p>
          )}

          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            Pay 20% to kick off the engagement. Each subsequent phase is invoiced and charged upon completion — giving you milestone-based accountability.
          </p>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-purple-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Pay as milestones complete
          </div>
        </button>
      </div>

      {/* CTA — only shown when onCheckout is provided (checkout step, not plan-select step) */}
      {onCheckout && (
        <div className="flex-shrink-0">
          <button
            onClick={() => selectedPlan && void onCheckout(selectedPlan, offerActive && selectedPlan === "full")}
            disabled={!selectedPlan || loading}
            className={`w-full py-3.5 rounded-xl text-white font-bold text-sm active:scale-[0.99] disabled:opacity-50 transition-all shadow-lg ${
              offerActive && selectedPlan === "full"
                ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20"
                : "bg-[#0078D4] hover:bg-[#0078D4]/90 shadow-[#0078D4]/20"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Redirecting to checkout…
              </span>
            ) : selectedPlan === "full" ? (
              offerActive && discountedFullPrice !== null
                ? `Pay ${formatCurrency(discountedFullPrice)} Today (Save ${formatCurrency(totalPrice - discountedFullPrice)})`
                : `Pay ${formatCurrency(totalPrice)} Now`
            ) : selectedPlan === "phased" ? (
              `Pay ${formatCurrency(upfrontAmount)} to Start`
            ) : (
              "Select a Payment Plan"
            )}
          </button>
          <p className="text-xs text-center text-muted-foreground mt-2">
            Secure checkout powered by Stripe · SSL encrypted
          </p>
        </div>
      )}
      {!onCheckout && (
        <p className="text-xs text-center text-muted-foreground mt-2 pb-2">
          {selectedPlan ? "Plan selected — click Next below to continue to your agreement." : "Select a plan above, then click Next below to continue."}
        </p>
      )}
    </div>
  );
}
