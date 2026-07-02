import { useState } from "react";

interface PaymentOptionsPanelProps {
  totalPrice: number;
  onCheckout: (plan: "full" | "phased") => Promise<void>;
  loading: boolean;
  alreadyPaid?: boolean;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function PaymentOptionsPanel({
  totalPrice,
  onCheckout,
  loading,
  alreadyPaid = false,
}: PaymentOptionsPanelProps) {
  const [selectedPlan, setSelectedPlan] = useState<"full" | "phased" | null>(null);

  const upfrontAmount = Math.round(totalPrice * 0.2 * 100) / 100;
  const remainingAmount = totalPrice - upfrontAmount;

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
          onClick={() => setSelectedPlan("full")}
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
          <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-extrabold text-[#0A2540] mb-1">Pay in Full</h3>
          <p className="text-2xl font-extrabold text-[#0078D4] mb-2">{formatCurrency(totalPrice)}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Single payment today. Best value — no additional billing steps. Work begins immediately upon payment confirmation.
          </p>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Simplest option
          </div>
        </button>

        {/* 20% upfront + milestone billing */}
        <button
          onClick={() => setSelectedPlan("phased")}
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
          <p className="text-xs text-muted-foreground mb-2">{formatCurrency(remainingAmount)} billed per completed phase</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
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

      {/* CTA */}
      <div className="flex-shrink-0">
        <button
          onClick={() => selectedPlan && void onCheckout(selectedPlan)}
          disabled={!selectedPlan || loading}
          className="w-full py-3.5 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 active:scale-[0.99] disabled:opacity-50 transition-all shadow-lg shadow-[#0078D4]/20"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Redirecting to checkout…
            </span>
          ) : (
            selectedPlan === "full"
              ? `Pay ${formatCurrency(totalPrice)} Now`
              : selectedPlan === "phased"
              ? `Pay ${formatCurrency(upfrontAmount)} to Start`
              : "Select a Payment Plan"
          )}
        </button>
        <p className="text-xs text-center text-muted-foreground mt-2">
          Secure checkout powered by Stripe · SSL encrypted
        </p>
      </div>
    </div>
  );
}
