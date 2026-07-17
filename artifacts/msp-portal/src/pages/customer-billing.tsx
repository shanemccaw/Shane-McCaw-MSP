import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Building2,
  Loader2,
  Shield,
  CreditCard,
  History,
} from "lucide-react";

import type { Invoice, StripeReceipt, Subscription, MspProfile } from "@/components/billing/billing-types";
import { BillingSummaryCards } from "@/components/billing/BillingSummaryCards";
import { SubscriptionList } from "@/components/billing/SubscriptionList";
import { InvoiceHistory } from "@/components/billing/InvoiceHistory";

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatCurrency(amount: string | number, currency: string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(num);
}

// ── Dialogs ──────────────────────────────────────────────────────────────

function CancelDialog({
  sub,
  open,
  onConfirm,
  onClose,
  loading,
}: {
  sub: Subscription;
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const periodEnd = sub.stripe?.cancelAt;
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl">Cancel subscription?</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-500">
            You&apos;re about to cancel your <strong className="text-slate-800 dark:text-slate-200">{sub.serviceName}</strong> retainer.{" "}
            {periodEnd
              ? `You'll retain access until ${formatDate(periodEnd)}, then the subscription won't renew. No further charges will be made.`
              : "Your access will continue through the end of the current billing period. No further charges will be made."
            }
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={loading} className="rounded-full">Keep subscription</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={loading}
            className="bg-rose-600 hover:bg-rose-700 text-white rounded-full border-none"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Yes, cancel
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResumeDialog({
  sub,
  open,
  onConfirm,
  onClose,
  loading,
}: {
  sub: Subscription;
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const stripe = sub.stripe;
  const amount = stripe?.amount;
  const currency = stripe?.currency ?? "usd";
  const nextBilling = stripe?.currentPeriodEnd
    ? formatDate(stripe.currentPeriodEnd)
    : null; // Assuming anchor logic handled in main component or simplified here

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl">Resume subscription?</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-500">
            You&apos;re about to resume your <strong className="text-slate-800 dark:text-slate-200">{sub.serviceName}</strong> retainer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-1 py-4">
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800/50 px-5 py-4 space-y-2">
            {amount !== null && amount !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Next charge</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(amount / 100, currency)}/month</span>
              </div>
            )}
            {nextBilling && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Billing date</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{nextBilling}</span>
              </div>
            )}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} className="rounded-full">Never mind</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full border-none"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Yes, resume
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomerBillingPage() {
  const { user, fetchWithAuth } = useAuth();

  const isPlatformBilled = (user?.mspId ?? 0) === 1;

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [stripeReceipts, setStripeReceipts] = useState<StripeReceipt[]>([]);
  const [mspProfile, setMspProfile] = useState<MspProfile | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [subLoading, setSubLoading] = useState(isPlatformBilled);
  const [receiptsLoading, setReceiptsLoading] = useState(isPlatformBilled);
  
  const [payingId, setPayingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [resumeTarget, setResumeTarget] = useState<Subscription | null>(null);
  const [resuming, setResuming] = useState(false);
  const [undoTarget, setUndoTarget] = useState<{ id: number; name: string; expiresAt: number } | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [alert, setAlert] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const UNDO_WINDOW_MS = 30_000;

  useEffect(() => {
    fetchWithAuth("/api/portal/invoices")
      .then((r) => r.json())
      .then((d) => setInvoices(d as Invoice[]))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => {
    if (!isPlatformBilled) return;
    fetchWithAuth("/api/portal/billing/subscriptions")
      .then((r) => r.json())
      .then((d) => setSubscriptions(d as Subscription[]))
      .catch(() => null)
      .finally(() => setSubLoading(false));
  }, [fetchWithAuth, isPlatformBilled]);

  useEffect(() => {
    if (!isPlatformBilled) return;
    fetchWithAuth("/api/portal/billing/stripe-receipts")
      .then((r) => r.json())
      .then((d) => setStripeReceipts(d as StripeReceipt[]))
      .catch(() => null)
      .finally(() => setReceiptsLoading(false));
  }, [fetchWithAuth, isPlatformBilled]);

  useEffect(() => {
    if (isPlatformBilled) return;
    fetchWithAuth("/api/msp/profile")
      .then((r) => (r.ok ? (r.json() as Promise<MspProfile>) : null))
      .then((d) => { if (d) setMspProfile(d); })
      .catch(() => null);
  }, [fetchWithAuth, isPlatformBilled]);

  useEffect(() => {
    if (!undoTarget) return;
    const remaining = undoTarget.expiresAt - Date.now();
    if (remaining <= 0) { setUndoTarget(null); return; }
    const id = setTimeout(() => setUndoTarget(null), remaining);
    return () => clearTimeout(id);
  }, [undoTarget]);

  const handlePay = async (invoice: Invoice) => {
    setPayingId(invoice.id);
    try {
      const res = await fetchWithAuth(`/api/portal/invoices/${invoice.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: window.location.origin }),
      });
      if (res.ok) {
        const data = await res.json() as { url: string };
        window.location.href = data.url;
      } else {
        const err = await res.json() as { error: string };
        setAlert({ type: "error", message: err.error ?? "Could not start payment. Please try again." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPayingId(null);
    }
  };

  const handleCancelConfirm = useCallback(async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await fetchWithAuth(`/api/portal/billing/subscriptions/${cancelTarget.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json() as { cancelAtPeriodEnd: boolean; cancelAt: number | null; billingCycleAnchor: number | null };
        const cancelled = cancelTarget;
        setSubscriptions((prev) =>
          prev.map((s) =>
            s.id === cancelled.id
              ? { ...s, stripe: s.stripe ? { ...s.stripe, cancelAtPeriodEnd: data.cancelAtPeriodEnd, cancelAt: data.cancelAt, billingCycleAnchor: data.billingCycleAnchor } : null }
              : s
          )
        );
        setCancelTarget(null);
        setUndoTarget({ id: cancelled.id, name: cancelled.serviceName, expiresAt: Date.now() + UNDO_WINDOW_MS });
        setAlert({ type: "success", message: `Your ${cancelled.serviceName} retainer will not renew after the current billing period.` });
      } else {
        const err = await res.json() as { error: string };
        setAlert({ type: "error", message: err.error ?? "Could not cancel subscription. Please contact support." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again or contact support." });
    } finally {
      setCancelling(false);
    }
  }, [cancelTarget, fetchWithAuth]);

  const handleUndoCancel = useCallback(async () => {
    if (!undoTarget) return;
    setUndoLoading(true);
    const target = undoTarget;
    try {
      const res = await fetchWithAuth(`/api/portal/billing/subscriptions/${target.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json() as { cancelAtPeriodEnd: boolean; cancelAt: number | null; currentPeriodEnd: number | null };
        setSubscriptions((prev) =>
          prev.map((s) =>
            s.id === target.id
              ? { ...s, stripe: s.stripe ? { ...s.stripe, cancelAtPeriodEnd: data.cancelAtPeriodEnd, cancelAt: data.cancelAt, currentPeriodEnd: data.currentPeriodEnd } : null }
              : s
          )
        );
        setUndoTarget(null);
        setAlert({ type: "success", message: `Cancellation undone — your ${target.name} retainer will keep renewing.` });
      } else {
        const err = await res.json() as { error: string };
        setAlert({ type: "error", message: err.error ?? "Could not undo cancellation. Please contact support." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setUndoLoading(false);
    }
  }, [undoTarget, fetchWithAuth]);

  const handleResumeConfirm = useCallback(async () => {
    if (!resumeTarget) return;
    setResuming(true);
    try {
      const res = await fetchWithAuth(`/api/portal/billing/subscriptions/${resumeTarget.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json() as { cancelAtPeriodEnd: boolean; cancelAt: number | null; currentPeriodEnd: number | null };
        setSubscriptions((prev) =>
          prev.map((s) =>
            s.id === resumeTarget.id
              ? { ...s, stripe: s.stripe ? { ...s.stripe, cancelAtPeriodEnd: data.cancelAtPeriodEnd, cancelAt: data.cancelAt, currentPeriodEnd: data.currentPeriodEnd } : null }
              : s
          )
        );
        setResumeTarget(null);
        setAlert({ type: "success", message: `Your ${resumeTarget.serviceName} retainer has been resumed and will continue renewing.` });
      } else {
        const err = await res.json() as { error: string };
        setAlert({ type: "error", message: err.error ?? "Could not resume subscription. Please try again." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setResuming(false);
    }
  }, [resumeTarget, fetchWithAuth]);

  return (
    <AppShell title="Billing Command Center">
      <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Billing Center</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm sm:text-base max-w-2xl">
              {isPlatformBilled
                ? "Manage your enterprise retainers, review invoice history, and access secure Stripe receipts."
                : "View your invoice history and payment records for your organization."}
            </p>
          </div>
          
          <div className="flex items-center gap-3 bg-white/5 dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-slate-800/50 rounded-full px-5 py-2.5 shadow-sm">
            <Shield className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Bank-grade encryption</span>
          </div>
        </div>

        {/* Global Alert Notification */}
        {alert && (
          <div className={`flex items-center gap-4 px-5 py-4 rounded-2xl border shadow-sm animate-in zoom-in-95 duration-200 ${
            alert.type === "success" ? "bg-emerald-50/50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-900 dark:text-emerald-300" : "bg-rose-50/50 border-rose-200 text-rose-800 dark:bg-rose-950/20 dark:border-rose-900 dark:text-rose-300"
          }`}>
            {alert.type === "success"
              ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-500" />
              : <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-500" />
            }
            <p className="text-sm font-medium flex-1">{alert.message}</p>
            <button onClick={() => setAlert(null)} className="opacity-60 hover:opacity-100 transition-opacity bg-black/5 dark:bg-white/5 rounded-full p-1.5">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Non-platform-billed: managed-by notice */}
        {!isPlatformBilled && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-900/20 px-6 py-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Building2 className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-800 dark:text-slate-100">Subscription managed by your MSP</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Your subscription is managed by{" "}
                <strong className="text-slate-700 dark:text-slate-300">{mspProfile?.name ?? "your service provider"}</strong>. Please contact them directly to make changes or adjust billing.
              </p>
            </div>
          </div>
        )}

        {/* High Level Billing Summary */}
        <BillingSummaryCards invoices={invoices} />

        {/* Main Grid Layout (Split-pane on Desktop) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
          
          {/* Left Column: Subscriptions */}
          {isPlatformBilled && (
            <div className="xl:col-span-7 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-5 h-5 text-blue-500" />
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Active Retainers</h2>
              </div>
              <SubscriptionList
                subscriptions={subscriptions}
                loading={subLoading}
                onCancel={setCancelTarget}
                onResume={setResumeTarget}
                cancelling={cancelling}
                fetchWithAuth={fetchWithAuth}
                onAlert={setAlert}
                undoTarget={undoTarget}
                onUndo={handleUndoCancel}
                undoLoading={undoLoading}
              />
            </div>
          )}

          {/* Right Column: Invoice History */}
          <div className={isPlatformBilled ? "xl:col-span-5 space-y-4" : "xl:col-span-12 space-y-4"}>
            <div className="flex items-center gap-2 mb-2">
              <History className="w-5 h-5 text-purple-500" />
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Recent Transactions</h2>
            </div>
            <InvoiceHistory
              invoices={invoices}
              stripeReceipts={stripeReceipts}
              loading={loading}
              receiptsLoading={receiptsLoading}
              isPlatformBilled={isPlatformBilled}
              fetchWithAuth={fetchWithAuth}
              onPay={handlePay}
              payingId={payingId}
            />
          </div>
          
        </div>

        {/* Dialogs */}
        {cancelTarget && (
          <CancelDialog
            sub={cancelTarget}
            open={!!cancelTarget}
            onConfirm={() => void handleCancelConfirm()}
            onClose={() => setCancelTarget(null)}
            loading={cancelling}
          />
        )}
        {resumeTarget && (
          <ResumeDialog
            sub={resumeTarget}
            open={!!resumeTarget}
            onConfirm={() => void handleResumeConfirm()}
            onClose={() => setResumeTarget(null)}
            loading={resuming}
          />
        )}
      </div>
    </AppShell>
  );
}
