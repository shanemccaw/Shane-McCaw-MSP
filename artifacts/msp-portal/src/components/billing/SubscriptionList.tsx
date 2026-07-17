import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, CreditCard, Undo2, Package } from "lucide-react";
import type { Subscription } from "./billing-types";

// Helper functions (could be moved to a utils file but kept here for self-containment)
function formatCurrency(amount: string | number, currency: string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(num);
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function nextBillingFromAnchor(anchor: number | null): string | null {
  if (!anchor) return null;
  const anchorDate = new Date(anchor * 1000);
  const dayOfMonth = anchorDate.getUTCDate();
  const now = new Date();
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth));
  if (candidate <= now) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  return candidate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface SubscriptionCardProps {
  sub: Subscription;
  onCancel: (sub: Subscription) => void;
  onResume: (sub: Subscription) => void;
  cancelling: boolean;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onAlert: (a: { type: "success" | "error"; message: string }) => void;
  undoExpiresAt: number | null;
  onUndo: () => void;
  undoLoading: boolean;
}

function SubscriptionCard({
  sub,
  onCancel,
  onResume,
  cancelling,
  fetchWithAuth,
  onAlert,
  undoExpiresAt,
  onUndo,
  undoLoading,
}: SubscriptionCardProps) {
  const [portalLoading, setPortalLoading] = useState(false);
  const [resubLoading, setResubLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    if (!undoExpiresAt) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((undoExpiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [undoExpiresAt]);

  const stripe = sub.stripe;
  const isCanceled = stripe?.status === "canceled";
  const isCancelPending = stripe?.cancelAtPeriodEnd === true && !isCanceled;
  const isActive = stripe
    ? (stripe.status === "active" || stripe.status === "trialing")
    : sub.status === "active";
  const cancelAt = stripe?.cancelAt ?? null;
  const amount = stripe?.amount;
  const currency = stripe?.currency ?? "usd";

  const nextBilling = stripe?.currentPeriodEnd
    ? formatDate(stripe.currentPeriodEnd)
    : nextBillingFromAnchor(stripe?.billingCycleAnchor ?? null);

  const handleManagePayment = async () => {
    setPortalLoading(true);
    try {
      const res = await fetchWithAuth("/api/portal/billing/customer-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json() as { url: string };
        window.location.href = data.url;
      } else {
        const err = await res.json() as { error: string };
        onAlert({ type: "error", message: err.error ?? "Could not open payment portal. Please try again." });
      }
    } catch {
      onAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPortalLoading(false);
    }
  };

  const handleResubscribe = async () => {
    setResubLoading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/billing/subscriptions/${sub.id}/resubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: window.location.origin }),
      });
      if (res.ok) {
        const data = await res.json() as { url: string };
        window.location.href = data.url;
      } else {
        const err = await res.json() as { error: string };
        onAlert({ type: "error", message: err.error ?? "Could not start checkout. Please try again." });
      }
    } catch {
      onAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setResubLoading(false);
    }
  };

  const showUndoBanner = isCancelPending && undoExpiresAt !== null && secondsLeft > 0;

  return (
    <div className="group relative bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-2xl overflow-hidden hover:shadow-md transition-all duration-300">
      {/* Glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/0 to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      {showUndoBanner && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 bg-amber-500/10 border-b border-amber-500/20">
          <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            Subscription cancelled — changed your mind?
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 bg-amber-500 text-white hover:bg-amber-600 border-none text-xs"
              onClick={onUndo}
              disabled={undoLoading}
            >
              {undoLoading ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Undo2 className="w-3 h-3 mr-1" />
              )}
              Undo cancel
            </Button>
            <span className="text-xs text-amber-500 font-bold tabular-nums w-6 text-right">{secondsLeft}s</span>
          </div>
        </div>
      )}
      
      <div className="px-5 py-5 flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="w-6 h-6 text-primary" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1.5">
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">{sub.serviceName}</p>
            {isCanceled ? (
              <Badge variant="secondary" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-transparent">Canceled</Badge>
            ) : isCancelPending ? (
              <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                Cancels {cancelAt ? formatDate(cancelAt) : "at period end"}
              </Badge>
            ) : isActive ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">Active</Badge>
            ) : (
              <Badge variant="secondary" className="border-transparent">{stripe?.status ?? sub.status}</Badge>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
            {amount !== null && amount !== undefined && (
              <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                <CreditCard className="w-4 h-4 text-slate-400" />
                {formatCurrency(amount / 100, currency)}<span className="text-xs text-slate-400 font-normal">/month</span>
              </div>
            )}
            {!isCancelPending && !isCanceled && nextBilling && isActive && (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 hidden sm:block" />
                Next billing: <span className="font-medium text-slate-700 dark:text-slate-300">{nextBilling}</span>
              </div>
            )}
            {!sub.stripeSubscriptionId && (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 hidden sm:block" />
                <span className="italic">Manually assigned — contact support to manage</span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex-shrink-0 flex flex-wrap gap-2 items-center">
          {isCanceled && sub.stripeSubscriptionId && (
            <Button size="sm" onClick={() => void handleResubscribe()} disabled={resubLoading} className="rounded-full px-4">
              {resubLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Re-purchase
            </Button>
          )}
          {isCancelPending && sub.stripeSubscriptionId && (
            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10 rounded-full px-4" onClick={() => onResume(sub)}>
              Resume subscription
            </Button>
          )}
          {!isCancelPending && !isCanceled && isActive && sub.stripeSubscriptionId && (
            <>
              <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => void handleManagePayment()} disabled={portalLoading}>
                {portalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Manage payment
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-rose-500 border-rose-500/30 hover:border-rose-500 hover:bg-rose-500/10 rounded-full px-4"
                onClick={() => onCancel(sub)}
                disabled={cancelling}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SubscriptionList({
  subscriptions,
  loading,
  onCancel,
  onResume,
  cancelling,
  fetchWithAuth,
  onAlert,
  undoTarget,
  onUndo,
  undoLoading,
}: {
  subscriptions: Subscription[];
  loading: boolean;
  onCancel: (sub: Subscription) => void;
  onResume: (sub: Subscription) => void;
  cancelling: boolean;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onAlert: (a: { type: "success" | "error"; message: string }) => void;
  undoTarget: { id: number; name: string; expiresAt: number } | null;
  onUndo: () => void;
  undoLoading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse bg-white/5 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl h-24" />
        ))}
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <div className="bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-2xl p-12 text-center flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <Package className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">No Active Subscriptions</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          You don't currently have any active monthly retainers or subscriptions on your account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {subscriptions.map((sub) => (
        <SubscriptionCard
          key={sub.id}
          sub={sub}
          onCancel={onCancel}
          onResume={onResume}
          cancelling={cancelling && (undoTarget?.id !== sub.id)}
          fetchWithAuth={fetchWithAuth}
          onAlert={onAlert}
          undoExpiresAt={undoTarget?.id === sub.id ? undoTarget.expiresAt : null}
          onUndo={onUndo}
          undoLoading={undoLoading && undoTarget?.id === sub.id}
        />
      ))}
    </div>
  );
}
