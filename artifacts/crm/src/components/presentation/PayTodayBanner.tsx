import { useState, useEffect } from "react";

export interface OfferState {
  active: boolean;
  expiresAt: string | null;
  savingsAmount: number;
  discountedTotal: number;
  originalTotal: number;
  variant: "adjustments_waived" | "percentage_off" | null;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function useCountdown(expiresAt: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) { setRemaining(null); return; }
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

function formatCountdown(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface PayTodayBannerProps {
  offer: OfferState | null;
}

export default function PayTodayBanner({ offer }: PayTodayBannerProps) {
  const remaining = useCountdown(offer?.active ? (offer.expiresAt ?? null) : null);

  if (!offer?.active || remaining === null || remaining <= 0) return null;

  return (
    <div className="flex-shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 flex items-center gap-3 text-white">
      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight">
          {"Pay Today & Save "}
          {formatCurrency(offer.savingsAmount)}
          {offer.variant === "adjustments_waived" ? " — Adjustments Waived" : " (15% off)"}
        </p>
        <p className="text-xs text-white/90 mt-0.5">
          {"Pay in full now for "}
          <span className="font-bold">{formatCurrency(offer.discountedTotal)}</span>
          {" (normally "}
          <span className="line-through opacity-80">{formatCurrency(offer.originalTotal)}</span>
          {") · Offer expires in "}
          <span className="font-bold tabular-nums">{formatCountdown(remaining)}</span>
        </p>
      </div>
    </div>
  );
}
