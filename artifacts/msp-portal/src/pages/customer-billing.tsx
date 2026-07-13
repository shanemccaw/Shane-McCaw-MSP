import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Download,
  CreditCard,
  RefreshCw,
  Building2,
  Loader2,
  Shield,
  Undo2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Invoice {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  pdfFilename: string | null;
  createdAt: string;
}

interface StripeReceipt {
  id: string;
  number: string | null;
  amount: number;
  currency: string;
  status: string;
  date: number;
  invoicePdf: string | null;
}

interface Subscription {
  id: number;
  serviceId: number;
  serviceName: string;
  serviceSlug: string | null;
  status: string;
  startDate: string | null;
  purchasedAt: string;
  stripeSubscriptionId: string | null;
  stripe: {
    status: string;
    cancelAtPeriodEnd: boolean;
    cancelAt: number | null;
    billingCycleAnchor: number | null;
    currentPeriodEnd: number | null;
    amount: number | null;
    currency: string | null;
  } | null;
}

interface MspProfile {
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  paid: { label: "Paid", classes: "bg-green-100 text-green-700 border-green-200" },
  due: { label: "Due", classes: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  overdue: { label: "Overdue", classes: "bg-red-100 text-red-700 border-red-200" },
  draft: { label: "Draft", classes: "bg-gray-100 text-gray-500 border-gray-200" },
};

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

// ── SubscriptionCard ──────────────────────────────────────────────────────────

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
}: {
  sub: Subscription;
  onCancel: (sub: Subscription) => void;
  onResume: (sub: Subscription) => void;
  cancelling: boolean;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onAlert: (a: { type: "success" | "error"; message: string }) => void;
  undoExpiresAt: number | null;
  onUndo: () => void;
  undoLoading: boolean;
}) {
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
    <div className="flex flex-col">
      {showUndoBanner && (
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-orange-50 border-b border-orange-200">
          <p className="text-xs text-orange-800 font-medium">
            Subscription cancelled — changed your mind?
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 bg-orange-600 hover:bg-orange-700 text-xs"
              onClick={onUndo}
              disabled={undoLoading}
            >
              {undoLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Undo2 className="w-3 h-3 mr-1" />
              )}
              Undo cancel
            </Button>
            <span className="text-xs text-orange-500 font-medium tabular-nums w-6 text-right">{secondsLeft}s</span>
          </div>
        </div>
      )}
      <div className="px-5 py-5 flex items-start gap-4 flex-wrap sm:flex-nowrap">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <RefreshCw className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-sm font-bold">{sub.serviceName}</p>
            {isCanceled ? (
              <Badge variant="secondary">Canceled</Badge>
            ) : isCancelPending ? (
              <Badge className="bg-orange-100 text-orange-700 border-orange-200 border">
                Cancels {cancelAt ? formatDate(cancelAt) : "at period end"}
              </Badge>
            ) : isActive ? (
              <Badge className="bg-green-100 text-green-700 border-green-200 border">Active</Badge>
            ) : (
              <Badge variant="secondary">{stripe?.status ?? sub.status}</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {amount !== null && amount !== undefined && (
              <span className="font-medium text-foreground">
                {formatCurrency(amount / 100, currency)}/month
              </span>
            )}
            {!isCancelPending && !isCanceled && nextBilling && isActive && (
              <span>Next billing: {nextBilling}</span>
            )}
            {sub.startDate && (
              <span>
                Started {new Date(sub.startDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            )}
            {!sub.stripeSubscriptionId && (
              <span className="italic">Manually assigned — contact support to manage</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 ml-auto self-center flex flex-col gap-2 items-end">
          {isCanceled && sub.stripeSubscriptionId && (
            <Button size="sm" onClick={() => void handleResubscribe()} disabled={resubLoading}>
              {resubLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Re-purchase
            </Button>
          )}
          {isCancelPending && sub.stripeSubscriptionId && (
            <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" onClick={() => onResume(sub)}>
              Resume subscription
            </Button>
          )}
          {!isCancelPending && !isCanceled && isActive && sub.stripeSubscriptionId && (
            <>
              <Button size="sm" variant="outline" onClick={() => void handleManagePayment()} disabled={portalLoading}>
                {portalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CreditCard className="w-3.5 h-3.5 mr-1" />}
                Manage payment method
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/30 hover:border-destructive/60 hover:bg-destructive/5"
                onClick={() => onCancel(sub)}
                disabled={cancelling}
              >
                Cancel subscription
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CancelDialog ──────────────────────────────────────────────────────────────

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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;re about to cancel your <strong>{sub.serviceName}</strong> retainer.{" "}
            {periodEnd
              ? `You'll retain access until ${formatDate(periodEnd)}, then the subscription won't renew. No further charges will be made.`
              : "Your access will continue through the end of the current billing period. No further charges will be made."
            }
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Keep subscription</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Yes, cancel
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── ResumeDialog ──────────────────────────────────────────────────────────────

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
    : nextBillingFromAnchor(stripe?.billingCycleAnchor ?? null);

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resume subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;re about to resume your <strong>{sub.serviceName}</strong> retainer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-6 pb-2">
          <div className="bg-muted rounded-xl border border-border px-4 py-3 space-y-1.5">
            {amount !== null && amount !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Next charge</span>
                <span className="font-semibold">{formatCurrency(amount / 100, currency)}/month</span>
              </div>
            )}
            {nextBilling && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Billing date</span>
                <span className="font-semibold">{nextBilling}</span>
              </div>
            )}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Never mind</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700 text-white"
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
  const [paying, setPayingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [resumeTarget, setResumeTarget] = useState<Subscription | null>(null);
  const [resuming, setResuming] = useState(false);
  const [undoTarget, setUndoTarget] = useState<{ id: number; name: string; expiresAt: number } | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [alert, setAlert] = useState<{ type: "success" | "error"; message: string } | null>(null);

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

  const UNDO_WINDOW_MS = 30_000;

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

  const totalDue = invoices
    .filter((i) => i.status === "due" || i.status === "overdue")
    .reduce((sum, i) => sum + parseFloat(i.amount), 0);
  const totalPaid = invoices.filter((i) => i.status === "paid").reduce((sum, i) => sum + parseFloat(i.amount), 0);

  return (
    <AppShell title="Billing">
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Billing &amp; Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isPlatformBilled
              ? "Manage your retainer subscriptions and view invoices."
              : "View your invoice history and payment records."}
          </p>
        </div>

        {alert && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
            alert.type === "success" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"
          }`}>
            {alert.type === "success"
              ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              : <AlertCircle className="w-5 h-5 flex-shrink-0" />
            }
            <p className="text-sm font-medium flex-1">{alert.message}</p>
            <button onClick={() => setAlert(null)} className="opacity-60 hover:opacity-100 transition-opacity">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Non-platform-billed: managed-by notice ─────────────────── */}
        {!isPlatformBilled && (
          <div className="rounded-2xl border border-border bg-muted/30 px-5 py-4">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Subscription managed by your MSP</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Your subscription is managed by{" "}
                  <strong>{mspProfile?.name ?? "your service provider"}</strong>. Contact them directly to make changes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Platform-billed: Monthly Retainers ────────────────────── */}
        {isPlatformBilled && (subLoading || subscriptions.length > 0) && (
          <div>
            <h2 className="text-base font-semibold mb-3">Monthly Retainers</h2>
            {subLoading ? (
              <Card>
                <CardContent className="flex items-center gap-3 py-6 text-muted-foreground text-sm">
                  <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />
                  Loading subscriptions…
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="divide-y divide-border">
                  {subscriptions.map((sub) => (
                    <SubscriptionCard
                      key={sub.id}
                      sub={sub}
                      onCancel={setCancelTarget}
                      onResume={setResumeTarget}
                      cancelling={cancelling && cancelTarget?.id === sub.id}
                      fetchWithAuth={fetchWithAuth}
                      onAlert={setAlert}
                      undoExpiresAt={undoTarget?.id === sub.id ? undoTarget.expiresAt : null}
                      onUndo={handleUndoCancel}
                      undoLoading={undoLoading && undoTarget?.id === sub.id}
                    />
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── Invoice summary cards ──────────────────────────────────── */}
        {!loading && invoices.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Invoiced</p>
                <p className="text-xl font-extrabold">
                  {formatCurrency(String(invoices.reduce((s, i) => s + parseFloat(i.amount), 0)), "usd")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Amount Paid</p>
                <p className="text-xl font-extrabold text-green-700">{formatCurrency(String(totalPaid), "usd")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Outstanding</p>
                <p className={`text-xl font-extrabold ${totalDue > 0 ? "text-red-600" : ""}`}>
                  {formatCurrency(String(totalDue), "usd")}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Invoice list ───────────────────────────────────────────── */}
        <div>
          <h2 className="text-base font-semibold mb-3">Invoice History</h2>
          {loading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </CardContent>
            </Card>
          ) : invoices.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <CreditCard className="w-7 h-7 text-primary" />
                </div>
                <CardTitle className="text-base mb-1">No invoices yet</CardTitle>
                <CardDescription>Your invoices will appear here.</CardDescription>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="divide-y divide-border">
                {invoices.map((inv) => {
                  const config = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.draft;
                  const canPay = inv.status === "due" || inv.status === "overdue";
                  return (
                    <div key={inv.id} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <CreditCard className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="text-sm font-bold">{inv.invoiceNumber}</p>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${config.classes}`}>{config.label}</span>
                        </div>
                        {inv.description && <p className="text-xs text-muted-foreground truncate">{inv.description}</p>}
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                          {inv.dueDate && inv.status !== "paid" && (
                            <span>Due {new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                          )}
                          {inv.paidAt && (
                            <span className="text-green-600 font-medium">
                              Paid {new Date(inv.paidAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
                        <p className="text-base font-extrabold">
                          {formatCurrency(inv.amount, inv.currency)}
                        </p>
                        <div className="flex items-center gap-2">
                          {inv.pdfFilename && (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              title="Download PDF"
                              onClick={async () => {
                                const r = await fetchWithAuth(`/api/portal/invoices/${inv.id}/download`);
                                const blob = await r.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `Invoice-${inv.invoiceNumber ?? inv.id}.pdf`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          )}
                          {canPay && (
                            <Button
                              size="sm"
                              onClick={() => void handlePay(inv)}
                              disabled={paying === inv.id}
                            >
                              {paying === inv.id ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-1" />
                              ) : (
                                <CreditCard className="w-4 h-4 mr-1" />
                              )}
                              Pay Now
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* ── Subscription Receipts (platform-billed only) ───────────── */}
        {isPlatformBilled && (receiptsLoading || stripeReceipts.length > 0) && (
          <div>
            <h2 className="text-base font-semibold mb-3">Subscription Receipts</h2>
            {receiptsLoading ? (
              <Card>
                <CardContent className="flex items-center gap-3 py-6 text-muted-foreground text-sm">
                  <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />
                  Loading receipts…
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="divide-y divide-border">
                  {stripeReceipts.map((receipt) => {
                    const isPaid = receipt.status === "paid";
                    const statusClasses = isPaid
                      ? "bg-green-100 text-green-700 border-green-200"
                      : receipt.status === "open"
                      ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                      : "bg-gray-100 text-gray-500 border-gray-200";
                    const statusLabel = isPaid
                      ? "Paid"
                      : receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1);
                    return (
                      <div key={receipt.id} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <RefreshCw className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <p className="text-sm font-bold">{receipt.number ?? receipt.id}</p>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusClasses}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(receipt.date * 1000).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
                          <p className="text-base font-extrabold">
                            {formatCurrency(receipt.amount / 100, receipt.currency)}
                          </p>
                          {receipt.invoicePdf && (
                            <a
                              href={receipt.invoicePdf}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Download PDF"
                            >
                              <Button variant="outline" size="icon" className="h-8 w-8">
                                <Download className="w-4 h-4" />
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── Security footer ────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-center gap-3">
          <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Payments are processed securely via Stripe. Your card details are never stored on our servers.
          </p>
        </div>

        {/* ── Dialogs ────────────────────────────────────────────────── */}
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
